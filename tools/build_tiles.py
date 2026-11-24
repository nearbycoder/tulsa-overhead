#!/usr/bin/env python3
"""Render overview map tiles (WebP) from the region files written by build_map.py.

Levels: z=0 -> 16 m/px, z=1 -> 32, z=2 -> 64, z=3 -> 128, z=4 -> 256 m/px. Tiles are 256 px.
Output: assets/map/tiles/<z>/<tx>_<ty>.webp and assets/map/tiles/index.json

Also:  --preview x0,y0,x1,y1,mpp out.png   renders an arbitrary world rect (for checking data).
"""
import argparse, gzip, json, math, os, sys, time
from collections import defaultdict
from PIL import Image, ImageDraw

REGION = 2048.0
TILE = 256
BASE_MPP = 16.0
LEVELS = 5
SS = 2  # supersampling

AREA_COL = {
    1: (226, 219, 186), 2: (214, 222, 178), 3: (196, 218, 160), 4: (229, 224, 214), 5: (236, 220, 214),
    6: (222, 214, 222), 7: (150, 186, 128), 8: (172, 210, 140), 9: (168, 214, 140), 10: (186, 206, 170),
    11: (160, 206, 150), 12: (214, 210, 206), 13: (120, 170, 214), 14: (238, 222, 170), 15: (170, 200, 170),
    16: (214, 206, 200), 17: (200, 222, 170), 18: (130, 200, 230), 19: (210, 206, 214), 20: (190, 200, 150),
    21: (214, 204, 178), 22: (206, 196, 180), 23: (226, 214, 190), 24: (236, 226, 196), 25: (238, 214, 214),
    26: (214, 200, 190), 27: (176, 210, 160), 28: (210, 160, 130), 29: (190, 214, 150), 30: (220, 214, 200),
    31: (226, 222, 218),
}
AREA_ORDER = [1, 2, 3, 23, 29, 4, 5, 6, 21, 22, 26, 24, 25, 30, 31, 16, 12, 19, 7, 20, 8, 9, 10, 27, 11, 28, 17, 14, 15, 13, 18]
ROAD_STYLE = {  # cls: (colour, casing, width_m, min_px)
    0: ((240, 140, 60), (150, 80, 30), 22, 2.6), 1: ((248, 178, 90), (160, 100, 40), 18, 2.2),
    10: ((240, 160, 90), (150, 90, 40), 8, 1.2), 11: ((248, 190, 110), (160, 100, 40), 8, 1.1),
    2: ((252, 214, 120), (160, 130, 60), 15, 1.8), 12: ((252, 220, 140), (160, 130, 60), 7, 1.0),
    3: ((255, 240, 170), (150, 140, 100), 13, 1.5), 13: ((255, 240, 180), (150, 140, 100), 7, 1.0),
    4: ((255, 255, 255), (150, 150, 150), 11, 1.2), 14: ((255, 255, 255), (150, 150, 150), 6, 0.9),
    5: ((255, 255, 255), (170, 170, 170), 8, 0.9), 6: ((255, 255, 255), (180, 180, 180), 8, 0.8),
    7: ((255, 255, 255), (180, 180, 180), 6, 0.7), 8: ((246, 246, 246), (200, 200, 200), 5, 0.0),
    9: ((200, 150, 110), None, 4, 0.6), 16: ((230, 120, 120), None, 10, 1.0), 15: ((180, 150, 120), None, 2, 0.0),
}
ROAD_ORDER = [15, 9, 8, 7, 6, 5, 14, 4, 13, 3, 12, 2, 11, 10, 1, 0, 16]
LINE_STYLE = {0: ((110, 100, 100), 3), 1: ((150, 140, 140), 2), 2: ((120, 170, 214), None), 3: ((120, 170, 214), None),
              4: ((120, 170, 214), None), 5: ((140, 180, 214), None), 6: ((170, 170, 180), None), 7: ((196, 196, 204), None)}


def dec_line(arr):
    out = []
    x = y = 0
    for i in range(0, len(arr), 2):
        x += arr[i]
        y += arr[i + 1]
        out.append((x / 10.0, y / 10.0))
    return out


