"""Prepare a tileable, metre-scaled terrain material sheet from Poly Haven CC0 diffuse scans.

Pass directories containing <source>-Diffuse.jpg files downloaded from the Poly Haven files API.
All survey colors and geometries remain in their independent geographic layers.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image

# Dimensions in metres from the Poly Haven asset catalogue. Mineral finishes use
# the game's palette so the transition to distant roads doesn't change road colour.
MATERIALS = [
    ('asphalt', 'asphalt_04', 4.04, (81,82,86), 12),
    ('asphaltHi', 'asphalt_04', 4.04, (89,91,92), 12),
    ('concrete', 'gravel_concrete_03', 2.10, (147,145,138), 13),
    ('walk', 'gravel_concrete_03', 2.10, (179,174,163), 10),
    ('dirtRoad', 'gravel_floor', 2.25, (163,104,63), 17),
    ('brick', 'red_brick_pavers', 1.80, (147,104,88), 22),
    ('pavers', 'rectangular_paving', 2.00, (146,135,119), 17),
    ('grassGrain', 'grass_ground', 2.51, (128,128,128), 33),
    ('soilGrain', 'brown_mud', 1.30, (128,128,128), 30),
]


def build(folders):
    size = 384
    atlas = Image.new('RGB', (3*size, 3*size))
    specs = {}
    for i, (name, source, metres, base, contrast) in enumerate(MATERIALS):
        filename = source + '-Diffuse.jpg'
        src = next((folder / filename for folder in folders if (folder / filename).is_file()), None)
        if src is None:
            raise FileNotFoundError(f'Provide {filename} from https://polyhaven.com/a/{source}')
        with Image.open(src) as photo:
            rgb = np.asarray(photo.convert('RGB').resize((size,size), Image.Resampling.LANCZOS), dtype='float32')
        luma = rgb @ np.array([.2126,.7152,.0722], dtype='float32')
        fine = (luma - luma.mean()) * (contrast / max(1, luma.std()))
        colored = np.asarray(base) + np.clip(fine, -3*contrast, 3*contrast)[...,None]
        if not name.endswith('Grain'):
            chroma = rgb - luma[...,None]
            colored += .25 * (chroma - chroma.mean(axis=(0,1)))
        col, row = i % 3, i // 3
        atlas.paste(Image.fromarray(np.uint8(np.clip(colored,0,255))), (col*size,row*size))
        specs[name] = [col,row,metres]
    folder = Path(__file__).resolve().parents[1] / 'assets/map/ground'
    atlas.save(folder/'materials.webp', quality=93, method=6)
    (folder/'materials.json').write_text(json.dumps({'size':size,'patterns':specs}, separators=(',',':')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folders', nargs='+', type=Path)
    build(parser.parse_args().folders)
