"""Build the public site and its browser-playable Overview edition in build/pages."""

import argparse
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/pages'


def build(archive_path):
    output_parent = OUTPUT.parent
    output_parent.mkdir(exist_ok=True)
    with ZipFile(archive_path) as archive, TemporaryDirectory(dir=output_parent) as temp:
        terrain = json.loads(archive.read('assets/map/ground/full/index.json'))
        if terrain['nativeArea'] != 'none' or terrain['nativeTileCount'] != 0:
            raise ValueError('The browser build requires the Overview edition.')

        site = Path(temp) / 'site'
        shutil.copytree(ROOT / 'site', site, ignore=shutil.ignore_patterns('.*'))
        if not (site / 'index.html').is_file():
            raise FileNotFoundError('Missing site/index.html')
        play = site / 'play'
        play.mkdir()
        # Generated map and voice assets live in the release. Versioned artwork,
        # sprites and code must follow the revision that triggered deployment.
        shutil.copytree(ROOT / 'assets', play / 'assets',
                        ignore=shutil.ignore_patterns('map', 'voice', '.*'))
        for entry in archive.infolist():
            if entry.filename.startswith(('assets/map/', 'assets/voice/')):
                archive.extract(entry, play)

        shutil.copytree(ROOT / 'src', play / 'src', ignore=shutil.ignore_patterns('.*'))
        credits = play / 'credits'
        credits.mkdir()
        shutil.copyfile(ROOT / 'tools/sprite-stacking/LICENSE', credits / 'sprite-stacking.txt')
        entrypoint = (ROOT / 'index.html').read_text(encoding='utf-8')
        (play / 'index.html').write_text(
            entrypoint.replace('</head>', '<link rel="up" href="../">\n</head>', 1),
            encoding='utf-8',
        )
        files = [path for path in site.rglob('*') if path.is_file()]
        size = sum(path.stat().st_size for path in files)
        if size > 1_000_000_000:
            raise ValueError(f'The site exceeds the GitHub Pages 1 GB limit ({size:,} bytes).')
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        site.rename(OUTPUT)
    print(f'Built {len(files):,} files in {OUTPUT} ({size:,} bytes).')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Path to the Overview release ZIP')
    build(parser.parse_args().archive)