class RegionCache:
    def __init__(self, root):
        self.root = root
        self.cache = {}
        self.exists = set()
        meta = json.load(open(os.path.join(root, "meta.json")))
        for r in meta["regions"]:
            self.exists.add((r[0], r[1]))
        self.meta = meta

    def get(self, rx, ry):
        k = (rx, ry)
        if k not in self.exists:
            return None
        if k not in self.cache:
            if len(self.cache) > 64:
                self.cache.pop(next(iter(self.cache)))
            with gzip.open(os.path.join(self.root, "r", f"{rx}_{ry}.json.gz")) as f:
                d = json.load(f)
            d["roads"] = [(r[0], r[1], r[2], dec_line(r[8])) for r in d["roads"]]
            d["areas"] = [(a[0], [dec_line(ring) for ring in a[1][0]] if a[1] and isinstance(a[1][0][0], list) else [dec_line(ring) for ring in a[1]]) for a in d["areas"]]
            d["lines"] = [(l[0], l[1], dec_line(l[3])) for l in d["lines"]]
            d["bld"] = [(b[0], b[1], dec_line(b[3]), b[7] if len(b) > 7 else "") for b in d["bld"]]
            self.cache[k] = d
        return self.cache[k]


def render_rect(rc, x0, y0, x1, y1, mpp, size, draw_buildings=True, bg=(214, 206, 176)):
    W, H = size
    S = SS
    img = Image.new("RGB", (W * S, H * S), bg)
    dr = ImageDraw.Draw(img)
    sc = S / mpp

    def tp(p):
        return ((p[0] - x0) * sc, (p[1] - y0) * sc)

    rxs = range(int(math.floor((x0 - 600) / REGION)), int(math.floor((x1 + 600) / REGION)) + 1)
    rys = range(int(math.floor((y0 - 600) / REGION)), int(math.floor((y1 + 600) / REGION)) + 1)
    regs = [rc.get(rx, ry) for rx in rxs for ry in rys]
    regs = [r for r in regs if r]
    # world mask: draw outside-world darker
    # areas
    by_kind = defaultdict(list)
    for r in regs:
        for (k, polys) in r["areas"]:
            by_kind[k].append(polys)
    for k in AREA_ORDER:
        col = AREA_COL.get(k)
        for polys in by_kind.get(k, []):
            # polys is a list of rings: first outer then holes
            if not polys:
                continue
            outer = [tp(p) for p in polys[0]]
            if len(outer) >= 3:
                dr.polygon(outer, fill=col)
            for hole in polys[1:]:
                hp = [tp(p) for p in hole]
                if len(hp) >= 3 and k == 13:
                    dr.polygon(hp, fill=bg)
    # waterway lines
    for r in regs:
        for (k, wdt, pts) in r["lines"]:
            if k in (2, 3, 4, 5):
                col = LINE_STYLE[k][0]
                w = max(wdt * sc, 1.0 * S if k in (2, 4) else 0.6 * S)
                if wdt * sc < 0.5 * S and k in (3, 5) and mpp > 40:
                    continue
                dr.line([tp(p) for p in pts], fill=col, width=max(1, int(round(w))))
    # runways
    for r in regs:
        for (k, wdt, pts) in r["lines"]:
            if k in (6, 7):
                dr.line([tp(p) for p in pts], fill=LINE_STYLE[k][0], width=max(1, int(round(wdt * sc))))
    if draw_buildings and mpp <= 20:
        for r in regs:
            for (bt, h, ring, roof_color) in r["bld"]:
                pts = [tp(p) for p in ring]
                if len(pts) >= 3:
                    c = (196, 186, 176) if h < 15 else (170, 160, 160)
                    # Keep the printed-map palette light, allowing photographed and mapped
                    # roof colors to distinguish neighbouring blocks at the closest zoom.
                    if roof_color:
                        rgb = bytes.fromhex(roof_color[1:])
                        c = tuple((base * 3 + source) // 4 for base, source in zip(c, rgb))
                    dr.polygon(pts, fill=c)
    # rail
    for r in regs:
        for (k, wdt, pts) in r["lines"]:
            if k in (0, 1):
                dr.line([tp(p) for p in pts], fill=LINE_STYLE[k][0], width=max(1, int(round(1.2 * S))))
    # roads: casings then fills
    by_cls = defaultdict(list)
    for r in regs:
        for (cls, flags, lanes, pts) in r["roads"]:
            by_cls[cls].append((flags, lanes, pts))
    for pass_ in (0, 1):
        for cls in ROAD_ORDER:
            col, casing, wm, minpx = ROAD_STYLE[cls]
            if minpx == 0 and mpp > 12:
                continue
            for (flags, lanes, pts) in by_cls.get(cls, []):
                w = max(wm * sc, minpx * S)
                if flags & 1 and cls in (0, 1, 2, 3):
                    w *= 0.7
                if pass_ == 0:
                    if casing is None:
                        continue
                    ww = w + 1.2 * S
                    q = [tp(p) for p in pts]
                    dr.line(q, fill=casing, width=max(1, int(round(ww))), joint="curve")
                else:
                    c = col
                    if flags & 8 and cls not in (0, 1, 10, 11):
                        c = (205, 160, 120)
                    q = [tp(p) for p in pts]
                    dr.line(q, fill=c, width=max(1, int(round(w))), joint="curve")
    return img.resize((W, H), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="assets/map")
    ap.add_argument("--preview", nargs=2, metavar=("RECT", "OUT"))
    ap.add_argument("--mpp", type=float, default=2.0)
    args = ap.parse_args()
    rc = RegionCache(args.root)
    if args.preview:
        x0, y0, x1, y1 = [float(v) for v in args.preview[0].split(",")]
        W = int((x1 - x0) / args.mpp)
        H = int((y1 - y0) / args.mpp)
        img = render_rect(rc, x0, y0, x1, y1, args.mpp, (W, H))
        img.save(args.preview[1])
        print("wrote", args.preview[1], W, H)
        return
    t0 = time.time()
    meta = rc.meta
    bx0, by0, bx1, by1 = meta["bounds"]
    out = os.path.join(args.root, "tiles")
    os.makedirs(out, exist_ok=True)
    # level 0
    span = TILE * BASE_MPP
    tx0, ty0 = int(math.floor(bx0 / span)), int(math.floor(by0 / span))
    tx1, ty1 = int(math.floor(bx1 / span)), int(math.floor(by1 / span))
    exists = rc.exists
    level_tiles = {}
    os.makedirs(os.path.join(out, "0"), exist_ok=True)
    made = {}
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            x0, y0 = tx * span, ty * span
            # skip if no region overlaps
            r0x, r0y = int(math.floor((x0 - 500) / REGION)), int(math.floor((y0 - 500) / REGION))
            r1x, r1y = int(math.floor((x0 + span + 500) / REGION)), int(math.floor((y0 + span + 500) / REGION))
            if not any((rx, ry) in exists for rx in range(r0x, r1x + 1) for ry in range(r0y, r1y + 1)):
                continue
            img = render_rect(rc, x0, y0, x0 + span, y0 + span, BASE_MPP, (TILE, TILE))
            made[(tx, ty)] = img
            img.save(os.path.join(out, "0", f"{tx}_{ty}.webp"), quality=78, method=5)
        print(f"  row {ty} of {ty1} ({time.time()-t0:.0f}s, {len(made)} tiles)", flush=True)
    level_tiles[0] = sorted(made.keys())
    prev = made
    for z in range(1, LEVELS):
        os.makedirs(os.path.join(out, str(z)), exist_ok=True)
        cur = {}
        keys = {(math.floor(tx / 2), math.floor(ty / 2)) for (tx, ty) in prev}
        for (px, py) in keys:
            canvas = Image.new("RGB", (TILE * 2, TILE * 2), (214, 206, 176))
            for dx in (0, 1):
                for dy in (0, 1):
                    c = prev.get((px * 2 + dx, py * 2 + dy))
                    if c is not None:
                        canvas.paste(c, (dx * TILE, dy * TILE))
            img = canvas.resize((TILE, TILE), Image.LANCZOS)
            cur[(px, py)] = img
            img.save(os.path.join(out, str(z), f"{px}_{py}.webp"), quality=78, method=5)
        level_tiles[z] = sorted(cur.keys())
        prev = cur
        print(f"level {z}: {len(cur)} tiles", flush=True)
    idx = {"tile": TILE, "baseMpp": BASE_MPP, "levels": LEVELS, "tiles": {str(z): [list(k) for k in v] for z, v in level_tiles.items()}}
    json.dump(idx, open(os.path.join(out, "index.json"), "w"), separators=(",", ":"))
    print(f"done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
