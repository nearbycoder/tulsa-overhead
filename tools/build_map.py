#!/usr/bin/env python3
"""Build GTPolly world data from an OpenStreetMap extract.

Usage:
  .venv/bin/python tools/build_map.py <filtered.osm.pbf> [--out assets/map]

Produces:
  assets/map/meta.json             world bounds, regions index, counties/cities, POIs, places
  assets/map/r/<rx>_<ry>.json.gz   region files (2048 m squares) with roads, buildings, areas, lines
  assets/map/tiles/<z>/<x>_<y>.png overview map tiles (built by build_tiles.py)

World space: metres, x east, y south, origin at downtown Tulsa.
"""
import argparse, gzip, json, math, os, random, sys, time, hashlib
from collections import defaultdict, Counter

import osmium
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

LAT0, LON0 = 36.1540, -95.9928
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0
REGION = 2048.0

COUNTIES = {"Tulsa County", "Osage County", "Pawnee County", "Creek County", "Okmulgee County",
            "Wagoner County", "Rogers County", "Washington County"}


def proj(lon, lat):
    return ((lon - LON0) * KX, -(lat - LAT0) * KY)


# ---------------------------------------------------------------- road classes
ROAD_CLS = {
    "motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "unclassified": 5,
    "residential": 6, "living_street": 7, "service": 8, "track": 9, "motorway_link": 10,
    "trunk_link": 11, "primary_link": 12, "secondary_link": 13, "tertiary_link": 14,
    "footway": 15, "path": 15, "cycleway": 15, "pedestrian": 15, "steps": 15, "bridleway": 15,
    "raceway": 16, "road": 5, "busway": 8,
}
DRIVABLE = {c for c in range(0, 15)} | {16}
LANE_W = {0: 3.7, 1: 3.6, 2: 3.4, 3: 3.3, 4: 3.2, 5: 3.0, 6: 3.0, 7: 2.8, 8: 2.8, 9: 2.6,
          10: 3.6, 11: 3.5, 12: 3.3, 13: 3.2, 14: 3.1, 15: 1.2, 16: 5.0}
DEFAULT_LANES = {0: 4, 1: 4, 2: 4, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1, 10: 1, 11: 1,
                 12: 1, 13: 1, 14: 1, 15: 1, 16: 2}

# flags
F_ONEWAY, F_BRIDGE, F_TUNNEL, F_UNPAVED, F_ROUND, F_AISLE, F_DRIVEWAY, F_SIDEWALK = 1, 2, 4, 8, 16, 32, 64, 128
UNPAVED = {"unpaved", "gravel", "dirt", "ground", "compacted", "fine_gravel", "grass", "sand", "earth", "mud", "pebblestone"}

# area kinds (surface/landuse layer); order also = draw priority (low first)
AREA_KIND = {
    "farmland": 1, "meadow": 2, "grass": 3, "residential": 4, "commercial": 5, "retail": 5,
    "industrial": 6, "forest": 7, "wood": 7, "park": 8, "golf_course": 9, "cemetery": 10,
    "pitch": 11, "parking": 12, "water": 13, "sand": 14, "wetland": 15, "railway": 16,
    "playground": 17, "swimming_pool": 18, "apron": 19, "scrub": 20, "brownfield": 21,
    "construction": 21, "quarry": 22, "landfill": 22, "farmyard": 23, "school": 24,
    "university": 24, "hospital": 25, "military": 26, "stadium": 27, "track": 28,
    "garden": 8, "recreation_ground": 8, "nature_reserve": 7, "orchard": 29, "vineyard": 29,
    "religious": 30, "basin": 13, "reservoir": 13, "plaza": 31, "beach": 14, "bare_rock": 22,
}

