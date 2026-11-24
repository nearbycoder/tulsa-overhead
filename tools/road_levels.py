#!/usr/bin/env python3
"""Give overpasses, bridges and their ramps real heights in the region files.

  .venv/bin/python tools/road_levels.py        (run after build_map.py / import_gt_tulsa.py; safe to re-run)

OpenStreetMap marks bridges with bridge=yes and a layer, but also tags creek culverts the same way.
A bridge edge is raised only when it really passes over something: another drivable road on a lower
layer, a railway or a river. Its deck sits at 6.2 m per layer. Every road connected to a raised deck
then ramps down at a 5 % grade (embankments and on-ramps), so a motorway climbs onto an overpass
and slip roads rise to meet it.

Each affected road record gets a 10th field: per-vertex height in decimetres. Raised edges are
densified to <= 15 m segments so ramps are smooth.
"""
import gzip, json, math, os, sys, time, heapq
from collections import defaultdict

from shapely.geometry import LineString
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RDIR = os.path.join(ROOT, 'assets', 'map', 'r')
F_BRIDGE = 2
PATH = 15
SERVICE, TRACK = 8, 9
DECK = 7.2       # metres per layer (about 5.5 m clearance + the deck)
GRADE = 0.05     # ramp grade
SEG = 15.0       # max segment length on raised roads


def dec(a):
    pts, x, y = [], 0, 0
    for i in range(0, len(a), 2):
        x += a[i]; y += a[i + 1]
        pts.append((x / 10, y / 10))
    return pts


def enc(pts):
    out, px, py = [], 0, 0
    for (x, y) in pts:
        ix, iy = int(round(x * 10)), int(round(y * 10))
        out.append(ix - px); out.append(iy - py)
        px, py = ix, iy
    return out


def main():
    t0 = time.time()
    regions = {}
    for fn in os.listdir(RDIR):
        if fn.endswith('.json.gz'):
            with gzip.open(os.path.join(RDIR, fn), 'rb') as f:
                regions[fn] = json.loads(f.read())
    # edges: (fn, index) -> record; drop any old heights first
    edges = []
    for fn, d in regions.items():
        for i, r in enumerate(d['roads']):
            if len(r) > 9:
                del r[9:]
            edges.append((fn, i, r, dec(r[8])))
    print(f'{len(edges)} road edges in {len(regions)} regions ({time.time()-t0:.0f}s)', flush=True)

    # what can a bridge pass over: lower drivable roads, railways, rivers
    under_geo, under_meta = [], []
    for k, (fn, i, r, pts) in enumerate(edges):
        if r[0] not in (PATH, SERVICE, TRACK) and len(pts) >= 2:
            under_geo.append(LineString(pts)); under_meta.append(('road', r[3] or 0, r[5], r[6], k))
    for fn, d in regions.items():
        for ln in d['lines']:
            kind = ln[0]
            if kind in (0, 1, 2):  # rail, old rail, river
                pts = dec(ln[3])
                if len(pts) >= 2:
                    under_geo.append(LineString(pts)); under_meta.append(('rail' if kind < 2 else 'river', -9, None, None, None))
    tree = STRtree(under_geo)
    own = {}  # edge k -> deck height
    nbr = 0
    for k, (fn, i, r, pts) in enumerate(edges):
        # parking-garage ramps and driveways are tagged as layered bridges too: leave them on the ground
        if not (r[1] & F_BRIDGE) or r[0] in (PATH, SERVICE, TRACK) or len(pts) < 2:
            continue
        nbr += 1
        layer = r[3] or 0
        ls = LineString(pts)
        over = False
        for j in tree.query(ls, predicate='intersects'):
            kind, lyr, n0, n1, kk = under_meta[j]
            if kk == k:
                continue
            if kind == 'road':
                if lyr >= max(layer, 1) or n0 in (r[5], r[6]) or n1 in (r[5], r[6]):
                    continue
            over = True
            break
        if over:
            own[k] = DECK * max(1, layer)
    print(f'bridges: {nbr}, raised (cross a road, rail or river): {len(own)}', flush=True)

    # node heights: start at raised decks, spread outward at the ramp grade
    node_edges = defaultdict(list)
    length = {}
    for k, (fn, i, r, pts) in enumerate(edges):
        if r[0] in (PATH, SERVICE, TRACK) or not r[5]:
            continue
        L = sum(math.dist(pts[a], pts[a + 1]) for a in range(len(pts) - 1))
        length[k] = L
        node_edges[r[5]].append(k); node_edges[r[6]].append(k)
    hnode = defaultdict(float)
    heap = []
    for k, h in own.items():
        r = edges[k][2]
        for n in (r[5], r[6]):
            if h > hnode[n]:
                hnode[n] = h; heapq.heappush(heap, (-h, n))
    while heap:
        nh, n = heapq.heappop(heap)
        h = -nh
        if h < hnode[n] - 1e-6:
            continue
        for k in node_edges[n]:
            r = edges[k][2]
            m = r[6] if r[5] == n else r[5]
            h2 = h - GRADE * length[k]
            if h2 > 0.05 and h2 > hnode[m] + 1e-6:
                hnode[m] = h2; heapq.heappush(heap, (-h2, m))
    raised_nodes = sum(1 for v in hnode.values() if v > 0.05)
    print(f'nodes lifted: {raised_nodes}', flush=True)

    # per-vertex heights for every edge touching a lifted node or with its own deck
    touched = 0
    for k, (fn, i, r, pts) in enumerate(edges):
        if r[0] in (PATH, SERVICE, TRACK) or not r[5]:
            continue
        ha, hb, ho = hnode.get(r[5], 0.0), hnode.get(r[6], 0.0), own.get(k, 0.0)
        if ha <= 0.05 and hb <= 0.05 and ho <= 0.05:
            continue
        # densify
        dp = [pts[0]]
        for a in range(len(pts) - 1):
            x0, y0 = pts[a]; x1, y1 = pts[a + 1]
            seg = math.dist(pts[a], pts[a + 1])
            nseg = max(1, int(math.ceil(seg / SEG)))
            for s in range(1, nseg + 1):
                dp.append((x0 + (x1 - x0) * s / nseg, y0 + (y1 - y0) * s / nseg))
        L = length[k]
        zs, acc = [], 0.0
        for a, p in enumerate(dp):
            if a:
                acc += math.dist(dp[a - 1], p)
            z = max(ho, ha - GRADE * acc, hb - GRADE * (L - acc), 0.0)
            zs.append(int(round(z * 10)))
        if max(zs) <= 1:
            continue
        r[8] = enc(dp)
        r.append(zs)
        touched += 1
    print(f'roads with heights: {touched}', flush=True)

    for fn, d in regions.items():
        with gzip.open(os.path.join(RDIR, fn), 'wb', compresslevel=9) as f:
            f.write(json.dumps(d, separators=(',', ':')).encode())
    print(f'done in {time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
