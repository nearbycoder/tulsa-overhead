"""Export street-scale photography from the same 0.6 m, five-band county mosaics as the overview.

Run after build_ground_survey.py, with the same decoder and mosaic arguments. Each tile
has a source pixel of overlap for continuous bilinear filtering at its boundaries.
"""

import argparse
import gzip
import json
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from pathlib import Path

import numpy as np
from build_ground_survey import REGION_DIR, SPAN, inspect_sid, read_window, world_bounds
from PIL import Image, ImageFilter
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

SIDE = 512
PIXELS = 896
M_PER_PIXEL = SIDE / PIXELS


def select_tiles(meta, available):
    # Dense housing and large commercial complexes benefit most at driving scale.
    # Retain a town-centre sample in sparse places that miss both thresholds.
    density = defaultdict(lambda: [0, 0])
    for rx, ry in available:
        with gzip.open(REGION_DIR / "r" / f"{rx}_{ry}.json.gz") as stream:
            buildings = json.load(stream)["bld"]
        for _, _, _, ring, *_ in buildings:
            # The first pair is an absolute decimetre position; the remaining
            # pairs are offsets. The shoelace sum can use the first vertex as origin.
            x = y = twice_area = 0
            for dx, dy in zip(ring[2::2], ring[3::2]):
                twice_area += x * dy - y * dx
                x += dx
                y += dy
            cell = density[ring[0] // (SIDE * 10), ring[1] // (SIDE * 10)]
            cell[0] += 1
            cell[1] += abs(twice_area) / 200
    chosen = {cell for cell, (count, area) in density.items() if count >= 30 or area >= SIDE**2 * 0.06}
    for city in meta["cities"]:
        shape = unary_union([Polygon(r).buffer(0) for r in city["poly"]])
        if shape.is_empty:
            continue
        west, north, east, south = shape.bounds
        cells = [
            (x, y)
            for x in range(int(west // SIDE), int(east // SIDE) + 1)
            for y in range(int(north // SIDE), int(south // SIDE) + 1)
            if (x, y) in density
            and shape.intersects(box(x * SIDE, y * SIDE, (x + 1) * SIDE, (y + 1) * SIDE))
        ]
        if cells:
            core = max(cells, key=lambda cell: density[cell][0])
            chosen.update(
                (x, y) for x in range(core[0] - 1, core[0] + 2) for y in range(core[1] - 1, core[1] + 2)
            )
    # Nearby parks, courthouses and main streets often have fewer roofs than
    # the tallest neighborhoods. Include the named settlement's centre too.
    for place in meta["places"]:
        if place["t"] in ("city", "town", "village"):
            cx, cy = int(place["x"] // SIDE), int(place["y"] // SIDE)
            chosen.update((x, y) for x in range(cx - 1, cx + 2) for y in range(cy - 1, cy + 2))
    groups = defaultdict(list)
    for x, y in sorted(chosen):
        region = x // 4, y // 4
        if region in available:
            groups[region].append((x % 4, y % 4))
    return sorted(groups.items())


def colour_detail(data):
    rgb = np.moveaxis(data[:3], 0, 2).astype(np.float32)
    red, nir = rgb[:, :, 0], data[3].astype(np.float32)
    cover = np.clip(((nir - red) / np.maximum(nir + red, 1) - 0.17) * 5, 0, 1)
    light = rgb[:, :, 0] * 0.24 + rgb[:, :, 1] * 0.58 + rgb[:, :, 2] * 0.18
    result = np.empty(rgb.shape, dtype=np.uint8)
    # Keep the difference between a brown lawn, live canopy and bare earth.
    # A small lift in deep shadow leaves room for the moving game shadows.
    for channel, (base, gain) in enumerate([(43, 0.53), (67, 0.60), (34, 0.33)]):
        raw = rgb[:, :, channel]
        turf = 0.53 * raw + 0.47 * (base + light * gain)
        mineral = raw * 0.94 + 10
        result[:, :, channel] = np.clip(mineral + cover * (turf - mineral), 0, 255)
    image = Image.fromarray(result).filter(ImageFilter.UnsharpMask(radius=0.85, percent=90, threshold=3))
    if data[4].min() < 255:
        image.putalpha(Image.fromarray(data[4]))
    return image


def blend_overview(tile, overview, cx, cy, missing):
    """Feather real high/low frequency differences at the edge of selected coverage."""
    if not missing:
        return tile
    # Include diagonal gaps so all four tiles agree at a coverage corner.
    axis = np.linspace(-M_PER_PIXEL, SIDE + M_PER_PIXEL, 131)
    x, y = np.meshgrid(axis, axis)
    distance = np.full_like(x, 20.0)
    for dx, dy in missing:
        ox = np.maximum(np.maximum(dx * SIDE - x, x - (dx + 1) * SIDE), 0)
        oy = np.maximum(np.maximum(dy * SIDE - y, y - (dy + 1) * SIDE), 0)
        distance = np.minimum(distance, np.hypot(ox, oy))
    w = np.clip(distance / 20, 0, 1)
    mask = Image.fromarray(np.round(255 * w * w * (3 - 2 * w)).astype("uint8")).resize(
        tile.size, Image.Resampling.BILINEAR
    )
    overview_scale = overview.width / SPAN
    gutter = M_PER_PIXEL * overview_scale
    left, top = cx * SIDE * overview_scale - gutter, cy * SIDE * overview_scale - gutter
    width = SIDE * overview_scale + 2 * gutter
    low = overview.transform(
        tile.size,
        Image.Transform.EXTENT,
        (left, top, left + width, top + width),
        Image.Resampling.BILINEAR,
    )
    # The overview is drawn with more vector turf showing through it. Match that
    # coverage at the transition as well as the colour of its source pixels.
    low.putalpha(low.getchannel("A").point(lambda a: round(a * 0.76 / 0.92)))
    return Image.composite(tile.convert("RGBA"), low, mask)


def render_details(job, sources, origin, out, decoder):
    (rx, ry), neighborhood = job
    cells = list(neighborhood)
    # Decode once per occupied region rectangle, including one extra pixel for
    # the sharpening filter beyond the gutter actually shipped in the image.
    left, top = min(x for x, y in cells), min(y for x, y in cells)
    lastx, lasty = max(x for x, y in cells), max(y for x, y in cells)
    width = max(lastx - left + 1, lasty - top + 1)
    x, y = rx * SPAN + left * SIDE, ry * SPAN + top * SIDE
    pad = 2 * M_PER_PIXEL
    bounds = world_bounds(origin, x - pad, y - pad, width * SIDE + 2 * pad)
    data = read_window(bounds, width * PIXELS + 4, 0, sources, decoder)
    folder = out / f"{rx}_{ry}"
    folder.mkdir(exist_ok=True)
    overview = Image.open(REGION_DIR / "ground" / f"{rx}_{ry}.webp").convert("RGBA")
    bits = 0
    for cx, cy in cells:
        dx, dy = (cx - left) * PIXELS, (cy - top) * PIXELS
        crop = data[:, dy : dy + PIXELS + 4, dx : dx + PIXELS + 4]
        if not crop[4, 2:-2, 2:-2].any():
            continue
        tile = colour_detail(crop).crop((1, 1, PIXELS + 3, PIXELS + 3))
        tile = blend_overview(tile, overview, cx, cy, neighborhood[cx, cy])
        bit = 4 * cy + cx
        dest = folder / f"{bit}.webp"
        temp = dest.with_suffix(".tmp")
        tile.save(temp, format="WEBP", quality=82, method=3)
        temp.replace(dest)
        bits |= 1 << bit
    return [rx, ry, bits]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--decoder", type=Path, required=True)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--out", type=Path, default=REGION_DIR / "ground" / "detail")
    p.add_argument("mosaics", type=Path, nargs="+")
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((REGION_DIR / "meta.json").read_text())
    index = json.loads((REGION_DIR / "ground" / "index.json").read_text())
    sources = [inspect_sid(path, args.decoder) for path in sorted(args.mosaics)]
    if sorted(path.name for path in args.mosaics) != sorted(index["mosaics"]):
        raise ValueError("Supply the same county mosaics used for the overview")
    groups = select_tiles(meta, set(map(tuple, index["regions"])))
    covered = {(4 * rx + cx, 4 * ry + cy) for (rx, ry), cells in groups for cx, cy in cells}
    jobs = []
    for (rx, ry), cells in groups:
        neighbors = {}
        for cx, cy in cells:
            x, y = 4 * rx + cx, 4 * ry + cy
            neighbors[cx, cy] = [
                (dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (x + dx, y + dy) not in covered
            ]
        jobs.append(((rx, ry), neighbors))
    work = partial(
        render_details, sources=sources, origin=meta["origin"], out=args.out, decoder=args.decoder
    )
    print(f"{len(jobs)} regions, {sum(len(c) for _, c in jobs)} candidate detail tiles", flush=True)
    with ProcessPoolExecutor(args.workers) as pool:
        results = []
        for i, row in enumerate(pool.map(work, jobs), 1):
            if row[2]:
                results.append(row)
            if i % 100 == 0:
                print(f"{i}/{len(jobs)}", flush=True)
    output = args.out / "index.json"
    temp = output.with_suffix(".tmp")
    temp.write_text(
        json.dumps(
            {"year": index["year"], "span": SIDE, "pixels": PIXELS, "regions": results},
            separators=(",", ":"),
        )
    )
    temp.replace(output)
    print(f"{sum(bits.bit_count() for _, _, bits in results)} native detail tiles", flush=True)


if __name__ == "__main__":
    main()
