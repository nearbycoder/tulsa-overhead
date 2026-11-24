"""Build the browser-ready NAIP pyramid for every cell intersecting the playable counties.

Supply the eight 2025 county SID mosaics used by build_ground_survey. Both levels
use the world projection and include a pixel of neighboring terrain on every edge.
An interrupted build can be resumed. The default AVIF tiles retain native resolution.
Use --opaque-format jpg in a separate output directory to reproduce the older JPEG
encoding. Completed images are published atomically in either profile.
"""

import argparse
import errno
import hashlib
import json
import os
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from pathlib import Path
from time import monotonic

from PIL import features
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

from build_ground_detail import colour_detail
from build_ground_survey import REGION_DIR, SPAN, inspect_sid, read_window, world_bounds
from terrain_towns import town_masks


NEAR_SPAN = SPAN // 4
NEAR_PIXELS = 854
FAR_PIXELS = 512
OPAQUE_FORMAT = 'avif'
AVIF_OPTIONS = dict(quality=65, speed=9, subsampling='4:2:0', max_threads=1)
WEBP_OPTIONS = dict(quality=84, method=1)
JPEG_OPTIONS = dict(quality=88, subsampling=2)


def cells(meta):
    world = unary_union([Polygon(p).buffer(0) for p in meta["world"]])
    area = prep(world)
    west, north, east, south = map(lambda n: int(n // SPAN), world.bounds)
    result = []
    for x in range(west, east + 1):
        for y in range(north, south + 1):
            region = box(x * SPAN, y * SPAN, (x + 1) * SPAN, (y + 1) * SPAN)
            if not area.intersects(region):
                continue
            mask = 65535
            if not area.covers(region):
                mask = 0
                for bit in range(16):
                    xx = x * SPAN + (bit % 4) * NEAR_SPAN
                    yy = y * SPAN + (bit // 4) * NEAR_SPAN
                    if area.intersects(box(xx, yy, xx + NEAR_SPAN, yy + NEAR_SPAN)):
                        mask |= 1 << bit
            result.append((x, y, mask))
    # Produce representative city and county views first in a fresh installation.
    priority = {(0, 0), (8, 5), (8, 6)}
    for county in meta["counties"]:
        shape = unary_union([Polygon(p).buffer(0) for p in county["poly"]])
        p = shape.representative_point()
        priority.add((int(p.x // SPAN), int(p.y // SPAN)))
    for p in meta["places"]:
        if p["t"] in ("city", "town"):
            priority.add((int(p["x"] // SPAN), int(p["y"] // SPAN)))
    return sorted(result, key=lambda row: (row[:2] not in priority, row[0], row[1]))


def store(image, folder, name, opaque):
    transparent = image.mode == 'RGBA'
    target = folder / (name + ('.webp' if transparent else '.' + opaque))
    temp = target.with_suffix('.tmp')
    if transparent:
        image.save(temp, 'WEBP', **WEBP_OPTIONS)
    elif opaque == 'jpg':
        image.save(temp, 'JPEG', **JPEG_OPTIONS)
    else:
        image.save(temp, 'AVIF', **AVIF_OPTIONS)
    temp.replace(target)
    return transparent


def complete(cell, row, level, out, opaque):
    """Confirm indexed output exists before skipping source reads on a rebuild."""
    if row is None:
        return False
    x, y, wanted = cell
    folder = out / f'{x}_{y}'
    if level == 'overview':
        return (folder / ('overview.webp' if row[4] else f'overview.{opaque}')).is_file()
    if row[2] != wanted or not folder.is_dir():
        return False
    existing = {path.name for path in folder.iterdir()}
    for bit in range(16):
        flag = 1 << bit
        if wanted & flag:
            ext = 'webp' if row[3] & flag else opaque
            if f'{bit}.{ext}' not in existing:
                return False
    return True


def render(cell, level, origin, sources, decoder, out, opaque=OPAQUE_FORMAT):
    x, y, wanted = cell
    folder = out / f'{x}_{y}'
    folder.mkdir(exist_ok=True)
    existing = {path.name for path in folder.iterdir()}
    px = FAR_PIXELS if level == 'overview' else NEAR_PIXELS * 4
    pad = 2 * SPAN / px
    bounds = world_bounds(origin, x*SPAN-pad, y*SPAN-pad, SPAN+2*pad)
    mask = alpha = 0
    if level == 'overview':
        for transparent, ext in [(0, opaque), (1, 'webp')]:
            if 'overview.' + ext in existing:
                return x, y, mask, alpha, transparent
    else:
        for bit in range(16):
            if not wanted & (1 << bit):
                continue
            if f'{bit}.{opaque}' in existing:
                mask |= 1 << bit
            elif f'{bit}.webp' in existing:
                mask |= 1 << bit
                alpha |= 1 << bit
        if mask == wanted:
            return x, y, mask, alpha, None
    data = read_window(bounds, px+4, 2 if level == 'overview' else 0, sources, decoder)
    if level == 'overview':
        if not data[4].any():
            return x, y, 0, 0, None
        image = colour_detail(data).crop((1, 1, px+3, px+3))
        return x, y, 0, 0, int(store(image, folder, 'overview', opaque))
    for bit in range(16):
        flag = 1 << bit
        if not wanted & flag or mask & flag:
            continue
        dx, dy = (bit % 4)*NEAR_PIXELS, (bit // 4)*NEAR_PIXELS
        n = NEAR_PIXELS
        patch = data[:, dy:dy+n+4, dx:dx+n+4]
        if not patch[4, 2:-2, 2:-2].any():
            continue
        image = colour_detail(patch).crop((1, 1, n+3, n+3))
        if store(image, folder, str(bit), opaque):
            alpha |= flag
        mask |= flag
    return x, y, mask, alpha, None


def build(args):
    args.out.mkdir(parents=True, exist_ok=True)
    # The OS releases this lock if a builder exits or is interrupted. Keep the
    # inode stable while the manifest and individual tiles are atomically replaced.
    with (args.out / '.build.lock').open('a+b') as lock:
        try:
            if os.name == 'nt':
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EAGAIN, errno.EACCES, errno.EDEADLK):
                raise
            raise SystemExit(f'Another terrain builder is writing {args.out}') from error
        build_regions(args)


def build_regions(args):
    opaque = args.opaque_format
    if opaque == 'avif' and not features.check('avif'):
        raise SystemExit('Install Pillow with AVIF support to build this pyramid.')
    meta_bytes = (REGION_DIR / 'meta.json').read_bytes()
    meta = json.loads(meta_bytes)
    mosaics = sorted(path.resolve() for path in args.mosaics)
    sources = [inspect_sid(p, args.decoder) for p in mosaics]
    profile = {opaque: AVIF_OPTIONS if opaque == 'avif' else JPEG_OPTIONS,
               'webp': WEBP_OPTIONS, 'nativePixels': NEAR_PIXELS,
               'overviewPixels': FAR_PIXELS, 'regionSpan': SPAN,
               'mapHash': hashlib.sha256(meta_bytes).hexdigest(),
               'sourceFiles': [[path.name, path.stat().st_size, path.stat().st_mtime_ns] for path in mosaics]}
    jobs = cells(meta)
    towns = town_masks(meta, jobs)
    town_rows = [[x, y, bits] for (x, y), bits in sorted(towns.items())]
    native_area = args.native_area
    native_jobs = (jobs if native_area == 'all' else
                   [(x, y, towns[x, y]) for x, y, _ in jobs if (x, y) in towns])
    native_count = sum(bits.bit_count() for _, _, bits in native_jobs)
    manifest = args.out / 'index.json'
    rows = {}
    previous = {}
    if manifest.exists():
        previous = json.loads(manifest.read_text())
        if (previous.get('buildProfile') != profile or previous.get('nativeArea', 'all') != native_area or
                (native_area == 'towns' and previous.get('townMasks') != town_rows)):
            raise SystemExit('Existing terrain uses different sources, encoding, or native area. Build into a fresh --out directory.')
        rows = {(row[0], row[1]): row for row in previous['regions']}
    elif any(path.name != '.build.lock' for path in args.out.iterdir()):
        raise SystemExit('Nonempty terrain directory has no build manifest. Use a fresh --out directory.')

    def publish():
        content = {'year': 2025, 'source': 'USDA NAIP Oklahoma county mosaics',
                   'mosaics': [s[0].name for s in sources], 'groundSampleMetres': 0.6, 'gutter': 1,
                   'span': NEAR_SPAN, 'pixels': NEAR_PIXELS, 'overviewSpan': SPAN, 'overviewPixels': FAR_PIXELS,
                   'opaqueFormat': opaque, 'buildProfile': profile, 'nativeArea': native_area,
                   'townMasks': town_rows, 'regionCount': len(jobs), 'nativeTileCount': native_count,
                   'regions': sorted(rows.values())}
        temp = manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(content, separators=(',', ':')))
        temp.replace(manifest)

    if (previous.get('townMasks') != town_rows or previous.get('nativeArea') != native_area or
            previous.get('regionCount') != len(jobs) or previous.get('nativeTileCount') != native_count):
        publish()
    # Every native edition needs a complete overview when flying or driving beyond its detail.
    levels = ['overview'] if args.level == 'overview' else ['overview', 'native']
    for level in levels:
        start = monotonic()
        level_jobs = jobs if level == 'overview' else native_jobs
        pending = [cell for cell in level_jobs if not complete(cell, rows.get(cell[:2]), level, args.out, opaque)]
        if not pending:
            print(f'{level}: all {len(level_jobs)} regions already built', flush=True)
            continue
        worker = partial(render, level=level, origin=meta['origin'], sources=sources, decoder=args.decoder,
                         out=args.out, opaque=opaque)
        with ProcessPoolExecutor(args.workers) as pool:
            for i, (x, y, mask, alpha, low) in enumerate(pool.map(worker, pending), 1):
                if low is not None:
                    row = rows.setdefault((x,y), [x,y,0,0,low])
                    row[4] = low
                elif level == 'native' and mask:
                    if (x,y) not in rows:
                        # At a sliver on the data edge native samples can survive downsampling.
                        _, _, _, _, overview = render((x,y,mask),'overview',meta['origin'],sources,args.decoder,args.out,opaque)
                        if overview is None:
                            continue
                        rows[x,y] = [x,y,0,0,overview]
                    rows[x,y][2:4] = [mask, alpha]
                if i in (1, 8) or i % 80 == 0:
                    publish()
                    print(f'{level}: {i}/{len(pending)} in {monotonic()-start:.0f}s', flush=True)
        publish()
        print(f'{level} complete: {len(rows)} regions, {sum(row[2].bit_count() for row in rows.values())} native tiles', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--decoder', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--opaque-format', choices=['avif', 'jpg'], default=OPAQUE_FORMAT)
    parser.add_argument('--native-area', choices=['all', 'towns'], default='all',
                        help='Build native tiles countywide or around municipalities and settlements.')
    parser.add_argument('--out', type=Path, default=REGION_DIR / 'ground' / 'full')
    parser.add_argument('--level', choices=['overview', 'native', 'all'], default='all')
    parser.add_argument('mosaics', type=Path, nargs='+')
    build(parser.parse_args())
