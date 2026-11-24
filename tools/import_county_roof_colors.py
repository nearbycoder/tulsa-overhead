#!/usr/bin/env python3
"""Sample the eight 2025 USDA NAIP county mosaics for roofs outside the lidar survey.

Pass --decoder /path/to/mrsiddecode and the same eight Oklahoma .sid files used by
build_ground_survey.py. Read each mosaic in small windows at 1.2 metres per pixel.
The input, alpha mask and polygons are sampled in their native projected county CRS.
"""

import argparse
import gzip
import json
import re
import subprocess
import tempfile
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache, partial
from pathlib import Path

import numpy as np
import rasterio
import shapely
from build_ground_survey import inspect_sid
from import_county_buildings import write_region
from import_gt_tulsa import dec_ring
from import_roof_colors import masked_color
from pyproj import Transformer
from shapely.geometry import Polygon, box

CODES = {
    "037": "Creek",
    "111": "Okmulgee",
    "113": "Osage",
    "117": "Pawnee",
    "131": "Rogers",
    "143": "Tulsa",
    "145": "Wagoner",
    "147": "Washington",
}


@lru_cache
def source_transform(crs):
    return Transformer.from_crs("EPSG:4326", crs, always_xy=True)


def sample_region(job, decoder, origin, root, survey):
    rx, ry, sources = job
    path = root / "r" / f"{rx}_{ry}.json.gz"
    with gzip.open(path) as f:
        data = json.load(f)
    candidates = [
        (i, Polygon(dec_ring(b[3])))
        for i, b in enumerate(data["bld"])
        if len(b) <= 7 or not b[7]
    ]
    candidates = [(i, p) for i, p in candidates if not survey.covers(p.centroid)]
    if not candidates:
        return rx, ry, path.stat().st_size, 0
    ids, world = zip(*candidates)
    lonlat = shapely.transform(
        world,
        lambda a: a / [origin["kx"], -origin["ky"]] + [origin["lon"], origin["lat"]],
    )
    colors = {}
    with tempfile.TemporaryDirectory() as tmp:
        for sid, crs, (west, south, east, north) in sources:
            transform = source_transform(crs)
            geoms = shapely.transform(
                lonlat,
                lambda a, transform=transform: np.column_stack(
                    transform.transform(*a.T)
                ),
            )
            x0, y0, x1, y1 = shapely.total_bounds(geoms)
            left, bottom, right, top = (
                max(west, x0 - 3),
                max(south, y0 - 3),
                min(east, x1 + 3),
                min(north, y1 + 3),
            )
            if min(right - left, top - bottom) < 2:
                continue
            tif = Path(tmp) / (sid.stem + ".tif")
            subprocess.run(
                [
                    decoder,
                    "-quiet",
                    "-j",
                    "1",
                    "-wf",
                    "-s",
                    "1",
                    "-i",
                    sid,
                    "-o",
                    tif,
                    "-of",
                    "tif",
                    "-coord",
                    "geo",
                    "-ulxy",
                    str(left),
                    str(top),
                    "-lrxy",
                    str(right),
                    str(bottom),
                ],
                check=True,
            )
            with rasterio.open(tif) as image:
                bands = image.read()
                affine = image.transform
            if not bands[4].any():
                continue
            rgb = np.moveaxis(bands[:3], 0, 2)
            red, nir = bands[0].astype("float32"), bands[3].astype("float32")
            ndvi = ((nir - red) / np.maximum(nir + red, 1) + 0.2) * 255
            alpha = bands[4] > 0
            for i, p in zip(ids, geoms):
                if i in colors:
                    continue
                h = data["bld"][i][1]
                interior = p.buffer(
                    -min(15, 1.2 + max(0, h - 5) * 0.14), join_style="mitre"
                )
                if interior.area < 6:
                    continue
                color = masked_color(
                    interior, affine.c, affine.f, affine.a, rgb, ndvi, alpha
                )
                if color:
                    colors[i] = color
            # Remaining unmatched roofs in a fully covered window failed the vegetation/shade test.
            if alpha.all():
                break
    for i, color in colors.items():
        b = data["bld"][i]
        if len(b) == 4:
            b.extend([0, round(b[1] * 10), -1, "", ""])
        b[7] = color
    return (
        rx,
        ry,
        write_region(path, data) if colors else path.stat().st_size,
        len(colors),
    )


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--map", type=Path, default=Path("assets/map"))
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--decoder", type=Path, required=True)
    p.add_argument("mosaics", type=Path, nargs="+")
    args = p.parse_args()
    meta_path = args.map / "meta.json"
    meta = json.loads(meta_path.read_bytes())
    size = meta["region"]
    sources = {}
    for path in args.mosaics:
        code = re.search(r"_ok(\d{3})_2025_", path.name)[1]
        sources[CODES[code] + " County"] = inspect_sid(path, args.decoder)
    if len(sources) != len(CODES):
        raise ValueError("All eight county mosaics are required.")
    counties = {
        c["n"]: shapely.union_all([Polygon(r).buffer(0) for r in c["poly"]])
        for c in meta["counties"]
    }
    survey = Polygon(meta["survey"]["coverage"])
    jobs = []
    for rx, ry, _, count, _ in meta["regions"]:
        tile = box(rx * size, ry * size, (rx + 1) * size, (ry + 1) * size)
        if not count or survey.covers(tile):
            continue
        local = sorted(
            (
                (poly.intersection(tile).area, name)
                for name, poly in counties.items()
                if poly.intersects(tile)
            ),
            reverse=True,
        )
        if local:
            jobs.append((rx, ry, [sources[name] for _, name in local]))
    work = partial(
        sample_region,
        decoder=args.decoder,
        origin=meta["origin"],
        root=args.map,
        survey=survey,
    )
    index = {(r[0], r[1]): r for r in meta["regions"]}
    sampled = 0
    with ProcessPoolExecutor(args.workers) as pool:
        for n, (rx, ry, byte_count, count) in enumerate(
            pool.map(work, jobs, chunksize=4), 1
        ):
            index[rx, ry][4] = byte_count
            sampled += count
            if n % 500 == 0:
                print(f"{n}/{len(jobs)} regions; {sampled} roof colors", flush=True)
    if sampled:
        old = meta["countyBuildings"].get("aerialRoofColors", {}).get("buildings", 0)
        meta["countyBuildings"]["aerialRoofColors"] = {
            "source": "USDA NAIP",
            "year": 2025,
            "buildings": old + sampled,
            "method": "Median roof-interior RGB with vegetation, shadow and county coverage masks",
        }
        temp = meta_path.with_suffix(".tmp")
        temp.write_text(json.dumps(meta, separators=(",", ":")))
        temp.replace(meta_path)
    print(f"{sampled} outer roofs colored", flush=True)


if __name__ == "__main__":
    main()
