#!/usr/bin/env python3
"""Package GT Tulsa's screened USDA NAIP roof photographs for the canvas renderer.

Use the GT Tulsa pipeline Python environment (pyarrow, pyproj, shapely, scipy and PIL).
The input roof charts and world/buildings.parquet must come from the same local build.
"""
import argparse
import gzip
import hashlib
import json
import math
import pickle
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from PIL import Image
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely import from_wkb

from import_gt_tulsa import GT_PROJ4, KX, KY, LAT0, LON0

MAP = Path(__file__).resolve().parents[1] / 'assets/map'
SIDE = 2048
SCALE = 0.75  # 0.89 m per packed pixel, downsampled from 0.67 m per chart pixel


def package(gt, out):
    charts = gt / 'data/build/roof_imagery/charts'
    output = out / 'sheets'
    output.mkdir(parents=True, exist_ok=True)
    src = pq.read_table(gt / 'data/build/world/buildings.parquet', columns=['bld_id', 'geometry']).to_pydict()
    geoms = dict(zip(src['bld_id'], src['geometry']))
    del src
    to_geo = Transformer.from_crs(GT_PROJ4, 'EPSG:4326', always_xy=True)
    to_gt = Transformer.from_crs('EPSG:4326', GT_PROJ4, always_xy=True)

    def game_to_gt(x, y):
        return to_gt.transform(LON0 + x / KX, LAT0 - y / KY)

    # Match full footprints, including the largest component chosen by the map importer.
    # Atlas fragments from split landmarks have different signatures and are left to their models.
    bounds, transforms = [], []
    for path in sorted(charts.glob('*.pkl')):
        chart = pickle.loads(path.read_bytes())
        if not chart:
            continue
        tile = int(path.stem)
        with Image.open(path.with_suffix('.jpg')) as image:
            width, height = image.size
            size = (round(width * SCALE), round(height * SCALE))
            assert (size[0] == width * SCALE and size[1] == height * SCALE)
            image.resize(size, Image.Resampling.LANCZOS).save(output / f'{tile}.webp', quality=75, method=3)
        for (bid, signature), (near, _) in chart.items():
            wkb = geoms.get(bid)
            if not wkb:
                continue
            geom = from_wkb(wkb)
            if geom.geom_type == 'MultiPolygon':
                geom = max(geom.geoms, key=lambda part: part.area)
            if geom.geom_type != 'Polygon' or hashlib.blake2b(geom.wkb, digest_size=8).digest() != signature:
                continue
            xy = np.asarray(geom.exterior.coords)
            lon, lat = to_geo.transform(xy[:, 0], xy[:, 1])
            x, y = (lon - LON0) * KX, (LAT0 - lat) * KY
            bounds.append((min(x), min(y), max(x), max(y)))
            wx, wy, sx, sy, u, v = near
            transforms.append((tile, wx, wy, sx * size[0], -sy * size[1], u * size[0], (1 - v) * size[1]))
    bounds = np.asarray(bounds)
    source_centers = (bounds[:, :2] + bounds[:, 2:]) * 0.5
    tree = cKDTree(source_centers)
    lo = np.floor(bounds[:, :2].min(axis=0) / SIDE).astype(int) - 1
    hi = np.floor(bounds[:, 2:].max(axis=0) / SIDE).astype(int) + 1
    regions = defaultdict(dict)
    conflicts = defaultdict(set)
    for path in sorted((MAP / 'r').glob('*.json.gz')):
        rx, ry = map(int, path.name.split('.')[0].split('_'))
        if not (lo[0] <= rx <= hi[0] and lo[1] <= ry <= hi[1]):
            continue
        with gzip.open(path) as f:
            records = json.load(f)['bld']
        if not records:
            continue
        boxes = []
        for b in records:
            pts = np.cumsum(np.reshape(b[3], (-1, 2)), axis=0) * 0.1
            boxes.append((*pts.min(axis=0), *pts.max(axis=0)))
        boxes = np.asarray(boxes)
        centers = (boxes[:, :2] + boxes[:, 2:]) * 0.5
        distances, indices = tree.query(centers, distance_upper_bound=0.7)
        for i in np.flatnonzero(np.isfinite(distances)):
            src_idx = indices[i]
            if np.abs(boxes[i] - bounds[src_idx]).max() > 0.85:
                continue
            # Match the decoded Float32 world vertices and JavaScript's round-to-positive tie rule.
            box = boxes[i].astype('f4').astype('f8')
            cx, cy = (box[:2] + box[2:]) * 0.5
            reg = (math.floor(cx / SIDE), math.floor(cy / SIDE))
            dx, dy = math.floor((cx - reg[0] * SIDE) * 10 + 0.5), math.floor((cy - reg[1] * SIDE) * 10 + 0.5)
            key = dx, dy
            if key in regions[reg]:
                conflicts[reg].add(key)
            # The chart UV origin is its lower-left in the survey's north-positive frame.
            x, y = game_to_gt(reg[0] * SIDE + dx / 10, reg[1] * SIDE + dy / 10)
            tile, wx, wy, sx, sy, u, v = transforms[src_idx]
            regions[reg][key] = (dx, dy, tile, round(10 * (u + (x - wx) * sx)), round(10 * (v + (y - wy) * sy)))
    count = 0
    for (rx, ry), records in sorted(regions.items()):
        x = (rx + 0.5) * SIDE
        y = (ry + 0.5) * SIDE
        gx, gy = game_to_gt(x, y)
        du, dv = game_to_gt(x + 1, y)
        eu, ev = game_to_gt(x, y + 1)
        # Atlas pixels to world tangent vectors, at the centre of this region.
        basis = np.linalg.inv(1.5 * SCALE * np.array([[du - gx, eu - gx], [gy - dv, gy - ev]]))
        with gzip.GzipFile(filename=str(out / f'{rx}_{ry}.bin.gz'), mode='wb', mtime=0) as f:
            f.write(struct.pack('<4f', *basis.flat))
            for key, entry in records.items():
                if key not in conflicts[rx, ry]:
                    f.write(struct.pack('<5h', *entry))
                    count += 1
    (out / 'index.json').write_text(json.dumps(dict(source='USDA NAIP 2025, GT Tulsa screened roof charts',
        roofCount=count, regionKeys=[f'{rx}_{ry}' for rx, ry in sorted(regions)]), separators=(',', ':')))
    print(f'Packaged {count:,} matched roofs in {len(regions)} regions', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gt', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=MAP / 'roof-photos')
    args = parser.parse_args()
    package(args.gt, args.out)
