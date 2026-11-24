#!/usr/bin/env python3
"""Extend the surveyed centre with Overture footprints for the entire playable world.

Download the bounding box with `overturemaps download -r 2026-11-18.0 -t building
--bbox=-97.070,35.374,-95.205,37.002 -f geoparquet -o build/eight_county_buildings.parquet`.
Run after import_gt_tulsa.py, using the same Python environment. The existing road,
area and place datasets are preserved. All clipping and size thresholds are in metres.
"""

import argparse
import gzip
import json
import math
import os
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import shapely
from import_gt_tulsa import BLD_TYPE, ROOF, dec_ring, enc_ring, hexcol
from shapely.geometry import Polygon, box
from shapely.strtree import STRtree

USE = {
    **BLD_TYPE,
    "terrace": 2,
    "semi": 2,
    "bungalow": 1,
    "cabin": 1,
    "factory": 6,
    "library": 19,
    "post_office": 19,
    "service": 11,
    "outbuilding": 11,
    "religious": 8,
    "education": 9,
    "medical": 10,
    "agricultural": 13,
    "shelter": 12,
}
LAND_USE = {5: 5, 6: 6, 19: 14, 23: 13, 24: 9, 25: 10, 27: 18, 30: 8}
DEFAULT_HEIGHT = [
    6,
    5.5,
    6,
    10,
    6.5,
    6.5,
    8.5,
    12,
    10,
    7.5,
    14,
    3.4,
    4,
    6,
    9,
    10,
    3.5,
    13,
    12,
    8,
    10,
]
POI_USE = {
    "church": 8,
    "place_of_worship": 8,
    "hospital": 10,
    "school": 9,
    "college": 9,
    "university": 9,
    "fire_station": 19,
    "townhall": 19,
    "library": 19,
    "police": 19,
    "post_office": 19,
    "hotel": 17,
    "theatre": 4,
    "restaurant": 4,
    "fuel": 4,
}


def game_polygons(rings):
    return shapely.union_all([Polygon(ring).buffer(0) for ring in rings])


def write_region(path, data):
    raw = json.dumps(data, separators=(",", ":")).encode()
    temp = path.with_suffix(".tmp")
    temp.write_bytes(gzip.compress(raw, compresslevel=7, mtime=0))
    os.replace(temp, path)
    return path.stat().st_size


def read_external(path, meta, world, survey):
    origin = meta["origin"]

    def project(xy):
        return (xy - [origin["lon"], origin["lat"]]) * [origin["kx"], -origin["ky"]]

    columns = [
        "geometry",
        "class",
        "subtype",
        "height",
        "num_floors",
        "roof_shape",
        "roof_height",
        "roof_color",
        "facade_color",
        "names",
        "is_underground",
    ]
    by_region = defaultdict(list)
    size = meta["region"]
    for batch in pq.ParquetFile(path).iter_batches(batch_size=16000, columns=columns):
        data = batch.to_pydict()
        geoms = shapely.transform(shapely.from_wkb(data["geometry"]), project)
        # Overture permits multipart buildings. Keep each exterior separately.
        parts, parents = shapely.get_parts(geoms, return_index=True)
        centers = shapely.centroid(parts)
        inside = shapely.contains(world, centers) & ~shapely.covers(survey, centers)
        for i in np.flatnonzero(inside):
            p = parts[i]
            parent = parents[i]
            if p.geom_type != "Polygon" or p.area < 4 or data["is_underground"][parent]:
                continue
            p = p.simplify(0.25)
            if not p.is_valid or p.is_empty:
                continue
            name = (data["names"][parent] or {}).get("primary", "")
            bt = USE.get(data["class"][parent], USE.get(data["subtype"][parent], 0))
            # The ownership test must use the same decimetre polygon the game loads.
            # A roof centred on the survey seam can otherwise change ownership on a rerun.
            reference = Polygon(dec_ring(enc_ring(p.exterior.coords))).centroid
            if survey.covers(reference):
                continue
            by_region[
                math.floor(reference.x / size), math.floor(reference.y / size)
            ].append(
                (
                    p,
                    bt,
                    data["height"][parent],
                    data["num_floors"][parent],
                    data["roof_shape"][parent],
                    data["roof_height"][parent],
                    hexcol(data["roof_color"][parent]),
                    hexcol(data["facade_color"][parent]),
                    name,
                )
            )
    return by_region


