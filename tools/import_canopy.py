"""Import georeferenced crown centres and canopy heights from GT Tulsa's tree rows."""
import argparse
from collections import defaultdict
import gzip
import json
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon, box

from import_gt_tulsa import GT_PROJ4, KX, KY, LAT0, LON0


def build(gt, root):
    source = gt / 'GTTulsa/Assets/StreamingAssets/World'
    meta = json.loads((root / 'meta.json').read_text())
    to_geo = Transformer.from_crs(GT_PROJ4, 'EPSG:4326', always_xy=True)
    span = meta['region']
    crowns = defaultdict(list)
    for row in range(40):
        data = (source / f'trees{row:02}.bin').read_bytes()
        offsets = np.frombuffer(data, dtype='<u8', count=41)
        for col, (a, b) in enumerate(zip(offsets, offsets[1:])):
            coords = np.frombuffer(data[a:b], dtype='<u2').reshape(-1, 3)
            lon, lat = to_geo.transform(coords[:, 0].astype(float) + col * 1024 - 20480,
                                        coords[:, 1].astype(float) + row * 1024 - 20480)
            east = np.rint((lon - LON0) * KX * 10).astype(int)
            south = np.rint((LAT0 - lat) * KY * 10).astype(int)
            cell = span * 10
            for x, y, h in zip(east.tolist(), south.tolist(), coords[:, 2].tolist()):
                crowns[x // cell, y // cell].extend([x % cell, y % cell, h])
    survey = Polygon(meta['survey']['coverage'])
    folder = root / 'canopy'
    folder.mkdir(exist_ok=True)
    index = []
    for rx, ry, *_ in meta['regions']:
        region = box(rx * span, ry * span, (rx + 1) * span, (ry + 1) * span)
        if not survey.intersects(region): continue
        clipped = survey.intersection(region)
        edge = [] if survey.covers(region) else np.rint(np.asarray(clipped.exterior.coords)).astype(int).flatten().tolist()
        payload = json.dumps([edge, crowns[rx, ry]], separators=(',', ':')).encode()
        (folder / f'{rx}_{ry}.json.gz').write_bytes(gzip.compress(payload, mtime=0))
        index.append([rx, ry])
    (folder / 'index.json').write_text(json.dumps({
        'source': 'GT Tulsa crown detections from Meta/WRI canopy heights and 2025 USDA NAIP vegetation',
        'license': 'https://creativecommons.org/licenses/by/4.0/',
        'citation': 'https://doi.org/10.1016/j.rse.2023.113888',
        'crowns': sum(len(crowns[x,y]) // 3 for x,y in index), 'regions': index
    }, separators=(',', ':')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gt', type=Path)
    parser.add_argument('--map', type=Path, default=Path('assets/map'))
    args = parser.parse_args()
    build(args.gt, args.map)
