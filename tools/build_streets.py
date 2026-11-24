"""Index roads crossing streaming-region boundaries and attach surveyed street attributes.

Use the same OSM extract as the road import so tagged control nodes and every
approaching road are available. Run from the project root:
.venv/bin/python tools/build_streets.py region.osm.pbf
Run again after rebuilding road geometry or bridge elevations.
"""
import argparse
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

import osmium
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep
from build_map import ROAD_CLS, proj
from traffic_controls import TrafficControls

MAP = Path(__file__).resolve().parents[1] / 'assets/map'
REGION_DM = 20480
CHUNK = 8
# Conservative storage margin. The runtime uses each edge's actual painted width.
PAD_DM = 320
MATERIAL = {'concrete': 'concrete', 'concrete:plates': 'concrete', 'bricks': 'brick',
            'paving_stones': 'pavers', 'sett': 'pavers'}
TURN = {'through': 1, 'left': 2, 'sharp_left': 2, 'right': 4, 'sharp_right': 4,
        'slight_left': 8, 'slight_right': 16}


def lane_count(s):
    return int(s) if s and s.isdigit() and 0 <= int(s) <= 10 else None


def arrows(value):
    if not value:
        return None
    masks = []
    for lane in value.split('|'):
        mask = 0
        for move in lane.split(';'):
            if move not in TURN and move not in ('none', ''):
                mask = 0
                break
            mask |= TURN.get(move, 0)
        masks.append(mask)
    return masks if any(masks) else None


class Survey(osmium.SimpleHandler):
    def __init__(self, boundary):
        super().__init__()
        self.segments = {}
        self.boundary = boundary
        self.walks = []
        self.controls = TrafficControls()

    def node(self, node):
        self.controls.node(node)

    def way(self, way):
        t = way.tags
        cls = ROAD_CLS.get(t.get('highway'))
        if cls is None:
            return
        if t.get('highway') == 'footway' and t.get('footway') == 'sidewalk':
            if t.get('area') == 'yes' or t.get('indoor') == 'yes' or t.get('tunnel') not in (None, 'no'):
                return
            pts = [proj(nd.lon, nd.lat) for nd in way.nodes if nd.location.valid()]
            if len(pts) < 2 or not self.boundary.intersects(LineString(pts)):
                return
            try:
                width = round(10 * float(t.get('width', '1.65')))
            except (ValueError, OverflowError):
                width = 17
            dm = [tuple(round(i * 10) for i in pt) for pt in pts]
            flags = 2 if t.get('bridge') not in (None, 'no') else 0
            self.walks.append((way.id, width if 7 <= width <= 100 else 17, MATERIAL.get(t.get('surface')), flags, dm))
            return
        sidewalk = t.get('sidewalk') or t.get('sidewalk:both')
        side_values = {'yes': 1, 'no': 0, 'none': 0, 'separate': 2}
        sides = [side_values.get(sidewalk)] * 2
        if sidewalk in ('both', 'left', 'right'):
            sides = [int(sidewalk in ('both', 'left')), int(sidewalk in ('both', 'right'))]
        for i, key in enumerate(('sidewalk:left', 'sidewalk:right')):
            sides[i] = side_values.get(t.get(key), sides[i])
        if cls == 15 or sides == [None, None]:
            sides = None
        ow = t.get('oneway')
        oneway = ow in ('yes', 'true', '1', '-1') or (ow is None and
            (cls in (0, 10) or t.get('junction') in ('roundabout', 'circular')))
        rev = t.get('oneway') == '-1'
        self.controls.way(way, cls, oneway, rev)
        fw = lane_count(t.get('lanes:forward'))
        bw = lane_count(t.get('lanes:backward'))
        center = lane_count(t.get('lanes:both_ways'))
        mat = MATERIAL.get(t.get('surface'))
        fa = arrows(t.get('turn:lanes:forward') or (t.get('turn:lanes') if oneway and not rev else None))
        ba = arrows(t.get('turn:lanes:backward') or (t.get('turn:lanes') if rev else None))
        if not (mat or fa or ba or fw or bw or center is not None or sides):
            return
        if any(not nd.location.valid() for nd in way.nodes) or len(way.nodes) < 2:
            return
        coords = [tuple(round(i * 10) for i in proj(nd.lon, nd.lat)) for nd in way.nodes]
        if rev:
            coords.reverse()
            fa, ba, fw, bw = ba, fa, bw, fw
            if sides:
                sides.reverse()
        row = (fw, bw, center, mat, fa, ba, coords[0], coords[-1], sides)
        for a, b in zip(coords, coords[1:]):
            if a == b:
                continue
            key = (cls, a, b)
            # Coincident ways with conflicting tags cannot be resolved by geometry.
            self.segments[key] = row if key not in self.segments or self.segments[key] == row else None

    def match(self, road, pts):
        rows = (self.segments.get((road[0], a, b)) for a, b in zip(pts, pts[1:]))
        row = next((r for r in rows if r is not None), None)
        if not row:
            return None
        fw, bw, center, mat, fa, ba, start, end, sides = row
        lanes = road[2]
        traits = {}
        if mat:
            traits['material'] = mat
        if sides:
            traits['sides'] = sides
        if road[1] & 1:
            fw, bw = lanes, 0
        else:
            if fw is None and fa:
                fw = len(fa)
            if bw is None and ba:
                bw = len(ba)
            if center is None and fw is not None and bw is not None:
                center = lanes - fw - bw
            center = center or 0
            if fw is None and bw is not None:
                fw = lanes - bw - center
            if bw is None and fw is not None:
                bw = lanes - fw - center
            if fw is None and bw is None and center == 1 and lanes % 2 == 1:
                fw = bw = (lanes - 1) // 2
            if fw and bw and fw > 0 and bw > 0 and center in (0, 1) and fw + bw + center == lanes:
                traits['split'] = [bw, center, fw]
        if fa and len(fa) == fw and pts[-1] == end:
            traits['ahead'] = fa
        if ba and len(ba) == bw and pts[0] == start:
            traits['back'] = ba
        return traits or None