def point_context(d, points):
    zones, kinds = [], []
    for k, rings in d["areas"]:
        if k in LAND_USE and rings:
            p = Polygon(dec_ring(rings[0]), [dec_ring(r) for r in rings[1:]])
            zones.append(p)
            kinds.append(k)
    types = {}
    if zones:
        ix, zone = STRtree(zones).query(points, predicate="within")
        for i, j in zip(ix, zone):
            if i not in types or zones[j].area < zones[types[i]].area:
                types[i] = j
    return {i: LAND_USE[kinds[j]] for i, j in types.items()}


def rebuild_region(d, records, survey, names, names_ix, pois, stats):
    geom = [r[0] for r in records]
    tree = STRtree(geom)
    local = []
    known = {}
    saved_colors = {}
    for old in d["bld"]:
        poly = Polygon(dec_ring(old[3]))
        if survey.covers(poly.centroid):
            local.append(old)
            continue
        if len(old) > 7 and old[7]:
            saved_colors[tuple(old[3])] = old[7]
        if not 0 <= old[2] < len(names):
            continue  # anonymous old lots can be procedural
        matches = tree.query(poly, predicate="intersects")
        best = None
        best_fraction = 0.25
        for i in matches:
            if not poly.is_valid:
                poly = poly.buffer(0)
            area = geom[i].intersection(poly).area
            fraction = area / max(poly.area, geom[i].area, 1)
            if fraction > best_fraction:
                best = i
                best_fraction = fraction
        if best is not None:
            known[best] = (old[0], names[old[2]])
        elif not len(matches):
            local.append(old)  # keep a mapped, named building absent from Overture
    for poi in pois:
        kind, _, value = poi["k"].partition("=")
        t = POI_USE.get(value, 5 if kind == "shop" else 0)
        if t:
            for i in tree.query(shapely.Point(poi["x"], poi["y"]), predicate="within"):
                known.setdefault(i, (t, poi["n"]))
    points = shapely.centroid(geom)
    zone_types = point_context(d, points)
    # File order from the remote parquet scan can vary. Preserve deterministic region payloads.
    rows = []
    for i, (p, t, h, floors, shape, rise, rc, wc, name) in enumerate(records):
        known_type, known_name = known.get(i, (0, ""))
        t = t or known_type or zone_types.get(i, 0)
        a = p.area
        if not t:
            t = 11 if a < 38 else 1 if a < 345 else 4 if a < 1500 else 6
        if h and math.isfinite(h) and h > 0:
            stats["sourceHeight"] += 1
        else:
            h = floors * 3.2 + 1.0 if floors and floors > 0 else DEFAULT_HEIGHT[t]
        h = round(min(260, max(2.4, h)), 1)
        ring = enc_ring(p.exterior.coords)
        if len(set(dec_ring(ring))) < 3:
            continue
        # When the source gives no shape, use simple pitched models on domestic footprints.
        roof = ROOF.get(shape, None)
        if roof is None:
            roof = (
                (1 if (ring[0] ^ ring[1]) & 1 else 2)
                if t in (1, 2, 11, 13, 16) and a < 600
                else 0
            )
        rec = [t, h, -1, ring]
        rc = rc or saved_colors.get(tuple(ring), "")
        if roof or rc or wc:
            if not rise or rise <= 0:
                rise = min(3.5, math.sqrt(a) * (0.12 if roof == 3 else 0.20))
            eave = max(2.1, h - rise) if roof else h
            rec.extend([roof, round(eave * 10), -1, rc, wc])
        rows.append((ring, rec, name or known_name))
    for _, rec, name in sorted(rows, key=lambda row: row[0]):
        if name:
            if name not in names_ix:
                names_ix[name] = len(names)
                names.append(name)
            rec[2] = names_ix[name]
        local.append(rec)
    return clean_rings(local)


