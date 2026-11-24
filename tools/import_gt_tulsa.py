#!/usr/bin/env python3
"""Import the GT Tulsa 3D project's surveyed buildings into GTPolly's region files.

Run with the GT Tulsa pipeline venv (pyarrow, shapely 2, pyproj):
  ../gt-tulsa/pipeline/.venv/bin/python tools/import_gt_tulsa.py [--gt /path/to/gt-tulsa]

Inside GT Tulsa's 40.96 km world square, every building is replaced by its data:
312k footprints (Microsoft + OpenStreetMap), Overture/lidar heights and roof shapes, with measured
eave and ridge heights and ridge direction from the lidar roof survey where available. Outside the square
the OSM buildings and procedurally filled house lots stay as they are.

Building record in a region file:
  [type, height_m, name_idx, ring, roof, eave_dm, ridge_az_deg, roof_col, wall_col]
  roof: 0 flat, 1 gabled, 2 hipped, 3 skillion, 4 cone/pyramid, 5 dome
  ridge_az_deg: compass bearing of the ridge (0 = north), -1 = use the footprint's long axis
  colours: '' or '#rrggbb'
The original region files are backed up once to build/map_backup/.
"""
import argparse, gzip, json, math, os, shutil, sys, time
from collections import defaultdict, Counter
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import Polygon, Point
from shapely.prepared import prep
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = os.path.join(ROOT, 'assets', 'map')

# GTPolly world frame (see tools/build_map.py)
LAT0, LON0 = 36.1540, -95.9928
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0
REGION = 2048.0

# GT Tulsa local frame (pipeline/tulsa/frame.py)
GT_PROJ4 = "+proj=tmerc +lat_0=36.12 +lon_0=-95.91 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
GT_HALF = 20480.0

BLD_TYPE = {
    'house': 1, 'detached': 1, 'semidetached_house': 1, 'mobile_home': 16, 'static_caravan': 16, 'residential': 2,
    'apartments': 3, 'dormitory': 3, 'commercial': 4, 'restaurant': 4, 'fuel_station': 4, 'retail': 5, 'strip_mall': 5,
    'big_box': 5, 'supermarket': 5, 'industrial': 6, 'warehouse': 6, 'office': 7, 'tower': 7, 'church': 8, 'chapel': 8,
    'cathedral': 8, 'religious': 8, 'school': 9, 'university': 9, 'college': 9, 'kindergarten': 9, 'hospital': 10,
    'detached_garage': 11, 'garage': 11, 'garages': 11, 'shed': 11, 'carport': 12, 'roof': 12, 'farm': 13,
    'farm_auxiliary': 13, 'barn': 13, 'greenhouse': 13, 'hangar': 14, 'silo_tank': 15, 'storage_tank': 15, 'silo': 15,
    'hotel': 17, 'stadium': 18, 'grandstand': 18, 'civic': 19, 'government': 19, 'public': 19, 'fire_station': 19,
    'train_station': 19, 'parking_garage': 20, 'parking': 20,
}
ROOF = {'flat': 0, 'gabled': 1, 'gambrel': 1, 'half_hipped': 2, 'hipped': 2, 'mansard': 2, 'skillion': 3,
        'pyramidal': 4, 'cone': 4, 'dome': 5, 'round': 5, 'onion': 5}


def gpoly(x, y):
    return (x - LON0) * KX, -(y - LAT0) * KY


def hexcol(v):
    if not v or not isinstance(v, str):
        return ''
    v = v.strip().lower()
    if v.startswith('#') and len(v) in (4, 7):
        if len(v) == 4:
            v = '#' + ''.join(c * 2 for c in v[1:])
        return v
    named = {'white': '#e8e6e0', 'grey': '#9a9a98', 'gray': '#9a9a98', 'black': '#2e2e30', 'red': '#9a3b2c', 'brown': '#6e5244',
             'beige': '#cdbfa6', 'yellow': '#d9c27a', 'blue': '#4a6a8a', 'green': '#5a7a4a', 'silver': '#b0b5b5', 'tan': '#c4b49a',
             'orange': '#c07a3a', 'darkgray': '#5a5a5c', 'lightgray': '#c6c4bc', 'maroon': '#6a2a24'}
    return named.get(v, '')


def enc_ring(coords):
    cs = list(coords)
    if len(cs) > 1 and cs[0] == cs[-1]:
        cs = cs[:-1]
    out, px, py = [], 0, 0
    for (x, y) in cs:
        ix, iy = int(round(x * 10)), int(round(y * 10))
        out.append(ix - px); out.append(iy - py)
        px, py = ix, iy
    return out


