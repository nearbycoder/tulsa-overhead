#!/usr/bin/env python3
"""Sample roof colors from the GT Tulsa georeferenced 2025 USDA NAIP RGB/NDVI tiles.

Use the GT Tulsa pipeline environment. The image tile index starts at the southwest
corner of its transverse Mercator grid. Each one-metre aerial image is north-up.
Explicit OSM/Overture colors take precedence. Only buildings in the lidar survey
are eligible, and source pixels obscured by vegetation or shadow are discarded.
"""

import argparse
import gzip
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import shapely
from import_county_buildings import write_region
from import_gt_tulsa import GT_HALF, GT_PROJ4, dec_ring
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import Polygon, box


def sample_roof(coords, height, images, tile_size):
    # Inset the sampling area to avoid mixed wall/ground pixels and displacement
    # of tall roofs in the orthophotography. Reject thin buildings with no core.
    poly = Polygon(coords)
    interior = poly.buffer(
        -min(15, 1.2 + max(0, height - 5) * 0.14), join_style="mitre"
    )
    if interior.is_empty or interior.area < 6:
        return None
    c = interior.representative_point()
    ix = math.floor((c.x + GT_HALF) / tile_size)
    iy = math.floor((c.y + GT_HALF) / tile_size)
    if not (0 <= ix < 40 and 0 <= iy < 40):
        return None
    rgb, ndvi = images(ix, iy)
    # Handle buildings crossing a tile seam using their interior on this tile.
    tx, ty = ix * tile_size - GT_HALF, (iy + 1) * tile_size - GT_HALF
    return masked_color(interior, tx, ty, 1, rgb, ndvi)


def masked_color(interior, west, north, resolution, rgb, ndvi, valid_pixels=None):
    xmin, ymin, xmax, ymax = interior.bounds
    height, width = rgb.shape[:2]
    x0 = max(0, math.floor((xmin - west) / resolution))
    x1 = min(width, math.ceil((xmax - west) / resolution))
    y0 = max(0, math.floor((north - ymax) / resolution))
    y1 = min(height, math.ceil((north - ymin) / resolution))
    if x0 >= x1 or y0 >= y1:
        return None
    mask = Image.new("1", (x1 - x0, y1 - y0))
    draw = ImageDraw.Draw(mask)
    for p in shapely.get_parts(interior):
        if p.geom_type != "Polygon":
            continue
        for outer, ring in enumerate((p.exterior, *p.interiors)):
            draw.polygon(
                [
                    ((x - west) / resolution - x0, (north - y) / resolution - y0)
                    for x, y in ring.coords
                ],
                fill=int(outer == 0),
            )
    inside = np.asarray(mask)
    band = rgb[y0:y1, x0:x1]
    # Source NDVI byte range maps linearly onto [-0.2, 0.8].
    valid = inside & (ndvi[y0:y1, x0:x1] < 121) & (band.mean(axis=2) > 22)
    if valid_pixels is not None:
        valid &= valid_pixels[y0:y1, x0:x1]
    if valid.sum() < max(6, inside.sum() * 0.25):
        return None
    red, green, blue = np.median(band[valid], axis=0).astype(int)
    return f"#{red:02x}{green:02x}{blue:02x}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "imagery", type=Path, help="GT Tulsa data/build/imagery directory"
    )
    parser.add_argument("--map", type=Path, default=Path("assets/map"))
    args = parser.parse_args()
    info = json.loads((args.imagery / "imagery_meta.json").read_text())
    if info["tile_m"] != info["tile_px"] or info["tiles"] != [40, 40]:
        raise ValueError(
            "Expected the 40 × 40 GT Tulsa image grid at 1 metre per pixel."
        )

    @lru_cache(maxsize=16)
    def images(ix, iy):
        stem = f"tile_{ix:02}_{iy:02}"
        with (
            Image.open(args.imagery / "rgb" / (stem + ".jpg")) as rgb,
            Image.open(args.imagery / "ndvi" / (stem + ".png")) as ndvi,
        ):
            return np.asarray(rgb.convert("RGB")), np.asarray(ndvi)

    meta_path = args.map / "meta.json"
    meta = json.loads(meta_path.read_bytes())
    origin = meta["origin"]
    size = meta["region"]
    coverage = Polygon(meta["survey"]["coverage"])
    project = Transformer.from_crs("EPSG:4326", GT_PROJ4, always_xy=True)
    changed = 0
    sampled = 0
    for row in meta["regions"]:
        rx, ry, _, count, _ = row
        if not count or not coverage.intersects(
            box(rx * size, ry * size, (rx + 1) * size, (ry + 1) * size)
        ):
            continue
        path = args.map / "r" / f"{rx}_{ry}.json.gz"
        with gzip.open(path) as f:
            d = json.load(f)
        hits = 0
        for b in d["bld"]:
            if len(b) > 7 and b[7]:
                continue
            pts = np.array(dec_ring(b[3]))
            if not coverage.covers(Polygon(pts).centroid):
                continue
            lon, lat = (
                pts / [origin["kx"], -origin["ky"]] + [origin["lon"], origin["lat"]]
            ).T
            e, n = project.transform(lon, lat)
            color = sample_roof(np.column_stack([e, n]), b[1], images, info["tile_m"])
            if not color:
                continue
            if len(b) == 4:
                b.extend([0, round(b[1] * 10), -1, "", ""])
            b[7] = color
            hits += 1
        if hits:
            row[4] = write_region(path, d)
            changed += 1
            sampled += hits
    if sampled:
        previous = meta["survey"].get("aerialRoofColors", {}).get("buildings", 0)
        meta["survey"]["aerialRoofColors"] = {
            "source": "USDA NAIP",
            "year": info["year"],
            "method": "Median roof-interior RGB with an NDVI and shadow mask",
            "buildings": previous + sampled,
        }
        tmp = meta_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, separators=(",", ":")))
        tmp.replace(meta_path)
    print(f"{sampled} NAIP roof colors added in {changed} regions", flush=True)


if __name__ == "__main__":
    main()