def clean_rings(records):
    # Snapping an OSM vertex to decimetres can fold a very short edge back on itself.
    # Repair the rendered ring at its final precision; preserve separate polygon pieces.
    unique = {}
    for rec in records:
        polygon = Polygon(dec_ring(rec[3]))
        parts = (
            [polygon]
            if polygon.is_valid
            else shapely.get_parts(shapely.set_precision(polygon.buffer(0), 0.1))
        )
        for p in parts:
            if p.geom_type != "Polygon" or p.area < 1:
                continue
            key = p.normalize().wkb
            if p is not polygon:
                rec = rec.copy()
                rec[3] = enc_ring(p.exterior.coords)
            # Prefer the surveyed roof and mapped name if the seam contributed identical rings.
            rank = (len(rec), rec[2] >= 0, rec[0] != 0)
            if key not in unique or unique[key][0] < rank:
                unique[key] = (rank, rec)
    return [record for _, record in unique.values()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parquet", type=Path)
    parser.add_argument("--map", type=Path, default=Path("assets/map"))
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    root = args.map
    meta_path = root / "meta.json"
    meta = json.loads(meta_path.read_bytes())
    world = game_polygons(meta["world"])
    survey = Polygon(meta["survey"]["coverage"])
    shapely.prepare(world)
    shapely.prepare(survey)
    state_path = Path(str(args.parquet) + ".state")
    if state_path.exists():
        state = json.loads(state_path.read_text())
        bbox = state["bbox"]
        origin = meta["origin"]
        x0, y0, x1, y1 = world.bounds
        if (
            state.get("last_release") != args.release
            or state.get("type") != "building"
            or bbox["xmin"] > origin["lon"] + x0 / origin["kx"]
            or bbox["xmax"] < origin["lon"] + x1 / origin["kx"]
            or bbox["ymin"] > origin["lat"] - y1 / origin["ky"]
            or bbox["ymax"] < origin["lat"] - y0 / origin["ky"]
        ):
            raise ValueError(
                "The Overture download must cover the full world and match the selected release."
            )
    features = read_external(args.parquet, meta, world, survey)
    size = meta["region"]
    pois = defaultdict(list)
    for p in meta["pois"]:
        pois[math.floor(p["x"] / size), math.floor(p["y"] / size)].append(p)
    names = meta["names"]
    names_ix = {n: i for i, n in enumerate(names)}
    index = {tuple(r[:2]): r for r in meta["regions"]}
    stats = Counter()
    changed = 0
    for key in sorted(index.keys() | features.keys()):
        rx, ry = key
        in_core = survey.covers(
            box(rx * size, ry * size, (rx + 1) * size, (ry + 1) * size)
        )
        path = root / "r" / f"{rx}_{ry}.json.gz"
        if key in index:
            with gzip.open(path) as f:
                d = json.load(f)
        else:
            d = {"rx": rx, "ry": ry, "bld": [], "roads": [], "areas": [], "lines": []}
        # The earlier road-elevation pass also changed some pre-existing file sizes.
        if key in index:
            index[key][4] = path.stat().st_size
        if not d["bld"] and key not in features:
            continue
        records = features.get(key, [])
        bld = (
            clean_rings(d["bld"])
            if in_core
            else rebuild_region(d, records, survey, names, names_ix, pois[key], stats)
        )
        if bld != d["bld"]:
            d["bld"] = bld
            index[key] = [rx, ry, len(d["roads"]), len(bld), write_region(path, d)]
            changed += 1
        stats["footprints"] += len(records)
    meta["regions"] = list(index.values())
    meta["countyBuildings"] = {
        **meta.get("countyBuildings", {}),
        "source": "Overture Maps Foundation, buildings theme (Microsoft and OpenStreetMap)",
        "release": args.release,
        "extent": "Playable world outside the GT Tulsa survey",
        **stats,
    }
    tmp = meta_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, separators=(",", ":")))
    tmp.replace(meta_path)
    print(f"{changed} region files changed; {dict(stats)}", flush=True)


if __name__ == "__main__":
    main()