def touching_regions(pts, pad):
    touched = set()
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        for ty in range((min(ay, by) - pad) // REGION_DM, (max(ay, by) + pad) // REGION_DM + 1):
            for tx in range((min(ax, bx) - pad) // REGION_DM, (max(ax, bx) + pad) // REGION_DM + 1):
                touched.add((tx, ty))
    return touched


def build(source):
    world = json.loads((MAP / 'meta.json').read_text())['world']
    survey = Survey(prep(unary_union([Polygon(ring) for ring in world])))
    survey.apply_file(str(source), locations=True)
    survey.controls.finish()
    regions = defaultdict(lambda: {'local': {}, 'cross': [], 'walks': []})
    counts = Counter()
    for osm_id, width, mat, flags, pts in survey.walks:
        encoded = []
        px = py = 0
        for x, y in pts:
            encoded.extend((x - px, y - py))
            px, py = x, y
        record = [osm_id, width, mat, flags, encoded]
        for region in touching_regions(pts, width // 2 + 4):
            regions[region]['walks'].append(record)
    counts['sidewalks'] = len(survey.walks)
    for path in sorted((MAP / 'r').glob('*.json.gz')):
        rx, ry = map(int, path.name.split('.')[0].split('_'))
        with gzip.open(path) as f:
            roads = json.load(f)['roads']
        for i, road in enumerate(roads):
            x = y = 0
            pts = []
            encoded = road[8]
            for dx, dy in zip(encoded[::2], encoded[1::2]):
                x += dx
                y += dy
                pts.append((x, y))
            traits = survey.match(road, pts)
            controls = survey.controls.match(road, pts)
            if controls:
                traits = {**(traits or {}), 'controls': controls}
            if traits:
                regions[rx, ry]['local'][i] = traits
                counts.update(traits.keys())
            touched = touching_regions(pts, PAD_DM) - {(rx, ry)}
            if touched:
                counts['boundary roads'] += 1
                shared = [rx, ry, i, road]
                if traits:
                    shared.append(traits)
                for target in touched:
                    regions[target]['cross'].append(shared)
    counts.update(survey.controls.nodes[k][0] for k in survey.controls.used)
    out = MAP / 'streets'
    out.mkdir(exist_ok=True)
    chunks = defaultdict(dict)
    for (rx, ry), value in sorted(regions.items()):
        chunks[rx // CHUNK, ry // CHUNK][f'{rx},{ry}'] = value
    encode = lambda v: json.dumps(v, separators=(',', ':')).encode()
    for (cx, cy), chunk in chunks.items():
        (out / f'{cx}_{cy}.json.gz').write_bytes(gzip.compress(encode(chunk), mtime=0))
    (out / 'index.json').write_bytes(encode({'chunk': CHUNK, 'regions': sorted(regions), 'counts': counts}))
    print(f'{len(regions)} regions in {len(chunks)} chunks. {dict(counts)}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    build(parser.parse_args().source)
