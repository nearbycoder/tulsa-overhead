#!/usr/bin/env python3
"""Check every streamed building and report the portion of each municipality inside the game.

Run after the map import. Requires shapely 2 and numpy. Prints a CSV suitable for comparing
releases. A boundary may only touch the map or intersect it in an undeveloped area.
"""

import argparse
import csv
import gzip
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import shapely
from shapely.geometry import Polygon
from shapely.strtree import STRtree


def region_buildings(path, index, names):
    if path.stat().st_size != index[4]:
        raise ValueError(f"Stale byte count for {path}")
    with gzip.open(path) as stream:
        data = json.load(stream)
    if [data["rx"], data["ry"], len(data["roads"]), len(data["bld"])] != index[:4]:
        raise ValueError(f"Region index mismatch for {path}")
    shapes = []
    for i, b in enumerate(data["bld"]):
        if not (
            0 <= b[0] <= 20
            and math.isfinite(b[1])
            and b[1] > 0
            and -1 <= b[2] < len(names)
        ):
            raise ValueError(f"Invalid building attributes in {path}, row {i}")
        if len(b) not in (4, 9) or len(b[3]) < 6 or len(b[3]) % 2:
            raise ValueError(f"Invalid building record in {path}, row {i}")
        if len(b) == 9 and (
            not (0 <= b[4] <= 5)
            or any(c and not re.fullmatch(r"#[a-fA-F0-9]{6}", c) for c in b[7:9])
        ):
            raise ValueError(f"Invalid roof attributes in {path}, row {i}")
        x = y = 0
        points = []
        for dx, dy in zip(b[3][::2], b[3][1::2]):
            x += dx
            y += dy
            points.append((x / 10, y / 10))
        shapes.append(Polygon(points))
    for i, valid in enumerate(shapely.is_valid(shapes)):
        if not valid:
            raise ValueError(f"{shapely.is_valid_reason(shapes[i])} in {path}, row {i}")
    return shapes, data["bld"]


def union(rings):
    return shapely.union_all([Polygon(r).buffer(0) for r in rings])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--map", type=Path, default=Path("assets/map"))
    args = p.parse_args()
    m = json.loads((args.map / "meta.json").read_text())
    cities = m["cities"]
    polys = [union(c["poly"]) for c in cities]
    tree = STRtree(polys)
    survey = Polygon(m["survey"]["coverage"])
    world = union(m["world"])
    shapely.prepare(survey)
    counts, outer, colors = Counter(), Counter(), Counter()
    for row in m["regions"]:
        shapes, b = region_buildings(
            args.map / "r" / f"{row[0]}_{row[1]}.json.gz", row, m["names"]
        )
        if not shapes:
            continue
        centers = shapely.centroid(shapes)
        outside = ~shapely.covers(survey, centers)
        ix, jx = tree.query(centers, predicate="within")
        for i, j in zip(ix, jx):
            counts[j] += 1
            outer[j] += int(outside[i])
            colors[j] += bool(len(b[i]) > 7 and b[i][7])
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(
        [
            "Municipality",
            "Playable area (km²)",
            "Building footprints",
            "Outside central survey",
            "With sourced roof color",
        ]
    )
    for j in sorted(range(len(cities)), key=lambda j: cities[j]["n"]):
        writer.writerow(
            [
                cities[j]["n"],
                round(polys[j].intersection(world).area / 1e6, 3),
                counts[j],
                outer[j],
                colors[j],
            ]
        )
    print(
        f"Validated {sum(r[3] for r in m['regions']):,} footprints in {len(m['regions']):,} regions and checked {len(cities)} municipal boundaries.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
