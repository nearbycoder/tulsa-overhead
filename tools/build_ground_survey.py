"""Colour-grade USDA NAIP county mosaics for the GTPolly ground renderer.

Pass the eight Oklahoma 2025 county .sid files (037, 111, 113, 117, 131,
143, 145, 147) and the path to the MrSID SDK's mrsiddecode. Dependencies:
numpy, shapely, rasterio and Pillow. Rebuilding reads only windows touching
the playable parts of the municipalities or the central roof survey.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
from functools import partial
import json
from pathlib import Path
import re
import subprocess
import tempfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds, reproject, Resampling
from shapely.geometry import box, Polygon
from shapely.ops import unary_union

SPAN = 2048
REGION_DIR = Path(__file__).resolve().parents[1] / 'assets/map'


def inspect_sid(path, decoder):
    info = subprocess.check_output([decoder.with_name('mrsidinfo'), '-i', path, '-wkt'], text=True)
    def field(name):
        return float(re.search(r'^\s*' + name + r':\s*([\d.-]+)', info, re.M)[1])
    pixel, west, north = field('X res'), field('X UL'), field('Y UL')
    if field('nband') != 5 or pixel != 0.6:
        raise ValueError(f'Expected a 0.6 m RGB/NIR/coverage mosaic: {path}')
    epsg = re.findall(r'AUTHORITY\["EPSG","(2691[45])"\]', info)[-1]
    return (path, 'EPSG:' + epsg, (west, north - (field('height')-1)*pixel,
                                    west + (field('width')-1)*pixel, north))


def grade(data):
    rgb = np.moveaxis(data[:3], 0, 2).astype(np.float32)
    red, nir = rgb[:, :, 0], data[3].astype(np.float32)
    ndvi = (nir - red) / np.maximum(nir + red, 1)
    vegetation = np.clip((ndvi - 0.19) * 6, 0, 1)
    light = rgb[:, :, 0] * 0.24 + rgb[:, :, 1] * 0.58 + rgb[:, :, 2] * 0.18
    # Preserve pavement, vegetation edges and soil colour. Lift baked aerial
    # shadows so the renderer's moving sunlight has room to shade the scene.
    result = np.empty((*light.shape, 4), dtype=np.uint8)
    for channel, (base, gain) in enumerate([(43, 0.53), (67, 0.60), (34, 0.33)]):
        turf = base + light * gain
        mineral = rgb[:, :, channel] * 0.8 + 36
        result[:, :, channel] = np.clip(mineral + vegetation * (turf - mineral), 0, 255)
    result[:, :, 3] = data[4]
    return Image.fromarray(result)


def read_window(bounds, pixels, overview, sources, decoder):
    n = pixels
    target = from_bounds(*bounds, n, n)
    result = np.zeros((5, n, n), dtype=np.uint8)
    with tempfile.TemporaryDirectory() as scratch:
        for path, crs, (l, b, r, t) in sources:
            w, s, e, nr = transform_bounds('EPSG:4326', crs, *bounds, densify_pts=4)
            w, s, e, nr = max(w-5,l), max(s-5,b), min(e+5,r), min(nr+5,t)
            if min(e-w, nr-s) <= 2:
                continue
            tif = Path(scratch) / (path.stem + '.tif')
            subprocess.run([decoder, '-quiet', '-j', '1', '-wf', '-s', str(overview),
                            '-i', path, '-o', tif, '-of', 'tif', '-coord', 'geo',
                            '-ulxy', str(w), str(nr), '-lrxy', str(e), str(s)], check=True)
            with rasterio.open(tif) as dataset:
                warped = np.zeros_like(result)
                reproject(dataset.read(), warped, src_transform=dataset.transform, src_crs=crs,
                          src_alpha=5, dst_transform=target, dst_crs='EPSG:4326',
                          dst_alpha=5, resampling=Resampling.bilinear)
            valid = (result[4] == 0) & (warped[4] != 0)
            if valid.all():
                result = warped
                break
            if valid.any():
                result[:, valid] = warped[:, valid]
            if result[4].all():
                break
    return result


def world_bounds(origin, x, y, width):
    return (origin['lon'] + x / origin['kx'], origin['lat'] - (y + width) / origin['ky'],
            origin['lon'] + (x + width) / origin['kx'], origin['lat'] - y / origin['ky'])


def render(job, sources, origin, out, decoder):
    rx, ry, count = job
    mpp = 1 if count >= 50 else 2
    result = read_window(world_bounds(origin, rx * SPAN, ry * SPAN, SPAN),
                         SPAN // mpp, mpp, sources, decoder)
    if not result[4].any():
        return None
    dest = out / f'{rx}_{ry}.webp'
    grade(result).save(dest.with_suffix('.tmp'), format='WEBP', quality=74, method=3)
    dest.with_suffix('.tmp').replace(dest)
    return [rx, ry]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--decoder', required=True, type=Path)
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--out', type=Path, default=REGION_DIR / 'ground')
    p.add_argument('mosaics', type=Path, nargs='+')
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sources = [inspect_sid(path, args.decoder) for path in sorted(args.mosaics)]
    meta = json.loads((REGION_DIR / 'meta.json').read_text())
    world = unary_union([Polygon(p).buffer(0) for p in meta['world']])
    cities = [Polygon(p).buffer(0) for city in meta['cities'] for p in city['poly']]
    survey = Polygon(meta['survey']['coverage'])
    area = unary_union([survey, *cities]).intersection(world)
    jobs = [(x,y,buildings) for x,y,_,buildings,_ in meta['regions']
            if area.intersects(box(x*SPAN,y*SPAN,(x+1)*SPAN,(y+1)*SPAN))]
    work = partial(render, sources=sources, origin=meta['origin'], out=args.out, decoder=args.decoder)
    with ProcessPoolExecutor(args.workers) as pool:
        tiles = []
        for i, tile in enumerate(pool.map(work, jobs), 1):
            if tile: tiles.append(tile)
            if i % 100 == 0: print(f'{i}/{len(jobs)}', flush=True)
    (args.out / 'index.json').write_text(json.dumps({
        'source': 'USDA National Agriculture Imagery Program, Oklahoma county mosaics',
        'year': 2025, 'catalog': 'https://nrcs.app.box.com/v/naip/folder/335607759930',
        'mosaics': sorted(path.name for path in args.mosaics), 'regions': sorted(tiles)
    }, separators=(',', ':')))
    print(f'{len(tiles)} ground tiles')


if __name__ == '__main__':
    main()