# building type codes
BLD_TYPE = {
    "house": 1, "detached": 1, "semidetached_house": 1, "residential": 2, "apartments": 3,
    "commercial": 4, "retail": 5, "industrial": 6, "warehouse": 6, "office": 7, "church": 8,
    "school": 9, "university": 9, "hospital": 10, "garage": 11, "garages": 11, "shed": 11,
    "carport": 11, "roof": 12, "barn": 13, "farm_auxiliary": 13, "hangar": 14,
    "storage_tank": 15, "static_caravan": 16, "hotel": 17, "stadium": 18, "civic": 19,
    "public": 19, "government": 19, "train_station": 19, "parking": 20, "service": 11,
    "construction": 0, "yes": 0, "mosque": 8, "temple": 8, "cathedral": 8, "chapel": 8,
    "dormitory": 3, "fire_station": 19, "kindergarten": 9, "supermarket": 5, "grandstand": 18,
    "silo": 15, "greenhouse": 13, "terrace": 2, "bungalow": 1, "cabin": 1, "farm": 1,
}
DEFAULT_H = {0: 6.0, 1: 5.5, 2: 7.0, 3: 11.0, 4: 7.0, 5: 6.5, 6: 9.0, 7: 13.0, 8: 12.0, 9: 9.0,
             10: 16.0, 11: 3.2, 12: 4.0, 13: 7.0, 14: 10.0, 15: 9.0, 16: 3.5, 17: 18.0, 18: 14.0,
             19: 10.0, 20: 10.0}

POI_KEYS = ("amenity", "tourism", "historic", "leisure", "shop", "man_made", "aeroway", "railway", "office", "building")
POI_KEEP_AMENITY = {"hospital", "police", "fire_station", "fuel", "bank", "restaurant", "fast_food", "bar",
                    "pub", "cafe", "casino", "school", "university", "college", "place_of_worship", "theatre",
                    "cinema", "nightclub", "library", "townhall", "courthouse", "prison", "car_wash",
                    "marketplace", "arts_centre", "community_centre", "post_office", "pharmacy", "car_rental",
                    "stripclub", "events_venue", "conference_centre", "bus_station", "ferry_terminal"}


def h32(s):
    return int(hashlib.md5(str(s).encode()).hexdigest()[:8], 16)


def parse_float(v):
    if v is None:
        return None
    try:
        v = v.strip().lower().replace("m", "").replace("'", "").strip()
        if v.endswith("ft"):
            return float(v[:-2]) * 0.3048
        return float(v.split(";")[0])
    except Exception:
        return None


