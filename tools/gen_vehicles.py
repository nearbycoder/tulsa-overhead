#!/usr/bin/env python3
"""GTPolly vehicle art + catalogue generator.

Every vehicle is built as a small voxel model at 0.1 m per voxel (x across, y along with the FRONT at
+y, z up). From the model we draw the four orthographic pixel-art views (TOP front-down, SIDE
front-left, FRONT, BACK) at native resolution with hue-shifted 4-tone shading and a 1 px dark outline,
upscale them 8x NEAREST and paste them in one row on flat white (path (c) of the sprite-stacking
skill). Each sheet is carved by the vendored slicer tools/sprite-stacking/views_to_slices.py
(subprocess, --slices = SIDE native height, --colours 0, --shade 0, --top-nose down). Cavities the
visual hull fills in (pickup beds, open cockpits, boat decks, gaps between parts) are then fixed by
intersecting the carved slices with the voxel model, and any voxel whose carved colour belongs to a
different material is repainted from the views.

Outputs
  assets/vehicles/<id>.png        slice strip: `count` slices of w x h, ground slice leftmost,
                                  front pointing DOWN (+y), transparent background
  assets/vehicles/<id>_rotor.png  helicopter main rotor strip (flat, drawn spinning by the game)
  assets/vehicles/catalog.json    vehicle catalogue
  build/vehicles/sheets/<id>.png  4-view sheets fed to the slicer
  build/vehicles/check/<id>.png   slicer check sheets
  build/vehicles/contact_sheet.png  every vehicle at two angles

Usage
  .venv/bin/python tools/gen_vehicles.py                 # everything (deterministic)
  .venv/bin/python tools/gen_vehicles.py --only id1,id2  # iterate on a few (catalogue keeps others)
  .venv/bin/python tools/gen_vehicles.py --jobs 4        # parallel slicer runs (default 8)

Catalogue extras beyond the base schema
  lights.beacon  [[x, y, 'r'|'b'|'a'], ...] flashing light bars / beacons (metres, same frame as head/tail)
  lights.nav     [[x, y, 'r'|'g'], ...]     navigation lights (boats)
  waterline      boats: slices that sit below the water surface
  rotor, rotorW, rotorH, rotorCount, rotorZ, rotorPos   helicopters: flat main-rotor strip (slice 0 blades,
                 slice 1 hub cap) to spin and draw starting at body slice rotorZ, hub at rotorPos (metres)
  spawn.zones    may contain "water" (boats)
  Light x is the strip's +x from the slice centre, y is toward the front (+y in the strip).
"""
from __future__ import annotations

import argparse
import colorsys
import json
import math
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SLICER_DIR = ROOT / "tools" / "sprite-stacking"
SLICER = SLICER_DIR / "views_to_slices.py"
BUILD = ROOT / "build" / "vehicles"
OUT = ROOT / "assets" / "vehicles"
UP = 8           # sheet upscale
GAP = 48         # px between views on the sheet
OUTLINE = (20, 22, 30)
MPP = 0.1        # metres per art pixel and per slice

sys.path.insert(0, str(SLICER_DIR))
import views_to_slices as vts  # noqa: E402  (only for render/emissive checks; carving runs as subprocess)


# =============================================================================================== colour
def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def sat(c):
    mx = max(c)
    return (mx - min(c)) / max(mx, 1)


def is_emissive(c):
    """Mirror of the slicer's detect_emissive candidate test (before the dominant-colour filter)."""
    l, s, mx = lum(c), sat(c), max(c)
    return (l >= 180 and (s >= 0.30 or l >= 232)) or (mx >= 215 and s >= 0.62 and l >= 110)


def safe(c):
    """Darken a body colour until it is comfortably outside the auto-emissive test."""
    f = [float(v) for v in c]
    while True:
        cc = tuple(int(round(min(255, max(0, v)))) for v in f)
        l, s, mx = lum(cc), sat(cc), max(cc)
        if not ((l >= 172 and (s >= 0.26 or l >= 224)) or (mx >= 205 and s >= 0.56 and l >= 100)):
            return cc
        f = [v * 0.97 for v in f]


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


COOL = (36, 30, 96)
WARM = (255, 238, 186)


def _hshift(h, target, amt):
    d = ((target - h + 0.5) % 1.0) - 0.5
    return (h + d * amt) % 1.0


def ramp(base, hl=0.25, sh=0.72, dsh=0.48, cool=1.0, warm=1.0):
    """4-tone hue-shifted ramp dark->light: deep shadow, shadow, mid (=base), highlight.
    Shadows drift toward blue and get a touch more saturated, highlights drift toward yellow."""
    r, g, b = (v / 255 for v in base)
    h, l, s = colorsys.rgb_to_hls(r, g, b)

    def mk(hh, ll, ss, tint, tamt):
        rr, gg, bb = colorsys.hls_to_rgb(hh, max(0, min(1, ll)), max(0, min(1, ss)))
        c = (rr * 255, gg * 255, bb * 255)
        return mix(c, tint, tamt)

    t3 = mk(_hshift(h, 1 / 6, 0.10 * warm), l + (1 - l) * hl, s * 0.92, WARM, 0.10 * warm)
    t1 = mk(_hshift(h, 2 / 3, 0.07 * cool), l * sh, min(1, s * 1.05 + 0.03), COOL, 0.10 * cool)
    t0 = mk(_hshift(h, 2 / 3, 0.14 * cool), l * dsh, min(1, s * 1.08 + 0.06), COOL, 0.20 * cool)
    out = [safe(t) for t in (t0, t1, tuple(float(v) for v in base), t3)]
    for i in range(1, 4):
        if out[i] == out[i - 1] or lum(out[i]) <= lum(out[i - 1]):
            out[i] = safe(tuple(min(255, v + 6 + 4 * i) for v in out[i - 1]))
    return out


def flat(c):
    return [tuple(c)] * 4


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# Standard materials: name -> (tones dark->light, kind)
# kinds: solid (geometric shading), glass, tire, light (flat emissive), dark (always deep)
STD = {
    "tire": ([(26, 25, 33), (38, 37, 47), (52, 51, 61), (68, 66, 77)], "tire"),
    "rim": (ramp((150, 156, 168)), "solid"),
    "rimdark": (ramp((70, 72, 80)), "solid"),
    "chrome": ([(96, 100, 118), (150, 156, 172), (196, 202, 214), (224, 224, 214)], "solid"),
    "trim": (ramp((48, 50, 58)), "solid"),
    "grille": ([(24, 24, 32), (34, 35, 44), (46, 47, 56), (64, 66, 76)], "solid"),
    "glass": ([(22, 34, 56), (38, 60, 92), (66, 98, 134), (172, 204, 228)], "glass"),
    "glassdark": ([(16, 18, 28), (26, 30, 44), (44, 50, 66), (130, 150, 176)], "glass"),
    "well": ([(30, 25, 33)] * 4, "dark"),
    "interior": (ramp((70, 64, 66)), "solid"),
    "seat": (ramp((58, 54, 58)), "solid"),
    "seat_tan": (ramp((168, 136, 98)), "solid"),
    "seat_red": (ramp((150, 40, 44)), "solid"),
    "seat_white": (ramp((196, 190, 178)), "solid"),
    "liner": (ramp((62, 62, 68)), "solid"),
    "steel": (ramp((128, 132, 142)), "solid"),
    "dsteel": (ramp((84, 88, 98)), "solid"),
    "rust": (ramp((140, 74, 42)), "solid"),
    "primer": (ramp((104, 102, 96)), "solid"),
    "wood": (ramp((150, 98, 56)), "solid"),
    "hay": (ramp((214, 184, 98)), "solid"),
    "canvas": (ramp((176, 166, 138)), "solid"),
    "rubber": (ramp((40, 40, 46)), "solid"),
    "engine": (ramp((110, 112, 120)), "solid"),
    "head": (flat((255, 250, 214)), "light"),
    "tail": (flat((255, 62, 54)), "light"),
    "amber": (flat((255, 168, 36)), "light"),
    "sirenr": (flat((255, 44, 60)), "light"),
    "sirenb": (flat((70, 120, 255)), "light"),
    "sirenw": (flat((255, 255, 255)), "light"),
    "neon": (flat((80, 255, 220)), "light"),
    "lamp": (flat((255, 236, 150)), "light"),
}