def dec_ring(a):
    pts, x, y = [], 0, 0
    for i in range(0, len(a), 2):
        x += a[i]; y += a[i + 1]
        pts.append((x / 10, y / 10))
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gt', default=str(Path(__file__).resolve().parents[2] / 'gt-tulsa'))
    args = ap.parse_args()
    t0 = time.time()
    gt = args.gt
    to_ll = Transformer.from_crs(GT_PROJ4, 'EPSG:4326', always_xy=True)

    # backup once
    bk = os.path.join(ROOT, 'build', 'map_backup')
    if not os.path.exists(os.path.join(bk, 'meta.json')):
        os.makedirs(bk, exist_ok=True)
        shutil.copytree(os.path.join(MAP, 'r'), os.path.join(bk, 'r'), dirs_exist_ok=True)
        shutil.copy(os.path.join(MAP, 'meta.json'), os.path.join(bk, 'meta.json'))
        print('backed up region files to', bk)
    # always import on top of the pristine originals so re-runs are idempotent
    src_r = os.path.join(bk, 'r')
    meta = json.load(open(os.path.join(bk, 'meta.json')))
    names = meta['names']
    name_ix = {n: i for i, n in enumerate(names)}

    # coverage square in GTPolly coordinates (densified edges)
    edge = np.linspace(-GT_HALF, GT_HALF, 41)
    ring = [(x, -GT_HALF) for x in edge] + [(GT_HALF, y) for y in edge[1:]] + [(x, GT_HALF) for x in edge[::-1][1:]] + [(-GT_HALF, y) for y in edge[::-1][1:]]
    lon, lat = to_ll.transform([p[0] for p in ring], [p[1] for p in ring])
    cov = Polygon([gpoly(a, b) for a, b in zip(lon, lat)]).buffer(-2)
    cov_p = prep(cov)
    print('coverage bounds (game m):', [round(v) for v in cov.bounds])

    # load regions
    regions = {}
    for fn in os.listdir(src_r):
        if not fn.endswith('.json.gz'):
            continue
        with gzip.open(os.path.join(src_r, fn), 'rb') as f:
            d = json.loads(f.read())
        regions[(d['rx'], d['ry'])] = d
    print(f'loaded {len(regions)} regions in {time.time()-t0:.0f}s', flush=True)

    removed = 0
    for d in regions.values():
        keep = []
        for b in d['bld']:
            pts = dec_ring(b[3])
            if len(pts) < 3:
                continue
            cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
            if cov_p.contains(Point(cx, cy)):
                removed += 1
                continue
            keep.append(b)
        d['bld'] = keep
    print('removed', removed, 'old buildings inside the surveyed square', flush=True)

    # load GT Tulsa buildings + lidar roof survey
    cols = ['bld_id', 'class', 'osm_building', 'height_m', 'roof_shape', 'roof_color', 'facade_color', 'geometry', 'is_underground', 'name', 'area_m2']
    t = pq.read_table(os.path.join(gt, 'data/build/world/buildings.parquet'), columns=cols).to_pydict()
    rs = pq.read_table(os.path.join(gt, 'data/build/roof_survey/buildings.parquet'), columns=['bld_id', 'roof_shape', 'eave_m', 'ridge_m', 'ridge_azimuth_deg', 'height_m', 'coverage']).to_pydict()
    survey = {}
    for i, bid in enumerate(rs['bld_id']):
        survey[bid] = (rs['roof_shape'][i], rs['eave_m'][i], rs['ridge_m'][i], rs['ridge_azimuth_deg'][i], rs['height_m'][i], rs['coverage'][i])
    print(f"GT Tulsa buildings: {len(t['bld_id'])}, lidar roofs: {len(survey)}", flush=True)

    geoms = shapely.from_wkb(t['geometry'])
    n = len(geoms)
    added = 0
    stats = Counter()
    new_names = 0
    for i in range(n):
        if t['is_underground'][i]:
            continue
        g = geoms[i]
        if g is None or g.is_empty:
            continue
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda q: q.area)
        if g.geom_type != 'Polygon':
            continue
        xs, ys = np.asarray(g.exterior.coords).T
        lo, la = to_ll.transform(xs, ys)
        gx = (np.asarray(lo) - LON0) * KX
        gy = -(np.asarray(la) - LAT0) * KY
        p = Polygon(np.column_stack([gx, gy]))
        if not p.is_valid:
            p = p.buffer(0)
            if p.geom_type == 'MultiPolygon':
                p = max(p.geoms, key=lambda q: q.area)
        if p.is_empty or p.geom_type != 'Polygon' or p.area < 4:
            continue
        q = p.simplify(0.25, preserve_topology=True)
        if q.is_empty or q.geom_type != 'Polygon' or len(q.exterior.coords) < 4:
            continue
        cls = t['class'][i] or ''
        ob = t['osm_building'][i] or ''
        bt = BLD_TYPE.get(cls, BLD_TYPE.get(ob, 0))
        h = t['height_m'][i]
        # roof: measured (lidar) wins over the default guess
        sv = survey.get(t['bld_id'][i])
        roof_name = t['roof_shape'][i] or 'flat'
        eave = None; az = -1
        if sv and sv[5] is not None and sv[5] >= 0.25:
            if sv[0]:
                roof_name = sv[0]
            if sv[2]:
                h = sv[2]
            if sv[1] and sv[2] and sv[2] > sv[1]:
                eave = sv[1]
            if sv[3] is not None and not (isinstance(sv[3], float) and math.isnan(sv[3])):
                az = sv[3]
            stats['lidar'] += 1
        if h is None or (isinstance(h, float) and math.isnan(h)) or h <= 0:
            h = {1: 5.5, 11: 3.2, 16: 3.6, 13: 7.0, 6: 9.0}.get(bt, 6.0)
        h = float(min(260.0, max(2.4, h)))
        roof = ROOF.get(roof_name, 0)
        # big boxes are flat whatever the default guess said
        if roof in (1, 2) and not sv and (p.area > 900 and bt not in (8, 13, 14)):
            roof = 0
        if roof in (1, 2, 3) and eave is None:
            mrr = q.minimum_rotated_rectangle
            cs = list(mrr.exterior.coords)
            e0 = math.dist(cs[0], cs[1]); e1 = math.dist(cs[1], cs[2])
            short = min(e0, e1)
            rise = max(0.8, min(4.0, short * (0.28 if roof != 3 else 0.12)))
            eave = max(2.2, h - rise)
        name = t['name'][i] or ''
        ni = -1
        if name:
            if name not in name_ix:
                name_ix[name] = len(names); names.append(name); new_names += 1
            ni = name_ix[name]
        rec = [bt, round(h, 1), ni, enc_ring(q.exterior.coords)]
        rc, wc = hexcol(t['roof_color'][i]), hexcol(t['facade_color'][i])
        if roof or rc or wc:
            rec += [roof, int(round((eave or h) * 10)), round(az, 1) if az is not None and az >= 0 else -1, rc, wc]
        c = q.centroid
        rk = (int(math.floor(c.x / REGION)), int(math.floor(c.y / REGION)))
        if rk not in regions:
            regions[rk] = {'rx': rk[0], 'ry': rk[1], 'roads': [], 'bld': [], 'areas': [], 'lines': []}
        regions[rk]['bld'].append(rec)
        added += 1
        stats['roof%d' % roof] += 1
        if i % 50000 == 0:
            print(f'  {i}/{n} ({time.time()-t0:.0f}s)', flush=True)
    print('added', added, 'buildings;', dict(stats), 'new names', new_names, flush=True)

    # write
    out_r = os.path.join(MAP, 'r')
    index = []
    total = 0
    for rk, d in regions.items():
        if not (d['roads'] or d['bld'] or d['areas'] or d['lines']):
            continue
        raw = json.dumps(d, separators=(',', ':')).encode()
        fn = os.path.join(out_r, f"{rk[0]}_{rk[1]}.json.gz")
        with gzip.open(fn, 'wb', compresslevel=9) as f:
            f.write(raw)
        sz = os.path.getsize(fn)
        total += sz
        index.append([rk[0], rk[1], len(d['roads']), len(d['bld']), sz])
    meta['regions'] = index
    meta['names'] = names
    meta['survey'] = {'source': 'GT Tulsa world data (Microsoft/OSM footprints, Overture heights, USGS lidar roof survey)', 'coverage': [[round(x), round(y)] for (x, y) in list(cov.exterior.coords)[::4]]}
    with open(os.path.join(MAP, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print(f'wrote {len(index)} regions, {total/1e6:.1f} MB, in {time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
