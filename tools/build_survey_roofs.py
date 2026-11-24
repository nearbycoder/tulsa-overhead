#!/usr/bin/env python3
"""Match validated GT Tulsa LiDAR roof triangles to the footprints shipped with the game."""
import argparse
import gzip
import json
import math
import pickle
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely import Polygon, make_valid

from import_gt_tulsa import GT_PROJ4, KX, KY, LAT0, LON0

MAP = Path(__file__).resolve().parents[1] / 'assets/map'
SIDE = 2048


def package(gt, out):
    to_geo = Transformer.from_crs(GT_PROJ4, 'EPSG:4326', always_xy=True)
    meshes, bounds = [], []
    for path in sorted((gt / 'data/build/districts').glob('*.facets')):
        for ox, oy, vertices, triangles, rim in pickle.loads(path.read_bytes()).values():
            lon, lat = to_geo.transform(ox + vertices[:, 0].astype('f8'), oy + vertices[:, 1].astype('f8'))
            xyz = np.column_stack(((lon - LON0) * KX, (LAT0 - lat) * KY, vertices[:, 2]))
            xy = xyz[rim, :2]
            bounds.append((*xy.min(axis=0), *xy.max(axis=0)))
            meshes.append((xyz, triangles, rim))
    if not meshes:
        raise ValueError('No surveyed roof meshes in the source directory')
    bounds = np.array(bounds)
    tree = cKDTree((bounds[:, :2] + bounds[:, 2:]) * 0.5)
    lo = np.floor(bounds[:, :2].min(axis=0) / SIDE).astype(int) - 1
    hi = np.floor(bounds[:, 2:].max(axis=0) / SIDE).astype(int) + 1
    regions = defaultdict(dict)
    total_faces = 0
    for path in sorted((MAP / 'r').glob('*.json.gz')):
        rx, ry = map(int, path.name.split('.')[0].split('_'))
        if not (lo[0] <= rx <= hi[0] and lo[1] <= ry <= hi[1]):
            continue
        with gzip.open(path) as f:
            buildings = json.load(f)['bld']
        footprints = [np.cumsum(np.reshape(b[3], (-1, 2)), axis=0) * 0.1 for b in buildings]
        if not footprints:
            continue
        boxes = np.array([(*xy.min(axis=0), *xy.max(axis=0)) for xy in footprints])
        distances, indices = tree.query((boxes[:, :2] + boxes[:, 2:]) * 0.5, distance_upper_bound=0.7)
        for idx in np.flatnonzero(np.isfinite(distances)):
            source = indices[idx]
            if np.max(np.abs(bounds[source] - boxes[idx])) > 0.85:
                continue
            xyz, triangles, rim = meshes[source]
            hull = Polygon(xyz[rim, :2])
            footprint = Polygon(footprints[idx])
            if not footprint.is_valid:
                footprint = make_valid(footprint)
            if footprint.symmetric_difference(hull).area > max(2.0, hull.area * 0.025):
                continue
            # Mirror the Float32 game footprint and Math.round, including region-edge ties.
            box = boxes[idx].astype('f4').astype('f8')
            cx, cy = (box[:2] + box[2:]) * 0.5
            reg = math.floor(cx / SIDE), math.floor(cy / SIDE)
            dx, dy = math.floor((cx - reg[0] * SIDE) * 10 + 0.5), math.floor((cy - reg[1] * SIDE) * 10 + 0.5)
            key = dx, dy
            if key in regions[reg]:
                regions[reg][key] = None
                continue
            anchor = (reg[0] * SIDE + dx / 10, reg[1] * SIDE + dy / 10, 0)
            cm = np.rint((xyz - anchor) * 100)
            assert len(cm) <= 256 and np.max(np.abs(cm)) < 32768
            header = struct.pack('<5H', dx, dy, len(cm), len(triangles), len(rim))
            body = cm.astype('<i2').tobytes() + triangles.astype('u1').tobytes() + rim.astype('u1').tobytes()
            regions[reg][key] = (header + body + bytes(len(body) % 2), len(triangles))
    out.mkdir(parents=True, exist_ok=True)
    counts = {}
    for (rx, ry), records in sorted(regions.items()):
        key = f'{rx}_{ry}'
        valid = [item for item in records.values() if item]
        with (out / (key + '.bin.gz')).open('wb') as raw:
            with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0, compresslevel=6) as f:
                for data, face_count in valid:
                    f.write(data)
                    total_faces += face_count
        counts[key] = len(valid)
    summary = dict(source='GT Tulsa validated LiDAR roof surfaces', roofCount=sum(counts.values()),
                   triangleCount=total_faces, regionKeys=sorted(counts))
    (out / 'index.json').write_text(json.dumps(summary, separators=(',', ':')))
    print(f"Matched {summary['roofCount']:,}/{len(meshes):,} roofs, {total_faces:,} triangles, {len(counts)} regions.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gt', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=MAP / 'survey-roofs')
    args = parser.parse_args()
    package(args.gt, args.out)
