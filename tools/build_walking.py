"""Build the pedestrian GPS network from the same OSM extract as the world."""
import argparse
from array import array
from collections import Counter
import json

import osmium
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

from build_map import F_ONEWAY, ROAD_CLS, proj
from build_navigation import MAP, write_graph


class Walks(osmium.SimpleHandler):
    def __init__(self, boundary, names):
        super().__init__()
        self.boundary = boundary
        self.names = names
        self.ways = []
        self.uses = Counter()
        self.blocked = set()

    def node(self, node):
        if not node.tags:
            return
        if node.tags.get('foot', node.tags.get('access')) in ('no', 'private'):
            self.blocked.add(node.id)

    def way(self, way):
        tags = way.tags
        highway = tags.get('highway')
        if highway not in ROAD_CLS or highway in ('motorway', 'motorway_link', 'trunk', 'trunk_link', 'raceway', 'busway'):
            return
        foot = tags.get('foot', tags.get('access'))
        if foot in ('no', 'private', 'use_sidepath', 'customers', 'permit', 'delivery', 'agricultural', 'forestry'):
            return
        # The River Parks trails and Williams Crossing include cycleways with
        # no foot tag. Keep these links unless the mapper excludes pedestrians.
        if highway == 'bridleway' and tags.get('foot') not in ('yes', 'designated', 'permissive'):
            return
        if tags.get('area') == 'yes' or tags.get('indoor') == 'yes' or tags.get('motorroad') == 'yes':
            return
        if not all(n.location.valid() for n in way.nodes):
            return
        points = [(n.ref, *proj(n.lon, n.lat)) for n in way.nodes]
        if len(points) < 2:
            return
        line = LineString([(x, y) for _, x, y in points])
        if not self.boundary.intersects(line):
            return
        if tags.get('oneway:foot') == '-1':
            points.reverse()
        flags = F_ONEWAY if tags.get('oneway:foot') in ('yes', 'true', '1', '-1') else 0
        cls = ROAD_CLS[highway]
        name = self.names.get(tags.get('name'), -1)
        contained = self.boundary.covers(line)
        run = []
        for ref, x, y in points:
            p = (ref, round(x * 10), round(y * 10))
            if ref in self.blocked:
                self.record(run, cls, flags, name)
                run = []
                continue
            if run and not contained:
                last = run[-1]
                if not self.boundary.covers(LineString([(last[1]/10, last[2]/10), (x, y)])):
                    self.record(run, cls, flags, name)
                    run = []
            run.append(p)
        self.record(run, cls, flags, name)

    def record(self, points, cls, flags, name):
        if len(points) >= 2:
            self.ways.append((points, cls, flags, name))
            self.uses.update(ref for ref, _, _ in points)


def build(source):
    meta = json.loads((MAP / 'meta.json').read_text())
    ways = Walks(prep(unary_union([Polygon(r) for r in meta['world']])),
                 {name: i for i, name in enumerate(meta['names'])})
    ways.apply_file(str(source), locations=True)
    nodes = {}
    ends, offsets, names, kinds, points = (array('i') for _ in range(5))
    for coords, cls, flags, name in ways.ways:
        start = 0
        for i in range(1, len(coords)):
            if i != len(coords)-1 and ways.uses[coords[i][0]] == 1:
                continue
            a, b = coords[start][0], coords[i][0]
            ends.extend([nodes.setdefault(a, len(nodes)), nodes.setdefault(b, len(nodes))])
            offsets.append(len(points) // 2)
            names.append(name)
            kinds.append(cls | flags << 8)
            px = py = 0
            for _, x, y in coords[start:i+1]:
                points.extend([x - px, y - py])
                px, py = x, y
            start = i
    offsets.append(len(points) // 2)
    write_graph(MAP / 'walking.bin.gz', len(nodes), ends, offsets, names, kinds, points)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    build(parser.parse_args().source)
