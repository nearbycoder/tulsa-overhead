"""Audit every aerial tile, its gutter, and coverage of all playable counties."""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

import numpy as np
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import Affine
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

from build_full_terrain import cells, FAR_PIXELS, NEAR_PIXELS, NEAR_SPAN, REGION_DIR, SPAN
from terrain_towns import town_masks


def audit_images(row, folder, opaque, decode_all, reference):
    x, y, wanted, alpha, low = row
    tile_dir = folder / f'{x}_{y}'
    names = set()
    masks = {}
    stored = 0
    for bit in [-1, *(n for n in range(16) if wanted & (1 << n))]:
        is_overview = bit == -1
        transparent = bool(low if is_overview else alpha & (1 << bit))
        side = FAR_PIXELS if is_overview else NEAR_PIXELS
        stem = 'overview' if is_overview else str(bit)
        ext = 'webp' if transparent else opaque
        name = f'{stem}.{ext}'
        names.add(name)
        path = tile_dir / name
        stored += path.stat().st_size
        with Image.open(path) as image:
            assert image.format == {'jpg': 'JPEG', 'webp': 'WEBP', 'avif': 'AVIF'}[ext], path
            assert image.size == (side + 2, side + 2), path
            assert transparent or 'A' not in image.getbands(), path
            if decode_all:
                image.load()
            if transparent:
                coverage = image.convert('RGBA').getchannel('A')
                if reference is not None:
                    with Image.open(reference / tile_dir.name / name) as old:
                        assert coverage.tobytes() == old.convert('RGBA').getchannel('A').tobytes(), path
                interior = coverage.crop((1, 1, side + 1, side + 1))
                masks[bit] = np.array(interior if is_overview else
                                      interior.resize((128, 128), Image.Resampling.NEAREST))
    actual = {p.name for p in tile_dir.iterdir() if p.suffix in ('.jpg', '.webp', '.avif')}
    assert actual == names, f'Unindexed or missing images in {tile_dir}: {actual ^ names}'
    return stored, masks


def check(folder, reference=None, decode_all=False, workers=8, overview_only=False):
    manifest = json.loads((folder / 'index.json').read_text())
    meta = json.loads((REGION_DIR / 'meta.json').read_text())
    assert (manifest['overviewPixels'], manifest['pixels']) == (FAR_PIXELS, NEAR_PIXELS)
    assert manifest['groundSampleMetres'] == 0.6
    assert (manifest['overviewSpan'], manifest['span'], manifest['gutter']) == (SPAN, NEAR_SPAN, 1)
    old_rows = {}
    if reference is not None:
        old = json.loads((reference / 'index.json').read_text())
        for key in ('year', 'mosaics', 'groundSampleMetres'):
            assert old[key] == manifest[key], f'Reference differs in {key}'
        old_rows = {(x, y): (bits, alpha, low) for x, y, bits, alpha, low in old['regions']}
    rows = manifest['regions']
    jobs = cells(meta)
    footprints = {(x, y): mask for x, y, mask in jobs}
    native_area = manifest.get('nativeArea', 'all')
    expected = footprints
    if 'townMasks' in manifest or native_area == 'towns':
        towns = town_masks(meta, jobs)
        assert [[x, y, bits] for (x, y), bits in sorted(towns.items())] == manifest['townMasks']
        if native_area == 'towns':
            expected = towns
    assert native_area in ('all', 'towns') or overview_only
    if overview_only:
        expected = {}
    assert len(rows) == len(footprints)
    assert manifest.get('regionCount', len(rows)) == len(rows)
    assert {(x, y) for x, y, *_ in rows} == set(footprints)
    for x, y, wanted, alpha, low in rows:
        assert wanted == expected.get((x, y), 0) and not alpha & ~wanted and low in (0, 1), (x, y)
        if reference is not None:
            old_bits, old_alpha, old_low = old_rows[x, y]
            assert not wanted & ~old_bits and old_alpha & wanted == alpha and old_low == low, (x, y)
    counties = {}
    for item in meta['counties']:
        shape = unary_union([Polygon(r).buffer(0) for r in item['poly']])
        counties[item['n']] = (shape, prep(shape))
    missing, extent = Counter(), Counter()
    stored = 0
    read = partial(audit_images, folder=folder, opaque=manifest.get('opaqueFormat', 'jpg'),
                   decode_all=decode_all, reference=reference)
    with ThreadPoolExecutor(workers) as pool:
        for (x, y, wanted, _, _), (size, masks) in zip(rows, pool.map(read, rows)):
            stored += size
            for bit in range(16):
                if not footprints[x, y] & (1 << bit):
                    continue
                left = x * SPAN + (bit % 4) * NEAR_SPAN
                top = y * SPAN + (bit // 4) * NEAR_SPAN
                rect = box(left, top, left + NEAR_SPAN, top + NEAR_SPAN)
                mask = masks.get(bit)
                if not wanted & (1 << bit) and -1 in masks:
                    dx, dy = (bit % 4) * 128, (bit // 4) * 128
                    mask = masks[-1][dy:dy+128, dx:dx+128]
                for name, (county, prepared) in counties.items():
                    if not prepared.intersects(rect):
                        continue
                    area = NEAR_SPAN**2 if prepared.covers(rect) else county.intersection(rect).area
                    extent[name] += area
                    if mask is not None and mask.min() == 0:
                        interior = rasterize([(county.intersection(rect), 1)], out_shape=(128, 128),
                                             transform=Affine(4, 0, left, 0, 4, top))
                        missing[name] += np.count_nonzero((interior != 0) & (mask == 0)) * 16
    for name, area in extent.items():
        print(f'{name}: {(area - missing[name])/1e6:,.2f} of {area/1e6:,.2f} km² '
              f'({100*(1-missing[name]/area):.4f}% sampled coverage)')
    samples = sum(bits.bit_count() for _, _, bits, _, _ in rows)
    transparent = sum(alpha.bit_count() for _, _, _, alpha, _ in rows)
    if not overview_only or native_area == 'none':
        assert manifest.get('nativeTileCount', samples) == samples
    print(f'{len(rows):,} regions, {samples:,} native tiles, {transparent:,} with alpha, '
          f'{stored:,} compressed bytes. Transparency sampled at 4 m.')
    if (not samples and not overview_only) or sum(missing.values()) > 0:
        raise SystemExit('Found uncovered ground in the sampled playable counties.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=REGION_DIR / 'ground' / 'full')
    parser.add_argument('--compare-with', type=Path, help='Verify identical tile coverage and full-resolution alpha.')
    parser.add_argument('--decode-all', action='store_true', help='Decode every pixel to verify image integrity.')
    parser.add_argument('--overview-only', action='store_true', help='Audit a countywide overview edition with zero native tiles.')
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()
    check(args.folder, args.compare_with, args.decode_all, args.workers, args.overview_only)
