"""Bundle the original vehicle and prop PNG strips with their catalogs for cold starts."""
import base64
import json
from pathlib import Path

try:
    from PIL import Image
except ModuleNotFoundError:
    Image = None


def slice_bounds(path, entry):
    """Record nontransparent source rectangles. Larger custom art uses the full-slice path."""
    w, h, count = (entry[name] for name in ('w', 'h', 'count'))
    if Image is None or max(w, h) > 255:
        return None
    with Image.open(path) as image:
        if image.size != (w * count, h):
            return None
        alpha = image.convert('RGBA').getchannel('A')
        bounds = bytearray()
        for i in range(count):
            box = alpha.crop((i * w, 0, (i + 1) * w, h)).getbbox()
            if box:
                left, top, right, bottom = box
                bounds.extend((left, top, right - left, bottom - top))
            else:
                bounds.extend((0, 0, 0, 0))
    # Adjacent layers often have the same outline. Byte deltas compress well in
    # both the HTTP response and the downloadable editions.
    for i in range(len(bounds) - 1, 3, -1):
        bounds[i] = (bounds[i] - bounds[i - 4]) & 255
    return base64.b64encode(bounds).decode('ascii')


def write_sprite_bundle(directory):
    catalog = json.loads((directory / 'catalog.json').read_text())
    images = {p.name: base64.b64encode(p.read_bytes()).decode('ascii')
              for p in sorted(directory.glob('*.png'))}
    bounds = {}
    for entry in catalog.get('vehicles', catalog.get('props', [])):
        for name in entry.get('frames', [entry['file']]):
            if name in images:
                encoded = slice_bounds(directory / name, entry)
                if encoded:
                    bounds[name] = encoded
    path = directory / 'sprites.json'
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps({**catalog, 'images': images, 'sliceBoundDeltas': bounds}, separators=(',', ':')))
    temp.replace(path)


if __name__ == '__main__':
    assets = Path(__file__).resolve().parents[1] / 'assets'
    for group in ('vehicles', 'props'):
        write_sprite_bundle(assets / group)
