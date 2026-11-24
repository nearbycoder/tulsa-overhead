#!/usr/bin/env python3
"""Build paint geometry for marked OSM pedestrian crossings on the game's roads.

osmium tags-filter oklahoma-latest.osm.pbf n/highway=crossing n/crossing:markings \
    w/footway=crossing w/cycleway=crossing -o crossings.osm.pbf
.venv/bin/python tools/import_crossings.py crossings.osm.pbf

Rows are [endpoints in game decimetres, walkway width in decimetres, marking style].
Unspecified crossings, unmarked crossings and changes of surface without paint are skipped.
"""

import argparse
import gzip
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import osmium
from build_map import LANE_W, proj
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree


def paint(tags):
    """Zero means explicitly no painted lines; None means the marking is unspecified."""
    marked = (tags.get("crossing:markings") or "").lower().split(";")
    control = (tags.get("crossing") or "").lower().split(";")
    if "no" in marked or "unmarked" in control:
        return 0
    for word in marked:
        if word.startswith("ladder:skewed"):
            return 4
        if word.startswith("ladder"):
            return 3
        if word.startswith("zebra"):
            return 2
        if word.startswith("lines"):
            return 1
        if word in ("dots", "dashes"):
            return 5
    if "surface" in marked:
        return 0
    if "zebra" in control:
        return 2
    if "yes" in marked or "marked" in control:
        return 1
    return None


def road_lines(root, meta):
    lines, widths = [], []
    for rx, ry, n, _, _ in meta["regions"]:
        if not n:
            continue
        with gzip.open(root / "r" / f"{rx}_{ry}.json.gz") as f:
            rows = json.load(f)["roads"]
        for cls, flags, lanes, _, _, _, _, _, encoded, *heights in rows:
            if (
                cls in (0, 9, 10, 15, 16)
                or flags & (2 | 4 | 8)
                or (heights and max(heights[0]) > 3)
            ):
                continue
            x = y = 0
            pts = []
            for dx, dy in zip(encoded[::2], encoded[1::2]):
                x += dx
                y += dy
                pts.append((x / 10, y / 10))
            line = LineString(pts)
            if line.length < 0.1:
                continue
            w = LANE_W[cls] * lanes
            if cls == 1:
                w += 3.5 if flags & 1 else 5
            if cls == 11:
                w += 2.5
            if cls == 8:
                w = 3.2 if flags & 64 else 6 if flags & 32 else max(w * 0.85, 4.5)
            lines.append(line)
            widths.append(w)
    return lines, widths


def direction(line, pos):
    d = line.project(pos)
    a = line.interpolate(max(0, d - 0.8))
    b = line.interpolate(min(line.length, d + 0.8))
    length = a.distance(b)
    if length < 0.05:
        return None
    return (b.x - a.x) / length, (b.y - a.y) / length


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf")
    parser.add_argument("--map", type=Path, default=Path("assets/map"))
    args = parser.parse_args()
    root = args.map
    meta = json.loads((root / "meta.json").read_text())
    world = unary_union([Polygon(p).buffer(0) for p in meta["world"]])
    nodes = {}
    ways = []
    for obj in osmium.FileProcessor(args.pbf).with_locations():
        tags = obj.tags
        if obj.is_node() and (
            tags.get("highway") == "crossing" or "crossing:markings" in tags
        ):
            pos = Point(proj(obj.location.lon, obj.location.lat))
            if world.covers(pos):
                nodes[obj.id] = (pos, paint(tags))
        if obj.is_way() and ("crossing" in (tags.get("footway"), tags.get("cycleway"))):
            if tags.get("bridge", "no") != "no" or tags.get("tunnel", "no") != "no":
                continue
            try:
                path = LineString([proj(n.lon, n.lat) for n in obj.nodes])
            except (osmium.InvalidLocationError, ValueError):
                continue
            if path.length < 0.1 or not world.intersects(path):
                continue
            try:
                width = max(1.2, min(8, float(tags.get("width", "3"))))
            except ValueError:
                width = 3
            ways.append((path, [n.ref for n in obj.nodes], paint(tags), width))
    roads, widths = road_lines(root, meta)
    tree = STRtree(roads)
    found = defaultdict(list)
    consumed = set()

    def add(pos, i, path, style, width):
        if not style:
            return
        tangent = direction(roads[i], pos)
        if not tangent:
            return
        ux, uy = tangent
        axis = direction(path, pos) if path is not None else (-uy, ux)
        if not axis:
            return
        dx, dy = axis
        sin_angle = abs(dx * uy - dy * ux)
        if sin_angle < 0.42:
            return
        half = (widths[i] / 2 - 0.25) / sin_angle
        # A split road, crossing way and crossing node may describe the same paint.
        cell = (math.floor(pos.x / 2), math.floor(pos.y / 2))
        for x in range(cell[0] - 1, cell[0] + 2):
            for y in range(cell[1] - 1, cell[1] + 2):
                for px, py, axisx, axisy, _ in found.get((x, y), []):
                    if (
                        math.hypot(px - pos.x, py - pos.y) < 1.1
                        and abs(dx * axisx + dy * axisy) > 0.9
                    ):
                        return
        row = [
            round(10 * (pos.x - dx * half)),
            round(10 * (pos.y - dy * half)),
            round(10 * (pos.x + dx * half)),
            round(10 * (pos.y + dy * half)),
            round(10 * width),
            style,
        ]
        found[cell].append((pos.x, pos.y, dx, dy, row))

    for path, refs, style, width in ways:
        matches = [(ref, *nodes[ref]) for ref in refs if ref in nodes]
        if not style and not any(st for _, _, st in matches):
            continue
        for i in tree.query(path, predicate="intersects"):
            hit = roads[i].intersection(path)
            points = hit.geoms if hit.geom_type == "MultiPoint" else [hit]
            for pos in points:
                if pos.geom_type != "Point":
                    continue
                nearby = [
                    (n, p.distance(pos), s)
                    for n, p, s in matches
                    if p.distance(pos) < 1.1
                ]
                node_style = None
                if nearby:
                    n, _, node_style = min(nearby, key=lambda q: q[1])
                    consumed.add(n)
                if style == 0 or node_style == 0:
                    continue
                # Use a named pattern in preference to a generic 'marked' tag.
                choice = (
                    node_style if node_style and node_style > 1 else style or node_style
                )
                add(pos, i, path, choice, width)
    for n, (p, style) in nodes.items():
        if n in consumed or not style:
            continue
        candidates = tree.query(p, predicate="dwithin", distance=0.75)
        if len(candidates):
            i = min(candidates, key=lambda j: (roads[j].distance(p), -widths[j]))
            add(roads[i].interpolate(roads[i].project(p)), i, None, style, 3)
    rows = sorted(v[-1] for bucket in found.values() for v in bucket)
    out = root / "crossings.json"
    out.write_text(json.dumps(rows, separators=(",", ":")))
    print(f"{len(rows)} mapped crossings: {dict(Counter(r[-1] for r in rows))}")


if __name__ == "__main__":
    main()