class Collector(osmium.SimpleHandler):
    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf")
    ap.add_argument("--out", default="assets/map")
    ap.add_argument("--no-gen-houses", action="store_true")
    args = ap.parse_args()
    out = args.out
    os.makedirs(os.path.join(out, "r"), exist_ok=True)
    t0 = time.time()

    ways = []        # drivable + path ways: (cls, tags-derived attrs, refs, coords)
    lines = []       # (kind, width, coords)  rail, river, stream, runway
    areas = []       # (kind, shapely geom)
    buildings = []   # (type, height, name, shapely polygon)
    pois = []        # dict
    places = []      # dict
    counties = {}
    cities = {}
    named_area_pois = []

    fp = osmium.FileProcessor(args.pbf).with_locations().with_areas()
    n = 0
    for o in fp:
        n += 1
        if n % 1000000 == 0:
            print(f"  .. {n} objects {time.time()-t0:.0f}s", flush=True)
        tags = o.tags
        if o.is_node():
            name = tags.get("name")
            if "place" in tags and name:
                pt = proj(o.location.lon, o.location.lat)
                pop = tags.get("population", "0")
                try:
                    pop = int(pop.replace(",", ""))
                except Exception:
                    pop = 0
                places.append({"n": name, "t": tags["place"], "x": round(pt[0]), "y": round(pt[1]), "p": pop})
            elif name:
                kind = None
                for k in POI_KEYS:
                    if k in tags:
                        v = tags[k]
                        if k == "amenity" and v not in POI_KEEP_AMENITY:
                            continue
                        kind = f"{k}={v}"
                        break
                if kind:
                    pt = proj(o.location.lon, o.location.lat)
                    pois.append({"n": name, "k": kind, "x": round(pt[0], 1), "y": round(pt[1], 1)})
            continue
        if o.is_way():
            hw = tags.get("highway")
            if hw and hw in ROAD_CLS:
                if tags.get("area") == "yes":
                    continue
                if hw == "footway" and tags.get("footway") in ("sidewalk", "crossing", "access_aisle"):
                    continue
                if hw in ("proposed", "construction", "abandoned", "corridor"):
                    continue
                if tags.get("access") in ("private", "no") and hw == "service" and tags.get("service") == "driveway":
                    pass
                try:
                    refs = [nd.ref for nd in o.nodes]
                    coords = [proj(nd.lon, nd.lat) for nd in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                if len(coords) < 2:
                    continue
                cls = ROAD_CLS[hw]
                flags = 0
                ow = tags.get("oneway")
                rev = False
                if ow in ("yes", "true", "1") or (ow is None and (hw in ("motorway", "motorway_link") or tags.get("junction") in ("roundabout", "circular"))):
                    flags |= F_ONEWAY
                elif ow == "-1":
                    flags |= F_ONEWAY
                    rev = True
                if tags.get("bridge") not in (None, "no"):
                    flags |= F_BRIDGE
                if tags.get("tunnel") not in (None, "no"):
                    flags |= F_TUNNEL
                surf = tags.get("surface")
                if surf in UNPAVED or (cls == 9 and surf is None):
                    flags |= F_UNPAVED
                if tags.get("junction") in ("roundabout", "circular"):
                    flags |= F_ROUND
                sv = tags.get("service")
                if sv == "parking_aisle":
                    flags |= F_AISLE
                if sv == "driveway":
                    flags |= F_DRIVEWAY
                lanes = None
                try:
                    lanes = int(tags.get("lanes", "").split(";")[0])
                except Exception:
                    lanes = None
                if not lanes or lanes < 1 or lanes > 10:
                    lanes = DEFAULT_LANES[cls]
                    if flags & F_ONEWAY and cls in (0, 1, 2):
                        lanes = 2
                    if flags & F_ONEWAY and cls in (3, 4, 5, 6):
                        lanes = 1 if cls >= 5 else 2
                    if cls == 8 and (flags & (F_DRIVEWAY)):
                        lanes = 1
                    if cls == 9:
                        lanes = 1
                if rev:
                    refs = refs[::-1]
                    coords = coords[::-1]
                try:
                    layer = int(tags.get("layer", "0"))
                except Exception:
                    layer = 0
                name = tags.get("name") or tags.get("ref") or ""
                ref = tags.get("ref", "")
                ms = parse_float((tags.get("maxspeed") or "").replace("mph", "")) if tags.get("maxspeed") else None
                ways.append((cls, flags, lanes, layer, name, ref, ms, refs, coords))
                continue
            rw = tags.get("railway")
            if rw in ("rail", "light_rail", "tram", "narrow_gauge", "preserved", "disused", "spur", "siding"):
                if tags.get("tunnel") not in (None, "no"):
                    continue
                try:
                    coords = [proj(nd.lon, nd.lat) for nd in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                lines.append(("rail" if rw != "disused" else "rail_old", 4.0, coords, tags.get("bridge") not in (None, "no")))
                continue
            ww = tags.get("waterway")
            if ww in ("river", "stream", "canal", "ditch", "drain"):
                try:
                    coords = [proj(nd.lon, nd.lat) for nd in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                wdt = parse_float(tags.get("width"))
                if wdt is None:
                    wdt = {"river": 20.0, "canal": 10.0, "stream": 3.5, "ditch": 2.0, "drain": 2.0}[ww]
                lines.append((ww, min(wdt, 60.0), coords, False))
                continue
            aw = tags.get("aeroway")
            if aw in ("runway", "taxiway"):
                try:
                    coords = [proj(nd.lon, nd.lat) for nd in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                wdt = parse_float(tags.get("width")) or (45.0 if aw == "runway" else 20.0)
                lines.append((aw, wdt, coords, False))
                continue
            continue
        if o.is_area():
            # assemble polygons
            def geom():
                polys = []
                for outer in o.outer_rings():
                    try:
                        oc = [proj(nd.lon, nd.lat) for nd in outer]
                    except osmium.InvalidLocationError:
                        return None
                    holes = []
                    for inner in o.inner_rings(outer):
                        try:
                            holes.append([proj(nd.lon, nd.lat) for nd in inner])
                        except osmium.InvalidLocationError:
                            pass
                    if len(oc) >= 4:
                        p = Polygon(oc, [h for h in holes if len(h) >= 4])
                        if not p.is_valid:
                            p = p.buffer(0)
                        if not p.is_empty:
                            polys.append(p)
                if not polys:
                    return None
                return polys[0] if len(polys) == 1 else MultiPolygon([q for p in polys for q in (p.geoms if p.geom_type == 'MultiPolygon' else [p])])

            if tags.get("boundary") == "administrative":
                lvl = tags.get("admin_level")
                name = tags.get("name", "")
                if lvl == "6" and (name in COUNTIES or name == "Tulsa"):
                    if name == "Tulsa":
                        name = "Tulsa County"
                    g = geom()
                    if g is not None and name not in counties:
                        counties[name] = g
                elif lvl == "8" and name:
                    g = geom()
                    if g is not None:
                        nm = name.split(";")[0]
                        if nm in cities:
                            cities[nm] = cities[nm].union(g)
                        else:
                            cities[nm] = g
                continue
            if "building" in tags and tags.get("building") != "no":
                g = geom()
                if g is None:
                    continue
                bt = BLD_TYPE.get(tags.get("building"), 0)
                if tags.get("amenity") in ("place_of_worship",):
                    bt = 8
                if tags.get("amenity") in ("hospital",):
                    bt = 10
                hgt = parse_float(tags.get("height"))
                if hgt is None:
                    lv = parse_float(tags.get("building:levels"))
                    if lv:
                        hgt = lv * 3.3 + (1.5 if lv > 2 else 0.8)
                if hgt is None:
                    base = DEFAULT_H.get(bt, 6.0)
                    hgt = base * (0.85 + (h32(o.orig_id()) % 1000) / 1000 * 0.4)
                    # bigger footprint -> a bit taller for unknown commercial
                    a = g.area
                    if bt in (0, 4, 5, 7) and a > 2500:
                        hgt = max(hgt, 8 + min(a / 2500, 4) * 1.5)
                nm = tags.get("name", "")
                polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
                for p in polys:
                    if p.area < 6:
                        continue
                    buildings.append((bt, round(min(hgt, 260.0), 1), nm, p))
                continue
            kind = None
            nat = tags.get("natural")
            if nat == "water" or tags.get("waterway") in ("riverbank",) or tags.get("landuse") in ("reservoir", "basin") or tags.get("water"):
                if nat == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in ("reservoir", "basin"):
                    kind = "water"
            if kind is None and tags.get("leisure") in ("swimming_pool",):
                kind = "swimming_pool"
            if kind is None and tags.get("amenity") == "parking" and tags.get("parking") not in ("underground", "multi-storey"):
                kind = "parking"
            if kind is None and tags.get("aeroway") == "apron":
                kind = "apron"
            if kind is None:
                for k in ("leisure", "landuse", "natural", "amenity"):
                    v = tags.get(k)
                    if v in AREA_KIND:
                        kind = v
                        break
            if kind is None:
                continue
            g = geom()
            if g is None:
                continue
            areas.append((AREA_KIND[kind], g))
            nm = tags.get("name")
            if nm and kind in ("park", "golf_course", "cemetery", "stadium", "university", "school", "hospital", "water", "nature_reserve", "recreation_ground", "pitch", "track", "parking", "military", "religious", "plaza", "garden") and g.area > 3000:
                c = g.representative_point()
                lk = next((f"{k}={tags[k]}" for k in ("leisure", "landuse", "amenity", "natural", "tourism") if k in tags), kind)
                named_area_pois.append({"n": nm, "k": lk, "x": round(c.x, 1), "y": round(c.y, 1), "a": round(g.area)})
    print(f"parsed {n} objects in {time.time()-t0:.0f}s: ways={len(ways)} lines={len(lines)} areas={len(areas)} buildings={len(buildings)} pois={len(pois)} places={len(places)} counties={list(counties)} cities={len(cities)}", flush=True)

    # --------------------------------------------------------------- world clip
    missing = COUNTIES - set(counties)
    if missing:
        print("WARNING missing counties:", missing)
    world = unary_union(list(counties.values())).buffer(0)
    world_s = world.simplify(20)
    wb = world.bounds
    print("world bounds", [round(v) for v in wb])
    prep_world = shapely.prepared.prep(world.buffer(150))

    # --------------------------------------------------------------- road graph
    t1 = time.time()
    use = Counter()
    for w in ways:
        if w[0] in DRIVABLE:
            for r in w[7]:
                use[r] += 1
            use[w[7][0]] += 2
            use[w[7][-1]] += 2
    synth = [-1]

    def new_node():
        synth[0] -= 1
        return synth[0]

    edges = []  # (cls, flags, lanes, layer, nameidx, n0, n1, coords, ms)
    names = {}

    def name_idx(s):
        if not s:
            return -1
        if s not in names:
            names[s] = len(names)
        return names[s]

    MAXLEN = 400.0
    for (cls, flags, lanes, layer, name, ref, ms, refs, coords) in ways:
        # cheap clip: keep ways with any point in world
        if not any(prep_world.contains(Point(c)) for c in coords[:: max(1, len(coords) // 6)] + [coords[-1]]):
            continue
        ni = name_idx(name)
        if cls not in DRIVABLE:
            edges.append((cls, flags, lanes, layer, ni, 0, 0, coords, ms))
            continue
        start = 0
        for i in range(1, len(coords)):
            if i == len(coords) - 1 or use[refs[i]] > 1:
                seg = coords[start:i + 1]
                srefs = refs[start:i + 1]
                # split long segments
                pieces = [(0, len(seg) - 1)]
                L = sum(math.dist(seg[j], seg[j + 1]) for j in range(len(seg) - 1))
                if L > MAXLEN:
                    pieces = []
                    acc = 0.0
                    ps = 0
                    for j in range(len(seg) - 1):
                        acc += math.dist(seg[j], seg[j + 1])
                        if acc >= MAXLEN and j + 1 < len(seg) - 1:
                            pieces.append((ps, j + 1))
                            ps = j + 1
                            acc = 0.0
                    pieces.append((ps, len(seg) - 1))
                    # if a long single segment (2 points) — subdivide geometry
                    if len(seg) == 2 and L > MAXLEN:
                        k = int(math.ceil(L / MAXLEN))
                        a, b = seg
                        seg = [(a[0] + (b[0] - a[0]) * t / k, a[1] + (b[1] - a[1]) * t / k) for t in range(k + 1)]
                        srefs = [srefs[0]] + [None] * (k - 1) + [srefs[-1]]
                        pieces = [(t, t + 1) for t in range(k)]
                node_ids = {}
                for (a, b) in pieces:
                    na = srefs[a] if srefs[a] is not None and a == 0 else node_ids.get(a)
                    if na is None:
                        na = srefs[a] if srefs[a] is not None and use[srefs[a]] > 1 else new_node()
                        node_ids[a] = na
                    nb = srefs[b] if b == len(seg) - 1 else node_ids.get(b)
                    if nb is None:
                        nb = new_node()
                        node_ids[b] = nb
                    edges.append((cls, flags, lanes, layer, ni, na, nb, seg[a:b + 1], ms))
                start = i
    print(f"graph edges={len(edges)} in {time.time()-t1:.0f}s", flush=True)

    # --------------------------------------------------------------- generated houses
    gen = []
    if not args.no_gen_houses:
        t2 = time.time()
        bpolys = [b[3] for b in buildings]
        # obstacles: existing buildings + road corridors + water + non-residential areas
        road_geoms = []
        for e in edges:
            cls = e[0]
            if cls == 15:
                continue
            wdt = LANE_W[cls] * e[2] + (3 if cls in (2, 3, 4, 5, 6, 7) else 1)
            road_geoms.append(LineString(e[7]).buffer(wdt / 2 + 1.5, cap_style=2, quad_segs=2))
        block_kinds = {AREA_KIND[k] for k in ("water", "park", "golf_course", "cemetery", "pitch", "parking", "industrial", "commercial", "retail", "school", "university", "hospital", "military", "stadium", "railway", "swimming_pool", "apron", "forest", "wood", "playground", "religious", "wetland")}
        block_polys = [g for (k, g) in areas if k in block_kinds]
        obstacles = bpolys + road_geoms + block_polys
        tree = STRtree(obstacles)
        placed = []
        placed_tree_batch = []
        rnd = random.Random(1921)
        res_edges = [e for e in edges if e[0] in (6, 7) and not (e[1] & (F_BRIDGE | F_TUNNEL))]
        print(f"  generating houses along {len(res_edges)} residential edges", flush=True)
        cand = []
        for e in res_edges:
            coords = e[7]
            half = LANE_W[e[0]] * e[2] / 2 + 1.5
            for side in (-1, 1):
                acc = rnd.uniform(4, 12)
                for j in range(len(coords) - 1):
                    ax, ay = coords[j]
                    bx, by = coords[j + 1]
                    L = math.hypot(bx - ax, by - ay)
                    if L < 1e-3:
                        continue
                    ux, uy = (bx - ax) / L, (by - ay) / L
                    nx, ny = -uy * side, ux * side
                    t = acc
                    while t < L - 3:
                        wdt = rnd.uniform(11, 17)
                        dep = rnd.uniform(9, 13)
                        setback = half + rnd.uniform(7, 11)
                        cx = ax + ux * t + nx * (setback + dep / 2)
                        cy = ay + uy * t + ny * (setback + dep / 2)
                        cand.append((cx, cy, ux, uy, wdt, dep))
                        t += wdt + rnd.uniform(5, 10)
                    acc = t - L
        print(f"  {len(cand)} candidates", flush=True)
        cpolys = []
        for (cx, cy, ux, uy, wdt, dep) in cand:
            nx, ny = -uy, ux
            hw, hd = wdt / 2, dep / 2
            pts = [(cx + ux * sx * hw + nx * sy * hd, cy + uy * sx * hw + ny * sy * hd) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            cpolys.append(Polygon(pts))
        if cpolys:
            arr = shapely.from_wkb(shapely.to_wkb(cpolys)) if False else cpolys
            hits = tree.query(arr, predicate="intersects")
            bad = set(hits[0].tolist())
            ok = [i for i in range(len(cpolys)) if i not in bad]
            # keep inside world
            ok = [i for i in ok if prep_world.contains(Point(cand[i][0], cand[i][1]))]
            # residential landuse or near urban: require some existing building within 250 m OR residential landuse
            res_polys = [g for (k, g) in areas if k == AREA_KIND["residential"]]
            res_tree = STRtree(res_polys) if res_polys else None
            near_tree = STRtree([p.centroid for p in bpolys]) if bpolys else None
            ok2 = []
            pts = [Point(cand[i][0], cand[i][1]) for i in ok]
            near = set()
            if near_tree is not None and pts:
                q = near_tree.query([p.buffer(250, quad_segs=2) for p in pts], predicate="intersects")
                cnt = Counter(q[0].tolist())
                near = {k for k, v in cnt.items() if v >= 4}
            inres = set()
            if res_tree is not None and pts:
                q = res_tree.query(pts, predicate="within")
                inres = set(q[0].tolist())
            for k, i in enumerate(ok):
                if k in near or k in inres:
                    ok2.append(i)
            # mutual overlap pruning (greedy)
            sel = []
            if ok2:
                cand_tree = STRtree([cpolys[i] for i in ok2])
                taken = set()
                for k, i in enumerate(ok2):
                    if k in taken:
                        continue
                    sel.append(i)
                    for j in cand_tree.query(cpolys[i].buffer(1.5), predicate="intersects").tolist():
                        if j != k:
                            taken.add(j)
            for i in sel:
                p = cpolys[i]
                hh = rnd.uniform(4.5, 7.5)
                gen.append((1, round(hh, 1), "", p))
        print(f"  generated {len(gen)} houses in {time.time()-t2:.0f}s", flush=True)

    # --------------------------------------------------------------- bucket into regions
    def rkey(x, y):
        return (int(math.floor(x / REGION)), int(math.floor(y / REGION)))

    regions = defaultdict(lambda: {"roads": [], "bld": [], "areas": [], "lines": []})

    def enc_line(coords):
        out = []
        px = py = 0
        for (x, y) in coords:
            ix, iy = int(round(x * 10)), int(round(y * 10))
            out.append(ix - px)
            out.append(iy - py)
            px, py = ix, iy
        return out

    def enc_ring(coords):
        cs = list(coords)
        if len(cs) > 1 and cs[0] == cs[-1]:
            cs = cs[:-1]
        return enc_line(cs)

    for e in edges:
        cls, flags, lanes, layer, ni, na, nb, coords, ms = e
        ls = LineString(coords)
        mid = ls.interpolate(0.5, normalized=True)
        rk = rkey(mid.x, mid.y)
        lane_w = LANE_W[cls]
        regions[rk]["roads"].append([cls, flags, lanes, layer, ni, na, nb, int(ms or 0), enc_line(coords)])

    def poly_rings(p, tol):
        p = p.simplify(tol, preserve_topology=True)
        if p.is_empty:
            return []
        polys = list(p.geoms) if p.geom_type == "MultiPolygon" else ([p] if p.geom_type == "Polygon" else [g for g in getattr(p, 'geoms', []) if g.geom_type == 'Polygon'])
        res = []
        for q in polys:
            if q.area < 1:
                continue
            rings = [enc_ring(q.exterior.coords)] + [enc_ring(i.coords) for i in q.interiors if Polygon(i).area > 4]
            res.append(rings)
        return res

    nb_out = 0
    for (bt, hgt, nm, p) in buildings + gen:
        c = p.centroid
        if not prep_world.contains(c):
            continue
        rk = rkey(c.x, c.y)
        q = p.simplify(0.25, preserve_topology=True)
        if q.is_empty or q.geom_type != "Polygon":
            continue
        regions[rk]["bld"].append([bt, hgt, name_idx(nm), enc_ring(q.exterior.coords)])
        nb_out += 1
    print("buildings written", nb_out)

    # areas: clip to region squares
    t3 = time.time()
    for (k, g) in areas:
        if not g.intersects(world):
            continue
        minx, miny, maxx, maxy = g.bounds
        r0 = rkey(minx, miny)
        r1 = rkey(maxx, maxy)
        tol = 1.0 if k != AREA_KIND["water"] else 1.5
        if r0 == r1:
            for rings in poly_rings(g, tol):
                regions[r0]["areas"].append([k, rings])
        else:
            for rx in range(r0[0], r1[0] + 1):
                for ry in range(r0[1], r1[1] + 1):
                    bb = box(rx * REGION - 2, ry * REGION - 2, (rx + 1) * REGION + 2, (ry + 1) * REGION + 2)
                    try:
                        part = g.intersection(bb)
                    except Exception:
                        part = g.buffer(0).intersection(bb)
                    if part.is_empty:
                        continue
                    if part.geom_type == "GeometryCollection":
                        part = unary_union([x for x in part.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
                        if part.is_empty:
                            continue
                    for rings in poly_rings(part, tol):
                        regions[(rx, ry)]["areas"].append([k, rings])
    print(f"areas clipped in {time.time()-t3:.0f}s", flush=True)

    LINE_KIND = {"rail": 0, "rail_old": 1, "river": 2, "stream": 3, "canal": 4, "ditch": 5, "drain": 5, "runway": 6, "taxiway": 7}
    for (kind, wdt, coords, bridge) in lines:
        ls = LineString(coords)
        if not ls.intersects(world):
            continue
        minx, miny, maxx, maxy = ls.bounds
        r0, r1 = rkey(minx, miny), rkey(maxx, maxy)
        parts = []
        if r0 == r1:
            parts = [(r0, ls)]
        else:
            for rx in range(r0[0], r1[0] + 1):
                for ry in range(r0[1], r1[1] + 1):
                    bb = box(rx * REGION - 1, ry * REGION - 1, (rx + 1) * REGION + 1, (ry + 1) * REGION + 1)
                    part = ls.intersection(bb)
                    if part.is_empty:
                        continue
                    geoms = list(part.geoms) if hasattr(part, "geoms") else [part]
                    for gg in geoms:
                        if gg.geom_type == "LineString" and len(gg.coords) >= 2:
                            parts.append(((rx, ry), gg))
        for rk, gg in parts:
            gg = gg.simplify(0.8)
            regions[rk]["lines"].append([LINE_KIND[kind], round(wdt, 1), 1 if bridge else 0, enc_line(gg.coords)])

    # --------------------------------------------------------------- write regions
    index = []
    total = 0
    for rk, d in regions.items():
        if not (d["roads"] or d["bld"] or d["areas"] or d["lines"]):
            continue
        rx, ry = rk
        bb = box(rx * REGION, ry * REGION, (rx + 1) * REGION, (ry + 1) * REGION)
        if not bb.intersects(world.buffer(400)):
            continue
        payload = {"rx": rx, "ry": ry, "roads": d["roads"], "bld": d["bld"], "areas": d["areas"], "lines": d["lines"]}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        fn = os.path.join(out, "r", f"{rx}_{ry}.json.gz")
        with gzip.open(fn, "wb", compresslevel=9) as f:
            f.write(raw)
        sz = os.path.getsize(fn)
        total += sz
        index.append([rx, ry, len(d["roads"]), len(d["bld"]), sz])
    print(f"regions written: {len(index)} total {total/1e6:.1f} MB", flush=True)

    # --------------------------------------------------------------- meta
    def poly_json(g, tol):
        g = g.simplify(tol, preserve_topology=True)
        polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        return [[[round(x), round(y)] for (x, y) in p.exterior.coords] for p in polys if p.geom_type == "Polygon" and p.area > 20000]

    city_out = []
    for nm, g in cities.items():
        if not g.intersects(world):
            continue
        city_out.append({"n": nm, "poly": poly_json(g, 25), "a": round(g.area)})
    city_out.sort(key=lambda c: c["a"])  # small first so lookups prefer enclaves
    county_out = [{"n": nm, "poly": poly_json(g, 60)} for nm, g in counties.items()]

    all_pois = []
    seen = set()
    for p in pois + named_area_pois:
        if not prep_world.contains(Point(p["x"], p["y"])):
            continue
        key = (p["n"], round(p["x"] / 50), round(p["y"] / 50))
        if key in seen:
            continue
        seen.add(key)
        all_pois.append(p)
    places_in = [p for p in places if prep_world.contains(Point(p["x"], p["y"]))]
    meta = {
        "origin": {"lat": LAT0, "lon": LON0, "kx": KX, "ky": KY},
        "region": REGION,
        "bounds": [round(v) for v in wb],
        "world": poly_json(world_s, 40),
        "regions": index,
        "names": [k for k, _ in sorted(names.items(), key=lambda kv: kv[1])],
        "counties": county_out,
        "cities": city_out,
        "places": places_in,
        "pois": all_pois,
    }
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print(f"meta.json {os.path.getsize(os.path.join(out, 'meta.json'))/1e6:.1f} MB; pois={len(all_pois)} places={len(places_in)} cities={len(city_out)}")
    print(f"done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
