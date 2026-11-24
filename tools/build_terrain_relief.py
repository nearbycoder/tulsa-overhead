"""Bake shaded relief from USGS 3DEP bare-earth elevations in the gameplay coordinate system.

Inputs are the USGS 1/3 arc-second GeoTIFFs n36w096, n36w097, n37w096,
n37w097 and n37w098. Optionally overlay the GT Tulsa 4 m Tulsa-metro survey.
"""
import argparse
from contextlib import ExitStack
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image
import rasterio
from rasterio.crs import CRS
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT
from rasterio.warp import Resampling, transform_bounds
from rasterio.windows import Window
from shapely.geometry import box, Polygon
from shapely.ops import unary_union

MAP = Path(__file__).resolve().parents[1] / 'assets/map'
SPAN, POST = 4096, 8
PAD = 3


def save_relief(image, target):
    # The soft-light overlay only needs 6-bit luminance. Keep neutral grey exact
    # and quantize before lossless encoding so neighboring gutters still match.
    shades = [min(255, ((v + 2) // 4) * 4) for v in range(256)]
    image.point(shades).save(target, 'WEBP', lossless=True, method=2)


def metro_dem(path, stack):
    grid = np.load(path, mmap_mode='r')
    if grid.shape != (10241, 10241) or grid.dtype != np.dtype('<f4'):
        raise ValueError('Expected the GT Tulsa 4 m bare-earth grid')
    # The survey rows run from south to north. Give the warp a north-up, tiled source.
    folder = Path(stack.enter_context(TemporaryDirectory()))
    source = folder / 'metro.tif'
    with rasterio.open(source, 'w', driver='GTiff', width=grid.shape[1], height=grid.shape[0],
                       count=1, dtype='float32', tiled=True, blockxsize=256, blockysize=256,
                       crs='+proj=tmerc +lat_0=36.12 +lon_0=-95.91 +k=1 +datum=WGS84 +units=m',
                       transform=Affine(4,0,-20482,0,-4,20482)) as out:
        for row in range(0, grid.shape[0], 256):
            block = grid[::-1][row:row+256]
            out.write(block, 1, window=Window(0,row,grid.shape[1],len(block)))
    return stack.enter_context(rasterio.open(source))


def build(args):
    meta = json.loads((MAP / 'meta.json').read_text())
    origin = meta['origin']
    land = unary_union([Polygon(ring) for ring in meta['world']])
    x0, y0, x1, y1 = land.bounds
    left, top = math.floor(x0 / SPAN), math.floor(y0 / SPAN)
    right, bottom = math.ceil(x1 / SPAN), math.ceil(y1 / SPAN)
    size = SPAN // POST
    lon = lambda x: origin['lon'] + x / origin['kx']
    lat = lambda y: origin['lat'] - y / origin['ky']
    transform = Affine(POST / origin['kx'], 0, lon(left * SPAN - PAD * POST),
                       0, -POST / origin['ky'], lat(top * SPAN - PAD * POST))
    dst = MAP / 'ground' / 'relief'
    dst.mkdir(parents=True, exist_ok=True)
    regions = []
    with ExitStack() as stack:
        stack.enter_context(rasterio.Env(GDAL_CACHEMAX=160 * 1024**2))
        rasters = [(stack.enter_context(rasterio.open(f)), 0) for f in args.tifs]
        if args.metro:
            rasters.append((metro_dem(args.metro, stack), 150))
        sources = []
        for ds, offset in rasters:
            west, south, east, north = ds.bounds
            bounds = transform_bounds(ds.crs, 'EPSG:4326', west, min(south, north), east, max(south, north))
            warp = stack.enter_context(WarpedVRT(ds, crs=CRS.from_epsg(4326), transform=transform,
                width=(right-left)*size+2*PAD, height=(bottom-top)*size+2*PAD,
                dtype='float32', nodata=-9999, resampling=Resampling.bilinear))
            sources.append((warp, offset, box(*bounds)))
        for ty in range(top, bottom):
            for tx in range(left, right):
                x, y = tx * SPAN, ty * SPAN
                if not land.intersects(box(x, y, x+SPAN, y+SPAN)):
                    continue
                win = Window((tx-left)*size, (ty-top)*size, size+2*PAD, size+2*PAD)
                h = np.full((size+2*PAD, size+2*PAD), np.nan, dtype=np.float32)
                bounds = box(lon(x-PAD*POST), lat(y+SPAN+PAD*POST), lon(x+SPAN+PAD*POST), lat(y-PAD*POST))
                for warp, offset, extent in sources:
                    if extent.intersects(bounds):
                        data = warp.read(1, window=win)
                        valid = data != -9999
                        h[valid] = data[valid] + offset
                missing = ~np.isfinite(h[PAD:-PAD, PAD:-PAD])
                if missing.any():
                    playable = rasterize([land], (size,size), transform=Affine(POST,0,x,0,POST,y))
                    if (playable & missing).any():
                        raise ValueError(f'Incomplete elevation coverage in {tx},{ty}')
                # A metre rise to the southeast has a northwest-facing normal.
                # The wider gradient softens quantization while retaining narrow drainages.
                dx = (h[2:-2, 4:] - h[2:-2, :-4]) / (4 * POST)
                dy = (h[4:, 2:-2] - h[:-4, 2:-2]) / (4 * POST)
                light = (.72 + .54*dx + .44*dy) / np.sqrt(1 + dx*dx + dy*dy)
                tone = np.clip(128 + 350 * (light - .72), 32, 224)
                # One sample of overlap on each side for interpolation at tile seams.
                image = Image.fromarray(np.uint8(np.nan_to_num(tone, nan=128)))
                save_relief(image, dst / f'{tx}_{ty}.webp')
                regions.append(f'{tx},{ty}')
            print(f'{len(regions)} relief tiles', flush=True)
    (dst/'index.json').write_text(json.dumps({'span': SPAN, 'regions': regions}, separators=(',', ':')))
    print(f'{len(regions)} tiles complete, {sum(p.stat().st_size for p in dst.glob("*.webp")):,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tifs', nargs='+', type=Path)
    parser.add_argument('--metro', type=Path)
    build(parser.parse_args())
