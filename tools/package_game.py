"""Package Tulsa Overhead with native aerial photography everywhere, around towns, or nowhere."""

import argparse
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
GROUND = ROOT / 'assets/map/ground'
PYRAMID = GROUND / 'full'
TEXT = {'.css', '.html', '.js', '.json', '.md', '.mjs', '.svg'}


def support_files():
    for folder in ('assets', 'docs', 'src'):
        for directory, children, files in os.walk(ROOT / folder):
            parent = Path(directory)
            if parent == GROUND:
                children[:] = [name for name in children if name not in ('full', 'detail')]
                files = [name for name in files if name in ('materials.webp', 'materials.json')]
            for name in files:
                if not name.startswith('.') and not name.endswith('.tmp'):
                    yield parent / name


def package(edition, pyramid):
    manifest = json.loads((pyramid / 'index.json').read_text())
    opaque = manifest.get('opaqueFormat', 'jpg')
    if 'regionCount' not in manifest or 'nativeTileCount' not in manifest:
        raise SystemExit('Use an indexed terrain build from tools/build_full_terrain.py.')
    towns = manifest.get('townMasks')
    if edition == 'compact' and towns is None:
        raise SystemExit('Build the terrain index with town masks before packaging the compact edition.')
    selected = {(x, y): bits for x, y, bits in towns or []}
    coverage = {(x, y): bits for x, y, bits, *_ in manifest['regions']}
    if len(coverage) != manifest['regionCount'] or len(coverage) != len(manifest['regions']):
        raise ValueError('The county-wide overview build is incomplete.')
    if edition == 'full' and (manifest.get('nativeArea', 'all') != 'all' or
                              sum(bin(row[2]).count('1') for row in manifest['regions']) != manifest['nativeTileCount']):
        raise ValueError('The county-wide native build is incomplete.')
    if edition == 'compact':
        manifest['nativeArea'] = 'towns'
        manifest['nativeTileCount'] = sum(bin(bits).count('1') for bits in selected.values())
    elif edition == 'overview':
        manifest['nativeArea'] = 'none'
        manifest['nativeTileCount'] = 0
    manifest.pop('buildProfile', None)
    output = ROOT / 'build' / f'Tulsa-Overhead-{edition.title()}.zip'
    output.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, delete=False, suffix='.tmp') as temp:
        stage = Path(temp.name)
    try:
        with ZipFile(stage, 'w', allowZip64=True) as archive:
            def add(path, dest=None):
                codec = ZIP_DEFLATED if path.suffix in TEXT else ZIP_STORED
                archive.write(path, dest if dest is not None else path.relative_to(ROOT), compress_type=codec)

            def add_json(path, index):
                archive.writestr(str(path.relative_to(ROOT)), json.dumps(index, separators=(',', ':')),
                                 compress_type=ZIP_DEFLATED)

            for name in ('index.html', 'README.md', 'tools/serve.mjs', 'tools/sprite-stacking/LICENSE'):
                add(ROOT / name)
            project = json.loads((ROOT / 'package.json').read_text())
            project.pop('devDependencies', None)
            project['scripts'] = {'start': project['scripts']['start']}
            add_json(ROOT / 'package.json', project)
            for path in support_files():
                add(path)
            # A fresh build needs no older survey. For an existing installation,
            # keep only supplemental imagery that extends the full map's coverage.
            for name in ('index.json', 'detail/index.json'):
                path = GROUND / name
                index = json.loads(path.read_text()) if path.exists() else {}
                rows = index.pop('regions', [])
                index['regions'] = []
                if edition == 'full':
                    for x, y, *mask in rows:
                        if not mask and (x, y) not in coverage:
                            add(GROUND / f'{x}_{y}.webp')
                            index['regions'].append([x, y])
                        if mask:
                            extra = mask[0] & ~coverage.get((x, y), 0)
                            if extra:
                                for bit in range(16):
                                    if extra & (1 << bit):
                                        add(path.parent / f'{x}_{y}' / f'{bit}.webp')
                                index['regions'].append([x, y, extra])
                add_json(path, index)
            for row in manifest['regions']:
                x, y, bits, alpha, overview_alpha = row
                directory = pyramid / f'{x}_{y}'
                dest = PYRAMID.relative_to(ROOT) / directory.name
                overview = 'overview.' + ('webp' if overview_alpha else opaque)
                add(directory / overview, dest / overview)
                if edition != 'full':
                    wanted = selected.get((x, y), 0) if edition == 'compact' else 0
                    if wanted & ~bits:
                        raise ValueError(f'Missing town imagery in region {x},{y}')
                    bits = wanted
                    row[2:4] = [bits, alpha & bits]
                for bit in range(16):
                    if bits & (1 << bit):
                        ext = 'webp' if alpha & (1 << bit) else opaque
                        tile = f'{bit}.{ext}'
                        add(directory / tile, dest / tile)
            add_json(PYRAMID / 'index.json', manifest)
        stage.replace(output)
    finally:
        if stage.exists():
            stage.unlink()
    print(f'{output} ({output.stat().st_size:,} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('edition', choices=('compact', 'overview', 'full'), default='compact', nargs='?')
    parser.add_argument('--pyramid', type=Path, default=PYRAMID, help='Use a separately built terrain directory.')
    args = parser.parse_args()
    package(args.edition, args.pyramid)