# =============================================================================================== model
def prof(points, n):
    """Piecewise-linear profile over 0..n-1 from control points [(i, value), ...] -> int array."""
    pts = sorted(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return np.round(np.interp(np.arange(n), xs, ys) + 1e-6).astype(int)


class Model:
    """Voxel model v[z, y, x] of material ids (0 = empty). y = 0 is the BACK, y = L-1 the FRONT."""

    def __init__(self, L, W, H):
        self.L, self.W, self.H = L, W, H
        self.v = np.zeros((H, L, W), np.uint8)
        self.t = np.zeros((H, L, W), np.int8)  # tone offset painted per voxel
        self.mats = [None]
        self.ids = {}
        self.custom = {}
        self.extra = {}       # misc metadata a builder wants to pass on (rotor, waterline ...)
        self.roof_hl = True   # highest plateau gets the highlight tone in the TOP view

    # ------------------------------------------------------------------ materials
    def define(self, name, tones, kind="solid"):
        self.custom[name] = ([tuple(int(c) for c in t) for t in tones], kind)
        if name in self.ids:
            self.mats[self.ids[name]] = {"name": name, "tones": self.custom[name][0], "kind": kind}

    def mid(self, name):
        if name in self.ids:
            return self.ids[name]
        tones, kind = self.custom[name] if name in self.custom else STD[name]
        self.ids[name] = len(self.mats)
        self.mats.append({"name": name, "tones": [tuple(t) for t in tones], "kind": kind})
        return self.ids[name]

    def ids_of(self, names):
        if names is None:
            return None
        if isinstance(names, str):
            names = [names]
        return [self.mid(n) for n in names if n != "*"] if "*" not in names else "*"

    # ------------------------------------------------------------------ editing
    def _sl(self, y0, y1, x0, x1, z0, z1):
        y0, y1 = max(0, int(y0)), min(self.L, int(y1))
        x0, x1 = max(0, int(x0)), min(self.W, int(x1))
        z0, z1 = max(0, int(z0)), min(self.H, int(z1))
        if y0 >= y1 or x0 >= x1 or z0 >= z1:
            return None
        return (slice(z0, z1), slice(y0, y1), slice(x0, x1))

    def box(self, y0, y1, x0, x1, z0, z1, mat, tone=0, only=None):
        """Fill the half-open box with `mat` (None erases). only: repaint just these materials ('*' any)."""
        s = self._sl(y0, y1, x0, x1, z0, z1)
        if s is None:
            return
        reg, treg = self.v[s], self.t[s]
        if only is None:
            mask = np.ones(reg.shape, bool)
        elif only == "*" or only == ["*"]:
            mask = reg > 0
        elif only == "empty":
            mask = reg == 0
        else:
            mask = np.isin(reg, self.ids_of(only))
        if mat is None:
            reg[mask] = 0
            treg[mask] = 0
        else:
            reg[mask] = self.mid(mat)
            treg[mask] = tone

    def paint(self, y0, y1, x0, x1, z0, z1, mat, tone=0, only="*"):
        self.box(y0, y1, x0, x1, z0, z1, mat, tone, only)

    def sbox(self, y0, y1, e0, e1, z0, z1, mat, tone=0, only=None):
        """Mirrored pair of boxes, x measured from each outer edge: [e0, e1)."""
        W = self.W
        self.box(y0, y1, e0, e1, z0, z1, mat, tone, only)
        self.box(y0, y1, W - e1, W - e0, z0, z1, mat, tone, only)

    def spaint(self, y0, y1, e0, e1, z0, z1, mat, tone=0, only="*"):
        self.sbox(y0, y1, e0, e1, z0, z1, mat, tone, only)

    def cbox(self, y0, y1, half, z0, z1, mat, tone=0, only=None, off=0.0):
        """Box centred across the width, `half` = half-width in px (float ok)."""
        c = (self.W) / 2 + off
        self.box(y0, y1, int(round(c - half)), int(round(c + half)), z0, z1, mat, tone, only)

    def tone(self, y0, y1, x0, x1, z0, z1, t, only="*"):
        s = self._sl(y0, y1, x0, x1, z0, z1)
        if s is None:
            return
        reg = self.v[s]
        mask = reg > 0 if only == "*" else np.isin(reg, self.ids_of(only))
        self.t[s][mask] = t

    def body(self, top, bot=2, y0=0, y1=None, inset=None, mat="paint", x0=0, x1=None):
        """Extruded body: for each y in [y0, y1) fill z in [bot(y), top(y)] (inclusive) with plan inset(y)."""
        L, W = self.L, self.W
        y1 = L if y1 is None else y1
        x1 = W if x1 is None else x1
        topa = prof(top, L) if isinstance(top, (list, tuple)) else np.full(L, int(top))
        bota = prof(bot, L) if isinstance(bot, (list, tuple)) else np.full(L, int(bot))
        ins = prof(inset, L) if isinstance(inset, (list, tuple)) else np.full(L, int(inset or 0))
        for y in range(max(0, y0), min(L, y1)):
            if topa[y] >= bota[y]:
                self.box(y, y + 1, x0 + ins[y], x1 - ins[y], bota[y], topa[y] + 1, mat)
        return topa

    def cyl_y(self, y0, y1, xc, zc, ry, rz, mat, only=None):
        """Cylinder (ellipse cross-section) along y."""
        xs = np.arange(self.W)[:, None]
        zs = np.arange(self.H)[None, :]
        m = ((xs - xc) / ry) ** 2 + ((zs - zc) / rz) ** 2 <= 1.0
        for x, z in zip(*np.nonzero(m)):
            self.box(y0, y1, x, x + 1, z, z + 1, mat, only=only)

    def disc_z(self, yc, xc, r, z0, z1, mat, only=None, ry=None):
        """Vertical cylinder (ellipse in plan)."""
        ry = r if ry is None else ry
        ys = np.arange(self.L)[:, None]
        xs = np.arange(self.W)[None, :]
        m = ((ys - yc) / ry) ** 2 + ((xs - xc) / r) ** 2 <= 1.0
        for y, x in zip(*np.nonzero(m)):
            self.box(y, y + 1, x, x + 1, z0, z1, mat, only=only)

    # ------------------------------------------------------------------ surface painting
    def skin_side(self, fn, mat, depth=1, tone=0, only="*", which="both"):
        """Paint the first `depth` voxels seen from both sides where fn(y, z) is True.
        which: 'lo' = low-x side (vehicle RIGHT / curb side), 'hi' = high-x side (vehicle LEFT / driver)."""
        occ = self.v > 0
        oid = None if only == "*" else self.ids_of(only)
        for z in range(self.H):
            for y in range(self.L):
                if not fn(y, z):
                    continue
                xs = np.nonzero(occ[z, y])[0]
                if len(xs) == 0:
                    continue
                lo = list(range(xs[0], min(xs[0] + depth, self.W))) if which in ("both", "lo") else []
                hi = list(range(max(xs[-1] - depth + 1, 0), xs[-1] + 1)) if which in ("both", "hi") else []
                for x in lo + hi:
                    if occ[z, y, x] and (oid is None or self.v[z, y, x] in oid):
                        self.v[z, y, x] = self.mid(mat)
                        self.t[z, y, x] = tone

    def skin_top(self, fn, mat, depth=1, tone=0, only="*"):
        occ = self.v > 0
        oid = None if only == "*" else self.ids_of(only)
        for y in range(self.L):
            for x in range(self.W):
                if not fn(y, x):
                    continue
                zs = np.nonzero(occ[:, y, x])[0]
                if len(zs) == 0:
                    continue
                for z in range(max(zs[-1] - depth + 1, 0), zs[-1] + 1):
                    if occ[z, y, x] and (oid is None or self.v[z, y, x] in oid):
                        self.v[z, y, x] = self.mid(mat)
                        self.t[z, y, x] = tone

    def skin_end(self, fn, mat, front=True, depth=1, tone=0, only="*"):
        """Paint the first voxels seen from the front (front=True) or back where fn(x, z)."""
        occ = self.v > 0
        oid = None if only == "*" else self.ids_of(only)
        for z in range(self.H):
            for x in range(self.W):
                if not fn(x, z):
                    continue
                ys = np.nonzero(occ[z, :, x])[0]
                if len(ys) == 0:
                    continue
                rng = range(max(ys[-1] - depth + 1, 0), ys[-1] + 1) if front else range(ys[0], min(ys[0] + depth, self.L))
                for y in rng:
                    if occ[z, y, x] and (oid is None or self.v[z, y, x] in oid):
                        self.v[z, y, x] = self.mid(mat)
                        self.t[z, y, x] = tone

    def top_z(self, y, x):
        zs = np.nonzero(self.v[:, y, x])[0]
        return int(zs[-1]) if len(zs) else -1

    def front_y(self, z, x):
        ys = np.nonzero(self.v[z, :, x])[0]
        return int(ys[-1]) if len(ys) else -1

    def back_y(self, z, x):
        ys = np.nonzero(self.v[z, :, x])[0]
        return int(ys[0]) if len(ys) else -1


# =============================================================================================== parts
def wheel(m, yc, D, tw=2, e=0, rim="rim", hub=0.5, well=True, mat="tire", zc=None, dual=False, well_r=1.15,
          only_side=None, axle=True):
    """Wheel pair centred at y=yc (float), diameter D px, tyre width tw, e = inset from body side."""
    r = D / 2.0
    zc = (D - 1) / 2.0 if zc is None else zc
    tid = m.mid(mat)
    rid = m.mid(rim) if rim else None
    W = m.W
    cols_l = list(range(e, e + tw))
    cols_r = [W - 1 - c for c in cols_l]
    sides = [(cols_l, e), (cols_r, W - 1 - e)]
    if only_side == "l":
        sides = sides[:1]
    for y in range(int(math.floor(yc - r - 2)), int(math.ceil(yc + r + 2)) + 1):
        if y < 0 or y >= m.L:
            continue
        for z in range(0, min(m.H, int(math.ceil(zc + r + 2)) + 1)):
            d = math.hypot(y - yc, z - zc)
            if d <= r - 0.08:
                for cols, outer in sides:
                    for x in cols:
                        m.v[z, y, x] = tid
                        m.t[z, y, x] = 0
                    if rid and d <= r * hub + 0.25:
                        m.v[z, y, outer] = rid
                        m.t[z, y, outer] = 1 if d > r * hub * 0.5 else 0
            elif well and d <= r + well_r and z >= zc - 0.6:
                for cols, outer in sides:
                    for x in cols + ([outer + 1] if outer == e else [outer - 1]):
                        if 0 <= x < W and m.v[z, y, x] and m.v[z, y, x] != tid:
                            m.v[z, y, x] = m.mid("well")
    if axle and only_side is None:
        # an axle between the wheels (only where empty) keeps every view one connected blob
        y0 = int(math.floor(yc)) - (0 if D % 2 else 0)
        m.box(y0, y0 + 2, e + tw, W - e - tw, int(zc) - 1 if zc >= 1 else 0, int(zc) + 1, "dsteel", only="empty")



def wheels(m, ys, D, tw=2, **kw):
    for yc in ys:
        wheel(m, yc, D, tw, **kw)


def axle_y(m, dist_from, D, front):
    """Axle centre for a wheel whose centre sits `dist_from` px from the front/back end."""
    yc = (m.L - 1 - dist_from) if front else dist_from
    if D % 2 == 0:
        yc = yc + (0.5 if not front else -0.5)
    return yc


def cabin(m, by0, by1, ry0, ry1, zb, zr, in0=2, in1=3, mat="paint", glass="glass", pillars=(), roof_rows=1,
          round_roof=True, wshield=True, rglass=True, side=True, side_from=None, side_to=None, frame=None):
    """Greenhouse layers z = zb+1 .. zr. Base y-range [by0, by1] (inclusive) at z=zb+1, roof [ry0, ry1] at zr.
    pillars: list of (y0, y1) absolute ranges kept as body colour in the side windows."""
    W = m.W
    n = zr - zb
    layers = []
    for z in range(zb + 1, zr + 1):
        t = (z - zb - 1) / max(1, n - 1)
        a = int(round(by0 + (ry0 - by0) * t))
        b = int(round(by1 + (ry1 - by1) * t))
        i = int(round(in0 + (in1 - in0) * t))
        layers.append((z, a, b, i))
        m.box(a, b + 1, i, W - i, z, z + 1, mat)
    if round_roof:
        z, a, b, i = layers[-1]
        for yy in (a, b):
            for xx in (i, W - 1 - i):
                m.box(yy, yy + 1, xx, xx + 1, z, z + 1, None)
    frame = mat if frame is None else frame
    win_top = zr - roof_rows
    for k, (z, a, b, i) in enumerate(layers):
        if z > win_top or k + 1 >= len(layers):
            continue
        _, a2, b2, i2 = layers[k + 1]
        if side:
            lo = a2 if a2 > a else a + 1
            hi = b2 if b2 < b else b - 1
            if side_from is not None:
                lo = max(lo, side_from)
            if side_to is not None:
                hi = min(hi, side_to)
            for x in (i, W - 1 - i):
                m.box(lo, hi + 1, x, x + 1, z, z + 1, glass)
                for p0, p1 in pillars:
                    m.box(p0, p1, x, x + 1, z, z + 1, frame)
        if wshield:
            f0 = min(b, b2 + 1)
            m.box(f0, b + 1, i + 1, W - 1 - i, z, z + 1, glass)
        if rglass:
            r1 = max(a, a2 - 1)
            m.box(a, r1 + 1, i + 1, W - 1 - i, z, z + 1, glass)
    return layers


def front_lights(m, e0, e1, z0, z1, mat="head", d=2):
    """Paint headlights on the front surface (first `d` voxels seen from the front), mirrored."""
    W = m.W
    m.skin_end(lambda x, z: z0 <= z < z1 and (e0 <= x < e1 or W - e1 <= x < W - e0), mat, front=True, depth=d)


def rear_lights(m, e0, e1, z0, z1, mat="tail", d=2):
    W = m.W
    m.skin_end(lambda x, z: z0 <= z < z1 and (e0 <= x < e1 or W - e1 <= x < W - e0), mat, front=False, depth=d)


def top_corner_lights(m, e0, e1, n, mat, front=True, d=1):
    """Paint the top surface at the front/rear corners (visible from above)."""
    W, L = m.W, m.L
    ys = range(L - n, L) if front else range(0, n)
    m.skin_top(lambda y, x: y in ys and (e0 <= x < e1 or W - e1 <= x < W - e0), mat, depth=d)


def end_band(m, z0, z1, mat, front=True, x0=0, x1=None, d=1, tone=0):
    W = m.W
    x1 = W if x1 is None else x1
    m.skin_end(lambda x, z: z0 <= z < z1 and x0 <= x < x1, mat, front=front, depth=d, tone=tone)


def side_band(m, z0, z1, mat, y0=0, y1=None, d=1, tone=0, only="*"):
    y1 = m.L if y1 is None else y1
    m.skin_side(lambda y, z: z0 <= z < z1 and y0 <= y < y1, mat, depth=d, tone=tone, only=only)


def top_band(m, x0, x1, mat, y0=0, y1=None, d=1, tone=0, only="*", sym=False):
    y1 = m.L if y1 is None else y1
    W = m.W
    if sym:
        m.skin_top(lambda y, x: y0 <= y < y1 and (x0 <= x < x1 or W - x1 <= x < W - x0), mat, depth=d, tone=tone, only=only)
    else:
        m.skin_top(lambda y, x: y0 <= y < y1 and x0 <= x < x1, mat, depth=d, tone=tone, only=only)


# =============================================================================================== views
def _label(mask):
    """4-connected components of a boolean 2D mask -> list of (ys, xs)."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    comps = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        st = [(y0, x0)]
        seen[y0, x0] = True
        pts = []
        while st:
            y, x = st.pop()
            pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    st.append((yy, xx))
        comps.append(pts)
    return comps


def vertical_view(m, which):
    """Render SIDE (seen from +x, front LEFT), FRONT (seen from +y) or BACK (seen from -y).
    Returns rgb (rows top->bottom), has mask, material ids, hit coords (z, y, x) per pixel."""
    occ = m.v > 0
    H, L, W = occ.shape
    if which == "side":      # columns u = L-1-y ; ray from x = W-1 toward 0
        a = occ[:, :, ::-1].argmax(2)          # (H, L)
        has = occ.any(2)
        hx = W - 1 - a
        depth = a
        zz, yy = np.mgrid[0:H, 0:L]
        hit = (zz, yy, hx)
        cols = lambda arr: arr[:, ::-1]  # noqa: E731  y -> u = L-1-y
    elif which == "front":   # columns u = x ; ray from y = L-1 toward 0
        a = occ[:, ::-1, :].argmax(1)          # (H, W)
        has = occ.any(1)
        hy = L - 1 - a
        depth = a
        zz, xx = np.mgrid[0:H, 0:W]
        hit = (zz, hy, xx)
        cols = lambda arr: arr  # noqa: E731
    else:                    # back: columns u = W-1-x ; ray from y = 0
        a = occ.argmax(1)
        has = occ.any(1)
        hy = a
        depth = a
        zz, xx = np.mgrid[0:H, 0:W]
        hit = (zz, hy, xx)
        cols = lambda arr: arr[:, ::-1]  # noqa: E731
    mat = np.where(has, m.v[hit], 0)
    toff = np.where(has, m.t[hit], 0)
    Hh, U = has.shape
    tone = np.full((Hh, U), 2, int)
    for u in range(U):
        kup = np.zeros(Hh, int)
        kdn = np.zeros(Hh, int)
        for z in range(Hh - 1, -1, -1):
            if not has[z, u]:
                continue
            brk = z == Hh - 1 or not has[z + 1, u] or depth[z + 1, u] > depth[z, u]
            kup[z] = 0 if brk else kup[z + 1] + 1
        for z in range(Hh):
            if not has[z, u]:
                continue
            brk = z == 0 or not has[z - 1, u] or depth[z - 1, u] > depth[z, u]
            kdn[z] = 0 if brk else kdn[z - 1] + 1
        for z in range(Hh):
            if not has[z, u]:
                continue
            run = kup[z] + kdn[z] + 1
            top_is_sil = (z + kup[z] == Hh - 1) or not has[z + kup[z] + 1, u]
            over = z + 1 < Hh and has[z + 1, u] and depth[z + 1, u] < depth[z, u]
            t = 2
            if run >= 3 and kdn[z] <= max(0, (run - 1) // 3):
                t = 1
            if run >= 5 and kdn[z] == 0:
                t = 0
            if kup[z] == 0 or (kup[z] == 1 and top_is_sil and run >= 4):
                t = 3
            if over:
                t = 1
            tone[z, u] = t
    return finish_view(m, has, mat, toff, tone, depth, cols, vertical=True)


def top_view(m):
    occ = m.v > 0
    H, L, W = occ.shape
    has = occ.any(0)
    zt = H - 1 - occ[::-1].argmax(0)
    zt = np.where(has, zt, -1)
    yy, xx = np.mgrid[0:L, 0:W]
    mat = np.where(has, m.v[np.clip(zt, 0, H - 1), yy, xx], 0)
    toff = np.where(has, m.t[np.clip(zt, 0, H - 1), yy, xx], 0)
    tone = np.full((L, W), 2, int)
    zmax = zt.max()
    solid_ids = {i for i, mt in enumerate(m.mats) if mt and mt["kind"] == "solid"}
    pad = np.pad(zt, 1, constant_values=-1)
    for y in range(L):
        for x in range(W):
            if not has[y, x]:
                continue
            z = zt[y, x]
            nb = [pad[y, x + 1], pad[y + 2, x + 1], pad[y + 1, x], pad[y + 1, x + 2]]
            if m.roof_hl and z >= zmax - 1 and mat[y, x] in solid_ids:
                tone[y, x] = 3
            if max(nb) >= z + 2:
                tone[y, x] = 1
    return finish_view(m, has, mat, toff, tone, zt, None, vertical=False)


def finish_view(m, has, mat, toff, tone, depth, cols, vertical):
    """Apply material-specific tone rules, glass glints, colour lookup and the 1px outline.
    Returns dict(rgb image array top->bottom rows, has, mat) in view image orientation."""
    tone = tone.copy()
    kinds = {i: mt["kind"] for i, mt in enumerate(m.mats) if mt}
    # material rules
    for i, k in kinds.items():
        sel = mat == i
        if not sel.any():
            continue
        if k == "tire":
            tone[sel] = np.where(tone[sel] == 3, 1, 0)
        elif k == "dark":
            tone[sel] = 0
        elif k == "glass":
            tone[sel] = 1
    tone = np.clip(tone + toff, 0, 3)
    # orient to image rows (top row = highest z) for vertical views
    if vertical:
        has_i, mat_i, tone_i = has[::-1], mat[::-1], tone[::-1]
        has_i, mat_i, tone_i = cols(has_i), cols(mat_i), cols(tone_i)
    else:
        has_i, mat_i, tone_i = has, mat, tone
    tone_i = tone_i.copy()
    # glass: shadow under the frame on the top row, one diagonal glint per pane
    gl = np.isin(mat_i, [i for i, k in kinds.items() if k == "glass"])
    for pts in _label(gl):
        ys = [p[0] for p in pts]
        xs = [p[1] for p in pts]
        y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs)
        hgt, wid = y1 - y0 + 1, x1 - x0 + 1
        if vertical:
            for (y, x) in pts:
                if y == y0 and hgt >= 3:
                    tone_i[y, x] = 0
        if len(pts) >= 5:
            k = (wid + hgt) // 3
            for (y, x) in pts:
                d = (x - x0) + (y - y0)
                if d == k:
                    tone_i[y, x] = 3
                elif d == k + 1 and (wid >= 6 or hgt >= 6):
                    tone_i[y, x] = 2
    hh, ww = has_i.shape
    rgb = np.zeros((hh, ww, 3), np.uint8)
    for i, mt in enumerate(m.mats):
        if not mt:
            continue
        sel = mat_i == i
        if sel.any():
            tl = np.array(mt["tones"], np.uint8)
            rgb[sel] = tl[tone_i[sel]]
    return {"rgb": rgb, "has": has_i, "mat": mat_i, "tone": tone_i}


def outline_view(view):
    has = view["has"]
    pad = np.pad(has, 1)
    inner = (pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
             & pad[:-2, :-2] & pad[:-2, 2:] & pad[2:, :-2] & pad[2:, 2:])
    edge = has & ~inner
    img = np.full(has.shape + (3,), 255, np.uint8)
    img[has] = view["rgb"][has]
    img[edge] = OUTLINE
    return img


def make_sheet(views):
    """Upscale TOP, SIDE, FRONT, BACK 8x and paste in a row on flat white, vertically centred."""
    ims = [Image.fromarray(outline_view(v)).resize((v["has"].shape[1] * UP, v["has"].shape[0] * UP), Image.NEAREST)
           for v in views]
    hmax = max(im.height for im in ims)
    wsum = sum(im.width for im in ims) + GAP * 5
    sheet = Image.new("RGB", (wsum, hmax + 2 * GAP), (255, 255, 255))
    x = GAP
    for im in ims:
        y = GAP + (hmax - im.height) // 2
        sheet.paste(im, (x, y))
        x += im.width + GAP
    return sheet


def connect_views(m):
    """The slicer needs every view to be one 8-connected blob (gaps of 1 native px split it)."""
    probs = []
    for name, has in (("top", (m.v > 0).any(0)), ("side", (m.v > 0).any(2)), ("front", (m.v > 0).any(1))):
        h, w = has.shape
        seen = np.zeros_like(has)
        n = 0
        for y0, x0 in zip(*np.nonzero(has)):
            if seen[y0, x0]:
                continue
            n += 1
            st = [(y0, x0)]
            seen[y0, x0] = True
            while st:
                y, x = st.pop()
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < h and 0 <= xx < w and has[yy, xx] and not seen[yy, xx]:
                            seen[yy, xx] = True
                            st.append((yy, xx))
        if n != 1:
            probs.append(f"{name} view has {n} parts")
    return probs


# =============================================================================================== pipeline
def crop_model(m):
    occ = m.v > 0
    zs, ys, xs = np.nonzero(occ)
    z1, y0, y1, x0, x1 = zs.max() + 1, ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    if zs.min() != 0:
        print(f"  warning: model floats {zs.min()} px above ground")
    nm = Model(int(y1 - y0), int(x1 - x0), int(z1))
    nm.v = m.v[:z1, y0:y1, x0:x1].copy()
    nm.t = m.t[:z1, y0:y1, x0:x1].copy()
    nm.mats, nm.ids, nm.custom, nm.extra, nm.roof_hl = m.mats, m.ids, m.custom, m.extra, m.roof_hl
    return nm, (y0, x0)


def model_colours(m, views):
    """Per-voxel fallback colour from the rendered views (or a tone rule when no view sees it)."""
    H, L, W = m.H, m.L, m.W
    occ = m.v > 0
    col = np.zeros((H, L, W, 3), np.uint8)
    top, side, front, back = views
    for z, y, x in zip(*np.nonzero(occ)):
        mt = m.mats[m.v[z, y, x]]
        c = None
        above = z + 1 < H and occ[z + 1, y, x]
        if not above and top["mat"][y, x] == m.v[z, y, x]:
            zs = np.nonzero(occ[:, y, x])[0]
            if zs[-1] == z:
                c = top["rgb"][y, x]
        if c is None and side["mat"][H - 1 - z, L - 1 - y] == m.v[z, y, x]:
            c = side["rgb"][H - 1 - z, L - 1 - y]
        if c is None and front["mat"][H - 1 - z, x] == m.v[z, y, x]:
            c = front["rgb"][H - 1 - z, x]
        if c is None and back["mat"][H - 1 - z, W - 1 - x] == m.v[z, y, x]:
            c = back["rgb"][H - 1 - z, W - 1 - x]
        if c is None:
            t = 2 if not above else 1
            if mt["kind"] in ("dark",):
                t = 0
            if mt["kind"] == "tire":
                t = 0
            t = int(np.clip(t + m.t[z, y, x], 0, 3))
            c = mt["tones"][t]
        col[z, y, x] = c
    return col


def _dilate(a, r):
    out = a.copy()
    p = np.pad(a, r)
    h, w = a.shape
    for dy in range(2 * r + 1):
        for dx in range(2 * r + 1):
            out |= p[dy:dy + h, dx:dx + w]
    return out


def _rgba(view):
    a = np.zeros(view["has"].shape + (4,), np.uint8)
    a[..., :3] = view["rgb"]
    a[..., 3] = np.where(view["has"], 255, 0)
    return a


def fix_volume(m, vol, views):
    """Intersect the carved hull with the voxel model (restores cavities the hull fills in), then
    recolour the voxels next to every change with the slicer's own colouring rule applied to the
    model's occupancy, and finally repaint any surface voxel whose colour belongs to another material."""
    H, L, W = m.H, m.L, m.W
    occ = m.v > 0
    hull = vol[..., 3] > 0
    diff = hull ^ occ
    out = vol.copy()
    out[~occ] = 0
    top = _rgba(views[0])
    side_a = _rgba(views[1])[:, ::-1]
    front = _rgba(views[2])
    back_a = _rgba(views[3])[:, ::-1]
    ix = np.arange(W)[None, :].repeat(L, 0)
    iy = np.arange(L)[:, None].repeat(W, 1)
    covered = np.zeros((L, W), bool)
    diff_above = np.zeros((L, W), bool)
    prev_need = np.zeros((L, W), bool)
    for z in range(H - 1, -1, -1):
        r = H - 1 - z
        above = covered.copy()
        o = occ[z]
        covered |= o
        aff = _dilate(diff[z] | diff_above, 2)
        diff_above |= diff[z]
        if not o.any():
            prev_need = np.zeros((L, W), bool)
            continue
        d = np.stack([
            ix - np.maximum.accumulate(np.where(~o, ix, -1), axis=1),
            np.minimum.accumulate(np.where(~o, ix, W)[:, ::-1], axis=1)[:, ::-1] - ix,
            iy - np.maximum.accumulate(np.where(~o, iy, -1), axis=0),
            np.minimum.accumulate(np.where(~o, iy, L)[::-1], axis=0)[::-1] - iy,
        ])
        face, depth = d.argmin(0), d.min(0)
        near_above = _dilate(above, 2)
        steep = (~above) & (depth <= 2) & near_above
        use_top = (~above) & (~steep)
        use_above = above & (depth > 2) & (occ[z + 1] if z + 1 < H else np.zeros_like(o))
        edge = top[..., :3].copy()
        srow = vts._edge_row(side_a, r, L)
        brow = vts._edge_row(back_a, r, W)
        frow = vts._edge_row(front, r, W)
        if srow is not None:
            mk = face < 2
            edge[mk] = np.broadcast_to(srow[:, None, :], (L, W, 3))[mk]
        if brow is not None:
            mk = face == 2
            edge[mk] = np.broadcast_to(brow[None, :, :], (L, W, 3))[mk]
        if frow is not None:
            mk = face > 2
            edge[mk] = np.broadcast_to(frow[None, :, :], (L, W, 3))[mk]
        rgb = np.where(use_top[..., None], top[..., :3], edge)
        if z + 1 < H:
            rgb = np.where(use_above[..., None], out[z + 1, :, :, :3], rgb)
        need = o & (aff | (use_above & prev_need) | (out[z, :, :, 3] == 0))
        out[z][need, :3] = rgb[need]
        out[z][o, 3] = 255
        prev_need = need
    # material check on the visible surface
    fallback = model_colours(m, views)
    allowed = {i: {tuple(t) for t in mt["tones"]} for i, mt in enumerate(m.mats) if mt}
    p = np.pad(occ, 1)
    surf = occ & ~(p[:-2, 1:-1, 1:-1] & p[2:, 1:-1, 1:-1] & p[1:-1, :-2, 1:-1] & p[1:-1, 2:, 1:-1]
                   & p[1:-1, 1:-1, :-2] & p[1:-1, 1:-1, 2:])
    rep = 0
    for z, y, x in zip(*np.nonzero(surf)):
        c = tuple(int(v) for v in out[z, y, x, :3])
        if c not in allowed[m.v[z, y, x]]:
            out[z, y, x, :3] = fallback[z, y, x]
            rep += 1
    return out, rep


def run_slicer(vid, sheet_path, raw_path, check_path, H):
    cmd = [sys.executable, str(SLICER), str(sheet_path), str(raw_path), "--slices", str(H), "--colours", "0",
           "--shade", "0", "--top-nose", "down", "--side-nose", "left", "--order", "reading",
           "--preview", str(check_path)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{vid}: slicer failed\n{r.stdout}\n{r.stderr}")
    return r.stdout


def lights_of(m, amber_beacon=False):
    """Light positions in metres, sprite-local: x = strip +x from the slice centre, y = toward the front
    (+y in the strip). head/tail: one point per side cluster (left, right, centre). beacon: flashing lights
    [x, y, 'r'|'b'|'a']. nav: boat/heli navigation lights [x, y, 'r'|'g']."""
    out = {}
    cx, cy = (m.W - 1) / 2, (m.L - 1) / 2

    def clusters(name):
        pts = []
        if name not in m.ids:
            return pts
        zz, yy, xx = np.nonzero(m.v == m.ids[name])
        for side in (xx < cx - 0.25, xx > cx + 0.25, np.abs(xx - cx) <= 0.25):
            if side.any():
                pts.append([round((float(xx[side].mean()) - cx) * MPP, 2), round((float(yy[side].mean()) - cy) * MPP, 2)])
        return pts

    def merge(pts):
        # a single light straddling the centre line comes out as two halves; fuse close pairs
        if len(pts) >= 2 and abs(pts[0][0] - pts[1][0]) < 0.35 and abs(pts[0][1] - pts[1][1]) < 0.35:
            return [[round((pts[0][0] + pts[1][0]) / 2, 2), round((pts[0][1] + pts[1][1]) / 2, 2)]] + pts[2:]
        return pts

    out["head"] = merge(clusters("head"))
    out["tail"] = merge(clusters("tail"))
    beacons = []
    for n, tag in (("sirenr", "r"), ("sirenb", "b")) + ((("amber", "a"),) if amber_beacon else ()):
        beacons += [p + [tag] for p in clusters(n)]
    if beacons:
        out["beacon"] = beacons
    nav = [p + ["r"] for p in clusters("navr")] + [p + ["g"] for p in clusters("navg")]
    if nav:
        out["nav"] = nav
    return out


def verify(m, vol):
    """Sanity checks on the final volume: paint colours exclusive to body paint, lights detected by the
    slicer's auto-emissive mask, nothing else glowing."""
    warns = []
    seen = {}
    for i, mt in enumerate(m.mats):
        if not mt:
            continue
        for t in set(mt["tones"]):
            if t in seen and seen[t] != mt["name"]:
                warns.append(f"colour {t} shared by {seen[t]} and {mt['name']}")
            seen[t] = mt["name"]
    if "paint" in m.ids:
        pt = {tuple(t) for t in m.mats[m.ids["paint"]]["tones"]}
        occ = vol[..., 3] > 0
        p = np.pad(occ, 1)
        surf = occ & ~(p[:-2, 1:-1, 1:-1] & p[2:, 1:-1, 1:-1] & p[1:-1, :-2, 1:-1] & p[1:-1, 2:, 1:-1]
                       & p[1:-1, 1:-1, :-2] & p[1:-1, 1:-1, 2:])
        bad = 0
        for z, y, x in zip(*np.nonzero(surf)):
            if tuple(int(c) for c in vol[z, y, x, :3]) in pt and m.v[z, y, x] != m.ids["paint"]:
                bad += 1
        if bad:
            warns.append(f"{bad} non-paint surface voxels carry paint colours")
    em = vts.detect_emissive(vol)
    cols = {tuple(int(c) for c in px[:3]) for px in em[em[..., 3] > 0]}
    lights = {tuple(t) for mt in m.mats if mt and mt["kind"] == "light" for t in mt["tones"]}
    extra = cols - lights
    if extra:
        warns.append(f"non-light colours detected as emissive: {sorted(extra)[:4]}")
    for name in ("head", "tail"):
        if name in m.ids and tuple(m.mats[m.ids[name]]["tones"][0]) not in cols:
            warns.append(f"{name} lights not picked up by the emissive mask")
    return warns


VEH = []


def vehicle(vid, name, make, cls, kind, dims, **meta):
    def deco(fn):
        VEH.append(dict(id=vid, name=name, make=make, cls=cls, kind=kind, dims=dims, build=fn, meta=meta))
        return fn
    return deco


def build_one(spec):
    vid = spec["id"]
    ln, wd, ht = spec["dims"]
    L, W, H = (int(math.floor(v / MPP + 0.5 + 1e-6)) for v in (ln, wd, ht))
    m0 = Model(L, W, H)
    spec["build"](m0)
    m, off = crop_model(m0)
    m.extra["crop"] = off
    probs = connect_views(m)
    if probs:
        raise RuntimeError(f"{vid}: {'; '.join(probs)} (the slicer needs one blob per view)")
    views = [top_view(m), vertical_view(m, "side"), vertical_view(m, "front"), vertical_view(m, "back")]
    sheet = make_sheet(views)
    sp = BUILD / "sheets" / f"{vid}.png"
    raw = BUILD / "raw" / f"{vid}.png"
    chk = BUILD / "check" / f"{vid}.png"
    for p in (sp, raw, chk):
        p.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(sp)
    log = run_slicer(vid, sp, raw, chk, m.H)
    strip = np.array(Image.open(raw).convert("RGBA"))
    n = m.H
    sw = strip.shape[1] // n
    vol = np.stack([strip[:, i * sw:(i + 1) * sw] for i in range(n)])
    if vol.shape[1:3] != (m.L, m.W):
        raise RuntimeError(f"{vid}: carved {vol.shape} != model {(m.H, m.L, m.W)}")
    vol, rep = fix_volume(m, vol, views)
    final = np.concatenate(list(vol), axis=1)
    Image.fromarray(final).save(OUT / f"{vid}.png", optimize=True)
    warns = [f"thin part in slices {a}-{b} (blinks)" for a, b in vts.thin_runs(vol)] + verify(m, vol)
    if "rotor" in m.extra:
        ro = m.extra["rotor"]
        m.extra["rotor_strip"] = rotor_strip(OUT / f"{vid}_rotor.png", ro["d"], ro["blades"], ro["tip"])
    return dict(m=m, vol=vol, warns=warns, rep=rep, log=log)


# =============================================================================================== vehicles
# (builders below)

def sub(m, L=None, W=None, H=None):
    """Child model sharing the parent's materials (for building parts at an offset)."""
    c = Model(L or m.L, W or m.W, H or m.H)
    c.mats, c.ids, c.custom = m.mats, m.ids, m.custom
    return c


def paste(m, c, y0=0, x0=0, z0=0):
    zs, ys, xs = np.nonzero(c.v)
    Y, X, Z = ys + y0, xs + x0, zs + z0
    ok = (Y >= 0) & (Y < m.L) & (X >= 0) & (X < m.W) & (Z >= 0) & (Z < m.H)
    m.v[Z[ok], Y[ok], X[ok]] = c.v[zs[ok], ys[ok], xs[ok]]
    m.t[Z[ok], Y[ok], X[ok]] = c.t[zs[ok], ys[ok], xs[ok]]


def inset_profile(L, nose, tail):
    d = {0: 0, L - 1: 0}
    d[len(tail)] = 0
    d[L - 1 - len(nose)] = 0
    for k, v in enumerate(tail):
        d[k] = v
    for k, v in enumerate(nose):
        d[L - 1 - k] = v
    return sorted(d.items())


def ends(m, *, zc, zhf, ztr, bumper="trim", bz=None, rbz=None, grille="grille", gz=None, gw=None, hl=None, tl=None,
         hl_top=2, tl_top=1, rbumper=None):
    W = m.W
    bz = bz or (zc, zc + 2)
    rbz = rbz or bz
    if bumper:
        end_band(m, bz[0], bz[1], bumper, front=True)
        end_band(m, rbz[0], rbz[1], rbumper or bumper, front=False)
    gz = gz or (bz[1], max(bz[1] + 1, zhf - 1))
    gw = gw if gw is not None else max(3, W // 2 - 3)
    if grille:
        x0 = W // 2 - gw
        end_band(m, gz[0], gz[1], grille, front=True, x0=x0, x1=W - x0)
    hl = hl or (1, 4, zhf - 2, zhf)
    tl = tl or (1, 4, ztr - 2, ztr)
    if hl[1] > hl[0]:
        front_lights(m, *hl)
        if hl_top:
            top_corner_lights(m, hl[0], hl[1], hl_top, "head", front=True)
    if tl[1] > tl[0]:
        rear_lights(m, *tl)
        if tl_top:
            top_corner_lights(m, tl[0], tl[1], tl_top, "tail", front=False)


def car(m, *, hood, ws, roof, rw, zb, zh=None, zhf=None, zt=None, ztr=None, zc=2, zr=None, in0=2, in1=3, D=7, tw=2,
        wf=9, wr=10, nose=(2, 1), tail=(1,), pillars=(0.5,), roof_rows=1, bumper="trim", bz=None, rbz=None,
        grille="grille", gz=None, gw=None, hl=None, tl=None, hl_top=2, tl_top=1, mirror=True, rim="rim",
        hub=0.5, paint="paint", glass="glass", shoulder=False, round_roof=True, seams=True, wells=True,
        rglass=True, nose_drop=1, tail_drop=1, roofmat=None, open_top=False, side_to=None, side_from=None,
        frame=None, lower_paint=None, rbumper=None, plan=None, cab_rear=None, we=0, wer=None, twr=None, Dr=None):
    """Generic passenger car. Lengths in px measured from the front: hood (front -> windshield base),
    ws (windshield run), roof (roof length), rw (rear-glass run). Heights: zb belt, zh hood at cowl,
    zhf hood tip, zt deck, ztr deck tip, zc body bottom, zr roof (default H-1)."""
    L, W, H = m.L, m.W, m.H
    zr = H - 1 if zr is None else zr
    zh = zb if zh is None else zh
    zhf = zh - nose_drop if zhf is None else zhf
    zt = zb if zt is None else zt
    ztr = zt - tail_drop if ztr is None else ztr
    by1 = L - 1 - hood
    ry1 = by1 - ws
    ry0 = ry1 - roof + 1
    by0 = ry0 - rw
    top = [(0, ztr), (2, zt), (max(2, by0 - 1), zt), (by0, max(zt, zb)), (by1, zb), (by1 + 1, zh),
           (L - 3, zhf + nose_drop), (L - 1, zhf)]
    m.body(top, zc, inset=plan if plan is not None else inset_profile(L, nose, tail), mat=paint)
    topa = prof(top, L)
    if shoulder:
        for y in range(L):
            if y < by0 or y > by1:
                m.box(y, y + 1, 0, 1, topa[y], topa[y] + 1, None)
                m.box(y, y + 1, W - 1, W, topa[y], topa[y] + 1, None)
    pil = []
    for f in pillars:
        py = int(round(ry1 - f * (ry1 - ry0)))
        pil.append((py, py + 1))
    lay = None
    if not open_top:
        lay = cabin(m, by0, by1, ry0, ry1, zb, zr, in0, in1, mat=paint, glass=glass, pillars=pil,
                    roof_rows=roof_rows, round_roof=round_roof, rglass=rglass, side_to=side_to,
                    side_from=side_from, frame=frame)
        if roofmat:
            z, a, b, i = lay[-1]
            m.paint(a + 1, b, i + 1, W - 1 - i, z, z + 1, roofmat)
    Dr = D if Dr is None else Dr
    yf = axle_y(m, wf, D, True)
    yr = axle_y(m, wr, Dr, False)
    if lower_paint:
        side_band(m, zc, zc + lower_paint[0], lower_paint[1], only=paint)
    wheel(m, yf, D, tw, rim=rim, hub=hub, well=wells, e=we)
    wheel(m, yr, Dr, twr or tw, rim=rim, hub=hub, well=wells, e=we if wer is None else wer)
    ends(m, zc=zc, zhf=zhf, ztr=ztr, bumper=bumper, bz=bz, rbz=rbz, grille=grille, gz=gz, gw=gw, hl=hl, tl=tl,
         hl_top=hl_top, tl_top=tl_top, rbumper=rbumper)
    if mirror and not open_top:
        m.skin_side(lambda y, z: by1 - 2 <= y < by1 and z == zb, "trim")
    if seams and pil:
        for p0, p1 in pil:
            m.skin_side(lambda y, z, p0=p0: y == p0 and zc + 2 <= z < zb, paint, tone=-1, only=paint)
    return dict(by0=by0, by1=by1, ry0=ry0, ry1=ry1, zr=zr, yf=yf, yr=yr, layers=lay, zb=zb, zh=zh, zt=zt,
                zhf=zhf, ztr=ztr, top=topa)


def cockpit(m, y0, y1, zfloor, zb, *, ws_h=3, rake=2, seat="seat_tan", rows=1, inn=2, frame="chrome",
            roll=None, bench=False):
    """Open cockpit for convertibles / roadsters: cavity from y0..y1 (inclusive), seats, dash, windshield."""
    W = m.W
    m.box(y0, y1 + 1, inn, W - inn, zfloor + 1, zb + 1, None)
    m.box(y0, y1 + 1, inn, W - inn, zfloor, zfloor + 1, "interior")
    m.box(y1 - 1, y1 + 1, inn, W - inn, zb - 2, zb + 1, "trim")         # dash
    # windshield, 2px thick, leaning back
    for k in range(ws_h):
        yy = y1 - int(round(k * rake / max(1, ws_h - 1)))
        z = zb + 1 + k
        m.box(yy - 1, yy + 1, inn - 1, W - inn + 1, z, z + 1, "glass")
        m.box(yy - 1, yy + 1, inn - 1, inn + 1, z, z + 1, frame)
        m.box(yy - 1, yy + 1, W - inn - 1, W - inn + 1, z, z + 1, frame)
        if k == ws_h - 1:
            m.box(yy - 1, yy + 1, inn - 1, W - inn + 1, z, z + 1, frame)
    # seats: front row just behind the dash, extra rows behind
    half = (W - 2 * inn) // 2
    xs = [(inn, inn + half - 1), (W - inn - half + 1, W - inn)] if not bench else [(inn, W - inn)]
    sy = y1 - 3
    seat_rows = []
    for r in range(rows):
        c0 = sy - 4
        for xa, xb in xs:
            m.box(c0, sy, xa, xb, zfloor + 1, zfloor + 3, seat)                    # cushion
            m.box(c0 - 2, c0, xa, xb, zfloor + 1, zb + 1, seat)                     # backrest
            m.box(c0 - 2, c0, xa + (xb - xa) // 2 - 1, xa + (xb - xa) // 2 + 1, zb + 1, zb + 2, seat)  # headrest
        seat_rows.append((c0 - 2, sy))
        sy = c0 - 4
    # steering wheel on the driver's side (vehicle left = +x)
    xa, xb = xs[-1]
    m.box(y1 - 3, y1 - 1, xa, xb, zb - 1, zb + 1, "trim")
    if roll:
        for (a, b) in seat_rows[:1]:
            for xa, xb in xs:
                m.box(a - 2, a, xa, xb, zb + 1, zb + 1 + roll, "chrome")
    return seat_rows


def std_paint(m, rgb, name="paint", **kw):
    m.define(name, ramp(rgb, **kw))


def light_bar(m, y0, y1, z, e0, e1, cols=("sirenr", "sirenb"), mid="trim", h=1):
    """Roof light bar from x=e0..W-e0 (with a dark centre e1..W-e1)."""
    W = m.W
    m.box(y0, y1, e0, W // 2, z, z + h, cols[1])
    m.box(y0, y1, W // 2, W - e0, z, z + h, cols[0])
    if e1 and mid:
        m.box(y0, y1, e1, W - e1, z, z + h, mid)


def roof_rails(m, y0, y1, z, e=0, mat="trim", bars=()):
    """Two 2px roof rails along y at roof inset e (from the roof edge columns), optional cross bars."""
    W = m.W
    m.box(y0, y1, e, e + 2, z, z + 1, mat)
    m.box(y0, y1, W - e - 2, W - e, z, z + 1, mat)
    for b in bars:
        m.box(b, b + 2, e, W - e, z, z + 1, mat)


def roof_at(m, y, x=None):
    x = m.W // 2 if x is None else x
    return m.top_z(y, x)


# =============================================================================================== CARS
@vehicle("redbud_pip", "Pip", "Redbud", "economy", "car", (3.6, 1.66, 1.52))
def _(m):
    std_paint(m, (110, 190, 156))
    car(m, hood=7, ws=6, roof=14, rw=3, zb=8, zh=8, zhf=7, zt=8, ztr=7, D=6, wf=7, wr=6, in0=1, in1=2,
        pillars=(0.7,), nose=(2, 1), tail=(1,), hl=(1, 4, 5, 7), tl=(1, 3, 5, 8), gw=3)


@vehicle("prairie_dash", "Dash", "Prairie", "compact", "car", (4.15, 1.76, 1.46))
def _(m):
    std_paint(m, (222, 120, 40))
    car(m, hood=9, ws=7, roof=16, rw=4, zb=9, zh=8, zt=9, ztr=8, D=7, wf=8, wr=7, in0=2, in1=3,
        pillars=(0.45,), tl=(1, 3, 6, 9), hl=(1, 4, 5, 7))
    z = m.H - 1
    ry0 = m.L - 1 - 9 - 7 - 16 + 1
    m.cbox(ry0 - 2, ry0 + 1, 5, z, z + 1, "trim")   # roof spoiler lip over the hatch


@vehicle("prairie_sprig", "Sprig", "Prairie", "compact", "car", (4.55, 1.78, 1.42))
def _(m):
    std_paint(m, (124, 142, 112))
    car(m, hood=11, ws=6, roof=13, rw=5, zb=8, zh=8, zt=8, D=6, wf=9, wr=9, in0=2, in1=3, pillars=(0.5,),
        hl=(1, 4, 6, 7), tl=(1, 4, 6, 8))


@vehicle("redbud_bloom", "Bloom EV", "Redbud", "economy", "car", (4.05, 1.78, 1.56))
def _(m):
    std_paint(m, (206, 210, 216))
    car(m, hood=8, ws=8, roof=15, rw=4, zb=9, zh=8, zt=9, ztr=8, D=7, wf=8, wr=7, in0=2, in1=3, pillars=(0.45,),
        grille=None, hl=(1, 7, 6, 7), tl=(1, 8, 7, 8), roofmat="glassdark", bumper="trim")


@vehicle("osage_meridian", "Meridian", "Osage Motor Works", "sedan", "car", (4.85, 1.85, 1.45))
def _(m):
    std_paint(m, (64, 98, 150))
    car(m, hood=12, ws=6, roof=14, rw=5, zb=9, zh=8, zt=9, D=7, wf=10, wr=10)


@vehicle("osage_ledger", "Ledger", "Osage Motor Works", "fullsize", "car", (5.35, 1.98, 1.47))
def _(m):
    std_paint(m, (112, 34, 44))
    car(m, hood=14, ws=6, roof=15, rw=5, zb=9, zh=9, zhf=8, zt=9, D=7, wf=11, wr=12, gw=5, grille="chrome",
        hl=(1, 5, 6, 8), tl=(1, 5, 6, 8))
    side_band(m, 5, 6, "trim", y0=3, y1=m.L - 3, only="paint")   # body-side moulding


@vehicle("verdigris_current", "Current", "Verdigris", "electric", "car", (4.7, 1.9, 1.42))
def _(m):
    std_paint(m, (176, 36, 44))
    car(m, hood=10, ws=8, roof=12, rw=9, zb=8, zh=7, zt=8, ztr=8, D=7, wf=9, wr=9, pillars=(0.55,), grille=None,
        roofmat="glassdark", hl=(1, 5, 5, 6), tl=(1, 9, 7, 8), tl_top=2)


@vehicle("keystone_sovereign", "Sovereign", "Keystone", "luxury", "car", (5.25, 1.95, 1.48))
def _(m):
    std_paint(m, (38, 40, 52))
    car(m, hood=15, ws=6, roof=14, rw=5, zb=9, zh=9, zhf=8, zt=9, D=7, wf=11, wr=11, grille="chrome", gw=3,
        gz=(4, 8), hl=(1, 5, 6, 8), tl=(1, 4, 6, 8), bumper="chrome", rim="chrome")
    side_band(m, 8, 9, "chrome", y0=4, y1=m.L - 4, only="paint")
    m.skin_top(lambda y, x: y >= m.L - 3 and m.W // 2 - 1 <= x <= m.W // 2, "chrome")   # hood ornament


@vehicle("keystone_magistrate", "Magistrate", "Keystone", "luxury", "car", (5.0, 1.9, 1.44))
def _(m):
    std_paint(m, (168, 174, 184))
    c = car(m, hood=13, ws=6, roof=13, rw=6, zb=9, zh=8, zt=9, D=7, wf=10, wr=11, gw=2, gz=(4, 7), grille="chrome",
            hl=(1, 5, 6, 7), tl=(1, 5, 6, 8))
    z, a, b, i = c["layers"][-1]
    m.paint(b - 6, b - 1, i + 2, m.W - i - 2, z, z + 1, "glassdark")   # sunroof


@vehicle("osage_homestead", "Homestead", "Osage Motor Works", "wagon", "car", (5.4, 2.0, 1.52))
def _(m):
    std_paint(m, (196, 176, 132))
    c = car(m, hood=13, ws=6, roof=27, rw=1, zb=9, zh=9, zhf=8, zt=9, zr=13, D=7, wf=11, wr=11,
            pillars=(0.28, 0.62), bumper="chrome", grille="chrome", tl=(1, 3, 5, 9), tl_top=2, hl=(1, 5, 6, 8))
    side_band(m, 4, 8, "wood", y0=3, y1=m.L - 3, only="paint")
    side_band(m, 8, 9, "seat_white", y0=3, y1=m.L - 3, only="paint")
    roof_rails(m, c["ry0"] + 2, c["ry1"] - 1, 14, e=3, mat="chrome", bars=(c["ry0"] + 4, c["ry1"] - 4))


@vehicle("redbud_trailhead", "Trailhead", "Redbud", "wagon", "car", (4.8, 1.84, 1.58))
def _(m):
    std_paint(m, (58, 104, 82))
    c = car(m, hood=11, ws=6, roof=22, rw=3, zb=9, zh=9, zhf=8, zt=9, zr=14, zc=3, D=7, wf=9, wr=8,
            pillars=(0.3, 0.62), tl=(1, 3, 7, 10), lower_paint=(2, "trim"))
    roof_rails(m, c["ry0"] + 1, c["ry1"], 15, e=3)
    m.cbox(c["ry0"] + 4, c["ry1"] - 3, 4, 15, 16, "trim")      # roof cargo box lid


@vehicle("bluedome_vesper", "Vesper", "Blue Dome Motors", "coupe", "car", (4.6, 1.82, 1.36))
def _(m):
    std_paint(m, (226, 186, 50))
    car(m, hood=12, ws=7, roof=10, rw=7, zb=8, zh=7, zt=8, D=7, wf=9, wr=9, pillars=(), in0=2, in1=3,
        hl=(1, 5, 5, 6), tl=(1, 5, 6, 7))


@vehicle("keystone_baron", "Baron", "Keystone", "coupe", "car", (5.6, 2.0, 1.36))
def _(m):
    std_paint(m, (176, 144, 98))
    m.define("vinyl", ramp((96, 58, 44)))
    c = car(m, hood=18, ws=5, roof=13, rw=4, zb=8, zh=8, zhf=7, zt=8, D=7, wf=12, wr=12, pillars=(),
            bumper="chrome", grille="chrome", gw=3, gz=(4, 7), hl=(1, 5, 5, 7), tl=(1, 6, 5, 7), rim="chrome",
            side_from=None)
    # vinyl landau roof over the back two thirds, solid C-pillar with a small opera window
    z, a, b, i = c["layers"][-1]
    for (zz, aa, bb, ii) in c["layers"]:
        cut = aa + (bb - aa) * 5 // 9
        m.paint(aa, cut, 0, m.W, zz, zz + 1, "vinyl", only=["paint", "glass"])
    m.skin_side(lambda y, z_: z_ in (10, 11) and c["ry0"] + 2 <= y <= c["ry0"] + 3, "glass")
    side_band(m, 7, 8, "chrome", y0=3, y1=m.L - 3, only="paint")


@vehicle("cimarron_sundowner", "Sundowner", "Cimarron", "convertible", "car", (4.8, 1.9, 1.24))
def _(m):
    std_paint(m, (40, 150, 160))
    L, W = m.L, m.W
    zb = 8
    top = [(0, 7), (2, 8), (L - 14, 8), (L - 13, 8), (L - 3, 8), (L - 1, 7)]
    m.body(top, 2, inset=inset_profile(L, (2, 1), (1,)))
    cockpit(m, 12, L - 15, 4, zb, ws_h=4, rake=2, seat="seat_tan", rows=2, inn=2)
    wheels(m, [axle_y(m, 10, 7, True), axle_y(m, 10, 7, False)], 7, 2)
    ends(m, zc=2, zhf=7, ztr=7, bumper="chrome", grille="chrome", gw=3, hl=(1, 5, 5, 7), tl=(1, 4, 5, 7))
    m.skin_side(lambda y, z: z == 7 and 4 <= y < L - 4, "chrome")


@vehicle("scissortail_zephyr", "Zephyr", "Scissortail", "convertible", "car", (3.95, 1.72, 1.22))
def _(m):
    std_paint(m, (196, 40, 40))
    L, W = m.L, m.W
    top = [(0, 6), (3, 7), (L - 14, 7), (L - 4, 6), (L - 1, 5)]
    m.body(top, 2, inset=inset_profile(L, (3, 2, 1), (2, 1)))
    cockpit(m, 11, L - 15, 3, 7, ws_h=3, rake=2, seat="seat", rows=1, inn=2, frame="trim", roll=3)
    wheels(m, [axle_y(m, 8, 6, True), axle_y(m, 8, 6, False)], 6, 2)
    ends(m, zc=2, zhf=5, ztr=6, grille="grille", gw=2, gz=(3, 4), hl=(2, 5, 4, 5), tl=(1, 4, 4, 6))
    top_band(m, W // 2 - 1, W // 2 + 1, "seat_white", y0=L - 13, y1=L - 1, only="paint")


@vehicle("cimarron_thunderhead", "Thunderhead", "Cimarron", "muscle", "car", (4.9, 1.9, 1.34))
def _(m):
    std_paint(m, (222, 98, 28))
    m.define("stripe", ramp((232, 228, 216)))
    c = car(m, hood=16, ws=5, roof=11, rw=5, zb=8, zh=8, zt=8, D=7, tw=3, wf=10, wr=10, pillars=(),
            bumper="chrome", grille="grille", gw=6, hl=(1, 5, 5, 7), tl=(1, 7, 5, 7), rim="rimdark")
    W, L = m.W, m.L
    m.box(L - 12, L - 5, W // 2 - 2, W // 2 + 2, 9, 10, "paint")      # hood scoop
    m.box(L - 6, L - 5, W // 2 - 2, W // 2 + 2, 9, 10, "grille")
    top_band(m, W // 2 - 4, W // 2 - 2, "stripe", only="paint")
    top_band(m, W // 2 + 2, W // 2 + 4, "stripe", only="paint")
    end_band(m, 0, 13, "stripe", front=True, x0=W // 2 - 4, x1=W // 2 - 2, only=None) if False else None


@vehicle("cimarron_dustdevil", "Dust Devil", "Cimarron", "muscle", "car", (4.75, 1.85, 1.32))
def _(m):
    std_paint(m, (36, 112, 64))
    c = car(m, hood=15, ws=5, roof=9, rw=10, zb=8, zh=8, zt=8, ztr=8, D=7, tw=3, wf=10, wr=9, pillars=(),
            hl=(1, 4, 5, 7), tl=(1, 6, 5, 7), rim="rimdark", gw=6)
    L, W = m.L, m.W
    side_band(m, 5, 7, "grille", y0=4, y1=L - 4, only="paint")              # side stripe
    m.box(0, 2, 1, W - 1, 9, 10, "paint")                                    # ducktail spoiler lip
    for k in range(c["by0"], c["ry0"], 2):                                   # rear-window louvres
        m.paint(k, k + 1, 3, W - 3, 0, m.H, "grille", only="glass")


@vehicle("cimarron_haymaker", "Haymaker", "Cimarron", "muscle", "car", (5.0, 1.96, 1.42))
def _(m):
    std_paint(m, (96, 40, 140))
    m.define("stripe", ramp((24, 24, 30)))
    c = car(m, hood=15, ws=7, roof=10, rw=7, zb=9, zh=8, zt=9, ztr=8, zr=13, D=7, tw=3, wf=10, wr=10, pillars=(),
            hl=(1, 5, 6, 7), tl=(1, 8, 7, 8), gw=7, gz=(3, 6), rim="rimdark")
    L, W = m.L, m.W
    top_band(m, W // 2 - 3, W // 2 - 1, "stripe", only="paint")
    top_band(m, W // 2 + 1, W // 2 + 3, "stripe", only="paint")
    m.box(1, 3, 2, 4, 10, 13, "trim")                 # wing posts
    m.box(1, 3, W - 4, W - 2, 10, 13, "trim")
    m.box(0, 3, 1, W - 1, 13, 14, "paint")           # wing


@vehicle("scissortail_kestrel", "Kestrel", "Scissortail", "sports", "car", (4.4, 1.85, 1.26))
def _(m):
    std_paint(m, (36, 86, 196))
    car(m, hood=13, ws=7, roof=8, rw=7, zb=7, zh=6, zt=7, ztr=7, D=7, wf=8, wr=8, pillars=(), nose=(3, 2, 1),
        tail=(2, 1), gw=4, gz=(2, 4), hl=(1, 5, 4, 5), tl=(1, 6, 5, 6), rim="rimdark", tw=3)


@vehicle("scissortail_peregrine", "Peregrine", "Scissortail", "sports", "car", (4.35, 1.92, 1.2))
def _(m):
    std_paint(m, (150, 188, 40))
    c = car(m, hood=10, ws=7, roof=7, rw=10, zb=7, zh=5, zhf=4, zt=7, ztr=7, D=7, wf=8, wr=8, pillars=(),
            nose=(4, 2, 1), tail=(2, 1), grille=None, hl=(2, 6, 3, 4), tl=(1, 8, 5, 6), rim="rimdark", tw=3,
            nose_drop=2)
    L, W = m.L, m.W
    m.skin_side(lambda y, z: c["by0"] - 4 <= y < c["by0"] + 1 and 4 <= z < 7, "grille")   # side intakes
    for k in range(c["by0"] - 8, c["by0"] - 1, 2):
        m.paint(k, k + 1, 4, W - 4, 0, m.H, "grille", only="paint", tone=0) if False else m.skin_top(
            lambda y, x, k=k: y == k and 4 <= x < W - 4, "grille")


@vehicle("keystone_rapier", "Rapier", "Keystone", "sports", "car", (4.75, 1.96, 1.3))
def _(m):
    std_paint(m, (84, 96, 108))
    car(m, hood=17, ws=6, roof=8, rw=8, zb=8, zh=7, zt=8, ztr=7, D=7, wf=10, wr=9, pillars=(), nose=(3, 1),
        tail=(2, 1), grille="grille", gw=4, gz=(3, 5), hl=(1, 5, 5, 6), tl=(1, 5, 5, 7), rim="chrome", tw=3)


@vehicle("derecho_anvil", "Anvil", "Derecho Automobili", "super", "car", (4.5, 2.0, 1.1))
def _(m):
    std_paint(m, (204, 28, 32))
    c = car(m, hood=12, ws=9, roof=6, rw=7, zb=6, zh=5, zhf=3, zt=6, ztr=6, D=7, tw=3, wf=8, wr=8, pillars=(),
            nose=(3, 2, 1), tail=(1,), grille=None, hl=(2, 6, 2, 3), tl=(1, 9, 4, 6), rim="rimdark",
            in0=3, in1=4, nose_drop=2, hl_top=0, tl_top=2)
    L, W = m.L, m.W
    for k in range(c["by0"] - 10, c["by0"], 2):                             # engine louvres
        m.skin_top(lambda y, x, k=k: y == k and 3 <= x < W - 3, "grille")
    m.skin_top(lambda y, x: L - 7 <= y < L - 4 and (2 <= x < 6 or W - 6 <= x < W - 2), "trim")  # pop-up lids
    m.skin_side(lambda y, z: c["by0"] - 2 <= y < c["by0"] + 3 and 3 <= z < 6, "grille")
    m.box(0, 3, 1, W - 1, 7, 8, "paint")                                    # rear wing (flat)
    m.box(1, 3, 3, 5, 6, 7, "trim")
    m.box(1, 3, W - 5, W - 3, 6, 7, "trim")


@vehicle("derecho_downburst", "Downburst", "Derecho Automobili", "super", "car", (4.7, 2.06, 1.2))
def _(m):
    std_paint(m, (30, 32, 40))
    m.define("accent", ramp((240, 120, 20)))
    c = car(m, hood=12, ws=8, roof=7, rw=8, zb=6, zh=5, zhf=3, zt=6, ztr=6, zr=10, D=7, tw=3, wf=8, wr=8,
            pillars=(), nose=(4, 2, 1), tail=(2, 1), grille=None, hl=(2, 6, 2, 4), tl=(1, 10, 4, 5),
            rim="accent", in0=3, in1=4, nose_drop=2, tl_top=0)
    L, W = m.L, m.W
    m.skin_side(lambda y, z: c["by0"] - 3 <= y < c["by0"] + 3 and 2 <= z < 6, "grille")
    side_band(m, 2, 3, "accent", y0=8, y1=L - 8, only="paint")
    top_band(m, W // 2 - 1, W // 2 + 1, "accent", only="paint")
    m.box(1, 3, 4, 6, 7, 11, "trim")                                        # swan-neck wing posts
    m.box(1, 3, W - 6, W - 4, 7, 11, "trim")
    m.box(0, 4, 0, W, 11, 12, "paint")                                      # big wing
    m.box(0, 1, 0, W, 11, 12, "accent")


@vehicle("bluedome_bajito", "Bajito", "Blue Dome Motors", "lowrider", "car", (5.4, 2.0, 1.32))
def _(m):
    std_paint(m, (134, 36, 156))
    m.define("gold", ramp((214, 168, 60)))
    c = car(m, hood=15, ws=5, roof=14, rw=5, zb=7, zh=7, zhf=6, zt=7, ztr=6, zc=1, D=6, tw=2, wf=11, wr=11,
            pillars=(0.55,), bumper="chrome", grille="chrome", gw=4, gz=(3, 6), hl=(1, 4, 4, 6), tl=(1, 4, 4, 6),
            rim="gold", hub=0.75, in0=2, in1=3, bz=(1, 3))
    L, W = m.L, m.W
    z, a, b, i = c["layers"][-1]
    m.paint(a, b + 1, 0, W, z, z + 1, "seat_white", only="paint")        # white top
    side_band(m, 5, 6, "gold", y0=5, y1=L - 5, only="paint")             # pinstripe


@vehicle("motherroad_jetfin", "Jetfin", "Mother Road Motor Co.", "classic", "car", (5.6, 2.02, 1.46))
def _(m):
    std_paint(m, (64, 186, 176))
    c = car(m, hood=16, ws=6, roof=13, rw=5, zb=9, zh=9, zhf=8, zt=9, ztr=9, zr=13, D=7, tw=2, wf=12, wr=13,
            pillars=(0.5,), bumper="chrome", grille="chrome", gw=7, gz=(3, 6), hl=(1, 4, 6, 8), tl=(0, 2, 9, 12),
            rim="seat_white", hub=0.8, in0=2, in1=3, tail=(), tl_top=0)
    L, W = m.L, m.W
    # tail fins rising at the rear corners
    for y in range(0, 14):
        h = 9 + int(round(3 * (1 - y / 14)))
        m.box(y, y + 1, 0, 2, 9, h + 1, "paint")
        m.box(y, y + 1, W - 2, W, 9, h + 1, "paint")
    m.box(0, 2, 0, 2, 10, 13, "tail")
    m.box(0, 2, W - 2, W, 10, 13, "tail")
    z, a, b, i = c["layers"][-1]
    m.paint(a, b + 1, 0, W, z, z + 1, "seat_white", only="paint")
    m.skin_side(lambda y, z_: 5 <= z_ <= 7 and 4 <= y <= 20 and z_ - 5 <= (y - 4) // 6, "seat_white")  # side cove
    side_band(m, 8, 9, "chrome", y0=3, y1=L - 3, only="paint")


@vehicle("speedshop_highboy", "Highboy", "Brookside Speed Shop", "hotrod", "car", (3.9, 1.76, 1.4))
def _(m):
    std_paint(m, (32, 30, 40))
    m.define("flame1", ramp((240, 110, 24)))
    m.define("flame2", ramp((250, 200, 60)))
    L, W, H = m.L, m.W, m.H
    bx0, bx1 = 3, W - 3                      # narrow body between exposed wheels
    m.box(4, 12, bx0, bx1, 4, 10, "paint")          # rear body / tub
    m.box(10, 22, bx0, bx1, 4, 9, "paint")          # cab lower
    cabin(m, 11, 21, 13, 20, 8, 13, in0=bx0, in1=bx0 + 1, pillars=(), rglass=False, roof_rows=1)
    m.box(21, 34, bx0 + 1, bx1 - 1, 4, 8, "paint")  # hood/engine bay sides
    m.box(22, 31, bx0 + 2, bx1 - 2, 8, 10, "engine")   # exposed engine
    m.box(24, 29, bx0 + 3, bx1 - 3, 10, 12, "chrome")  # blower
    m.box(25, 28, bx0 + 3, bx1 - 3, 12, 13, "grille")  # scoop
    m.box(32, 36, bx0 + 1, bx1 - 1, 3, 9, "chrome")    # grille shell
    m.box(34, 36, bx0 + 2, bx1 - 2, 4, 8, "grille")
    m.box(2, 34, bx0 + 1, bx1 - 1, 2, 4, "trim")       # frame rails
    # big rear wheels, skinny fronts, all exposed
    wheel(m, 7.5, 8, 3, rim="chrome", well=False)
    wheel(m, L - 5.5, 6, 2, rim="chrome", well=False, e=1)
    m.box(L - 3, L - 1, bx0, bx1, 5, 7, "chrome")      # front axle / headlight bar
    m.box(L - 3, L - 1, bx0, bx0 + 2, 7, 9, "head")
    m.box(L - 3, L - 1, bx1 - 2, bx1, 7, 9, "head")
    m.box(0, 2, bx0, bx0 + 2, 6, 8, "tail")
    m.box(0, 2, bx1 - 2, bx1, 6, 8, "tail")
    m.box(2, 4, bx0, bx1, 6, 9, "paint")
    # flames licking back along the cab sides and engine bay
    m.skin_side(lambda y, z: 20 <= y <= 34 and 4 <= z <= 7 and (y + z) % 5 < 3 and y - 20 > (7 - z) * 2, "flame1")
    m.skin_side(lambda y, z: 24 <= y <= 34 and 5 <= z <= 6 and (y + z) % 5 == 0, "flame2")


@vehicle("speedshop_rustbucket", "Rust Bucket", "Brookside Speed Shop", "ratrod", "car", (4.4, 1.8, 1.28))
def _(m):
    L, W, H = m.L, m.W, m.H
    bx0, bx1 = 2, W - 2
    m.box(2, 14, 1, W - 1, 3, 7, "rust")          # bed
    m.box(3, 13, 2, W - 2, 4, 7, None)
    m.box(3, 13, 2, W - 2, 3, 4, "wood")
    m.box(14, 24, bx0, bx1, 3, 8, "primer")        # cab lower
    cabin(m, 14, 23, 15, 22, 7, 11, in0=bx0, in1=bx0, pillars=(), rglass=False, mat="primer", glass="glassdark",
          roof_rows=1)
    m.box(14, 23, bx0, bx1, 11, 12, "rust")         # chopped roof
    m.box(24, 36, 4, W - 4, 4, 9, "engine")         # exposed engine
    m.box(26, 34, 5, W - 5, 9, 10, "chrome")
    m.box(30, 32, 2, 4, 6, 12, "dsteel")            # zoomie pipes
    m.box(30, 32, W - 4, W - 2, 6, 12, "dsteel")
    m.box(36, 41, 4, W - 4, 3, 9, "rust")           # grille shell
    m.box(39, 41, 5, W - 5, 4, 8, "grille")
    m.box(1, 42, 4, W - 4, 2, 3, "dsteel")          # frame
    wheel(m, 7.5, 8, 3, rim="rimdark", well=False)
    wheel(m, L - 6.5, 7, 2, rim="rimdark", well=False, e=1)
    m.box(L - 3, L - 1, 3, 6, 6, 8, "head")
    m.box(L - 3, L - 1, W - 6, W - 3, 6, 8, "head")
    m.box(0, 2, 2, 4, 5, 7, "tail")
    m.box(0, 2, W - 4, W - 2, 5, 7, "tail")
    m.box(0, 2, 4, W - 4, 4, 6, "dsteel")
    m.skin_top(lambda y, x: (x * 7 + y * 3) % 11 == 0 and 14 <= y < 24, "rust")


def with_front(m, build, ext):
    """Build a body `ext` px shorter (into a child model) and paste it at the back, leaving room at the
    front for a push bar / bumper guard. Returns (child, builder result)."""
    c = sub(m, L=m.L - ext)
    r = build(c)
    paste(m, c)
    return c, r


def push_bar(m, z0, z1, ext=2, mat="trim", half=4):
    """Police push bar in the `ext` px reserved at the front: two uprights + two cross bars."""
    L, W = m.L, m.W
    cx = W // 2
    m.box(L - ext, L, cx - half - 1, cx - half + 1, z0, z1, mat)
    m.box(L - ext, L, cx + half - 1, cx + half + 1, z0, z1, mat)
    m.box(L - ext, L, cx - half - 1, cx + half + 1, z0 + 1, z0 + 3, mat)
    m.box(L - ext, L, cx - half - 1, cx + half + 1, z1 - 2, z1, mat)


def badge(m, y0, z0, mat="gold"):
    """Small 3x3 door star painted on both sides."""
    m.skin_side(lambda y, z: (y0 <= y < y0 + 3 and z == z0 + 1) or (y == y0 + 1 and z0 <= z < z0 + 3), mat)


STD["gold"] = (ramp((210, 166, 56)), "solid")
STD["stripe_w"] = (ramp((222, 224, 228)), "solid")
STD["mud"] = (ramp((112, 84, 56)), "solid")


@vehicle("arkvalley_carpool", "Carpool", "Arkansas Valley", "minivan", "car", (5.15, 1.99, 1.76))
def _(m):
    std_paint(m, (128, 146, 168))
    c = car(m, hood=8, ws=9, roof=30, rw=2, zb=9, zh=8, zhf=7, zt=9, ztr=8, D=7, wf=9, wr=9, pillars=(0.22, 0.62),
            tl=(1, 3, 8, 13), tl_top=2, hl=(1, 5, 5, 7), gw=4, gz=(3, 5))
    roof_rails(m, c["ry0"] + 2, c["ry1"] - 2, m.H - 1, e=3) if False else None
    m.skin_side(lambda y, z: z == 13 and c["ry0"] + 4 <= y <= c["ry1"] - 12, "trim")   # sliding door track


@vehicle("prairie_nester", "Nester", "Prairie", "minivan", "car", (4.85, 1.9, 1.7))
def _(m):
    std_paint(m, (36, 112, 114))
    car(m, hood=7, ws=11, roof=25, rw=2, zb=8, zh=7, zhf=6, zt=8, ztr=8, D=6, wf=8, wr=8, pillars=(0.3, 0.68),
        tl=(1, 3, 7, 12), tl_top=2, hl=(1, 5, 4, 6), gw=4, gz=(3, 4))
    side_band(m, 3, 7, "wood", y0=6, y1=m.L - 8, only="paint")


@vehicle("osage_wren", "Wren", "Osage Motor Works", "crossover", "car", (4.4, 1.82, 1.62))
def _(m):
    std_paint(m, (172, 92, 52))
    car(m, hood=9, ws=7, roof=18, rw=4, zb=10, zh=9, zt=10, ztr=9, zc=3, D=7, wf=8, wr=7, pillars=(0.45,),
        lower_paint=(2, "trim"), hl=(1, 5, 7, 8), tl=(1, 4, 8, 10), gw=4, gz=(4, 7), tl_top=2)


@vehicle("verdigris_heron", "Heron EV", "Verdigris", "crossover", "car", (4.75, 1.94, 1.64))
def _(m):
    std_paint(m, (140, 176, 198))
    car(m, hood=9, ws=9, roof=18, rw=6, zb=10, zh=9, zt=10, ztr=9, zc=3, D=7, wf=9, wr=8, pillars=(0.45,),
        grille=None, roofmat="glassdark", hl=(1, 9, 7, 8), tl=(1, 10, 8, 9), tl_top=2, lower_paint=(1, "trim"))


@vehicle("redfork_outrider", "Outrider", "Red Fork", "suv", "car", (5.35, 2.04, 1.93))
def _(m):
    std_paint(m, (46, 84, 60))
    c = car(m, hood=13, ws=5, roof=31, rw=1, zb=12, zh=11, zhf=11, zt=12, ztr=11, zc=3, zr=17, D=8, tw=3, wf=11,
            wr=11, pillars=(0.25, 0.55), grille="chrome", gw=6, gz=(6, 10), hl=(1, 5, 8, 10), tl=(0, 2, 9, 15),
            tl_top=2, bz=(3, 6), nose=(1,), tail=(1,), round_roof=True)
    roof_rails(m, c["ry0"] + 2, c["ry1"] - 1, 18, e=3, bars=(c["ry0"] + 6, c["ry1"] - 6))
    side_band(m, 3, 4, "trim", y0=c["yr"] + 5, y1=c["yf"] - 5)                   # running boards


@vehicle("keystone_chancellor", "Chancellor", "Keystone", "suv", "car", (5.4, 2.06, 1.95))
def _(m):
    std_paint(m, (30, 32, 42))
    c = car(m, hood=14, ws=5, roof=30, rw=1, zb=12, zh=12, zhf=11, zt=12, ztr=11, zc=3, D=8, tw=3, wf=11, wr=11,
            pillars=(0.25, 0.55), grille="chrome", gw=7, gz=(5, 11), hl=(1, 4, 9, 11), tl=(0, 3, 10, 14),
            tl_top=2, bz=(3, 5), bumper="chrome", rim="chrome", nose=(1,), tail=(1,), frame="chrome")
    side_band(m, 12, 13, "chrome", y0=3, y1=m.L - 3, only="paint")
    side_band(m, 3, 4, "chrome", y0=c["yr"] + 5, y1=c["yf"] - 5)


@vehicle("redfork_mudcat", "Mudcat", "Red Fork", "offroad", "car", (4.2, 1.92, 2.0))
def _(m):
    std_paint(m, (192, 160, 102))
    L, W = m.L, m.W
    c = car(m, hood=11, ws=3, roof=24, rw=0, zb=11, zh=11, zhf=10, zt=11, ztr=11, zc=4, zr=18, D=9, tw=3, wf=8,
            wr=7, in0=1, in1=1, pillars=(0.38,), nose=(1,), tail=(), rglass=False, round_roof=False, gw=5,
            gz=(6, 10), hl=(2, 5, 8, 10), tl=(0, 2, 8, 11), bumper="trim", bz=(3, 6), tl_top=0, rim="rimdark")
    m.paint(c["by0"], c["by0"] + 1, 3, W - 3, 13, 17, "glass")                    # rear window
    m.cyl_y(0, 2, (W - 1) / 2, 10, 4.2, 4.2, "tire")                              # spare wheel
    m.cyl_y(0, 1, (W - 1) / 2, 10, 2.0, 2.0, "rimdark")
    m.box(c["ry1"] - 3, c["ry1"] - 1, 1, W - 1, 19, 20, "trim")                   # roof light bar
    for x in range(2, W - 2, 3):
        m.box(c["ry1"] - 2, c["ry1"] - 1, x, x + 2, 19, 20, "lamp")
    m.box(c["by1"] - 3, c["by1"] - 1, W - 2, W, 11, 19, "trim")                   # snorkel
    for yc in (c["yf"], c["yr"]):                                                 # fender flares
        m.skin_side(lambda y, z, yc=yc: abs(y - yc) <= 6 and z in (9, 10) and abs(y - yc) >= 3, "trim")


@vehicle("keystone_regalia", "Regalia Stretch", "Keystone", "limo", "car", (8.6, 1.98, 1.48))
def _(m):
    std_paint(m, (214, 216, 220))
    c = car(m, hood=15, ws=6, roof=48, rw=5, zb=9, zh=9, zhf=8, zt=9, D=7, wf=11, wr=11,
            pillars=(0.12, 0.35, 0.62, 0.88), glass="glassdark", bumper="chrome", grille="chrome", gw=3, gz=(4, 8),
            hl=(1, 5, 6, 8), tl=(1, 4, 6, 8), rim="chrome")
    side_band(m, 8, 9, "chrome", y0=4, y1=m.L - 4, only="paint")


@vehicle("keystone_repose", "Repose", "Keystone", "hearse", "car", (5.95, 2.0, 1.6))
def _(m):
    std_paint(m, (28, 28, 36))
    m.define("curtain", ramp((170, 160, 150)))
    c = car(m, hood=15, ws=6, roof=30, rw=1, zb=9, zh=9, zhf=8, zt=9, zr=15, D=7, wf=11, wr=12, pillars=(0.18,),
            side_from=None, bumper="chrome", grille="chrome", gw=3, gz=(4, 8), hl=(1, 5, 6, 8), tl=(1, 3, 6, 12),
            tl_top=2, rim="chrome", round_roof=True)
    L = m.L
    cut = c["ry1"] - 9
    m.paint(0, cut, 0, m.W, 10, 15, "paint", only="glass")                      # solid rear compartment
    m.skin_side(lambda y, z: cut - 9 <= y < cut - 3 and 11 <= z < 14, "curtain")  # small curtained window
    # chrome landau bars (S shape) on the rear quarter
    m.skin_side(lambda y, z: 4 <= y < cut - 11 and ((z == 13 and y < cut - 14) or (y - 4) == 2 * (13 - z) and z >= 10), "chrome")


@vehicle("pecan_fairway", "Fairway", "Pecan Valley Carts", "cart", "car", (2.45, 1.22, 1.8))
def _(m):
    std_paint(m, (214, 214, 206))
    m.define("roof", ramp((58, 118, 72)))
    L, W, H = m.L, m.W, m.H
    m.body([(0, 5), (L - 9, 5), (L - 6, 7), (L - 2, 7), (L - 1, 6)], 2, y0=2, y1=L, inset=[(0, 0), (L - 3, 0), (L - 1, 1)])
    m.box(8, 13, 1, W - 1, 6, 8, "seat_white")                 # bench
    m.box(6, 8, 1, W - 1, 6, 11, "seat_white")                 # backrest
    m.box(L - 8, L - 6, 3, 6, 8, 10, "trim")                   # steering wheel (driver = +x... left seat)
    for y0 in (3, L - 6):                                      # roof posts
        m.box(y0, y0 + 2, 0, 2, 5, 16, "trim")
        m.box(y0, y0 + 2, W - 2, W, 5, 16, "trim")
    m.box(L - 6, L - 4, 2, W - 2, 9, 15, "glass")              # windshield
    m.box(1, L - 1, 0, W, 16, 17, "roof")                      # canopy
    m.box(2, L - 2, 1, W - 1, 17, 18, "roof")
    m.box(0, 4, 3, W - 3, 4, 6, "dsteel")                      # bag rack
    m.disc_z(2.5, (W - 1) / 2, 2.2, 6, 12, "canvas")           # golf bag
    m.box(1, 4, W // 2 - 1, W // 2 + 1, 12, 14, "chrome")      # clubs
    wheels(m, [3.5, L - 4.5], 4, 2, well=False)
    m.box(L - 1, L, 2, 4, 5, 6, "head")
    m.box(L - 1, L, W - 4, W - 2, 5, 6, "head")
    m.box(2, 3, 1, 3, 3, 5, "tail")
    m.box(2, 3, W - 3, W - 1, 3, 5, "tail")


@vehicle("prairie_fleetline_cab", "Fleetline Cab", "Prairie", "taxi", "car", (5.2, 1.92, 1.68),
         livery=True)
def _(m):
    m.define("paint", ramp((236, 182, 28)))
    m.define("checkb", ramp((34, 34, 40)))
    m.define("sign", ramp((226, 222, 210)))
    c = car(m, hood=13, ws=6, roof=15, rw=5, zb=9, zh=9, zhf=8, zt=9, ztr=8, zr=14, D=7, wf=10, wr=11,
            pillars=(0.5,), hl=(1, 5, 6, 8), tl=(1, 4, 6, 8), gw=4, rim="rimdark")
    m.skin_side(lambda y, z: z in (6, 7) and 6 <= y < m.L - 6 and ((y // 2 + z) % 2 == 0), "checkb")
    yc = (c["ry0"] + c["ry1"]) // 2
    m.cbox(yc - 2, yc + 2, 4, 15, 17, "sign")
    m.cbox(yc - 1, yc + 1, 3, 16, 17, "lamp")
    badge(m, c["ry1"] - 1, 4, "checkb")


@vehicle("osage_ledger_police", "Ledger Police", "Osage Motor Works", "police", "car", (5.55, 1.98, 1.62),
         livery=True)
def _(m):
    m.define("paint", ramp((30, 30, 38)))
    def b(c):
        return car(c, hood=14, ws=6, roof=15, rw=5, zb=9, zh=9, zhf=8, zt=9, zr=14, D=7, wf=11, wr=12, gw=5,
                   grille="grille", hl=(1, 5, 6, 8), tl=(1, 5, 6, 8), rim="rimdark", hub=0.4)
    c, r = with_front(m, b, 2)
    push_bar(m, 3, 9)
    W = m.W
    # white doors + roof
    m.skin_side(lambda y, z: r["ry0"] - 2 <= y <= r["by1"] - 1 and 3 <= z <= 13, "stripe_w", only=["paint"])
    z, a, b_, i = r["layers"][-1]
    m.paint(a, b_ + 1, 0, W, z, z + 1, "stripe_w", only="paint")
    badge(m, r["ry1"] - 2, 5, "gold")
    yc = (r["ry0"] + r["ry1"]) // 2 + 2
    light_bar(m, yc - 1, yc + 2, 15, 2, 0)
    m.box(r["by1"] - 2, r["by1"], W - 2, W, 11, 13, "chrome")                 # spotlight


@vehicle("redfork_outrider_police", "Outrider Police", "Red Fork", "police", "car", (5.55, 2.04, 2.03),
         livery=True)
def _(m):
    m.define("paint", ramp((218, 220, 226)))
    m.define("navy", ramp((30, 50, 110)))
    def b(c):
        return car(c, hood=13, ws=5, roof=31, rw=1, zb=12, zh=11, zhf=11, zt=12, ztr=11, zc=3, zr=18, D=8, tw=3,
                   wf=11, wr=11, pillars=(0.25, 0.55), grille="grille", gw=6, gz=(6, 10), hl=(1, 5, 8, 10),
                   tl=(0, 2, 9, 15), tl_top=2, bz=(3, 6), nose=(1,), tail=(1,), rim="rimdark", hub=0.4)
    c, r = with_front(m, b, 2)
    push_bar(m, 4, 12)
    side_band(m, 5, 9, "navy", y0=3, y1=m.L - 3, only="paint")
    side_band(m, 10, 11, "navy", y0=3, y1=m.L - 3, only="paint")
    badge(m, r["ry1"] - 3, 5, "gold")
    yc = r["ry1"] - 6
    light_bar(m, yc - 1, yc + 2, 19, 2, 0)


@vehicle("cimarron_pursuit", "Haymaker Pursuit", "Cimarron", "police", "car", (5.2, 1.96, 1.5), livery=True)
def _(m):
    m.define("paint", ramp((62, 66, 74)))
    m.define("ghost", ramp((76, 80, 92)))
    def b(c):
        return car(c, hood=15, ws=7, roof=10, rw=7, zb=9, zh=8, zt=9, ztr=8, zr=13, D=7, tw=3, wf=10, wr=10,
                   pillars=(), hl=(1, 5, 6, 7), tl=(1, 8, 7, 8), gw=7, gz=(3, 6), rim="rimdark")
    c, r = with_front(m, b, 2)
    push_bar(m, 3, 8, half=3)
    side_band(m, 4, 7, "ghost", y0=8, y1=m.L - 10, only="paint")
    yc = (r["ry0"] + r["ry1"]) // 2
    light_bar(m, yc - 1, yc + 2, 14, 3, 0)


@vehicle("osage_meridian_detective", "Meridian Detective", "Osage Motor Works", "police", "car", (5.05, 1.85, 1.5),
         livery=True)
def _(m):
    m.define("paint", ramp((112, 106, 92)))
    def b(c):
        return car(c, hood=12, ws=6, roof=14, rw=5, zb=9, zh=8, zt=9, zr=14, D=7, wf=10, wr=10, rim="rimdark",
                   hub=0.35)
    c, r = with_front(m, b, 2)
    push_bar(m, 3, 8, half=3)
    W = m.W
    by1 = r["by1"]
    m.skin_top(lambda y, x: by1 - 1 <= y <= by1 and 4 <= x < W // 2 - 1, "sirenr")     # dash lights
    m.skin_top(lambda y, x: by1 - 1 <= y <= by1 and W // 2 + 1 <= x < W - 4, "sirenb")
    m.box(2, 4, 3, 5, 10, 12, "trim")                                                   # trunk antennas
    m.box(2, 4, W - 5, W - 3, 10, 12, "trim")
    m.box(by1 - 2, by1, W - 2, W, 10, 12, "chrome")                                     # spotlight


@vehicle("cimarron_lawman", "Lawman Trooper", "Cimarron", "police", "car", (5.25, 1.95, 1.48), livery=True)
def _(m):
    m.define("paint", ramp((150, 156, 166)))
    m.define("navy", ramp((28, 40, 86)))
    def b(c):
        return car(c, hood=14, ws=7, roof=13, rw=6, zb=9, zh=8, zt=9, ztr=8, D=7, tw=3, wf=10, wr=10,
                   pillars=(0.5,), hl=(1, 5, 6, 7), tl=(1, 8, 7, 8), gw=6, gz=(3, 6), rim="rimdark")
    c, r = with_front(m, b, 2)
    push_bar(m, 3, 8, half=3)
    W = m.W
    side_band(m, 4, 8, "navy", y0=3, y1=m.L - 3, only="paint")
    side_band(m, 8, 9, "gold", y0=3, y1=m.L - 3, only="paint")
    badge(m, r["ry1"] - 2, 4, "gold")
    by1, by0 = r["by1"], r["by0"]
    m.skin_top(lambda y, x: by1 - 2 <= y <= by1 - 1 and 3 <= x < W // 2, "sirenr")      # slicktop lightbars
    m.skin_top(lambda y, x: by1 - 2 <= y <= by1 - 1 and W // 2 <= x < W - 3, "sirenb")
    m.skin_top(lambda y, x: by0 + 1 <= y <= by0 + 2 and 3 <= x < W // 2, "sirenb")
    m.skin_top(lambda y, x: by0 + 1 <= y <= by0 + 2 and W // 2 <= x < W - 3, "sirenr")
    m.box(by1 - 2, by1, W - 2, W, 10, 12, "chrome")
    m.box(by1 - 2, by1, 0, 2, 10, 12, "chrome")


def pickup(m, *, cab, hood, ws=5, zb, zh=None, zhf=None, zc, D, tw=3, wf, wr, floor, wall=2, bed_in=0, in0=1,
           in1=2, zr=None, pillars=(0.45,), nose=(1,), hl=None, gw=6, gz=None, bz=None, grille="chrome",
           bumper="chrome", rim="rim", plan=None, we=0, wer=None, twr=None, Dr=None, rear_window=True,
           tl_h=4, hub=0.5, round_roof=True, bed=True):
    """Pickup: car body with a short roof (the cab) and a hollow bed (2px walls) behind it."""
    W = m.W
    c = car(m, hood=hood, ws=ws, roof=cab, rw=0, zb=zb, zh=zh, zhf=zhf, zt=zb, ztr=zb, zc=zc, zr=zr, in0=in0,
            in1=in1, D=D, tw=tw, wf=wf, wr=wr, nose=nose, tail=(), pillars=pillars, rglass=False, tl=(0, 0, 0, 0),
            tl_top=0, bumper=bumper, bz=bz, grille=grille, gz=gz, gw=gw, hl=hl, rim=rim, plan=plan, we=we,
            wer=wer, twr=twr, Dr=Dr, hub=hub, round_roof=round_roof)
    by0 = c["by0"]
    if bed:
        m.box(wall, by0 - 1, bed_in + wall, W - bed_in - wall, floor + 1, zb + 1, None)
        m.box(wall, by0 - 1, bed_in + wall, W - bed_in - wall, floor, floor + 1, "liner")
        m.box(0, wall, bed_in + 3, W - bed_in - 3, zb - 1, zb - 0, "paint", tone=-1, only="paint")  # tailgate seam
    if rear_window:
        m.paint(by0, by0 + 1, in1 + 2, W - in1 - 2, zb + 2, c["zr"] - 1, "glass")
    rear_lights(m, bed_in, bed_in + wall, zb - tl_h, zb)
    m.skin_top(lambda y, x: y < 2 and (bed_in <= x < bed_in + wall or W - bed_in - wall <= x < W - bed_in), "tail")
    c["bed"] = (wall, by0 - 2)
    return c


@vehicle("redfork_roughneck", "Roughneck", "Red Fork", "pickup", "car", (5.9, 2.03, 1.95))
def _(m):
    std_paint(m, (168, 38, 36))
    pickup(m, cab=17, hood=16, zb=12, zh=12, zhf=11, zc=4, D=9, wf=12, wr=13, floor=6, hl=(1, 5, 9, 11),
           gz=(6, 10), bz=(3, 6))


@vehicle("redfork_roustabout", "Roustabout", "Red Fork", "workpickup", "car", (5.75, 2.0, 2.3))
def _(m):
    std_paint(m, (214, 216, 220))
    W = m.W
    c = pickup(m, cab=10, hood=16, zb=12, zh=12, zhf=11, zc=4, zr=19, D=9, wf=12, wr=14, floor=6, pillars=(),
               hl=(1, 5, 9, 11), gz=(6, 10), bz=(3, 6), grille="grille", bumper="trim", rim="rimdark", hub=0.4)
    y0, y1 = 2, c["by0"] - 3
    for yy in (y0, y1):                                   # ladder rack posts
        m.box(yy, yy + 2, 0, 2, 12, 21, "dsteel")
        m.box(yy, yy + 2, W - 2, W, 12, 21, "dsteel")
        m.box(yy, yy + 2, 0, W, 20, 21, "dsteel")
    m.box(y0, c["ry1"] - 1, 0, 2, 20, 21, "dsteel")         # side rails reaching over the cab
    m.box(y0, c["ry1"] - 1, W - 2, W, 20, 21, "dsteel")
    m.box(c["ry1"] - 3, c["ry1"] - 1, 0, W, 20, 21, "dsteel")
    m.box(y0 - 2, c["ry1"] + 2, 4, 9, 21, 22, "steel")       # extension ladder
    m.box(y0 + 4, c["ry1"] - 4, W - 8, W - 4, 21, 22, "steel")
    for k in range(y0, c["ry1"] + 2, 3):
        m.tone(k, k + 1, 5, 8, 21, 22, -1)
    m.box(c["by0"] - 4, c["by0"] - 1, 2, W - 2, 12, 13, "chrome")   # crossover toolbox
    m.box(c["ry1"] - 1, c["ry1"] + 1, W // 2 - 2, W // 2 + 2, 20, 21, "amber")


@vehicle("prairie_jackrabbit", "Jackrabbit", "Prairie", "compactpickup", "car", (4.75, 1.7, 1.6))
def _(m):
    std_paint(m, (56, 108, 168))
    pickup(m, cab=11, hood=12, zb=9, zh=9, zhf=8, zc=3, D=7, tw=2, wf=9, wr=10, floor=4, in0=1, in1=2, pillars=(),
           hl=(1, 4, 6, 8), gw=4, gz=(5, 7), bz=(2, 4), grille="grille", bumper="trim", tl_h=3)
    side_band(m, 7, 8, "stripe_w", y0=3, y1=m.L - 4, only="paint")


@vehicle("sooner_bigiron", "Big Iron 3500 Dually", "Sooner Truck Co.", "hdpickup", "car", (6.5, 2.42, 2.05))
def _(m):
    std_paint(m, (32, 50, 94))
    L, W = m.L, m.W
    yr = 15
    plan = [(0, 3), (yr - 8, 3), (yr - 7, 0), (yr + 7, 0), (yr + 8, 3), (L - 2, 3), (L - 1, 4)]
    c = pickup(m, cab=17, hood=17, zb=13, zh=13, zhf=12, zc=4, D=9, wf=13, wr=yr, floor=6, bed_in=3, in0=4,
               in1=5, hl=(4, 8, 9, 11), gz=(6, 11), gw=6, bz=(3, 6), we=3, wer=0, twr=6, plan=plan, rim="chrome")
    m.box(yr - 7, yr + 8, 0, 3, 11, 14, None)                  # flare tops step down below the bed rail
    m.box(yr - 7, yr + 8, W - 3, W, 11, 14, None)
    m.cbox(c["bed"][0] + 8, c["bed"][0] + 10, 1, 7, 8, "chrome")    # gooseneck ball
    for x in (W // 2 - 4, W // 2 - 1, W // 2 + 2):
        m.box(c["ry1"] - 1, c["ry1"] + 1, x, x + 2, c["zr"], c["zr"] + 1, "amber")


@vehicle("redfork_mudbogger", "Mud Bogger", "Red Fork", "lifted", "car", (5.9, 2.4, 2.7))
def _(m):
    std_paint(m, (112, 172, 40))
    L, W = m.L, m.W
    plan = [(0, 2), (L - 2, 2), (L - 1, 3)]
    c = pickup(m, cab=16, hood=16, zb=19, zh=19, zhf=18, zc=11, zr=25, D=12, tw=4, wf=12, wr=12, floor=13,
               bed_in=2, in0=3, in1=4, hl=(3, 7, 16, 18), gz=(13, 17), gw=6, bz=(10, 13), plan=plan, we=0,
               grille="grille", bumper="trim", rim="rimdark", hub=0.45)
    m.box(c["yr"] - 1, c["yf"] + 2, 5, W - 5, 4, 11, "dsteel")         # exposed lift kit / frame
    m.box(c["yr"] - 2, c["yr"] + 2, 3, W - 3, 4, 7, "dsteel")
    m.box(c["yf"] - 2, c["yf"] + 2, 3, W - 3, 4, 7, "dsteel")
    m.box(c["ry1"] - 3, c["ry1"] - 1, 3, W - 3, 26, 27, "trim")         # light bar
    for x in range(4, W - 4, 3):
        m.box(c["ry1"] - 2, c["ry1"] - 1, x, x + 2, 26, 27, "lamp")
    m.skin_side(lambda y, z: z < 15 and ((y * 7 + z * 13) % 9 in (0, 4)), "mud", only=["paint", "tire", "trim"])


@vehicle("sooner_farmhand", "Farmhand Flatbed", "Sooner Truck Co.", "farmtruck", "car", (6.2, 2.2, 2.05))
def _(m):
    std_paint(m, (156, 56, 44))
    L, W, H = m.L, m.W, m.H
    cy0, cy1 = 26, 38                                   # cab
    m.box(cy0, cy1, 2, W - 2, 4, 11, "paint")
    cabin(m, cy0, cy1, cy0, cy1 - 3, 10, 19, in0=2, in1=3, pillars=(), rglass=False)
    m.paint(cy0, cy0 + 1, 6, W - 6, 13, 17, "glass")
    m.body([(cy1, 11), (L - 4, 10), (L - 2, 9), (L - 1, 8)], 4, y0=cy1, y1=L, x0=4, x1=W - 4)  # hood
    yf = L - 9.5
    for s0, s1 in ((0, 5), (W - 5, W)):                 # round front fenders
        m.body([(int(yf) - 6, 6), (int(yf) - 4, 9), (int(yf) + 4, 9), (int(yf) + 6, 7)], 5, y0=int(yf) - 6,
               y1=int(yf) + 7, x0=s0, x1=s1)
    m.box(L - 2, L, 5, W - 5, 4, 9, "chrome")            # grille
    m.box(L - 1, L, 2, W - 2, 3, 5, "chrome")            # bumper
    m.box(1, cy0, 0, W, 6, 8, "wood")                    # flatbed deck
    m.box(1, cy0, 3, W - 3, 4, 6, "dsteel")              # frame
    for y in (1, 9, 17, cy0 - 3):                        # stake posts
        m.box(y, y + 2, 0, 2, 8, 12, "wood")
        m.box(y, y + 2, W - 2, W, 8, 12, "wood")
    # square hay bales, two layers + a top row
    for (z0, ys, xs) in ((8, range(2, cy0 - 1, 6), ((2, 11), (11, 20))), (12, range(3, cy0 - 2, 6), ((2, 11), (11, 20))),
                         (16, range(6, cy0 - 6, 6), ((6, 15),))):
        for y in ys:
            for xa, xb in xs:
                m.box(y, min(y + 6, cy0 - 1), xa, xb, z0, z0 + 4, "hay")
                m.tone(y, y + 1, xa, xb, z0, z0 + 4, -1)
                m.tone(y, y + 6, xa, xa + 1, z0, z0 + 4, -1)
    wheel(m, yf, 8, 3, rim="rimdark", e=0)
    wheel(m, 7.5, 8, 3, rim="rimdark", e=0)
    m.box(L - 3, L - 1, 1, 4, 7, 9, "head")
    m.box(L - 3, L - 1, W - 4, W - 1, 7, 9, "head")
    m.box(0, 2, 0, 3, 5, 7, "tail")
    m.box(0, 2, W - 3, W, 5, 7, "tail")


@vehicle("redfork_cattleman", "Cattleman", "Red Fork", "ranchtruck", "car", (5.5, 2.0, 2.1))
def _(m):
    std_paint(m, (176, 150, 108))
    W = m.W
    c = pickup(m, cab=12, hood=16, ws=4, zb=12, zh=12, zhf=12, zc=4, zr=19, D=8, wf=11, wr=12, floor=6,
               nose=(), round_roof=False, pillars=(), hl=(2, 6, 9, 11), gz=(6, 11), gw=6, bz=(3, 6),
               rim="rimdark", hub=0.45)
    side_band(m, 8, 11, "stripe_w", y0=2, y1=m.L - 2, only="paint")
    hy = c["by0"] - 3
    m.box(hy, hy + 2, 0, 2, 12, 20, "dsteel")             # headache rack
    m.box(hy, hy + 2, W - 2, W, 12, 20, "dsteel")
    m.box(hy, hy + 2, 0, W, 19, 20, "dsteel")
    m.box(hy, hy + 2, 0, W, 15, 16, "dsteel")
    # round bale riding in the bed, axis across the truck
    yc, zc_, r = (c["bed"][0] + hy) / 2, 13.5, 7.0
    for y in range(m.L):
        for z in range(m.H):
            d = math.hypot(y - yc, z - zc_)
            if d <= r:
                m.box(y, y + 1, 3, W - 3, z, z + 1, "hay", tone=(-1 if 3.5 < d < 4.6 else 0))


@vehicle("motherroad_stepside", "Stepside", "Mother Road Motor Co.", "classicpickup", "car", (4.85, 1.95, 1.85))
def _(m):
    std_paint(m, (224, 194, 96))
    L, W, H = m.L, m.W, m.H
    cy0, cy1 = 18, 30
    yf, yr = L - 8.5, 8.5
    m.box(cy0, cy1, 2, W - 2, 4, 11, "paint")
    cabin(m, cy0, cy1, cy0 + 1, cy1 - 3, 10, 17, in0=2, in1=3, pillars=(), rglass=False)
    m.paint(cy0, cy0 + 1, 6, W - 6, 12, 15, "glass")
    m.body([(cy1, 11), (L - 5, 10), (L - 2, 9), (L - 1, 8)], 4, y0=cy1, y1=L, x0=4, x1=W - 4)
    for yc in (yf, yr):
        for s0, s1 in ((0, 5), (W - 5, W)):
            m.body([(int(yc) - 6, 5), (int(yc) - 4, 8), (int(yc) + 4, 8), (int(yc) + 6, 6)], 5, y0=int(yc) - 6,
                   y1=int(yc) + 7, x0=s0, x1=s1)
    m.box(2, cy0 - 1, 4, W - 4, 4, 10, "paint")          # narrow stepside bed
    m.box(4, cy0 - 1, 6, W - 6, 6, 10, None)
    m.box(4, cy0 - 1, 6, W - 6, 5, 6, "wood")
    m.box(int(yr) + 6, int(yf) - 6, 1, 4, 3, 4, "trim")  # running boards
    m.box(int(yr) + 6, int(yf) - 6, W - 4, W - 1, 3, 4, "trim")
    m.box(L - 2, L, 6, W - 6, 4, 9, "chrome")
    m.box(L - 1, L, 1, W - 1, 3, 5, "chrome")
    m.box(0, 2, 1, W - 1, 3, 5, "chrome")
    wheel(m, yf, 7, 2, rim="seat_white", hub=0.8, e=0)
    wheel(m, yr, 7, 2, rim="seat_white", hub=0.8, e=0)
    m.box(L - 6, L - 3, 1, 4, 8, 10, "head")
    m.box(L - 6, L - 3, W - 4, W - 1, 8, 10, "head")
    m.box(2, 4, 2, 4, 7, 9, "tail")
    m.box(2, 4, W - 4, W - 2, 7, 9, "tail")


@vehicle("redfork_bassrig", "Roughneck + Bass Boat", "Red Fork", "towrig", "car", (12.4, 2.3, 1.95))
def _(m):
    std_paint(m, (150, 154, 164))
    m.define("hull", ramp((196, 30, 44)))
    m.define("carpet", ramp((92, 96, 104)))
    L, W = m.L, m.W
    t = sub(m, L=59, W=21)
    pickup(t, cab=17, hood=16, zb=12, zh=12, zhf=11, zc=4, D=9, wf=12, wr=13, floor=6, hl=(1, 5, 9, 11),
           gz=(6, 10), bz=(3, 6))
    paste(m, t, y0=L - 59, x0=1)
    ty = L - 59
    # trailer: tongue, frame, fenders, wheels
    m.box(ty - 8, ty + 1, W // 2 - 1, W // 2 + 1, 3, 5, "dsteel")
    m.box(2, ty - 7, 3, W - 3, 2, 4, "dsteel")
    wheel(m, 26, 5, 2, rim="rim", well=False, e=1)
    m.box(20, 33, 0, 3, 5, 6, "dsteel")
    m.box(20, 33, W - 3, W, 5, 6, "dsteel")
    m.box(2, 4, 0, 2, 3, 5, "tail")
    m.box(2, 4, W - 2, W, 3, 5, "tail")
    # bass boat sitting on the trailer: bow toward the truck
    bl = 58
    for y in range(0, bl):
        f = y / (bl - 1)
        ins = 0 if f < 0.62 else int(round((f - 0.62) / 0.38 * 9))
        m.box(y, y + 1, 1 + ins, W - 1 - ins, 6, 11, "hull")
        m.box(y, y + 1, 4 + ins, W - 4 - ins, 4, 6, "hull")
    side_band(m, 9, 10, "chrome", y0=2, y1=bl - 4, only="hull")
    m.box(2, bl - 6, 3, W - 3, 11, 12, "carpet")
    m.box(2, bl - 6, 3, W - 3, 10, 11, "hull") if False else None
    m.box(28, 32, 3, 9, 11, 14, "trim")                  # console + windscreen
    m.box(31, 32, 3, 9, 14, 15, "glass")
    m.box(22, 26, 4, 9, 11, 14, "seat_white")             # seats
    m.box(22, 26, W - 9, W - 4, 11, 14, "seat_white")
    m.box(0, 4, W // 2 - 3, W // 2 + 3, 6, 14, "trim")    # outboard cowling
    m.box(1, 3, W // 2 - 1, W // 2 + 1, 2, 6, "trim")


STD["boxwhite"] = (ramp((214, 216, 218)), "solid")
STD["tank"] = (ramp((168, 176, 186)), "solid")
STD["crane"] = (ramp((232, 176, 28)), "solid")
STD["orange"] = (ramp((232, 108, 28)), "solid")
STD["redstripe"] = (ramp((196, 32, 36)), "solid")
STD["bluestripe"] = (ramp((36, 70, 160)), "solid")
STD["greenstripe"] = (ramp((30, 130, 96)), "solid")
STD["hazard"] = (ramp((236, 196, 30)), "solid")
STD["gravel"] = (ramp((150, 136, 118)), "solid")
STD["pipe"] = (ramp((92, 88, 86)), "solid")
STD["hose"] = (ramp((222, 200, 60)), "solid")
STD["dish"] = (ramp((206, 208, 212)), "solid")
STD["pink"] = (ramp((236, 140, 176)), "solid")
STD["babyblue"] = (ramp((120, 176, 228)), "solid")
STD["waffle"] = (ramp((206, 150, 80)), "solid")
STD["cherry"] = (ramp((190, 24, 40)), "solid")
STD["stopsign"] = (ramp((196, 28, 36)), "solid")


def rbox(m, y0, y1, x0, x1, z0, z1, mat, r=1, tone=0, ends=True):
    """Box with its top edges bevelled by r px so it reads rounded."""
    m.box(y0, y1, x0, x1, z0, z1, mat, tone)
    for k in range(r):
        z = z1 - 1 - k
        e = r - k
        m.box(y0, y1, x0, x0 + e, z, z + 1, None)
        m.box(y0, y1, x1 - e, x1, z, z + 1, None)
        if ends:
            m.box(y0, y0 + e, x0, x1, z, z + 1, None)
            m.box(y1 - e, y1, x0, x1, z, z + 1, None)


def windows(m, y0, y1, z0, z1, pitch=6, pil=1, mat="glass", which="both", off=0, only="*"):
    m.skin_side(lambda y, z: y0 <= y < y1 and z0 <= z < z1 and ((y - y0 + off) % pitch) >= pil, mat, which=which,
                only=only)


def conv_front(m, *, hood, cab, cin, hin, zc, zh, zb, zr, D, wf, tw=3, ws=2, mat="paint", grille="chrome",
               bumper="chrome", hl=None, side_len=8, sleeper=0, zs=None, front=None, we=0, rim="rim",
               rear_win=True, fender=True, bz=None):
    """Conventional truck front: hood + fenders + cab (+ sleeper). Returns key positions."""
    W = m.W
    front = m.L - 1 if front is None else front
    yh0 = front - hood + 1
    cy1 = yh0 - 1
    cy0 = cy1 - cab + 1
    m.body([(yh0, zh), (front - 2, zh), (front, zh - 1)], zc, y0=yh0, y1=front + 1, x0=hin, x1=W - hin, mat=mat)
    m.box(cy0, cy1 + 1, cin, W - cin, zc, zb + 1, mat)
    cabin(m, cy0, cy1, cy0, cy1 - ws, zb, zr, in0=cin, in1=cin, pillars=(), rglass=False, mat=mat,
          side_from=cy1 - side_len, round_roof=True)
    if sleeper:
        zs = zs or zr
        rbox(m, cy0 - sleeper, cy0 + 2, cin, W - cin, zc, zs + 1, mat, r=1)
    elif rear_win:
        m.paint(cy0, cy0 + 1, cin + 3, W - cin - 3, zb + 2, zr - 1, "glass")
    yc = front - wf + (0.5 if D % 2 == 0 else 0)
    r = D / 2
    if fender:
        y0, y1 = int(yc - r - 2), int(yc + r + 3)
        for s0, s1 in ((0, hin + 1), (W - hin - 1, W)):
            m.body([(y0, D - 1), (y0 + 2, D + 1), (y1 - 3, D + 1), (y1 - 1, D - 1)], int(r), y0=y0, y1=y1, x0=s0,
                   x1=s1, mat=mat)
    wheel(m, yc, D, tw, e=we, rim=rim)
    bz = bz or (zc - 1, zc + 2)
    m.box(front - 1, front + 1, 0, W, bz[0], bz[1], bumper)
    if grille:
        m.paint(front - 1, front + 1, hin + 1, W - hin - 1, bz[1], zh - 1, grille)
    hl = hl or (bz[1], bz[1] + 2)
    m.box(front - 2, front + 1, 0, 3, hl[0], hl[1], "head")
    m.box(front - 2, front + 1, W - 3, W, hl[0], hl[1], "head")
    return dict(cy0=cy0, cy1=cy1, yh0=yh0, yc=yc, front=front)


def stacks(m, y0, z0, z1, e=1):
    W = m.W
    m.box(y0, y0 + 2, e, e + 2, z0, z1, "chrome")
    m.box(y0, y0 + 2, W - e - 2, W - e, z0, z1, "chrome")


def roof_markers(m, y, z, n=5, mat="amber"):
    W = m.W
    for k in range(n):
        x = W // 2 - (n * 3) // 2 + k * 3
        m.box(y - 1, y + 1, x, x + 2, z, z + 1, mat)


def van(m, *, hood=8, ws=7, zb=10, zh=10, zhf=9, zc=2, zr=None, D=7, tw=2, wf=9, wr=11, side_from=None,
        pillars=(), in0=1, in1=2, hl=(1, 4, 6, 8), tl=(0, 2, 8, 16), gw=4, gz=(4, 7), twr=None, rim="rim"):
    L = m.L
    by1 = L - 1 - hood
    ry1 = by1 - ws
    c = car(m, hood=hood, ws=ws, roof=ry1, rw=0, zb=zb, zh=zh, zhf=zhf, zt=zb, ztr=zb, zc=zc, zr=zr, D=D, tw=tw,
            wf=wf, wr=wr, in0=in0, in1=in1, pillars=pillars, tail=(), nose=(2, 1), rglass=False,
            side_from=side_from if side_from is not None else ry1 - 8, hl=hl, tl=tl, tl_top=2, gw=gw, gz=gz,
            twr=twr, rim=rim)
    W = m.W
    m.paint(c["by0"], c["by0"] + 1, 3, W - 3, c["zr"] - 6, c["zr"] - 2, "glass")      # rear door windows
    m.tone(c["by0"], c["by0"] + 1, W // 2, W // 2 + 1, zc + 2, c["zr"] - 1, -1)
    return c


@vehicle("arkvalley_cargo", "Cargo", "Arkansas Valley", "van", "car", (5.95, 2.03, 2.1))
def _(m):
    std_paint(m, (214, 216, 220))
    c = van(m)
    m.skin_side(lambda y, z: y == c["ry1"] - 12 and 4 <= z < 19, "paint", tone=-1, which="lo", only="paint")
    m.skin_side(lambda y, z: y in (c["ry1"] - 14, c["ry1"] - 13) and z == 12, "trim", which="lo")


@vehicle("arkvalley_fellowship", "Fellowship 15", "Arkansas Valley", "churchvan", "car", (6.4, 2.02, 2.2))
def _(m):
    std_paint(m, (210, 212, 216))
    c = van(m, side_from=0, pillars=(0.16, 0.36, 0.56, 0.76, 0.93), wr=12)
    side_band(m, 8, 9, "bluestripe", y0=2, y1=m.L - 3, only="paint")
    side_band(m, 7, 8, "redstripe", y0=2, y1=m.L - 3, only="paint")


@vehicle("arkvalley_newsvan", "Eyewitness Unit", "Arkansas Valley", "newsvan", "car", (6.1, 2.03, 3.1), livery=True)
def _(m):
    m.define("paint", ramp((214, 216, 220)))
    c = van(m, zr=20)
    L, W = m.L, m.W
    side_band(m, 6, 9, "bluestripe", y0=2, y1=L - 3, only="paint")
    side_band(m, 9, 10, "redstripe", y0=2, y1=L - 3, only="paint")
    m.skin_side(lambda y, z: 30 <= y < 40 and 12 <= z < 18 and (y - 30) // 3 % 2 == 0, "bluestripe", only="paint")
    roof_rails(m, 4, c["ry1"] - 2, 21, e=2, mat="dsteel", bars=(8, 30))
    m.box(10, c["ry1"] - 4, W // 2 - 1, W // 2 + 1, 22, 24, "steel")          # folded mast
    m.box(6, 12, W // 2 - 2, W // 2 + 2, 21, 25, "dsteel")                    # mast base
    yc, xc, zc0, r = 22.0, (W - 1) / 2, 26.0, 6.5                            # dish, tilted toward the back
    a = math.radians(50)
    n = (0.0, -math.sin(a), math.cos(a))
    for z in range(21, m.H):
        for y in range(m.L):
            for x in range(W):
                v = (x - xc, y - yc, z - zc0)
                d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]
                rr = math.sqrt(max(0.0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - d * d))
                if abs(d) <= 1.1 and rr <= r:
                    m.box(y, y + 1, x, x + 1, z, z + 1, "dish", tone=(-1 if rr > r - 1.2 else 0))
    m.box(int(yc) - 1, int(yc) + 1, W // 2 - 1, W // 2 + 1, 21, 26, "dsteel")
    m.box(int(yc) - 3, int(yc), W // 2 - 1, W // 2 + 1, 26, 29, "trim")       # feed horn


@vehicle("arkvalley_tactical", "Tactical Response", "Arkansas Valley", "swat", "truck", (6.6, 2.45, 2.85),
         livery=True)
def _(m):
    m.define("paint", ramp((40, 42, 48)))
    m.define("band", ramp((90, 94, 104)))
    L, W, H = m.L, m.W, m.H
    m.body([(2, 12), (L - 14, 12), (L - 12, 15), (L - 3, 13), (L - 1, 11)], 4, y0=1, y1=L, inset=[(0, 0), (L - 2, 0), (L - 1, 1)])
    rbox(m, 2, L - 12, 0, W, 12, H - 1, "paint", r=1)
    m.skin_end(lambda x, z: 2 <= x < W - 2 and 16 <= z < 22, "glassdark", front=True, depth=1)
    windows(m, L - 20, L - 14, 18, 21, pitch=7, pil=1, mat="glassdark")
    windows(m, 10, 50, 19, 21, pitch=10, pil=7, mat="glassdark")
    side_band(m, 11, 13, "band", only="paint")
    m.box(L - 2, L, 0, W, 3, 9, "dsteel")                               # ram bumper
    m.box(L - 2, L, 3, 6, 9, 12, "dsteel")
    m.box(L - 2, L, W - 6, W - 3, 9, 12, "dsteel")
    roof_rails(m, 4, L - 16, H - 1, e=1, mat="dsteel")
    m.box(20, 26, W // 2 - 3, W // 2 + 3, H - 1, H, "trim")             # roof hatch
    light_bar(m, L - 16, L - 13, H - 1, 3, 0)
    m.box(0, 2, 3, W - 3, 4, 6, "dsteel")                               # rear step
    m.tone(2, 3, W // 2, W // 2 + 1, 6, H - 2, -1)
    m.box(L - 2, L, 1, 4, 9, 11, "head")
    m.box(L - 2, L, W - 4, W - 1, 9, 11, "head")
    rear_lights(m, 0, 3, 8, 12)
    wheel(m, L - 10.5, 10, 3)
    wheel(m, 12.5, 10, 4)


@vehicle("sooner_strongbox", "Strongbox", "Sooner Truck Co.", "armored", "truck", (6.5, 2.45, 2.85), livery=True)
def _(m):
    m.define("paint", ramp((100, 118, 118)))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=12, cab=10, cin=2, hin=4, zc=4, zh=13, zb=14, zr=22, D=10, wf=9, side_len=6,
                   rear_win=False, grille="grille", bumper="dsteel")
    rbox(m, 1, c["cy0"] + 1, 0, W, 4, H, "paint", r=1)
    side_band(m, 8, 10, "bluestripe", y0=1, y1=c["cy0"] + 1, only="paint")
    windows(m, 8, c["cy0"] - 2, 18, 20, pitch=14, pil=11, mat="glassdark")
    m.skin_side(lambda y, z: z == 14 and y in (10, 11, 26, 27, 40, 41), "grille")     # gun ports
    m.box(1, 2, W // 2 - 1, W // 2 + 1, 6, H - 2, "paint", tone=-1)
    m.box(c["cy0"] - 4, c["cy0"] - 2, W // 2 - 1, W // 2 + 1, H - 1, H, "amber")
    rear_lights(m, 0, 3, 7, 11)
    wheel(m, 12.5, 10, 4)


@vehicle("arkvalley_medic", "Medic One", "Arkansas Valley", "ambulance", "truck", (7.0, 2.42, 2.95), livery=True)
def _(m):
    m.define("paint", ramp((220, 222, 226)))
    L, W, H = m.L, m.W, m.H
    t = sub(m, W=20)
    c = car(t, hood=8, ws=7, roof=12, rw=0, zb=11, zh=11, zhf=10, zt=11, ztr=11, zc=3, zr=20, D=8, tw=3, wf=9,
            wr=13, in0=1, in1=2, pillars=(), tail=(), rglass=False, hl=(1, 4, 7, 9), tl=(0, 0, 0, 0), tl_top=0,
            gw=4, gz=(5, 8), twr=4, hub=0.4)
    paste(m, t, x0=2)
    b1 = c["ry0"] + 2
    rbox(m, 1, b1, 0, W, 4, H, "paint", r=1)
    wheel(m, axle_y(m, 13, 8, False), 8, 4, hub=0.4)
    side_band(m, 10, 13, "redstripe", y0=1, y1=L - 2, only="paint")
    side_band(m, 13, 14, "orange", y0=1, y1=b1, only="paint")
    m.skin_side(lambda y, z: (y in (20, 21) and 17 <= z < 23) or (17 <= y < 25 and z in (19, 20)), "bluestripe")
    windows(m, b1 - 8, b1 - 2, 18, 23, pitch=10, pil=4, mat="glassdark")
    for y0 in (b1 - 3, 1):                                     # corner beacons, front and rear of the box
        m.box(y0, y0 + 2, 0, 3, H - 2, H, "sirenr")
        m.box(y0, y0 + 2, W - 3, W, H - 2, H, "sirenr")
    m.box(b1 - 3, b1 - 1, W // 2 - 2, W // 2 + 2, H - 1, H, "sirenw")
    rear_lights(m, 0, 3, 6, 10)
    m.tone(1, 2, W // 2, W // 2 + 1, 6, H - 2, -1)
    light_bar(m, c["ry1"] - 3, c["ry1"] - 1, 21, 3, 0, cols=("sirenr", "sirenr"), mid="sirenw") if False else None


@vehicle("sooner_box16", "Box 16", "Sooner Truck Co.", "boxtruck", "truck", (8.2, 2.45, 3.4))
def _(m):
    std_paint(m, (36, 92, 170))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=10, cab=11, cin=1, hin=3, zc=4, zh=12, zb=13, zr=22, D=10, wf=9, side_len=8,
                   rear_win=False, grille="grille", bumper="trim")
    rbox(m, 1, c["cy0"] - 1, 0, W, 6, H, "boxwhite", r=1)
    m.box(4, c["cy0"], 4, W - 4, 4, 6, "dsteel")
    side_band(m, 7, 10, "paint", y0=1, y1=c["cy0"] - 1, only="boxwhite")
    for z in range(9, H - 2, 3):                                      # roll-up door slats
        m.tone(0, 1, 1, W - 1, z, z + 1, -1)
    rear_lights(m, 0, 2, 7, 11)
    m.box(1, 3, 0, 2, H - 2, H - 1, "amber")
    m.box(1, 3, W - 2, W, H - 2, H - 1, "amber")
    wheel(m, 16.5, 10, 4)


@vehicle("arkvalley_stepper", "Stepper", "Arkansas Valley", "stepvan", "truck", (7.0, 2.4, 3.05), livery=True)
def _(m):
    m.define("paint", ramp((40, 104, 70)))
    m.define("cream", ramp((222, 208, 170)))
    L, W, H = m.L, m.W, m.H
    m.body([(L - 7, 11), (L - 3, 10), (L - 1, 8)], 3, y0=L - 8, y1=L, x0=1, x1=W - 1)
    rbox(m, 1, L - 7, 0, W, 3, H, "paint", r=2)
    m.box(L - 8, L - 7, 2, W - 2, 12, 24, "glass")
    m.box(L - 8, L - 7, 2, W - 2, 24, 26, "paint")
    side_band(m, 8, 13, "cream", only="paint")
    m.skin_top(lambda y, x: True, "cream", only="paint")
    m.skin_side(lambda y, z: L - 15 <= y < L - 8 and 5 <= z < 25, "interior", which="lo")      # open doorway
    m.skin_side(lambda y, z: L - 15 <= y < L - 8 and 15 <= z < 24, "glass", which="hi")
    m.box(L - 2, L, 0, W, 2, 5, "trim")
    m.box(L - 2, L, 1, 4, 7, 9, "head")
    m.box(L - 2, L, W - 4, W - 1, 7, 9, "head")
    rear_lights(m, 0, 2, 6, 10)
    m.tone(1, 2, W // 2, W // 2 + 1, 4, H - 3, -1)
    wheel(m, L - 11.5, 9, 3)
    wheel(m, 13.5, 9, 4)


@vehicle("arkvalley_sundae", "Sundae Driver", "Arkansas Valley", "icecream", "truck", (6.4, 2.3, 3.15), livery=True)
def _(m):
    m.define("paint", ramp((224, 226, 230)))
    L, W, H = m.L, m.W, m.H
    m.body([(L - 9, 12), (L - 4, 11), (L - 1, 9)], 3, y0=L - 10, y1=L, x0=1, x1=W - 1)
    rbox(m, 1, L - 9, 0, W, 3, 26, "paint", r=2)
    m.box(L - 10, L - 9, 2, W - 2, 13, 21, "glass")
    side_band(m, 4, 7, "babyblue", only="paint")
    side_band(m, 22, 25, "pink", only="paint")
    m.skin_side(lambda y, z: 20 <= y < 36 and 12 <= z < 19, "interior", which="lo")          # serving window
    m.skin_side(lambda y, z: 19 <= y < 37 and z in (19, 20) and (y // 2) % 2 == 0, "pink", which="lo")
    m.skin_side(lambda y, z: 8 <= y < 44 and 8 <= z < 12 and (y // 3) % 3 != 2, "babyblue", which="hi")
    for k, col in enumerate(("pink", "waffle", "babyblue", "cherry")):                          # menu decals
        m.skin_side(lambda y, z, k=k: 40 + k * 4 <= y < 43 + k * 4 and 9 <= z < 12, col, which="lo")
    cy, cx = 30.5, (W - 1) / 2                                                              # giant cone
    for z in range(26, 30):
        m.disc_z(cy, cx, 1.6 + (z - 26) * 0.7, z, z + 1, "waffle")
    for z, r in ((30, 3.6), (31, 2.6)):
        m.disc_z(cy, cx, r, z, z + 1, "pink")
    m.box(int(cy), int(cy) + 2, W // 2 - 1, W // 2 + 1, 31, 32, "cherry")
    m.box(L - 2, L, 0, W, 2, 5, "chrome")
    m.box(L - 2, L, 1, 4, 7, 9, "head")
    m.box(L - 2, L, W - 4, W - 1, 7, 9, "head")
    rear_lights(m, 0, 2, 6, 10)
    wheel(m, L - 12, 9, 3)
    wheel(m, 13, 9, 3)


@vehicle("sooner_smokehouse", "Smokehouse BBQ", "Sooner Truck Co.", "foodtruck", "truck", (7.6, 2.45, 3.2),
         livery=True)
def _(m):
    m.define("paint", ramp((170, 32, 30)))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=9, cab=10, cin=1, hin=3, zc=4, zh=12, zb=13, zr=22, D=9, wf=8, side_len=8,
                   rear_win=False, grille="grille", bumper="trim")
    b0 = 13
    rbox(m, b0, c["cy0"] - 1, 0, W, 6, 30, "paint", r=1)
    m.box(2, c["cy0"], 4, W - 4, 4, 6, "dsteel")
    side_band(m, 6, 9, "grille", y0=b0, y1=c["cy0"] - 1, only="paint")
    side_band(m, 9, 11, "wood", y0=b0, y1=c["cy0"] - 1, only="paint")
    m.skin_side(lambda y, z: 26 <= y < 44 and 14 <= z < 22, "interior", which="lo")
    m.skin_side(lambda y, z: 25 <= y < 45 and z in (22, 23) and (y // 2) % 2 == 0, "stripe_w", which="lo")
    m.skin_side(lambda y, z: 26 <= y < 44 and z == 13, "chrome", which="lo")
    m.box(1, b0, 3, W - 3, 4, 6, "dsteel")                                   # rear platform
    m.cyl_y(1, b0 - 1, (W - 1) / 2, 11, 4.5, 4.5, "grille")                  # barrel smoker
    m.box(1, 5, W // 2 - 4, W // 2 + 4, 6, 15, "grille")                     # firebox
    m.box(2, 4, W // 2 - 1, W // 2 + 1, 15, 25, "dsteel")                    # chimney
    rear_lights(m, 0, 3, 4, 6)
    wheel(m, 18.5, 9, 4)


@vehicle("sooner_wrecker", "Wrecker", "Sooner Truck Co.", "wrecker", "truck", (7.0, 2.42, 2.9))
def _(m):
    std_paint(m, (186, 32, 34))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=14, cab=11, cin=1, hin=3, zc=4, zh=13, zb=14, zr=22, D=9, wf=10, side_len=8)
    cy0 = c["cy0"]
    m.box(4, cy0, 3, W - 3, 4, 7, "dsteel")
    m.box(6, cy0 - 1, 0, 6, 5, 14, "paint")                                  # side tool boxes
    m.box(6, cy0 - 1, W - 6, W, 5, 14, "paint")
    for y in range(9, cy0 - 1, 7):
        m.tone(y, y + 1, 0, W, 6, 13, -1, only="paint")
    m.box(cy0 - 9, cy0 - 1, W // 2 - 3, W // 2 + 3, 7, 16, "dsteel")         # boom base
    for y in range(2, cy0 - 5):                                              # boom rising to the rear
        z = int(round(15 + (cy0 - 6 - y) * 10 / (cy0 - 8)))
        m.box(y, y + 1, W // 2 - 1, W // 2 + 2, z, z + 2, "crane")
    m.box(1, 3, W // 2 - 1, W // 2 + 1, 16, 25, "dsteel")                    # cable + hook
    m.box(0, 5, 4, W - 4, 3, 5, "dsteel")                                    # wheel lift
    m.box(0, 2, 4, 7, 4, 6, "dsteel")
    m.box(0, 2, W - 7, W - 4, 4, 6, "dsteel")
    light_bar(m, c["cy1"] - 3, c["cy1"] - 1, 23, 3, 0, cols=("amber", "amber"))
    rear_lights(m, 0, 3, 6, 9) if False else None
    m.box(6, 8, 0, 3, 11, 14, "tail")
    m.box(6, 8, W - 3, W, 11, 14, "tail")
    wheel(m, 14, 9, 4)


@vehicle("driller_rigtender", "Rig Tender", "Driller Oilfield Services", "oilfield", "truck", (7.2, 2.45, 3.0),
         livery=True)
def _(m):
    m.define("paint", ramp((218, 220, 224)))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=16, cab=11, cin=1, hin=3, zc=5, zh=14, zb=15, zr=23, D=10, wf=11, side_len=8)
    cy0 = c["cy0"]
    m.box(2, cy0, 0, W, 5, 16, "paint")                                      # service body
    side_band(m, 6, 8, "orange", y0=2, y1=cy0, only="paint")
    for y in range(8, cy0 - 1, 8):
        m.tone(y, y + 1, 0, W, 8, 15, -1, only="paint")
    m.skin_side(lambda y, z: z == 12 and (y - 5) % 8 in (0, 1) and y < cy0 - 2, "chrome")
    m.box(3, 10, W // 2 - 3, W // 2 + 3, 16, 23, "crane")                    # crane pedestal
    m.box(4, cy0 + 7, W // 2 - 2, W // 2 + 2, 24, 27, "crane")               # main boom folded over the cab
    m.box(7, cy0 - 2, W // 2 + 2, W // 2 + 5, 16, 19, "crane")               # knuckle section
    m.box(cy0 + 5, cy0 + 7, W // 2 - 1, W // 2 + 1, 21, 24, "dsteel")        # hook
    m.box(c["cy1"] - 3, c["cy1"] - 1, W // 2 - 4, W // 2 - 2, 24, 25, "amber")
    m.box(2, 4, 0, 3, 7, 10, "tail")
    m.box(2, 4, W - 3, W, 7, 10, "tail")
    wheel(m, 13, 10, 4)


def day_cab(t, colour_mat="paint", sleeper=0):
    """Tractor unit (conventional) built into model t; returns positions."""
    W = t.W
    c = conv_front(t, hood=20, cab=10, cin=1, hin=5, zc=7, zh=18, zb=19, zr=30, D=10, wf=11, side_len=8,
                   rear_win=not sleeper, sleeper=sleeper, zs=36, bz=(5, 9))
    cy0 = c["cy0"]
    t.box(4, cy0, 5, W - 5, 7, 10, "dsteel")                                  # frame
    stacks(t, cy0 - sleeper - 2, 8, min(t.H, 39))
    for x in (0, W - 5):
        t.cyl_y(cy0 - 11, cy0 - 1, x + 2.5, 6, 2.4, 2.4, "chrome")             # fuel tanks
    t.box(8, 18, 6, W - 6, 10, 11, "trim")                                    # fifth wheel
    for yc in (9.5, 21.5):
        wheel(t, yc, 10, 4, rim="chrome")
    t.box(2, 4, 0, 3, 7, 10, "tail")
    t.box(2, 4, W - 3, W, 7, 10, "tail")
    t.box(2, 4, 3, W - 3, 7, 10, "dsteel")
    roof_markers(t, c["cy1"] - 1, 30)
    return c


@vehicle("sooner_longhaul", "Longhaul Sleeper", "Sooner Truck Co.", "semi", "truck", (7.6, 2.6, 4.0))
def _(m):
    std_paint(m, (128, 24, 30))
    c = day_cab(m, sleeper=14)
    m.box(c["cy1"] - 1, c["cy1"] + 1, 1, m.W - 1, 29, 30, "paint")           # sun visor


@vehicle("sooner_longhaul_dryvan", "Longhaul + Dry Van", "Sooner Truck Co.", "semitrailer", "truck",
         (17.6, 2.6, 4.1))
def _(m):
    std_paint(m, (34, 80, 160))
    L, W, H = m.L, m.W, m.H
    t = sub(m, L=62)
    day_cab(t)
    paste(m, t, y0=L - 62)
    tl = 134
    rbox(m, 0, tl, 0, W, 12, H, "boxwhite", r=1)
    m.box(4, tl - 4, 4, W - 4, 10, 12, "dsteel")
    side_band(m, 13, 16, "bluestripe", y0=0, y1=tl, only="boxwhite")
    for y in range(8, tl - 4, 8):
        m.skin_side(lambda yy, z, y=y: yy == y and 16 <= z < H - 2, "boxwhite", tone=-1, only="boxwhite")
    m.tone(0, 1, W // 2, W // 2 + 1, 13, H - 2, -1)
    m.box(tl - 20, tl - 18, 4, 6, 3, 10, "dsteel")                           # landing gear
    m.box(tl - 20, tl - 18, W - 6, W - 4, 3, 10, "dsteel")
    for yc in (10.5, 22.5):
        wheel(m, yc, 10, 4)
    rear_lights(m, 0, 3, 12, 15)


@vehicle("sooner_crudehauler", "Crude Hauler", "Sooner Truck Co.", "tanker", "truck", (16.5, 2.6, 3.7))
def _(m):
    std_paint(m, (222, 224, 228))
    m.define("placard", ramp((206, 40, 36)))
    L, W, H = m.L, m.W, m.H
    t = sub(m, L=62)
    day_cab(t)
    paste(m, t, y0=L - 62)
    y0, y1 = 2, 124
    xc, zc, rx, rz = (W - 1) / 2, 23.5, 12.8, 12.0
    for y in range(y0, y1):
        e = min(y - y0, y1 - 1 - y)
        k = 1.0 if e >= 4 else (0.72 + 0.07 * e)
        m.cyl_y(y, y + 1, xc, zc, rx * k, rz * k, "tank")
    for y in range(y0 + 14, y1 - 4, 18):
        m.tone(y, y + 1, 0, W, 0, H, -1, only="tank")
    m.box(20, 104, W // 2 - 2, W // 2 + 2, H - 1, H, "dsteel")                # walkway
    for yy in (36, 62, 88):
        m.box(yy, yy + 3, W // 2 - 3, W // 2 + 3, H - 1, H, "chrome")
    m.box(2, 30, 5, W - 5, 8, 12, "dsteel")
    m.box(108, 110, 4, 6, 3, 12, "dsteel")
    m.box(108, 110, W - 6, W - 4, 3, 12, "dsteel")
    m.skin_side(lambda y, z: 60 <= y < 63 and 20 <= z < 23, "placard")
    m.skin_end(lambda x, z: W // 2 - 1 <= x <= W // 2 and 20 <= z < 23, "placard", front=False)
    for yc in (10.5, 22.5):
        wheel(m, yc, 10, 4)
    m.box(0, 2, 2, 5, 9, 12, "tail")
    m.box(0, 2, W - 5, W - 2, 9, 12, "tail")
    m.box(0, 2, 5, W - 5, 9, 11, "dsteel")


@vehicle("sooner_pipehauler", "Pipe Hauler", "Sooner Truck Co.", "pipetruck", "truck", (16.0, 2.6, 3.3))
def _(m):
    std_paint(m, (230, 120, 26))
    m.define("cap", ramp((40, 96, 190)))
    L, W, H = m.L, m.W, m.H
    t = sub(m, L=62)
    day_cab(t)
    paste(m, t, y0=L - 62)
    tl = 114
    m.box(0, tl, 0, W, 12, 14, "wood")
    m.box(2, tl - 2, 4, W - 4, 9, 12, "dsteel")
    r = 2.5
    layers = [(16.5, [2.5 + 5 * k for k in range(5)]), (20.8, [5 + 5 * k for k in range(4)]),
              (25.1, [7.5 + 5 * k for k in range(3)])]
    for zc, xs in layers:
        for xc in xs:
            m.cyl_y(2, tl - 2, xc + 0.5, zc, r, r, "pipe")
            m.cyl_y(2, 3, xc + 0.5, zc, r, r, "cap")
            m.cyl_y(tl - 3, tl - 2, xc + 0.5, zc, r, r, "cap")
    for y in (20, 56, 92):                                                    # load straps
        m.paint(y, y + 2, 0, W, 14, H, "hazard", only="pipe")
    for y in range(4, tl - 2, 22):                                            # stakes
        m.box(y, y + 2, 0, 2, 14, 19, "dsteel")
        m.box(y, y + 2, W - 2, W, 14, 19, "dsteel")
    m.box(tl - 18, tl - 16, 4, 6, 3, 9, "dsteel")
    m.box(tl - 18, tl - 16, W - 6, W - 4, 3, 9, "dsteel")
    for yc in (10.5, 22.5):
        wheel(m, yc, 10, 4)
    m.box(0, 2, 0, 3, 10, 12, "tail")
    m.box(0, 2, W - 3, W, 10, 12, "tail")


def fire_cab(m, front, zc=4, ztop=29):
    W = m.W
    y0 = front - 19
    rbox(m, y0, front + 1, 0, W, zc, ztop, "paint", r=1)
    m.skin_end(lambda x, z: 2 <= x < W - 2 and 15 <= z < 26, "glass", front=True)
    windows(m, y0 + 2, front, 16, 26, pitch=9, pil=1)
    m.skin_top(lambda y, x: y0 <= y <= front, "stripe_w", only="paint")
    m.box(front - 4, front - 1, 2, W - 2, ztop, ztop + 1, "sirenr")
    m.box(front - 4, front - 1, W // 2 - 2, W // 2 + 2, ztop, ztop + 1, "sirenw")
    m.box(front + 1, front + 3, 0, W, zc - 1, zc + 3, "chrome")
    m.box(front - 1, front + 1, 1, 4, 6, 8, "head")
    m.box(front - 1, front + 1, W - 4, W - 1, 6, 8, "head")
    m.skin_side(lambda y, z: z == 25 and front - 4 <= y < front - 1, "sirenr")
    return y0


@vehicle("heartland_pumper", "Engine 21", "Heartland Fire Apparatus", "fire", "truck", (10.0, 2.5, 3.3),
         livery=True)
def _(m):
    m.define("paint", ramp((192, 26, 30)))
    L, W, H = m.L, m.W, m.H
    y0 = fire_cab(m, L - 3)
    rbox(m, 2, y0, 0, W, 4, 28, "paint", r=1)
    side_band(m, 12, 14, "stripe_w", y0=2, y1=L - 3, only="paint")
    side_band(m, 6, 7, "chrome", y0=2, y1=y0, only="paint")
    for y in range(6, y0 - 4, 9):
        m.skin_side(lambda yy, z, y=y: yy == y and 7 <= z < 26, "paint", tone=-1, only="paint")
    m.skin_side(lambda y, z: y0 - 4 <= y < y0 and 8 <= z < 26, "chrome")       # pump panel
    m.box(4, 30, 2, W - 2, 26, 28, None)                                     # hose bed
    m.box(4, 30, 2, W - 2, 25, 26, "hose")
    for y in range(5, 30, 3):
        m.tone(y, y + 1, 2, W - 2, 25, 26, -1)
    m.box(30, 78, 2, 4, 28, 29, "chrome")                                    # ground ladder on the roof
    m.box(30, 78, 10, 12, 28, 29, "chrome")
    for y in range(31, 78, 4):
        m.box(y, y + 2, 4, 10, 28, 29, "chrome")
    rear_lights(m, 0, 3, 6, 10)
    m.box(2, 4, 0, 3, 24, 27, "sirenr")
    m.box(2, 4, W - 3, W, 24, 27, "sirenr")
    wheel(m, L - 13, 11, 3)
    wheel(m, 22, 11, 4)


@vehicle("heartland_aerial", "Ladder 7", "Heartland Fire Apparatus", "fire", "truck", (12.2, 2.5, 3.55), livery=True)
def _(m):
    m.define("paint", ramp((192, 26, 30)))
    L, W, H = m.L, m.W, m.H
    y0 = fire_cab(m, L - 3)
    rbox(m, 6, y0, 0, W, 4, 23, "paint", r=1)
    side_band(m, 10, 12, "stripe_w", y0=6, y1=L - 3, only="paint")
    for y in range(10, y0 - 4, 9):
        m.skin_side(lambda yy, z, y=y: yy == y and 6 <= z < 22, "paint", tone=-1, only="paint")
    m.skin_side(lambda y, z: 8 <= y < 14 and 5 <= z < 10 and (y + z) % 4 < 2, "hazard")   # outriggers
    m.skin_side(lambda y, z: y0 - 8 <= y < y0 - 2 and 5 <= z < 10 and (y + z) % 4 < 2, "hazard")
    m.box(0, 6, 4, W - 4, 4, 7, "dsteel")
    m.disc_z(14, (W - 1) / 2, 7.2, 23, 26, "dsteel")                          # turntable
    m.box(9, 19, W // 2 - 4, W // 2 + 4, 26, 30, "paint")
    for y in range(8, L - 4):                                                 # aerial ladder over the cab
        z = 30 if y < 40 else 30 - (0 if y < L - 30 else 0)
        m.box(y, y + 1, W // 2 - 6, W // 2 - 4, z, z + 3, "stripe_w")
        m.box(y, y + 1, W // 2 + 4, W // 2 + 6, z, z + 3, "stripe_w")
    for y in range(12, L - 5, 4):
        m.box(y, y + 2, W // 2 - 4, W // 2 + 4, 30, 31, "chrome")
    m.box(L - 16, L - 14, W // 2 - 1, W // 2 + 1, 29, 30, "dsteel")           # ladder rest
    rear_lights(m, 0, 3, 5, 8) if False else None
    m.box(6, 8, 0, 3, 7, 10, "tail")
    m.box(6, 8, W - 3, W, 7, 10, "tail")
    wheel(m, L - 13, 11, 3)
    wheel(m, 22, 11, 4)
    wheel(m, 34, 11, 4)


@vehicle("sooner_refuser", "Refuser", "Sooner Truck Co.", "garbage", "truck", (9.6, 2.5, 3.6), livery=True)
def _(m):
    m.define("paint", ramp((40, 120, 66)))
    L, W, H = m.L, m.W, m.H
    rbox(m, L - 16, L, 0, W, 3, 25, "stripe_w", r=1)                         # low-entry cab
    m.skin_end(lambda x, z: 2 <= x < W - 2 and 12 <= z < 22, "glass", front=True)
    windows(m, L - 13, L - 2, 13, 22, pitch=12, pil=1)
    m.box(L - 2, L, 0, W, 2, 5, "trim")
    m.box(L - 2, L, 1, 4, 6, 8, "head")
    m.box(L - 2, L, W - 4, W - 1, 6, 8, "head")
    m.box(L - 6, L - 4, W // 2 - 1, W // 2 + 1, 25, 26, "amber")
    rbox(m, 12, L - 16, 0, W, 5, H, "paint", r=2)
    m.box(4, L - 16, 4, W - 4, 3, 5, "dsteel")
    m.body([(0, 20), (11, H - 2), (12, H - 1)], 4, y0=0, y1=12, mat="paint")  # tailgate / hopper
    m.skin_end(lambda x, z: 4 <= x < W - 4 and 7 <= z < 15, "interior", front=False)
    m.tone(11, 12, 0, W, 4, H, -1)
    side_band(m, 5, 7, "stripe_w", y0=0, y1=L - 16, only="paint")
    m.box(0, 2, 0, 3, 16, 19, "tail")
    m.box(0, 2, W - 3, W, 16, 19, "tail")
    m.box(13, 15, W // 2 - 1, W // 2 + 1, H - 1, H, "amber") if False else None
    wheel(m, L - 9, 10, 3)
    wheel(m, 22, 10, 4)
    wheel(m, 33, 10, 4)


@vehicle("arbuckle_churn", "Churn Mixer", "Arbuckle Heavy", "mixer", "truck", (9.4, 2.5, 3.85), livery=True)
def _(m):
    m.define("paint", ramp((206, 210, 218)))
    m.define("drum", ramp((228, 110, 28)))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=8, cab=11, cin=1, hin=3, zc=5, zh=15, zb=16, zr=26, D=11, wf=8, side_len=8,
                   rear_win=False, grille="grille", bumper="dsteel")
    cy0 = c["cy0"]
    m.box(2, cy0, 4, W - 4, 5, 9, "dsteel")
    ya, yb = 8, cy0 - 3
    xc = (W - 1) / 2
    for y in range(ya, yb):
        f = (y - ya) / (yb - ya - 1)
        zc = 18.5 + 5.5 * (1 - f)
        r = 11.6 * min(1.0, 0.55 + 2.2 * f, 0.62 + 1.6 * (1 - f))
        for x in range(W):
            for z in range(H):
                dx, dz = x - xc, z - zc
                if dx * dx + dz * dz <= r * r:
                    ang = math.atan2(dz, dx)
                    band = int((y + ang * 9 / math.pi) // 5) % 2
                    m.v[z, y, x] = m.mid("drum" if band else "stripe_w")
    m.box(yb - 4, yb, W // 2 - 4, W // 2 + 4, 9, 16, "dsteel")              # drum pedestals
    m.box(6, 12, W // 2 - 4, W // 2 + 4, 9, 18, "dsteel")
    m.box(1, 7, W // 2 - 4, W // 2 + 4, 27, H, "drum")                       # hopper
    m.box(2, 6, W // 2 - 3, W // 2 + 3, H - 1, H, None)
    m.box(0, 4, W // 2 - 2, W // 2 + 2, 15, 19, "dsteel")                    # chute
    m.box(3, 5, W // 2 + 6, W // 2 + 8, 9, 30, "dsteel")                     # ladder
    m.box(0, 2, 0, W, 6, 8, "dsteel")                                        # rear bumper bar
    m.box(0, 2, 0, 3, 7, 10, "tail")
    m.box(0, 2, W - 3, W, 7, 10, "tail")
    wheel(m, 15.5, 10, 4)
    wheel(m, 27.5, 10, 4)


@vehicle("arbuckle_quarryman", "Quarryman Dump", "Arbuckle Heavy", "dump", "truck", (8.6, 2.5, 3.2))
def _(m):
    std_paint(m, (232, 178, 26))
    L, W, H = m.L, m.W, m.H
    c = conv_front(m, hood=20, cab=12, cin=1, hin=4, zc=6, zh=17, zb=18, zr=28, D=11, wf=11, side_len=8,
                   bz=(4, 8))
    cy0 = c["cy0"]
    stacks(m, cy0 - 2, 9, 32)
    m.box(2, cy0, 4, W - 4, 6, 9, "dsteel")
    b1 = cy0 - 4
    m.box(1, b1, 0, W, 9, 26, "paint")                                       # dump body
    m.box(3, b1 - 2, 2, W - 2, 12, 26, None)
    for y in range(3, b1 - 2):
        for x in range(2, W - 2):
            h = 18 + int(round(3 * math.sin(math.pi * (y - 3) / (b1 - 5)) * math.sin(math.pi * (x - 2) / (W - 5))))
            m.box(y, y + 1, x, x + 1, 11, h + 1, "gravel", tone=(-1 if (x * 5 + y * 3) % 7 == 0 else 0))
    for y in range(6, b1, 7):
        m.skin_side(lambda yy, z, y=y: yy == y and 10 <= z < 25, "paint", tone=-1, only="paint")
    m.box(b1 - 1, b1 + 2, 0, W, 24, 29, "paint")                              # cab shield
    m.box(0, 2, 0, 3, 10, 13, "tail")
    m.box(0, 2, W - 3, W, 10, 13, "tail")
    wheel(m, 13.5, 11, 4)
    wheel(m, 25.5, 11, 4)


@vehicle("heartland_scholar", "Scholar School Bus", "Heartland Coach", "schoolbus", "bus", (11.6, 2.45, 3.2),
         livery=True)
def _(m):
    m.define("paint", ramp((240, 170, 16)))
    L, W, H = m.L, m.W, m.H
    hy = L - 14
    m.body([(hy, 15), (L - 3, 14), (L - 1, 12)], 4, y0=hy, y1=L, x0=3, x1=W - 3)          # hood
    for s0, s1 in ((0, 4), (W - 4, W)):
        m.body([(L - 14, 9), (L - 12, 11), (L - 5, 11), (L - 3, 9)], 5, y0=L - 14, y1=L - 2, x0=s0, x1=s1)
    m.box(L - 2, L, 0, W, 3, 6, "trim")
    m.paint(L - 1, L, 5, W - 5, 6, 12, "grille")
    m.box(L - 3, L - 1, 1, 4, 9, 11, "head")
    m.box(L - 3, L - 1, W - 4, W - 1, 9, 11, "head")
    rbox(m, 1, hy, 0, W, 4, H, "paint", r=2)
    m.skin_end(lambda x, z: 2 <= x < W - 2 and 16 <= z < 26, "glass", front=True)
    windows(m, 4, hy - 8, 18, 25, pitch=7, pil=1)
    for z in (8, 12, 16):
        side_band(m, z, z + 1, "trim", only="paint")
    m.skin_side(lambda y, z: hy - 7 <= y < hy - 1 and 5 <= z < 26, "glass", which="lo")      # entry door
    m.skin_side(lambda y, z: y == hy - 4 and 5 <= z < 26, "trim", which="lo")
    m.skin_side(lambda y, z: hy - 10 <= y < hy - 7 and 17 <= z < 20, "stopsign", which="hi")  # stop arm
    m.skin_end(lambda x, z: 7 <= x < W - 7 and 15 <= z < 26, "glass", front=False)           # emergency door
    m.skin_end(lambda x, z: x == W // 2 and 6 <= z < 27, "trim", front=False)
    for yy in (hy - 1, 1):
        fr = yy != 1
        m.skin_end(lambda x, z: z in (28, 29) and (2 <= x < 4 or W - 4 <= x < W - 2), "amber", front=fr)
        m.skin_end(lambda x, z: z in (28, 29) and (5 <= x < 7 or W - 7 <= x < W - 5), "sirenr", front=fr)
    m.box(30, 34, W // 2 - 2, W // 2 + 2, H - 1, H, "trim")
    m.box(80, 84, W // 2 - 2, W // 2 + 2, H - 1, H, "trim")
    rear_lights(m, 0, 3, 7, 11)
    wheel(m, L - 9, 10, 3)
    wheel(m, 30, 10, 4)


@vehicle("heartland_transit", "Green Country Transit", "Heartland Coach", "citybus", "bus", (12.2, 2.6, 3.25),
         livery=True)
def _(m):
    m.define("paint", ramp((220, 222, 226)))
    L, W, H = m.L, m.W, m.H
    fy = L - 3
    m.body([(0, H - 4), (fy, H - 4)], 3, y0=0, y1=fy + 1, inset=[(0, 1), (1, 0), (fy - 1, 0), (fy, 1)])
    rbox(m, 0, fy + 1, 0, W, H - 4, H - 3, "paint", r=1)
    m.box(L - 2, L, 4, W - 4, 4, 9, "dsteel")                                 # bike rack
    m.box(L - 2, L, 6, 8, 9, 12, "dsteel")
    m.box(L - 2, L, W - 8, W - 6, 9, 12, "dsteel")
    m.skin_end(lambda x, z: 2 <= x < W - 2 and 9 <= z < 25, "glassdark", front=True, depth=1)
    m.skin_end(lambda x, z: 4 <= x < W - 4 and 25 <= z < 27, "lamp", front=True, depth=1)
    windows(m, 6, fy - 12, 15, 26, pitch=12, pil=1, mat="glassdark")
    side_band(m, 8, 14, "greenstripe", only="paint")
    side_band(m, 14, 15, "bluestripe", only="paint")
    m.skin_side(lambda y, z: fy - 9 <= y < fy - 2 and 4 <= z < 26, "glass", which="lo")
    m.skin_side(lambda y, z: 50 <= y < 57 and 4 <= z < 26, "glass", which="lo")
    m.skin_side(lambda y, z: y in (fy - 6, 53) and 4 <= z < 26, "trim", which="lo")
    rbox(m, L - 46, L - 26, 4, W - 4, H - 4, H, "boxwhite", r=1)               # roof A/C pod
    m.box(3, 12, 5, W - 5, H - 3, H - 1, "boxwhite")
    m.skin_end(lambda x, z: 5 <= x < W - 5 and 6 <= z < 14 and z % 2 == 0, "grille", front=False)
    m.box(fy - 1, fy + 1, 1, 4, 5, 8, "head")
    m.box(fy - 1, fy + 1, W - 4, W - 1, 5, 8, "head")
    rear_lights(m, 0, 3, 7, 14)
    wheel(m, L - 27, 10, 3)
    wheel(m, 28, 10, 4)


@vehicle("heartland_wanderer", "Wanderer RV", "Heartland Coach", "rv", "bus", (9.6, 2.5, 3.45), livery=True)
def _(m):
    m.define("paint", ramp((226, 222, 210)))
    m.define("swoosh1", ramp((150, 84, 46)))
    m.define("swoosh2", ramp((226, 128, 40)))
    L, W, H = m.L, m.W, m.H
    t = sub(m, W=21)
    c = car(t, hood=8, ws=7, roof=14, rw=0, zb=11, zh=11, zhf=10, zt=11, ztr=11, zc=3, zr=20, D=8, tw=3, wf=9,
            wr=24, in0=1, in1=2, pillars=(), tail=(), rglass=False, hl=(1, 4, 7, 9), tl=(0, 0, 0, 0), tl_top=0,
            gw=4, gz=(5, 8))
    paste(m, t, x0=2)
    b1 = c["ry0"] + 4
    rbox(m, 1, b1, 0, W, 5, H - 2, "paint", r=2)
    m.body([(b1 - 1, H - 3), (b1 + 8, H - 3), (b1 + 11, H - 5)], 22, y0=b1 - 1, y1=b1 + 12, x0=1, x1=W - 1)   # cab-over
    m.box(b1 + 9, b1 + 12, 1, W - 1, 22, 24, None)
    m.skin_end(lambda x, z: 5 <= x < W - 5 and 26 <= z < 29, "glass", front=True)
    for y0w in (12, 40):
        m.skin_side(lambda y, z, y0w=y0w: y0w <= y < y0w + 10 and 18 <= z < 25, "glass")
    m.skin_side(lambda y, z: b1 - 10 <= y < b1 - 4 and 6 <= z < 29, "paint", tone=-1, which="lo")
    m.skin_side(lambda y, z: b1 - 9 <= y < b1 - 5 and 21 <= z < 26, "glass", which="lo")
    m.skin_side(lambda y, z: 2 <= y < b1 and (10 + 5 * math.sin(y / 9.0)) <= z < (12 + 5 * math.sin(y / 9.0)), "swoosh1",
                only="paint")
    m.skin_side(lambda y, z: 2 <= y < b1 and (12 + 5 * math.sin(y / 9.0)) <= z < (13.5 + 5 * math.sin(y / 9.0)),
                "swoosh2", only="paint")
    m.skin_side(lambda y, z: 4 <= y < b1 - 12 and z in (30, 31), "trim", which="lo")             # awning roll
    rbox(m, 30, 42, 6, W - 6, H - 2, H, "boxwhite", r=1)                       # A/C
    m.skin_end(lambda x, z: x in (W - 6, W - 5, W - 3, W - 2) and 8 <= z < 31, "dsteel", front=False)
    m.box(0, 2, 3, W - 3, 4, 6, "trim")
    rear_lights(m, 0, 3, 7, 11)
    wheel(m, axle_y(m, 24, 9, False), 9, 4)


STD["navr"] = (flat((255, 40, 50)), "light")
STD["navg"] = (flat((70, 255, 120)), "light")
STD["rotorblur"] = (ramp((128, 132, 140)), "solid")
STD["carpet"] = (ramp((92, 96, 104)), "solid")
STD["grain"] = (ramp((214, 178, 92)), "solid")


def cx0(m, w):
    """x start of a centred run `w` px wide."""
    return (m.W - w) // 2


def cbox2(m, y0, y1, w, z0, z1, mat, tone=0, only=None):
    x0 = cx0(m, w)
    m.box(y0, y1, x0, x0 + w, z0, z1, mat, tone, only)


def ring_yz(m, yc, zc, ro, ri, x0, x1, mat, tone=0):
    for y in range(m.L):
        for z in range(m.H):
            d = math.hypot(y - yc, z - zc)
            if ri < d <= ro:
                m.box(y, y + 1, x0, x1, z, z + 1, mat, tone)


def disc_yz(m, yc, zc, r, x0, x1, mat, tone=0):
    ring_yz(m, yc, zc, r, -1, x0, x1, mat, tone)


def ring_xz(m, y0, y1, xc, zc, ro, ri, mat):
    for x in range(m.W):
        for z in range(m.H):
            d = math.hypot(x - xc, z - zc)
            if ri < d <= ro:
                m.box(y0, y1, x, x + 1, z, z + 1, mat)


def cwheel(m, yc, D, tw=2, rim="rim", spokes=False, zc=None):
    """Centred single wheel for two-wheelers (tyre ring + hub)."""
    r = D / 2
    zc = (D - 1) / 2 if zc is None else zc
    x0 = cx0(m, tw)
    disc_yz(m, yc, zc, r - 0.05, x0, x0 + tw, "tire")
    if rim:
        disc_yz(m, yc, zc, max(0.8, r - 2.0), x0, x0 + tw, rim)


def slope(m, ya, za, yb, zb, w, mat, h=2, thick=2):
    """A `w`-wide, `thick`-deep tube from (ya, za) to (yb, zb) in the side plane."""
    n = max(abs(yb - ya), abs(zb - za)) * 2 + 1
    x0 = cx0(m, w)
    for k in range(int(n) + 1):
        t = k / n
        y = ya + (yb - ya) * t
        z = za + (zb - za) * t
        m.box(int(round(y)) - thick // 2, int(round(y)) - thick // 2 + thick, x0, x0 + w,
              int(round(z)) - h // 2, int(round(z)) - h // 2 + h, mat)


# ------------------------------------------------------------------------------------------- bicycles
def bicycle(m, *, D, frame, rear, front, seat_y, head_y, ztop, bars_w, drop=False, fenders=False, basket=False,
            pegs=False, seat="seat"):
    L, W = m.L, m.W
    zc = (D - 1) / 2
    for yc in (rear, front):
        x0 = cx0(m, 2)
        ring_yz(m, yc, zc, D / 2 - 0.05, D / 2 - 2.0, x0, x0 + 2, "tire")
        disc_yz(m, yc, zc, 0.9, x0, x0 + 2, "rim")
    bb = (rear + front) / 2 - 1
    slope(m, rear, zc, bb, zc - 0.5, 2, frame)                 # chain stay
    slope(m, bb, zc - 0.5, seat_y, ztop - 2, 2, frame)          # seat tube
    slope(m, seat_y, ztop - 2, head_y, ztop - 1.5, 2, frame)    # top tube
    slope(m, bb, zc - 0.5, head_y, ztop - 2.5, 2, frame)        # down tube
    slope(m, rear, zc, seat_y, ztop - 2, 2, frame)              # seat stay
    slope(m, head_y, ztop - 1, front, zc, 2, "chrome")          # fork
    cbox2(m, int(seat_y) - 2, int(seat_y) + 2, 2, ztop - 1, ztop, seat)
    hy = int(head_y)
    m.box(hy - 1, hy + 1, 0 if bars_w >= W else cx0(m, bars_w), W if bars_w >= W else cx0(m, bars_w) + bars_w,
          ztop, ztop + 1, "trim" if not drop else "stripe_w")
    cbox2(m, hy - 1, hy + 1, 2, ztop - 2, ztop, "chrome")
    if fenders:
        for yc in (rear, front):
            for y in range(L):
                for z in range(m.H):
                    d = math.hypot(y - yc, z - zc)
                    if D / 2 - 0.05 < d <= D / 2 + 1.0 and z >= zc:
                        cbox2(m, y, y + 1, 2, z, z + 1, frame, only="empty")
    if basket:
        cbox2(m, int(front) - 1, min(L, int(front) + 3), 6, ztop - 3, ztop, "wood")
    if pegs:
        m.box(int(rear) - 1, int(rear) + 1, 0, W, int(zc), int(zc) + 1, "chrome", only="empty")


@vehicle("sandhill_kicker", "Kicker BMX", "Sandhill Cycles", "bicycle", "bike", (1.7, 0.6, 1.0))
def _(m):
    std_paint(m, (60, 200, 90))
    bicycle(m, D=5, frame="paint", rear=2.5, front=m.L - 3.5, seat_y=6, head_y=m.L - 5, ztop=8, bars_w=6,
            pegs=True, seat="trim")


@vehicle("sandhill_velo", "Velo Road", "Sandhill Cycles", "bicycle", "bike", (1.75, 0.44, 1.0))
def _(m):
    std_paint(m, (200, 32, 40))
    bicycle(m, D=7, frame="paint", rear=3, front=m.L - 4, seat_y=6, head_y=m.L - 6, ztop=9, bars_w=4, drop=True)


@vehicle("sandhill_boardwalk", "Boardwalk Cruiser", "Sandhill Cycles", "bicycle", "bike", (1.9, 0.68, 1.05))
def _(m):
    std_paint(m, (120, 200, 196))
    bicycle(m, D=7, frame="paint", rear=3, front=m.L - 4, seat_y=6, head_y=m.L - 6, ztop=10, bars_w=7,
            fenders=True, basket=True, seat="seat_tan")


@vehicle("zipline_scoot", "Zip Scoot", "Zipline Mobility", "escooter", "bike", (1.1, 0.44, 1.15), livery=True)
def _(m):
    m.define("paint", ramp((120, 200, 40)))
    L, W = m.L, m.W
    cwheel(m, 1.5, 3, rim=None)
    cwheel(m, L - 2.5, 3, rim=None)
    cbox2(m, 1, L - 2, 2, 1, 3, "trim")
    cbox2(m, 2, L - 3, 2, 3, 4, "paint")
    cbox2(m, L - 4, L - 2, 2, 2, 11, "paint")
    m.box(L - 4, L - 2, 0, W, 10, 11, "trim")
    cbox2(m, L - 2, L, 2, 7, 9, "head")
    cbox2(m, 0, 2, 2, 3, 4, "tail")


# ------------------------------------------------------------------------------------------- scooters / motorbikes
@vehicle("scissortail_piccolo", "Piccolo", "Scissortail", "scooter", "motorbike", (1.8, 0.76, 1.15))
def _(m):
    std_paint(m, (150, 210, 180))
    L, W = m.L, m.W
    cwheel(m, 2.5, 4)
    cwheel(m, L - 3.5, 4)
    rbox(m, 1, 9, 1, W - 1, 3, 9, "paint", r=1)
    cbox2(m, 2, 9, 4, 8, 9, "seat_tan")
    cbox2(m, 8, 14, 4, 2, 3, "trim")
    rbox(m, 13, 15, 1, W - 1, 2, 10, "paint", r=1)
    cbox2(m, 13, 16, 4, 9, 11, "paint")
    m.box(13, 15, 0, W, 10, 11, "chrome")
    cbox2(m, 15, 16, 2, 9, 10, "head")
    cbox2(m, 14, 17, 2, 3, 5, "paint")
    cbox2(m, 0, 1, 2, 6, 7, "tail")


@vehicle("ozark_putt", "Putt 50 Delivery", "Ozark Moto", "moped", "motorbike", (1.75, 0.72, 1.25))
def _(m):
    std_paint(m, (196, 44, 40))
    L, W = m.L, m.W
    cwheel(m, 2.5, 5)
    cwheel(m, L - 3.5, 5)
    slope(m, 4, 4, L - 5, 4, 2, "paint")
    slope(m, L - 6, 4, L - 5, 10, 2, "paint")
    cbox2(m, 5, 10, 4, 3, 7, "engine")
    cbox2(m, 6, 11, 4, 7, 8, "seat")
    rbox(m, 0, 6, 1, W - 1, 6, 12, "boxwhite", r=1)
    m.box(0, 6, 1, W - 1, 9, 10, "redstripe", only="boxwhite")
    m.box(L - 6, L - 4, 0, W, 10, 11, "trim")
    cbox2(m, L - 5, L - 3, 4, 8, 10, "paint")
    cbox2(m, L - 3, L - 2, 2, 8, 9, "head")
    cbox2(m, 0, 1, 2, 7, 8, "tail")


@vehicle("scissortail_talon", "Talon R", "Scissortail", "sportbike", "motorbike", (2.05, 0.72, 1.12))
def _(m):
    std_paint(m, (30, 90, 200))
    L, W = m.L, m.W
    cwheel(m, 3.5, 6)
    cwheel(m, L - 4.5, 6)
    cbox2(m, 6, 13, 4, 2, 6, "engine")
    rbox(m, 7, 17, 1, W - 1, 3, 8, "paint", r=1)
    m.box(7, 17, 1, W - 1, 4, 5, "stripe_w", only="paint")
    cbox2(m, 13, 19, 4, 6, 9, "paint")
    cbox2(m, 18, 20, 2, 6, 8, "head")
    cbox2(m, 14, 16, 4, 9, 10, "glass")
    cbox2(m, 9, 13, 4, 7, 9, "paint")
    cbox2(m, 4, 9, 2, 7, 8, "seat")
    cbox2(m, 1, 5, 2, 7, 9, "paint")
    cbox2(m, 0, 2, 2, 8, 9, "tail")
    m.box(12, 14, 0, W, 8, 9, "trim")
    cbox2(m, 15, 17, 2, 3, 8, "chrome")
    m.box(2, 6, W - 3, W - 1, 4, 6, "chrome")


@vehicle("ozark_drifter", "Drifter Chopper", "Ozark Moto", "chopper", "motorbike", (2.5, 1.0, 1.2))
def _(m):
    std_paint(m, (126, 22, 30))
    L, W = m.L, m.W
    cwheel(m, 3.5, 6, tw=4, rim="chrome")
    cwheel(m, L - 4, 7, tw=2, rim="chrome")
    slope(m, 17, 10, L - 4, 3, 2, "chrome")                   # raked fork
    cbox2(m, 8, 14, 4, 2, 8, "chrome")
    cbox2(m, 9, 13, 2, 3, 7, "engine")
    cbox2(m, 11, 17, 4, 7, 10, "paint")
    cbox2(m, 5, 11, 4, 6, 7, "seat")
    cbox2(m, 1, 7, 4, 5, 7, "paint")
    cbox2(m, 3, 5, 2, 7, 12, "chrome")                        # sissy bar
    m.box(16, 18, 2, 4, 10, 12, "chrome")                     # ape hangers
    m.box(16, 18, W - 4, W - 2, 10, 12, "chrome")
    m.box(16, 18, 0, W, 11, 12, "chrome")
    m.box(2, 14, W - 3, W - 1, 2, 4, "chrome")                # pipes
    cbox2(m, 18, 20, 2, 8, 10, "head")
    cbox2(m, 0, 2, 2, 6, 7, "tail")


@vehicle("kiamichi_mudlark", "Mudlark 450", "Kiamichi Outdoors", "dirtbike", "motorbike", (2.15, 0.8, 1.2))
def _(m):
    std_paint(m, (232, 104, 20))
    L, W = m.L, m.W
    cwheel(m, 3.5, 7, rim="rimdark")
    cwheel(m, L - 4.5, 7, rim="rimdark")
    m.tone(0, L, 0, W, 0, m.H, 1, only="tire") if False else None
    cbox2(m, 8, 13, 4, 2, 6, "engine")
    slope(m, 15, 10, L - 4, 4, 2, "chrome")
    cbox2(m, 10, 15, 6, 6, 9, "paint")
    cbox2(m, 4, 13, 2, 8, 9, "seat")
    cbox2(m, 0, 6, 2, 8, 9, "paint")
    cbox2(m, 15, L - 1, 2, 8, 9, "paint")                      # high front fender
    cbox2(m, 15, 17, 4, 7, 10, "stripe_w")                     # number plate
    m.box(13, 15, 0, W, 10, 11, "trim")
    m.box(2, 8, W - 3, W - 1, 6, 8, "chrome")
    cbox2(m, 16, 18, 2, 9, 10, "head")
    cbox2(m, 0, 1, 2, 8, 9, "tail")


@vehicle("ozark_longroad", "Long Road Bagger", "Ozark Moto", "touring", "motorbike", (2.55, 1.0, 1.45))
def _(m):
    std_paint(m, (110, 26, 40))
    m.define("cream", ramp((222, 208, 170)))
    L, W = m.L, m.W
    cwheel(m, 3.5, 6, rim="chrome")
    cwheel(m, L - 4.5, 6, rim="chrome")
    cbox2(m, 9, 16, 6, 2, 8, "chrome")
    rbox(m, 17, 22, 1, W - 1, 6, 12, "paint", r=1)            # batwing fairing
    cbox2(m, 17, 19, 6, 12, 14, "glass")
    cbox2(m, 21, 22, 4, 7, 9, "head")
    cbox2(m, 12, 17, 4, 7, 10, "paint")
    cbox2(m, 6, 12, 4, 7, 9, "seat")
    cbox2(m, 5, 7, 4, 9, 11, "seat")
    m.box(2, 8, 0, 3, 3, 8, "paint")                          # saddlebags
    m.box(2, 8, W - 3, W, 3, 8, "paint")
    m.box(2, 8, 0, W, 6, 7, "cream", only="paint")
    rbox(m, 1, 6, 2, W - 2, 8, 12, "paint", r=1)              # trunk
    cbox2(m, 1, 2, 4, 9, 10, "tail")
    m.box(13, 16, 0, W, 3, 4, "trim")                         # floorboards
    m.box(3, 8, 3, W - 3, 2, 8, "trim", only="empty")


@vehicle("ozark_longroad_patrol", "Long Road Patrol", "Ozark Moto", "policebike", "motorbike", (2.5, 1.0, 1.5),
         livery=True)
def _(m):
    m.define("paint", ramp((222, 224, 228)))
    L, W = m.L, m.W
    cwheel(m, 3.5, 6, rim="rimdark")
    cwheel(m, L - 4.5, 6, rim="rimdark")
    cbox2(m, 9, 16, 6, 2, 8, "engine")
    cbox2(m, 17, 21, 6, 6, 10, "paint")
    cbox2(m, 17, 19, 6, 10, 15, "glass")                      # tall windshield
    cbox2(m, 20, 21, 2, 7, 9, "head")
    m.box(17, 19, 0, 2, 5, 7, "sirenr")                       # crash-bar lights
    m.box(17, 19, W - 2, W, 5, 7, "sirenb")
    m.box(17, 19, 2, W - 2, 5, 6, "chrome", only="empty")
    cbox2(m, 12, 17, 4, 7, 10, "grille")
    cbox2(m, 7, 12, 4, 7, 9, "seat")
    m.box(2, 8, 0, 3, 3, 8, "paint")
    m.box(2, 8, W - 3, W, 3, 8, "paint")
    m.box(2, 8, 0, W, 5, 6, "grille", only="paint")
    cbox2(m, 2, 7, 4, 3, 9, "grille", only="empty")
    m.box(1, 3, 2, 4, 9, 14, "sirenr")                        # rear light masts
    m.box(1, 3, W - 4, W - 2, 9, 14, "sirenb")
    cbox2(m, 1, 3, 2, 7, 9, "tail")
    cbox2(m, 3, 9, 2, 3, 7, "trim", only="empty")


# ------------------------------------------------------------------------------------------- ATVs
@vehicle("kiamichi_brushbuster", "Brushbuster 4x4", "Kiamichi Outdoors", "atv", "atv", (2.05, 1.16, 1.15))
def _(m):
    std_paint(m, (176, 34, 36))
    L, W = m.L, m.W
    wheel(m, 3.5, 6, 3, well=False, rim="rimdark")
    wheel(m, L - 4.5, 6, 3, well=False, rim="rimdark")
    m.box(4, L - 4, 3, W - 3, 2, 5, "engine")
    rbox(m, 12, L, 0, W, 5, 7, "paint", r=1)
    cbox2(m, 12, L - 2, 6, 7, 8, "paint")
    rbox(m, 0, 9, 0, W, 5, 7, "paint", r=1)
    m.box(15, L - 1, 2, W - 2, 7, 8, "dsteel", only="empty")
    m.box(1, 7, 2, W - 2, 7, 8, "dsteel", only="empty")
    cbox2(m, 6, 12, 4, 7, 9, "seat")
    m.box(12, 14, 1, W - 1, 9, 10, "trim")
    cbox2(m, 12, 14, 2, 7, 9, "trim")
    m.box(L - 2, L, 2, 4, 5, 6, "head")
    m.box(L - 2, L, W - 4, W - 2, 5, 6, "head")
    cbox2(m, 0, 1, 4, 5, 6, "tail")


@vehicle("kiamichi_ridgerunner", "Ridgerunner UTV", "Kiamichi Outdoors", "utv", "atv", (3.05, 1.6, 1.9))
def _(m):
    std_paint(m, (88, 104, 60))
    L, W = m.L, m.W
    m.box(2, L - 1, 1, W - 1, 3, 7, "paint")
    m.body([(19, 10), (L - 3, 9), (L - 1, 8)], 7, y0=19, y1=L, x0=2, x1=W - 2)
    m.box(1, 9, 0, W, 7, 11, "paint")                        # dump bed
    m.box(3, 8, 2, W - 2, 8, 11, None)
    m.box(3, 8, 2, W - 2, 7, 8, "liner")
    m.box(9, 19, 1, W - 1, 7, 8, "interior")
    for xa, xb in ((2, 7), (W - 7, W - 2)):
        m.box(12, 16, xa, xb, 8, 10, "seat")
        m.box(10, 12, xa, xb, 8, 13, "seat")
    m.box(17, 19, 2, W - 2, 8, 12, "trim")
    m.box(15, 17, W - 6, W - 3, 11, 12, "trim")              # steering wheel (driver side)
    for yy in (9, 19):                                       # roll cage
        m.box(yy, yy + 2, 1, 3, 8, 18, "trim")
        m.box(yy, yy + 2, W - 3, W - 1, 8, 18, "trim")
    m.box(9, 21, 1, W - 1, 18, 19, "canvas")
    m.box(19, 21, 3, W - 3, 18, 19, "lamp")
    m.box(L - 2, L, 2, 5, 7, 9, "head")
    m.box(L - 2, L, W - 5, W - 2, 7, 9, "head")
    m.box(1, 2, 0, 2, 8, 10, "tail")
    m.box(1, 2, W - 2, W, 8, 10, "tail")
    wheel(m, 5, 7, 3, rim="rimdark")
    wheel(m, L - 6, 7, 3, rim="rimdark")


@vehicle("kiamichi_workhorse", "Workhorse 6x6", "Kiamichi Outdoors", "atv6", "atv", (2.95, 1.26, 1.2))
def _(m):
    std_paint(m, (100, 104, 64))
    L, W = m.L, m.W
    m.box(3, L - 3, 3, W - 3, 2, 6, "engine")
    rbox(m, 19, L, 0, W, 5, 7, "paint", r=1)
    cbox2(m, 20, L - 2, 6, 7, 8, "paint")
    m.box(21, L - 1, 2, W - 2, 8, 9, "dsteel", only="empty")
    cbox2(m, 13, 18, 4, 7, 9, "seat")
    m.box(18, 20, 1, W - 1, 9, 10, "trim")
    cbox2(m, 18, 20, 2, 7, 9, "trim")
    m.box(0, 13, 0, W, 6, 11, "paint")                        # cargo box
    m.box(2, 11, 2, W - 2, 7, 11, None)
    m.box(2, 11, 2, W - 2, 6, 7, "liner")
    m.box(L - 2, L, 2, 4, 5, 6, "head")
    m.box(L - 2, L, W - 4, W - 2, 5, 6, "head")
    m.box(0, 1, 1, 3, 7, 9, "tail")
    m.box(0, 1, W - 3, W - 1, 7, 9, "tail")
    for yc in (3.5, 10.5, L - 4.5):
        wheel(m, yc, 6, 3, rim="rimdark", well=False)


@vehicle("bermuda_lawnpro", "Lawn Pro 42", "Bermuda Turf", "mower", "tractor", (1.9, 1.25, 1.1))
def _(m):
    std_paint(m, (40, 150, 110))
    L, W = m.L, m.W
    m.box(5, 14, 0, W, 1, 3, "dsteel")                       # cutting deck
    m.box(2, L - 1, 3, W - 3, 3, 5, "paint")
    m.body([(11, 8), (L - 3, 7), (L - 1, 6)], 4, y0=11, y1=L, x0=2, x1=W - 2)
    m.box(L - 1, L, 4, W - 4, 4, 6, "grille")
    m.box(3, 9, 3, W - 3, 6, 8, "seat")
    m.box(2, 4, 3, W - 3, 8, 11, "seat")
    m.box(1, 7, 0, 3, 5, 7, "paint")
    m.box(1, 7, W - 3, W, 5, 7, "paint")
    cbox2(m, 9, 11, 2, 6, 9, "trim")
    m.box(9, 11, 4, W - 4, 9, 10, "trim")
    m.box(L - 2, L, 2, 4, 6, 7, "head")
    m.box(L - 2, L, W - 4, W - 2, 6, 7, "head")
    wheel(m, 3, 5, 3, rim="hazard", well=False)
    wheel(m, L - 3, 3, 2, e=1, rim=None, well=False)


@vehicle("panhandle_sodbuster", "Sodbuster 180", "Panhandle Ag", "tractor", "tractor", (4.6, 2.4, 3.0))
def _(m):
    std_paint(m, (226, 108, 30))
    m.define("cream", ramp((232, 220, 186)))
    L, W, H = m.L, m.W, m.H
    m.box(16, L - 1, 8, W - 8, 5, 9, "engine")
    m.body([(22, 17), (L - 3, 16), (L - 1, 14)], 8, y0=22, y1=L, x0=7, x1=W - 7)
    m.box(L - 1, L, 8, W - 8, 9, 15, "grille")
    m.box(34, 36, 8, 10, 17, 26, "dsteel")                    # exhaust
    m.box(30, 32, W - 10, W - 8, 17, 20, "chrome")            # air intake
    m.box(5, 22, 4, W - 4, 10, 14, "paint")
    cabin(m, 5, 21, 6, 20, 13, H - 2, in0=4, in1=4, pillars=(), rglass=True, roof_rows=1)
    m.box(4, 22, 3, W - 3, H - 1, H, "cream")
    m.box(1, 18, 0, 6, 17, 19, "paint")                       # rear fenders
    m.box(1, 18, W - 6, W, 17, 19, "paint")
    m.box(0, 3, 8, W - 8, 4, 9, "dsteel")                     # hitch
    m.box(0, 8, 10, W - 10, 4, 7, "dsteel")
    m.box(L - 2, L, 8, 10, 12, 14, "head")
    m.box(L - 2, L, W - 10, W - 8, 12, 14, "head")
    m.box(20, 22, 5, 8, H - 1, H, "lamp")
    m.box(20, 22, W - 8, W - 5, H - 1, H, "lamp")
    m.box(4, 6, 4, 6, 16, 18, "tail")
    m.box(4, 6, W - 6, W - 4, 16, 18, "tail")
    wheel(m, 9, 17, 5, rim="paint", hub=0.45, well=False)
    wheel(m, L - 8, 10, 3, e=4, rim="paint", hub=0.45, well=False)
    m.skin_side(lambda y, z: z < 17 and ((y * 3 + z * 5) % 6 == 0), "tire", tone=1, only="tire")


@vehicle("panhandle_reaper", "Reaper Combine", "Panhandle Ag", "combine", "tractor", (11.0, 9.1, 4.0))
def _(m):
    std_paint(m, (226, 108, 30))
    m.define("cream", ramp((232, 220, 186)))
    L, W, H = m.L, m.W, m.H
    bx0, bx1 = 30, W - 30
    rbox(m, 8, 80, bx0, bx1, 5, 32, "paint", r=2)                       # main body
    side_band(m, 18, 20, "cream", y0=8, y1=80, only="paint")
    m.box(38, 72, bx0 + 1, bx1 - 1, 32, 38, "paint")                    # grain tank
    m.box(40, 70, bx0 + 3, bx1 - 3, 34, 38, None)
    m.box(40, 70, bx0 + 3, bx1 - 3, 33, 35, "grain")
    m.box(70, 86, bx0 + 5, bx1 - 5, 22, 25, "paint")                    # cab base
    cabin(m, 70, 85, 71, 83, 24, 38, in0=bx0 + 5, in1=bx0 + 5, pillars=(), rglass=False)
    m.box(70, 86, bx0 + 4, bx1 - 4, 39, 40, "cream")
    m.box(84, 86, bx0 + 7, bx0 + 10, 39, 40, "lamp")
    m.box(84, 86, bx1 - 10, bx1 - 7, 39, 40, "lamp")
    m.box(20, 76, bx1, bx1 + 3, 30, 33, "paint")                        # folded unloading auger
    m.box(74, 77, bx1 - 2, bx1 + 3, 26, 33, "paint")
    m.box(2, 9, bx0 + 6, bx1 - 6, 8, 18, "dsteel")                      # spreader
    m.box(80, 92, 37, W - 37, 4, 16, "paint")                           # feeder house
    m.box(88, 93, 0, W, 2, 13, "cream")                                 # header back wall
    m.box(88, L, 0, W, 2, 4, "dsteel")                                  # header floor
    m.box(88, L, 0, 3, 2, 10, "paint")                                  # end plates
    m.box(88, L, W - 3, W, 2, 10, "paint")
    for x in range(4, W - 4, 3):
        m.box(L - 2, L, x, x + 1, 2, 3, "chrome")                       # knife guards
    for y in range(93, 98):                                             # cross auger
        for z in range(4, 9):
            if math.hypot(y - 95, z - 6) <= 2.2:
                m.box(y, y + 1, 3, W - 3, z, z + 1, "chrome")
    for k in range(6):                                                  # reel bats
        a = k * math.pi / 3
        yy, zz = 101 + 4.2 * math.cos(a), 11 + 4.2 * math.sin(a)
        m.box(int(round(yy)) - 1, int(round(yy)) + 1, 4, W - 4, int(round(zz)) - 1, int(round(zz)) + 1, "redstripe")
    for x0_ in (3, W - 6):
        disc_yz(m, 101, 11, 4.6, x0_, x0_ + 3, "paint")
    m.box(100, 103, 4, W - 4, 10, 12, "dsteel")
    m.box(60, 64, bx0 - 2, bx0, 6, 24, "dsteel")                        # ladder
    m.box(8, 10, bx0, bx0 + 3, 10, 13, "tail")
    m.box(8, 10, bx1 - 3, bx1, 10, 13, "tail")
    m.box(L - 2, L, 2, 6, 6, 8, "amber")
    m.box(L - 2, L, W - 6, W - 2, 6, 8, "amber")
    wheel(m, 64, 17, 6, e=bx0 - 6, rim="paint", hub=0.45, well=False)
    wheel(m, 18, 10, 4, e=bx0 - 3, rim="paint", hub=0.45, well=False)


# ------------------------------------------------------------------------------------------- boats
def hull(m, y0, y1, mat, zdeck, bow=0.62, vee=((0, 2, 4), (2, 4, 2)), x0=0, x1=None, bowin=None):
    """Boat hull, bow at +y: plan tapers over the front (1-bow) of its length; V bottom from `vee` rows
    (z0, z1, extra inset)."""
    x1 = m.W if x1 is None else x1
    wd = x1 - x0
    bowin = bowin or (wd // 2 - 2)
    for y in range(y0, y1):
        f = (y - y0) / max(1, y1 - y0 - 1)
        ins = 0 if f < bow else int(round(((f - bow) / (1 - bow)) ** 1.6 * bowin))
        m.box(y, y + 1, x0 + ins, x1 - ins, vee[-1][1], zdeck + 1, mat)
        for z0, z1, e in vee:
            m.box(y, y + 1, x0 + ins + e, x1 - ins - e, z0, z1, mat)


def outboard(m, y0, z0, z1, w=6):
    cbox2(m, y0, y0 + 4, w, z0, z1, "trim")
    cbox2(m, y0 + 1, y0 + 3, 2, 0, z0, "trim")
    cbox2(m, y0, y0 + 1, 2, z0 + 2, z0 + 4, "chrome")


@vehicle("jenks_lunker", "Lunker 20 Bass Boat", "Jenks Marine", "bassboat", "boat", (6.2, 2.35, 1.3))
def _(m):
    std_paint(m, (196, 30, 44))
    L, W, H = m.L, m.W, m.H
    hull(m, 4, L, "paint", 7, vee=((0, 2, 5), (2, 4, 2)))
    side_band(m, 6, 7, "chrome", y0=4, y1=L - 4, only="paint")
    m.skin_top(lambda y, x: 6 <= y < L - 6, "carpet", only="paint")
    m.box(30, 34, 3, 9, 8, 11, "trim")                               # console (starboard)
    m.box(33, 34, 3, 9, 11, 12, "glass")
    m.box(30, 33, W - 9, W - 3, 8, 10, "trim")
    for xa in (4, W - 9):
        m.box(23, 27, xa, xa + 5, 8, 10, "seat_white")
        m.box(22, 24, xa, xa + 5, 8, 12, "seat_white")
    cbox2(m, 50, 53, 3, 8, 10, "seat_white")                         # bow casting seat
    cbox2(m, 10, 13, 3, 8, 10, "seat_white")
    cbox2(m, L - 4, L - 2, 2, 8, 10, "trim")                         # trolling motor
    outboard(m, 0, 4, 13)
    m.box(L - 3, L - 1, W // 2 - 3, W // 2 - 1, 7, 8, "navg")
    m.box(L - 3, L - 1, W // 2 + 1, W // 2 + 3, 7, 8, "navr")
    m.extra["waterline"] = 3


@vehicle("jenks_sunsetter", "Sunsetter Pontoon", "Jenks Marine", "pontoon", "boat", (7.3, 2.55, 2.6), livery=True)
def _(m):
    m.define("paint", ramp((214, 216, 220)))
    m.define("bimini", ramp((36, 54, 110)))
    L, W, H = m.L, m.W, m.H
    for xc in (4.0, W - 5.0):
        for y in range(3, L):
            k = 1.0 if y < L - 5 else max(0.35, 1 - (y - (L - 5)) * 0.16)
            m.cyl_y(y, y + 1, xc, 3, 3.2 * k, 3.2 * k, "chrome")
    m.box(3, L - 3, 0, W, 6, 7, "carpet")
    for (y0, y1, x0, x1) in ((3, 5, 0, W), (3, L - 3, 0, 2), (3, L - 3, W - 2, W), (L - 5, L - 3, 0, 9),
                             (L - 5, L - 3, W - 9, W)):
        m.box(y0, y1, x0, x1, 7, 12, "paint")
    side_band(m, 9, 11, "bluestripe", y0=3, y1=L - 3, only="paint")
    m.box(5, 60, 2, 6, 7, 10, "seat_white")
    m.box(5, 60, W - 6, W - 2, 7, 10, "seat_white")
    m.box(5, 9, 2, W - 2, 7, 10, "seat_white")
    m.box(44, 50, W - 10, W - 4, 7, 12, "trim")
    m.box(49, 50, W - 10, W - 4, 12, 14, "glass")
    for yy in (18, 46):
        m.box(yy, yy + 2, 2, 4, 12, 24, "chrome")
        m.box(yy, yy + 2, W - 4, W - 2, 12, 24, "chrome")
    rbox(m, 16, 50, 1, W - 1, 24, 26, "bimini", r=1)
    outboard(m, 0, 4, 14)
    m.box(L - 5, L - 3, 2, 4, 12, 13, "navg")
    m.box(L - 5, L - 3, W - 4, W - 2, 12, 13, "navr")
    m.extra["waterline"] = 3


@vehicle("jenks_skimmer", "Sandbar Skimmer Airboat", "Jenks Marine", "airboat", "boat", (4.9, 2.4, 2.9))
def _(m):
    std_paint(m, (92, 104, 62))
    L, W, H = m.L, m.W, m.H
    hull(m, 5, L, "paint", 3, bow=0.7, vee=((0, 1, 1),), bowin=4)
    m.box(5, L, 0, W, 4, 6, "paint", only="empty")
    m.box(7, L - 3, 2, W - 2, 4, 6, None)
    m.box(7, L - 3, 2, W - 2, 3, 4, "liner")
    m.box(32, 38, 4, W - 4, 4, 7, "seat")
    m.box(31, 33, 4, W - 4, 7, 10, "seat")
    for yy in (16, 22):
        m.box(yy, yy + 2, 8, 10, 4, 14, "dsteel")
        m.box(yy, yy + 2, W - 10, W - 8, 4, 14, "dsteel")
    m.box(15, 24, 8, W - 8, 14, 16, "seat")
    m.box(15, 17, 8, W - 8, 16, 20, "seat")
    m.box(7, 14, 7, W - 7, 4, 13, "engine")
    xc = (W - 1) / 2
    ring_xz(m, 3, 5, xc, 15, 11.6, 9.6, "dsteel")
    m.box(3, 5, int(xc) - 0, int(xc) + 2, 4, 26, "dsteel")
    m.box(3, 5, 1, W - 1, 14, 16, "dsteel")
    m.box(5, 6, int(xc) - 1, int(xc) + 3, 7, 23, "wood")              # propeller blade
    m.box(5, 7, int(xc), int(xc) + 2, 13, 17, "trim")
    for xa in (int(xc) - 6, int(xc) + 5):
        m.box(0, 3, xa, xa + 2, 6, 23, "dsteel")                        # rudders
    m.box(0, 5, int(xc) - 6, int(xc) + 7, 4, 6, "dsteel")
    m.box(L - 3, L - 1, 3, 5, 6, 7, "navg")
    m.box(L - 3, L - 1, W - 5, W - 3, 6, 7, "navr")
    m.extra["waterline"] = 2


# ------------------------------------------------------------------------------------------- helicopters
def lathe(m, y0, y1, fn, mat, p=2.4):
    """Body of revolution-ish along y: fn(y) -> (xc, zc, rx, rz); superellipse cross-section."""
    for y in range(y0, y1):
        xc, zc, rx, rz = fn(y)
        if rx <= 0 or rz <= 0:
            continue
        for x in range(m.W):
            for z in range(m.H):
                if abs((x - xc) / rx) ** p + abs((z - zc) / rz) ** p <= 1.0:
                    m.box(y, y + 1, x, x + 1, z, z + 1, mat)


def heli(m, *, nose, cab0, tail0, tail_z, mast_y, mast_z, fin, fenestron=False, bulb=1.0):
    W = m.W
    xc = (W - 1) / 2

    def body(y):
        if y > nose - 14:
            f = (nose - y) / 14
            k = max(0.0, 1 - (1 - f) ** 2.2)
            return xc, 15 - 2 * (1 - f), 8.6 * bulb * (0.35 + 0.65 * k), 9.0 * (0.4 + 0.6 * k)
        if y >= cab0 + 8:
            return xc, 15, 8.6 * bulb, 9.0
        f = (y - cab0) / 8
        return xc, 15 + 3 * (1 - f), 8.6 * bulb * (0.35 + 0.65 * f), 9.0 * (0.33 + 0.67 * f)

    lathe(m, cab0, nose + 1, body, "paint")
    lathe(m, tail0, cab0 + 2, lambda y: (xc, tail_z, 3.0 - 0.7 * (cab0 - y) / (cab0 - tail0),
                                          3.0 - 0.7 * (cab0 - y) / (cab0 - tail0)), "paint", p=4)
    m.paint(nose - 14, nose + 1, 0, W, 13, m.H, "glass", only="paint")                 # bubble canopy
    m.skin_side(lambda y, z: nose - 28 <= y < nose - 16 and 14 <= z < 21 and (y - nose) % 7 != 0, "glass", depth=2)
    rbox(m, mast_y - 12, mast_y + 10, int(xc) - 4, int(xc) + 6, 22, 27, "paint", r=1)     # engine cowling
    m.box(mast_y - 1, mast_y + 2, int(xc) - 1, int(xc) + 2, 26, mast_z + 1, "dsteel")    # mast
    for yy in (cab0 + 8, nose - 14):                                                    # skids + cross tubes
        m.box(yy, yy + 2, 2, 4, 1, 9, "dsteel")
        m.box(yy, yy + 2, W - 4, W - 2, 1, 9, "dsteel")
        m.box(yy, yy + 2, 2, W - 2, 7, 9, "dsteel")
    m.box(cab0 + 2, nose - 6, 1, 4, 0, 2, "dsteel")
    m.box(cab0 + 2, nose - 6, W - 4, W - 1, 0, 2, "dsteel")
    m.box(tail0 + 10, tail0 + 14, int(xc) - 7, int(xc) + 9, tail_z, tail_z + 1, "paint")  # stabiliser
    if fenestron:
        ring_yz(m, tail0 + 4, tail_z - 1, 6.2, 3.4, int(xc), int(xc) + 2, "paint")
        disc_yz(m, tail0 + 4, tail_z - 1, 3.4, int(xc), int(xc) + 2, "rotorblur")
        m.box(tail0 + 1, tail0 + 8, int(xc), int(xc) + 2, tail_z + 4, tail_z + 4 + fin, "paint")
    else:
        for z in range(tail_z - 4, tail_z + fin):
            sh = (z - tail_z) // 2
            m.box(tail0 + max(0, sh), tail0 + 7 + max(0, sh), int(xc), int(xc) + 2, z, z + 1, "paint")
        disc_yz(m, tail0 + 6, tail_z + fin - 4, 4.4, int(xc) + 2, int(xc) + 4, "rotorblur")
    return xc


def rotor_strip(path, d, blades, tip):
    """Flat main-rotor strip: slice 0 = blades + hub, slice 1 = hub cap. Drawn spinning by the game."""
    n = 2
    img = np.zeros((d, d * n, 4), np.uint8)
    c = (d - 1) / 2
    blade = ramp((70, 72, 82))
    for i in range(blades):
        a = 2 * math.pi * i / blades
        ca, sa = math.cos(a), math.sin(a)
        for y in range(d):
            for x in range(d):
                u = (x - c) * ca + (y - c) * sa
                v = -(x - c) * sa + (y - c) * ca
                if 2.5 <= u <= c and abs(v) <= 1.6:
                    col = blade[2] if v < 0 else blade[1]
                    if u > c - 4:
                        col = tip
                    img[y, x] = (*col, 255)
    for y in range(d):
        for x in range(d):
            r = math.hypot(x - c, y - c)
            if r <= 3.2:
                img[y, x] = (*blade[0], 255)
            if r <= 2.2:
                img[y, d + x] = (*blade[3], 255)
    Image.fromarray(img).save(path, optimize=True)
    return {"w": d, "h": d, "count": n}


@vehicle("tallgrass_sentinel", "Sentinel Air Unit", "Tallgrass Aero", "policeheli", "heli", (10.6, 2.4, 3.2),
         livery=True)
def _(m):
    m.define("paint", ramp((28, 44, 92)))
    L, W = m.L, m.W
    xc = heli(m, nose=L - 1, cab0=56, tail0=1, tail_z=19, mast_y=72, mast_z=31, fin=11)
    side_band(m, 6, 10, "stripe_w", y0=56, y1=L - 10, only="paint")
    m.skin_top(lambda y, x: 56 <= y < L - 14, "stripe_w", depth=3, only="paint")           # white roof
    m.box(L - 10, L - 7, int(xc) - 1, int(xc) + 3, 3, 6, "head")                 # searchlight
    m.box(62, 64, int(xc) - 3, int(xc), 27, 28, "sirenr")                          # beacons on the cowling
    m.box(62, 64, int(xc) + 1, int(xc) + 4, 27, 28, "sirenb")
    m.extra["rotor"] = {"d": 107, "blades": 4, "tip": (236, 196, 40), "mast": (72, 31)}


@vehicle("tallgrass_skywatch", "Skywatch News", "Tallgrass Aero", "newsheli", "heli", (10.9, 2.3, 3.3),
         livery=True)
def _(m):
    m.define("paint", ramp((222, 224, 228)))
    L, W = m.L, m.W
    xc = heli(m, nose=L - 1, cab0=60, tail0=1, tail_z=17, mast_y=76, mast_z=32, fin=10, fenestron=True, bulb=1.05)
    side_band(m, 7, 10, "orange", y0=20, y1=L - 8, only="paint")
    side_band(m, 10, 11, "redstripe", y0=20, y1=L - 8, only="paint")
    m.box(L - 8, L - 4, int(xc) - 1, int(xc) + 3, 2, 6, "trim")                  # camera gimbal
    m.box(L - 5, L - 4, int(xc), int(xc) + 2, 3, 5, "glassdark")
    m.box(70, 73, int(xc) - 1, int(xc) + 3, 5, 6, "navr")
    m.box(L - 6, L - 4, 2, 4, 8, 9, "head")
    m.extra["rotor"] = {"d": 107, "blades": 3, "tip": (230, 110, 30), "mast": (76, 32)}


@vehicle("redfork_roughneck_sheriff", "Roughneck Sheriff", "Red Fork", "police", "car", (6.1, 2.03, 2.05),
         livery=True)
def _(m):
    m.define("paint", ramp((206, 184, 140)))
    m.define("brown", ramp((86, 58, 40)))

    def b(c):
        return pickup(c, cab=17, hood=16, zb=12, zh=12, zhf=11, zc=4, zr=19, D=9, wf=12, wr=13, floor=6,
                      hl=(1, 5, 9, 11), gz=(6, 10), bz=(3, 6), grille="grille", bumper="trim", rim="rimdark",
                      hub=0.4)
    c, r = with_front(m, b, 2)
    push_bar(m, 4, 12)
    W = m.W
    side_band(m, 4, 9, "brown", y0=2, y1=m.L - 3, only="paint")
    badge(m, r["ry1"] - 3, 9, "gold")
    yc = r["ry1"] - 5
    light_bar(m, yc - 1, yc + 2, 20, 2, 0)
    m.box(r["by1"] - 2, r["by1"], W - 2, W, 13, 15, "chrome")


# =============================================================================================== catalogue data
Z_ALL = ["urban", "suburb", "rural", "highway", "industrial", "downtown", "rich"]
# class: mass kg, topSpeed m/s, accel m/s2, brake m/s2, grip, steer rad/s, drift, health, seats, engine, horn,
#        role, siren, spawn weight, zones, price $
CLASSES = {
    "economy": (1050, 44, 6.5, 11, 0.95, 2.7, 0.35, 650, 4, "i4", "high", "civilian", None, 1.3, ["urban", "suburb", "downtown"], 9000),
    "compact": (1250, 47, 7.0, 12, 1.0, 2.6, 0.35, 700, 5, "i4", "high", "civilian", None, 1.4, ["urban", "suburb", "downtown", "highway"], 15000),
    "electric": (1850, 52, 10.5, 13, 1.05, 2.4, 0.25, 800, 5, "electric", "mid", "civilian", None, 0.7, ["suburb", "downtown", "rich", "highway"], 41000),
    "sedan": (1500, 50, 7.5, 12.5, 1.0, 2.4, 0.4, 800, 5, "v6", "mid", "civilian", None, 1.6, ["urban", "suburb", "downtown", "highway"], 24000),
    "fullsize": (1800, 51, 7.5, 11.5, 0.95, 2.2, 0.5, 950, 5, "v8", "mid", "civilian", None, 1.0, ["urban", "suburb", "highway", "rural"], 13000),
    "luxury": (1950, 56, 8.5, 13.5, 1.05, 2.3, 0.35, 900, 5, "v8", "mid", "civilian", None, 0.5, ["rich", "downtown", "suburb", "highway"], 64000),
    "wagon": (1700, 48, 6.5, 11.5, 0.95, 2.3, 0.4, 850, 6, "v6", "mid", "civilian", None, 0.6, ["suburb", "rural", "urban"], 14000),
    "coupe": (1450, 54, 8.0, 12.5, 1.05, 2.6, 0.5, 750, 4, "v6", "mid", "civilian", None, 0.6, ["urban", "suburb", "highway", "downtown"], 26000),
    "convertible": (1500, 56, 8.5, 12.5, 1.05, 2.6, 0.5, 700, 4, "v8", "mid", "civilian", None, 0.35, ["rich", "suburb", "highway", "downtown"], 39000),
    "muscle": (1650, 62, 9.5, 12.5, 0.95, 2.4, 0.75, 900, 4, "v8_muscle", "low", "civilian", None, 0.45, ["urban", "suburb", "highway", "rural"], 36000),
    "sports": (1350, 68, 11.0, 14, 1.2, 2.8, 0.45, 750, 2, "v6", "mid", "civilian", None, 0.25, ["rich", "downtown", "highway"], 68000),
    "super": (1450, 80, 13.0, 15, 1.35, 3.0, 0.4, 750, 2, "v12_super", "mid", "special", None, 0.05, ["rich", "downtown"], 320000),
    "lowrider": (1800, 46, 6.0, 10.5, 0.85, 2.2, 0.6, 850, 5, "v8", "low", "gang", None, 0.3, ["urban"], 21000),
    "classic": (1750, 47, 6.0, 10, 0.85, 2.1, 0.65, 900, 6, "v8", "low", "civilian", None, 0.15, ["urban", "suburb", "highway", "rural"], 48000),
    "hotrod": (1050, 64, 11.5, 11, 0.9, 2.7, 0.8, 650, 2, "v8_muscle", "low", "special", None, 0.06, ["urban", "suburb", "highway"], 58000),
    "ratrod": (1300, 58, 10.0, 10, 0.85, 2.5, 0.85, 800, 2, "v8_muscle", "low", "gang", None, 0.12, ["urban", "industrial", "rural"], 8000),
    "minivan": (2000, 46, 6.0, 11, 0.9, 2.2, 0.3, 900, 7, "v6", "mid", "civilian", None, 1.0, ["suburb", "urban"], 31000),
    "crossover": (1600, 49, 7.0, 12, 0.95, 2.4, 0.3, 850, 5, "i4", "mid", "civilian", None, 1.3, ["suburb", "urban", "highway", "downtown"], 29000),
    "suv": (2550, 49, 7.0, 11, 0.9, 2.1, 0.35, 1100, 7, "v8", "low", "civilian", None, 0.9, ["suburb", "rich", "highway", "rural"], 54000),
    "offroad": (1900, 44, 7.0, 10.5, 0.9, 2.4, 0.45, 1050, 4, "v6", "mid", "civilian", None, 0.4, ["rural", "suburb"], 38000),
    "pickup": (2300, 47, 7.0, 11, 0.9, 2.1, 0.5, 1100, 5, "v8", "low", "civilian", None, 1.4, ["rural", "suburb", "industrial", "highway", "urban"], 44000),
    "workpickup": (2200, 44, 6.0, 10.5, 0.9, 2.1, 0.5, 1100, 3, "v8", "low", "service", None, 0.8, ["industrial", "suburb", "rural", "urban"], 33000),
    "compactpickup": (1500, 43, 6.0, 11, 0.95, 2.5, 0.5, 850, 2, "i4", "high", "civilian", None, 0.6, ["rural", "suburb", "urban"], 8000),
    "hdpickup": (3600, 44, 6.0, 9.5, 0.85, 1.9, 0.45, 1300, 5, "diesel", "truck", "civilian", None, 0.5, ["rural", "highway", "industrial"], 74000),
    "lifted": (3000, 42, 6.5, 9, 0.8, 2.0, 0.6, 1400, 5, "v8", "low", "civilian", None, 0.12, ["rural"], 61000),
    "farmtruck": (3200, 34, 4.0, 8, 0.8, 1.9, 0.55, 1200, 2, "diesel", "truck", "civilian", None, 0.4, ["rural"], 7000),
    "ranchtruck": (2200, 42, 5.5, 10, 0.85, 2.1, 0.6, 1100, 3, "v8", "low", "civilian", None, 0.5, ["rural"], 11000),
    "classicpickup": (1700, 40, 5.0, 9.5, 0.85, 2.2, 0.6, 900, 3, "v8", "low", "civilian", None, 0.15, ["rural", "suburb", "urban"], 29000),
    "towrig": (4100, 38, 4.5, 8.5, 0.85, 1.7, 0.4, 1300, 5, "v8", "low", "civilian", None, 0.2, ["rural", "highway", "suburb"], 91000),
    "oilfield": (6500, 36, 3.5, 7.5, 0.85, 1.7, 0.4, 1500, 3, "diesel", "truck", "service", None, 0.3, ["rural", "industrial", "highway"], 145000),
    "van": (2400, 42, 5.5, 10, 0.85, 2.1, 0.35, 1000, 2, "v8", "mid", "service", None, 0.9, ["urban", "industrial", "suburb", "downtown"], 39000),
    "churchvan": (2900, 40, 5.0, 9.5, 0.8, 2.0, 0.35, 1000, 15, "v8", "mid", "civilian", None, 0.3, ["suburb", "urban", "rural"], 36000),
    "newsvan": (3200, 38, 4.5, 9, 0.8, 1.9, 0.35, 1100, 3, "v8", "mid", "service", None, 0.1, ["downtown", "urban"], 120000),
    "swat": (7500, 36, 4.0, 8, 0.85, 1.8, 0.3, 2400, 10, "diesel", "truck", "police", "police", 0.0, ["urban", "downtown"], 260000),
    "armored": (8000, 34, 3.5, 7.5, 0.85, 1.7, 0.3, 3000, 4, "diesel", "truck", "service", None, 0.1, ["downtown", "urban", "rich"], 180000),
    "ambulance": (5000, 40, 5.0, 9, 0.85, 1.9, 0.35, 1300, 4, "diesel", "mid", "emergency", "ambulance", 0.12, ["urban", "suburb", "downtown", "highway"], 165000),
    "boxtruck": (7000, 34, 3.5, 7.5, 0.8, 1.7, 0.35, 1500, 2, "diesel", "truck", "service", None, 0.6, ["industrial", "urban", "highway", "downtown"], 66000),
    "stepvan": (6000, 34, 3.5, 7.5, 0.8, 1.8, 0.35, 1400, 1, "diesel", "mid", "service", None, 0.4, ["suburb", "urban", "downtown"], 72000),
    "icecream": (5000, 32, 3.0, 7, 0.8, 1.8, 0.35, 1200, 2, "v8", "squeaky", "service", None, 0.12, ["suburb"], 52000),
    "foodtruck": (7500, 33, 3.0, 7, 0.8, 1.7, 0.35, 1400, 2, "diesel", "truck", "service", None, 0.2, ["downtown", "urban", "industrial"], 88000),
    "wrecker": (7000, 36, 3.5, 7.5, 0.85, 1.7, 0.35, 1600, 2, "diesel", "truck", "service", None, 0.2, ["urban", "highway", "industrial"], 92000),
    "garbage": (16000, 30, 2.5, 6.5, 0.8, 1.5, 0.3, 2200, 2, "diesel_big", "truck", "service", None, 0.3, ["urban", "suburb", "industrial"], 285000),
    "mixer": (18000, 30, 2.2, 6, 0.75, 1.5, 0.3, 2400, 2, "diesel_big", "truck", "service", None, 0.25, ["industrial", "highway", "urban"], 165000),
    "dump": (15000, 32, 2.5, 6.5, 0.8, 1.6, 0.35, 2200, 2, "diesel_big", "truck", "service", None, 0.3, ["industrial", "rural", "highway"], 155000),
    "semi": (9000, 34, 3.0, 7, 0.8, 1.6, 0.35, 2200, 2, "diesel_big", "truck", "civilian", None, 0.4, ["highway", "industrial"], 165000),
    "semitrailer": (24000, 31, 1.8, 5.5, 0.75, 1.2, 0.3, 3000, 2, "diesel_big", "truck", "civilian", None, 0.5, ["highway", "industrial"], 210000),
    "tanker": (26000, 30, 1.7, 5.5, 0.75, 1.2, 0.3, 3000, 2, "diesel_big", "truck", "service", None, 0.3, ["highway", "industrial", "rural"], 235000),
    "pipetruck": (28000, 30, 1.6, 5.5, 0.75, 1.2, 0.3, 3000, 2, "diesel_big", "truck", "service", None, 0.25, ["highway", "industrial", "rural"], 220000),
    "fire": (17000, 36, 3.0, 7, 0.85, 1.6, 0.3, 2600, 6, "diesel_big", "truck", "emergency", "fire", 0.06, ["urban", "suburb", "downtown"], 520000),
    "schoolbus": (12000, 28, 2.2, 6, 0.75, 1.3, 0.3, 2400, 48, "diesel_big", "truck", "service", None, 0.25, ["suburb", "urban", "rural"], 98000),
    "citybus": (13000, 28, 2.0, 6, 0.75, 1.3, 0.3, 2600, 40, "diesel_big", "truck", "service", None, 0.4, ["downtown", "urban"], 460000),
    "rv": (7000, 32, 2.5, 6.5, 0.75, 1.4, 0.3, 1800, 6, "v8", "truck", "civilian", None, 0.15, ["highway", "rural"], 98000),
    "limo": (2900, 48, 5.5, 10, 0.9, 1.6, 0.35, 1100, 8, "v8", "mid", "special", None, 0.08, ["rich", "downtown"], 125000),
    "hearse": (2400, 47, 6.0, 11, 0.9, 2.0, 0.4, 950, 2, "v8", "low", "service", None, 0.05, ["urban", "suburb"], 82000),
    "cart": (450, 9, 2.5, 6, 0.8, 2.8, 0.2, 350, 2, "electric", "squeaky", "civilian", None, 0.2, ["rich", "suburb"], 7500),
    "taxi": (1750, 49, 7.0, 11.5, 0.95, 2.3, 0.45, 950, 5, "v6", "mid", "service", None, 0.8, ["downtown", "urban"], 27000),
    "police": (1850, 58, 9.0, 13.5, 1.05, 2.4, 0.5, 1200, 4, "v8", "mid", "police", "police", 0.25, ["urban", "suburb", "downtown", "highway"], 46000),
    "bicycle": (13, 10, 3.0, 5, 0.85, 3.2, 0.3, 120, 1, "bicycle", "bike_bell", "civilian", None, 0.5, ["urban", "suburb", "downtown"], 450),
    "escooter": (15, 8, 2.5, 5, 0.8, 3.2, 0.25, 90, 1, "electric", "bike_bell", "civilian", None, 0.5, ["downtown", "urban"], 600),
    "scooter": (110, 20, 4.5, 7, 0.9, 3.0, 0.3, 250, 2, "moto_2t", "moto", "civilian", None, 0.4, ["urban", "downtown", "suburb"], 3200),
    "moped": (95, 18, 4.0, 7, 0.9, 3.0, 0.3, 230, 1, "moto_2t", "moto", "service", None, 0.3, ["urban", "downtown", "suburb"], 2400),
    "sportbike": (190, 75, 13.0, 13, 1.25, 3.0, 0.3, 350, 2, "moto_4t", "moto", "civilian", None, 0.25, ["urban", "highway", "downtown"], 16000),
    "chopper": (300, 55, 8.0, 9, 0.95, 2.2, 0.4, 450, 2, "moto_v2", "moto", "gang", None, 0.2, ["urban", "highway", "rural"], 24000),
    "dirtbike": (115, 50, 10.0, 9, 0.9, 3.2, 0.6, 300, 1, "moto_2t", "moto", "civilian", None, 0.2, ["rural"], 9000),
    "touring": (380, 58, 8.0, 11, 1.05, 2.2, 0.3, 500, 2, "moto_v2", "moto", "civilian", None, 0.2, ["highway", "rural", "suburb"], 28000),
    "policebike": (370, 62, 9.0, 12, 1.1, 2.4, 0.3, 500, 1, "moto_v2", "moto", "police", "police", 0.08, ["downtown", "highway", "urban"], 30000),
    "atv": (300, 30, 7.0, 8, 0.85, 2.9, 0.6, 400, 1, "atv", "high", "civilian", None, 0.3, ["rural"], 9000),
    "utv": (750, 28, 6.0, 8, 0.9, 2.5, 0.55, 600, 2, "atv", "mid", "civilian", None, 0.25, ["rural"], 21000),
    "atv6": (450, 26, 5.0, 7, 0.95, 2.4, 0.45, 500, 1, "atv", "high", "civilian", None, 0.12, ["rural"], 15000),
    "mower": (250, 8, 1.8, 4, 0.8, 2.8, 0.2, 250, 1, "mower", "squeaky", "civilian", None, 0.15, ["suburb", "rich"], 3000),
    "tractor": (6500, 12, 1.5, 4.5, 0.8, 1.6, 0.2, 1500, 1, "tractor", "truck", "civilian", None, 0.25, ["rural"], 165000),
    "combine": (16000, 9, 1.0, 4, 0.75, 1.0, 0.1, 3000, 1, "diesel_big", "truck", "civilian", None, 0.05, ["rural"], 480000),
    "bassboat": (900, 30, 7.0, 3, 0.6, 1.8, 0.7, 500, 3, "outboard", "high", "civilian", None, 0.6, ["water"], 52000),
    "pontoon": (1600, 18, 3.0, 2, 0.5, 1.2, 0.6, 600, 10, "outboard", "mid", "civilian", None, 0.4, ["water"], 45000),
    "airboat": (800, 26, 6.0, 2, 0.45, 1.8, 0.9, 500, 4, "v8", "low", "civilian", None, 0.15, ["water"], 60000),
    "policeheli": (1400, 55, 6.0, 6, 1.0, 1.6, 0.2, 1200, 4, "turbine", "low", "police", "police", 0.0, ["urban", "downtown", "suburb", "highway"], 2400000),
    "newsheli": (1300, 55, 6.0, 6, 1.0, 1.6, 0.2, 1000, 4, "turbine", "low", "service", None, 0.0, ["downtown", "urban"], 2100000),
}
KEYS = ["mass", "topSpeed", "accel", "brake", "grip", "steer", "drift", "health", "seats", "engine", "horn", "role",
        "siren"]

# per-vehicle tweaks on top of the class defaults (also: weight, zones, price)
TWEAK = {
    "redbud_pip": dict(topSpeed=42, accel=6.0, mass=920, seats=4),
    "redbud_bloom": dict(engine="electric", accel=8.5, topSpeed=43, mass=1500),
    "prairie_sprig": dict(topSpeed=46),
    "osage_ledger": dict(mass=1850, drift=0.55),
    "keystone_magistrate": dict(topSpeed=60, accel=9.5, grip=1.1, engine="v6"),
    "redbud_trailhead": dict(engine="i4", grip=1.0),
    "keystone_baron": dict(engine="v8", topSpeed=52, steer=2.2, drift=0.55, price=19000, zones=["urban", "suburb", "rich"]),
    "scissortail_zephyr": dict(engine="i4", topSpeed=58, accel=9.0, grip=1.15, steer=2.9, seats=2, mass=1050),
    "cimarron_dustdevil": dict(topSpeed=63, drift=0.7),
    "cimarron_haymaker": dict(topSpeed=68, accel=10.5, grip=1.0, health=950, price=48000),
    "scissortail_peregrine": dict(topSpeed=72, accel=11.5, grip=1.25, steer=2.9),
    "keystone_rapier": dict(topSpeed=72, engine="v8", accel=11.0, price=110000),
    "derecho_anvil": dict(topSpeed=78, accel=12.5, grip=1.3, drift=0.45),
    "derecho_downburst": dict(topSpeed=85, accel=14.0, grip=1.4, brake=16, price=1900000),
    "speedshop_rustbucket": dict(paintless=True),
    "prairie_nester": dict(topSpeed=44, price=6000),
    "verdigris_heron": dict(engine="electric", accel=9.5, topSpeed=50, mass=2200, zones=["suburb", "rich", "downtown", "highway"]),
    "keystone_chancellor": dict(price=92000, topSpeed=52, zones=["rich", "downtown", "suburb", "highway"]),
    "redfork_mudcat": dict(grip=0.95),
    "redfork_roustabout": dict(price=34000),
    "sooner_farmhand": dict(seats=2),
    "keystone_regalia": dict(price=135000),
    "osage_ledger_police": dict(),
    "redfork_outrider_police": dict(mass=2550, topSpeed=53, accel=8.0, brake=12.5, grip=1.0, steer=2.2, drift=0.4,
                                    health=1400, weight=0.18),
    "cimarron_pursuit": dict(mass=1800, topSpeed=66, accel=10.5, brake=14, grip=1.1, steer=2.5, drift=0.55, weight=0.1,
                             zones=["highway", "urban", "downtown"]),
    "osage_meridian_detective": dict(mass=1650, topSpeed=56, accel=8.5, brake=13, steer=2.4, drift=0.45, health=1100,
                                     weight=0.05, engine="v6", zones=["downtown", "urban"]),
    "cimarron_lawman": dict(mass=1850, topSpeed=64, accel=10.0, brake=14, grip=1.1, drift=0.5, weight=0.12,
                            zones=["highway", "rural", "suburb"]),
    "redfork_roughneck_sheriff": dict(mass=2400, topSpeed=50, accel=7.5, brake=12, grip=0.95, steer=2.1, drift=0.5,
                                      health=1400, weight=0.12, zones=["rural", "suburb", "highway"]),
    "heartland_aerial": dict(mass=25000, topSpeed=33, accel=2.2, brake=6, steer=1.3, health=3000, seats=4, price=950000),
    "sandhill_kicker": dict(topSpeed=9.5, accel=3.5, steer=3.4, drift=0.45, price=350),
    "sandhill_velo": dict(topSpeed=12, accel=3.2, grip=0.9, steer=2.9, price=1800, zones=["urban", "suburb", "rural", "downtown"]),
    "sandhill_boardwalk": dict(topSpeed=9, accel=2.6, steer=2.9, price=420),
    "zipline_scoot": dict(weight=0.6),
}

DESC = {
    "redbud_pip": "Tiny city hatch that parks anywhere on Cherry Street and still has room for one Braum's bag.",
    "prairie_dash": "Five-door hatch with a roof spoiler nobody asked for; the default first car of every TCC student.",
    "prairie_sprig": "Sensible compact sedan in sensible sage. Gets 40 mpg and zero second looks.",
    "redbud_bloom": "Bubbly little EV with a glass roof; plugs in at every grocery store from Jenks to Owasso.",
    "osage_meridian": "The mid-size sedan in every Broken Arrow driveway and every 71st Street traffic jam.",
    "osage_ledger": "Body-on-frame full-size from the '90s. Floats like a couch, refuses to die.",
    "verdigris_current": "Silent electric fastback; it'll beat your muscle car to the next red light on Memorial.",
    "keystone_sovereign": "Black-on-chrome luxury barge for oil money that likes the old ways.",
    "keystone_magistrate": "Executive sport sedan with a sunroof, a lease and an opinion about lane discipline.",
    "osage_homestead": "Wood-panelled family wagon with a chrome roof rack, veteran of a thousand Grand Lake trips.",
    "redbud_trailhead": "AWD wagon with a roof box; equally happy at Turkey Mountain or the Whole Foods lot.",
    "bluedome_vesper": "Neat two-door coupe in sunshine yellow, the Blue Dome District's favourite date car.",
    "keystone_baron": "Seventies personal-luxury coupe: opera windows, landau roof, hood longer than your driveway.",
    "cimarron_sundowner": "Top-down cruiser made for Route 66 sunsets and tan leather that burns in July.",
    "scissortail_zephyr": "Two-seat roadster with roll hoops; tiny, light and absurdly fun on Highway 10's curves.",
    "cimarron_thunderhead": "Big-block '70s muscle with a hood scoop and twin stripes; loud enough to rattle the Cain's windows.",
    "cimarron_dustdevil": "Fastback pony car with louvres and a ducktail. Leaves a dust devil on every dirt road.",
    "cimarron_haymaker": "Modern muscle coupe with a wing and dual stripes. Supercharged, overconfident, purple.",
    "scissortail_kestrel": "Lightweight front-engine sports coupe that dances through the Riverside Drive curves.",
    "scissortail_peregrine": "Mid-engine lime rocket with gaping side intakes; the fastest bird in the Scissortail nest.",
    "keystone_rapier": "Long-hood grand tourer for Southern Hills members who drive to the club the long way.",
    "derecho_anvil": "Eighties wedge supercar with pop-up lights and louvres; a poster car that grew wheels.",
    "derecho_downburst": "Carbon hypercar with a swan-neck wing. Named for the storm that flattens wheat fields.",
    "bluedome_bajito": "Candy-purple lowrider on gold wires, three inches off North Peoria's asphalt.",
    "motherroad_jetfin": "1950s Route 66 cruiser in turquoise and white, tail fins sharp enough to slice pie.",
    "speedshop_highboy": "Fenderless hot rod with a chrome blower poking through; built in a Brookside garage.",
    "speedshop_rustbucket": "Chopped, rusted rat rod with zoomie pipes. Patina is a lifestyle, not a problem.",
    "arkvalley_carpool": "Modern minivan with sliding doors, eight cupholders and three car seats' worth of crumbs.",
    "prairie_nester": "Nineties minivan with faux-wood sides, the official chariot of every Little League carpool.",
    "osage_wren": "Small crossover with black cladding, sized for Tulsa parking garages.",
    "verdigris_heron": "Electric crossover with a glass roof and a full-width light bar; whisper-quiet school run.",
    "redfork_outrider": "Full-size three-row SUV with roof rails and running boards; built for Okie road trips.",
    "keystone_chancellor": "Blacked-out luxury SUV with a chrome grille the size of a barn door.",
    "redfork_mudcat": "Two-door 4x4 with a snorkel, light bar and spare on the back. Lives on the Keystone Lake trails.",
    "keystone_regalia": "White stretch limo for proms, weddings and anyone who wins big at the casino.",
    "keystone_repose": "Black hearse with chrome landau bars and curtained windows. Drives slow on purpose.",
    "pecan_fairway": "Electric golf cart with a green canopy; spotted far off the course in every gated neighbourhood.",
    "prairie_fleetline_cab": "Yellow cab with a checker stripe and roof light, working the airport-to-downtown run.",
    "osage_ledger_police": "Black-and-white police cruiser with a light bar, push bar and a spotlight on the A-pillar.",
    "redfork_outrider_police": "White police SUV with blue stripes and a push bar; the city's front-line patrol unit.",
    "cimarron_pursuit": "Ghost-striped pursuit coupe with a low-profile bar. If it's behind you, you're already caught.",
    "osage_meridian_detective": "Beige unmarked sedan with dash lights, steel wheels and too many antennas to fool anyone.",
    "cimarron_lawman": "Highway patrol muscle sedan in silver and navy, hiding in the turnpike median.",
    "redfork_roughneck": "Crew-cab full-size pickup in barn red; the unofficial state vehicle.",
    "redfork_roustabout": "White regular-cab work truck with a ladder rack and crossover toolbox.",
    "prairie_jackrabbit": "Little '90s compact pickup with a stripe, still running on its third engine.",
    "sooner_bigiron": "One-ton dually with a gooseneck hitch; tows the horse trailer to the State Fair every September.",
    "redfork_mudbogger": "Lifted mud truck on 44-inch tyres, light bar on top and the river bottom all over it.",
    "sooner_farmhand": "Sixties flatbed farm truck stacked with square bales, rarely over 35 mph.",
    "redfork_cattleman": "Square-body ranch truck with a headache rack and a round bale riding in the bed.",
    "motherroad_stepside": "Fifties stepside pickup with whitewalls and running boards; a Route 66 postcard on wheels.",
    "redfork_bassrig": "Pickup towing a metal-flake bass boat to Fort Gibson at 5 a.m. on a Saturday.",
    "driller_rigtender": "Oilfield service truck with a knuckle crane, compartments full of wrenches and a pipe dope smell.",
    "sooner_wrecker": "Red wrecker with a boom and wheel-lift, first on scene at every I-44 pile-up.",
    "arkvalley_cargo": "Plain white panel van; plumbers, florists and kidnappers in the movies all agree.",
    "arkvalley_fellowship": "Fifteen-passenger church van with stripes, carrying the youth group to camp at Lake Tenkiller.",
    "arkvalley_newsvan": "Channel Nine Eyewitness live unit with a satellite dish and a mast for breaking storm coverage.",
    "arkvalley_tactical": "Armoured black tactical van with a ram bumper. The SWAT team's ride.",
    "sooner_strongbox": "Armoured cash-in-transit truck with gun ports; banks downtown expect it at 10:15 sharp.",
    "arkvalley_medic": "Type III ambulance with red stripes and corner beacons, running lights to Saint Francis.",
    "sooner_box16": "Sixteen-foot box truck with a roll-up door; moves furniture and the occasional band.",
    "arkvalley_stepper": "Prairie Parcel step van in green and cream, never fully stopping at your porch.",
    "arkvalley_sundae": "Ice-cream truck with a giant cone on the roof and a jingle you'll hear in your sleep.",
    "sooner_smokehouse": "BBQ food truck towing its own smoker; brisket by noon, sold out by one.",
    "sooner_longhaul": "Long-nose sleeper tractor with chrome stacks, bobtailing between Catoosa and the turnpike.",
    "sooner_longhaul_dryvan": "Day-cab semi hauling a 44-foot dry van down I-44 toward Oklahoma City.",
    "sooner_crudehauler": "Tractor pulling a polished crude tank from the lease road to the Glenpool tank farm.",
    "sooner_pipehauler": "Flatbed semi stacked with strapped line pipe bound for the next oilfield job.",
    "heartland_pumper": "Engine 21 pumper with a hose bed, ground ladders and lots of chrome.",
    "heartland_aerial": "Ladder 7 aerial truck; the ladder rests over the cab until somebody's cat needs it.",
    "sooner_refuser": "Green rear-loader garbage truck with a low-entry cab; Tuesday mornings' alarm clock.",
    "arbuckle_churn": "Cement mixer with an orange-and-white spiral drum, always turning, always late.",
    "arbuckle_quarryman": "Long-nose dump truck hauling crushed limestone from the Arbuckle quarries.",
    "heartland_scholar": "Yellow conventional school bus with stop arm and flashing reds. Do not pass.",
    "heartland_transit": "Green Country Transit city bus with a front bike rack, rolling down Peoria every 20 minutes.",
    "heartland_wanderer": "Class C motorhome with a cab-over bunk and brown swooshes, retirees bound for Branson.",
    "redfork_roughneck_sheriff": "County sheriff's pickup in tan and brown with a gold star, push bar and light bar.",
    "sandhill_kicker": "Neon-green BMX with pegs, born on the River Parks dirt jumps.",
    "sandhill_velo": "Lightweight road bike with drop bars for the Saturday ride down Riverside.",
    "sandhill_boardwalk": "Beach cruiser with fenders and a wicker basket; no beach, still cruising.",
    "zipline_scoot": "Lime-green rental e-scooter, abandoned on a downtown sidewalk near you.",
    "scissortail_piccolo": "Mint step-through scooter with leg shields and a cream seat.",
    "ozark_putt": "Fifty-cc delivery moped with a pizza box on the back; it'll get there, eventually.",
    "scissortail_talon": "Fully-faired sport bike that hits 160 before the Broken Arrow Expressway ends.",
    "ozark_drifter": "Raked-out chopper with ape hangers and a sissy bar; loud, slow to turn, very cool.",
    "kiamichi_mudlark": "Orange two-stroke dirt bike for the sand pits along the Arkansas River.",
    "ozark_longroad": "Full-dress bagger with batwing fairing, saddlebags and a trunk; built for Route 66 all the way.",
    "ozark_longroad_patrol": "Police touring bike with a tall screen and light masts; traffic unit's favourite.",
    "kiamichi_brushbuster": "Red 4x4 quad with racks front and back, the deer-lease workhorse.",
    "kiamichi_ridgerunner": "Side-by-side UTV with a roll cage, canvas roof, light bar and a dump bed.",
    "kiamichi_workhorse": "Six-wheeled ATV with a cargo box; carries feed sacks where trucks won't go.",
    "bermuda_lawnpro": "Riding mower with a 42-inch deck; top speed is a brisk walk, top style is unmatched.",
    "panhandle_sodbuster": "Big-wheel farm tractor with an enclosed cab, orange paint and a cream roof.",
    "panhandle_reaper": "Combine harvester with a 30-foot header; when wheat harvest hits, it owns the county road.",
    "jenks_lunker": "Metal-flake bass boat with a trolling motor and a big outboard; tournament ready.",
    "jenks_sunsetter": "Pontoon boat with couches and a navy bimini top, the Grand Lake party platform.",
    "jenks_skimmer": "Airboat with a caged prop, skimming the Arkansas River sandbars at deafening volume.",
    "tallgrass_sentinel": "Police helicopter with a searchlight; the eye in the sky over Tulsa at night.",
    "tallgrass_skywatch": "News helicopter with a nose camera ball and a shrouded tail fan; first to every storm.",
}


# =============================================================================================== output
def render_angle(vol, deg, squash=0.75):
    return vts.render_stack_image(vol, deg, squash=squash, spacing=1.0, shadow=True, outline=True)


def contact_sheet(entries, path, scale=3, cols=None, title=None, maxw=None):
    """entries: list of (label, vol). Two angles per vehicle, shelf-packed rows."""
    cells = []
    for label, vol in entries:
        a = render_angle(vol, 30)
        b = render_angle(vol, 120)
        w = a.width + b.width + 4
        h = max(a.height, b.height)
        cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cell.paste(a, (0, h - a.height), a)
        cell.paste(b, (a.width + 4, h - b.height), b)
        cell = cell.resize((cell.width * scale, cell.height * scale), Image.NEAREST)
        cells.append((label, cell))
    maxw = maxw or (2400 if cols is None else cols)
    pad, lab = 10, 14
    rows, row, rw = [], [], 0
    for lc in cells:
        if row and rw + lc[1].width + pad > maxw:
            rows.append(row)
            row, rw = [], 0
        row.append(lc)
        rw += lc[1].width + pad
    if row:
        rows.append(row)
    W = max(sum(c.width + pad for _, c in r) for r in rows) + pad
    Ht = sum(max(c.height for _, c in r) + lab + pad for r in rows) + pad + (20 if title else 0)
    sheet = Image.new("RGB", (W, Ht), (226, 230, 236))
    d = ImageDraw.Draw(sheet)
    y = pad
    if title:
        d.text((pad, 4), title, fill=(30, 30, 40))
        y += 20
    for r in rows:
        x = pad
        rh = max(c.height for _, c in r)
        for label, c in r:
            d.text((x, y), label, fill=(30, 34, 46))
            sheet.paste(c, (x, y + lab + rh - c.height), c)
            x += c.width + pad
        y += rh + lab + pad
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="", help="comma-separated vehicle ids to rebuild")
    ap.add_argument("--jobs", type=int, default=8)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    only = {s.strip() for s in a.only.split(",") if s.strip()}
    ids = [v["id"] for v in VEH]
    assert len(ids) == len(set(ids)), "duplicate ids"
    todo = [v for v in VEH if not only or v["id"] in only]
    if only and len(todo) != len(only):
        print("unknown ids:", only - set(ids))
    results = {}
    failed = []
    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futs = {v["id"]: ex.submit(build_one, v) for v in todo}
        for vid, f in futs.items():
            try:
                r = f.result()
            except Exception as e:  # report and carry on so one bad model doesn't hide the rest
                failed.append(vid)
                print(f"FAILED {vid}: {str(e).splitlines()[0] if str(e) else e!r}")
                continue
            results[vid] = r
            m = r["m"]
            print(f"{vid:28s} {m.W:3d}x{m.L:3d}x{m.H:2d}  repainted {r['rep']:5d}" + ("  " + "; ".join(r["warns"]) if r["warns"] else ""))
    if failed:
        print("failed:", ",".join(failed))
    if not only and not failed:
        keep = {f"{v['id']}.png" for v in VEH} | {f"{v['id']}_rotor.png" for v in VEH} | {"catalog.json", "sprites.json"}
        for f in OUT.iterdir():
            if f.name not in keep:
                print("removing stale", f.name)
                f.unlink()
    write_catalog(results)
    entries = [(f"{vid} {results[vid]['m'].W}x{results[vid]['m'].L}x{results[vid]['m'].H}", results[vid]["vol"]) for vid in results]
    contact_sheet(entries, BUILD / ("contact_partial.png" if only else "contact_sheet.png"))
    if not only:
        for k in range(0, len(entries), 16):
            contact_sheet(entries[k:k + 16], BUILD / f"contact_part{k // 16 + 1}.png", maxw=1800)


def write_catalog(results):
    path = OUT / "catalog.json"
    old = {}
    if path.exists():
        try:
            old = {v["id"]: v for v in json.loads(path.read_text())["vehicles"]}
        except Exception:
            old = {}
    vehicles = []
    for spec in VEH:
        vid = spec["id"]
        if vid in results:
            vehicles.append(catalog_entry(spec, results[vid]["m"]))
        elif vid in old:
            vehicles.append(old[vid])
    doc = {"artScale": MPP, "sliceH": MPP, "vehicles": vehicles}
    path.write_text(json.dumps(doc, indent=1))
    from build_sprite_bundles import write_sprite_bundle
    write_sprite_bundle(OUT)


def catalog_entry(spec, m):
    vid = spec["id"]
    e = {"id": vid, "name": spec["name"], "make": spec["make"], "class": spec["cls"], "kind": spec["kind"],
         "file": f"{vid}.png", "w": int(m.W), "h": int(m.L), "count": int(m.H),
         "len": round(m.L * MPP, 2), "wid": round(m.W * MPP, 2), "hgt": round(m.H * MPP, 2)}
    base = CLASSES[spec["cls"]]
    tw = dict(TWEAK.get(vid, {}))
    for k, v in zip(KEYS, base[:13]):
        e[k] = tw.pop(k, v)
    weight = tw.pop("weight", base[13])
    zones = tw.pop("zones", base[14])
    price = tw.pop("price", base[15])
    paintless = tw.pop("paintless", False)
    pid = m.ids.get("paint")
    e["paint"] = ([list(t) for t in m.mats[pid]["tones"]]
                  if pid and not spec["meta"].get("livery") and not paintless else [])
    e["lights"] = lights_of(m, amber_beacon=spec["cls"] in ("wrecker", "oilfield", "workpickup", "armored", "garbage"))
    e["spawn"] = {"weight": weight, "zones": zones}
    e["price"] = price
    if "waterline" in m.extra:
        e["waterline"] = m.extra["waterline"]
    if "rotor_strip" in m.extra:
        rs, ro = m.extra["rotor_strip"], m.extra["rotor"]
        my, mz = ro["mast"]
        my -= m.extra.get("crop", (0, 0))[0]
        e["rotor"] = f"{vid}_rotor.png"
        e["rotorW"], e["rotorH"], e["rotorCount"] = rs["w"], rs["h"], rs["count"]
        e["rotorZ"] = int(mz) + 1
        e["rotorPos"] = [0.0, round((my + 0.5 - (m.L - 1) / 2) * MPP, 2)]
    e["desc"] = DESC.get(vid, "")
    assert not tw, f"{vid}: unknown tweak keys {list(tw)}"
    return e


if __name__ == "__main__":
    main()
