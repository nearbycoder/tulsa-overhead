#!/usr/bin/env python3
"""GTPolly prop + landmark sprite-stack generator (deterministic, re-runnable).

Outputs
  assets/props/<id>.png        horizontal strip of `count` slices (w x h each), ground slice leftmost,
                               transparent background, front of the prop facing DOWN (+y).
  assets/props/<id>_emit.png   optional emissive strip (same dims): glow colour where lit, else clear.
  assets/props/catalog.json    one entry per prop (see PROPS registry below for the fields).
  build/props/contact_sheet.png  every prop at two angles (squash 0.75), labelled.
  build/props/sheet_<kind>.png   larger per-kind sheets; build/props/views/<id>.png carve sheets.

Two build paths
  carve  Boxy / lathe props: four orthographic pixel-art views (TOP, SIDE, FRONT, BACK on flat white,
         1px dark outline, identical scale) are drawn here at native resolution, upscaled 8x into a
         1x4 sheet and carved by the vendored slicer tools/sprite-stacking/views_to_slices.py with
         --slices = SIDE native height, --top-nose down, --colours 0 (and --round where needed).
  voxel  Anything with overhangs, cavities or organic form (statues, trees, animals, lattices, the
         whale's open mouth) is built directly as a 3D volume in metres and shaded from smoothed
         surface normals with 4-tone hue-shifted ramps (rotation-invariant: no baked side light).

Usage
  .venv/bin/python tools/gen_props.py                 # everything
  .venv/bin/python tools/gen_props.py --only oak_1,pumpjack
"""
from __future__ import annotations

import argparse
import colorsys
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "sprite-stacking"))
import views_to_slices as vts  # noqa: E402  (vendored sprite-stacking slicer, MIT)

OUT = ROOT / "assets" / "props"
BUILD = ROOT / "build" / "props"


# ============================================================================ colour
def rgb(c):
    if isinstance(c, (tuple, list)):
        return tuple(int(v) for v in c[:3])
    c = c.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))


def _toward(h, target, amt):
    d = ((target - h + 0.5) % 1.0) - 0.5
    return (h + max(-amt, min(amt, d))) % 1.0


def make_ramp(base, hs=0.035):
    """4 tones [deep, shadow, base, light]: shadows cool + saturated, highlights warm + bright."""
    r, g, b = (v / 255 for v in rgb(base))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    grey = s < 0.1
    out = []
    for k, (dh, ds, vm, va) in enumerate(
        [(-2, 0.10, 0.58, 0.0), (-1, 0.05, 0.79, 0.0), (0, 0.0, 1.0, 0.0), (1, -0.12, 1.0, 0.30)]
    ):
        if grey:
            hh = 0.62 if dh < 0 else 0.11
            ss = s + (0.07 if dh == -2 else 0.045 if dh == -1 else 0.035 if dh > 0 else 0)
        else:
            hh = _toward(h, 0.62 if dh < 0 else 0.13, abs(dh) * hs)
            ss = min(1.0, max(0.0, s * (1 + ds * (2 if dh else 0)) + (ds if dh < 0 else 0)))
            if dh > 0:
                ss = s * 0.82
        vv = min(1.0, v * vm + (1 - v) * va + (0.06 if dh > 0 else 0))
        cr, cg, cb = colorsys.hsv_to_rgb(hh, ss, vv)
        out.append((round(cr * 255), round(cg * 255), round(cb * 255)))
    return out


class Mat:
    """A voxel material: 4-tone ramp + shading response.

    base/kz: tone score = base + kz * normal_z (walls ~ base, tops ~ base + kz).
    noise: +- tone jitter from clustered value noise (cell = cluster size in voxels).
    emit: voxels glow at night (written to the emissive strip in their lit colour).
    tone: force a fixed tone index (flat paint, neon)."""

    def __init__(self, base=None, ramp=None, *, emit=False, tone=None, noise=0.0, cell=3, seed=1,
                 b=2.2, kz=1.15, shadow=1.0, hs=0.035, ao=0.6):
        self.r = [rgb(c) for c in ramp] if ramp else make_ramp(base, hs)
        self.emit, self.tone, self.noise, self.cell, self.seed = emit, tone, noise, cell, seed
        self.b, self.kz, self.shadow, self.ao = b, kz, shadow, ao


def M(*a, **k):
    return Mat(*a, **k)


# ============================================================================ helpers
def box_blur(a, axis, r=1):
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r, r)
    p = np.pad(a, pad, mode="constant")
    c = np.cumsum(p, axis=axis, dtype=np.float32)
    c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return (hi - lo) / (2 * r + 1)


def blur3(a, r=1):
    for ax in range(a.ndim):
        a = box_blur(a, ax, r)
    return a


def value_noise(shape, cell, seed):
    """Smooth 3D value noise in [0,1], features ~cell voxels (cell may be a (cz, cy, cx) tuple)."""
    if not isinstance(cell, (tuple, list)):
        cell = (cell, cell, cell)
    rng = np.random.default_rng(seed)
    g = rng.random(tuple(int(math.ceil(s / c)) + 2 for s, c in zip(shape, cell)))
    out = g
    for ax, (n, c) in enumerate(zip(shape, cell)):
        t = (np.arange(n) + 0.5) / c
        i0 = np.floor(t).astype(int)
        f = t - i0
        f = f * f * (3 - 2 * f)
        a0 = np.take(out, i0, axis=ax)
        a1 = np.take(out, i0 + 1, axis=ax)
        sh = [1] * out.ndim
        sh[ax] = n
        f = f.reshape(sh)
        out = a0 * (1 - f) + a1 * f
    return out


def open2(occ):
    """Per-slice morphological opening with a 2x2 block: drops 1px specks/lines that would blink."""
    b = occ[:, :-1, :-1] & occ[:, 1:, :-1] & occ[:, :-1, 1:] & occ[:, 1:, 1:]
    keep = np.zeros_like(occ)
    keep[:, :-1, :-1] |= b
    keep[:, 1:, :-1] |= b
    keep[:, :-1, 1:] |= b
    keep[:, 1:, 1:] |= b
    return occ & keep


# ============================================================================ pixel font
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    "I": ["111", "010", "010", "010", "010", "010", "111"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "$": ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
    "!": ["1", "1", "1", "1", "1", "0", "1"],
    " ": ["000", "000", "000", "000", "000", "000", "000"],
}


def text_bitmap(text, gap=1):
    """Bool array (7, width) for `text` in the 5x7 pixel font, row 0 = top."""
    cols = []
    for i, ch in enumerate(text):
        g = np.array([[c == "1" for c in row] for row in FONT[ch]], bool)
        if i:
            cols.append(np.zeros((7, gap), bool))
        cols.append(g)
    return np.concatenate(cols, axis=1)


# ============================================================================ voxel volume
class Vox:
    """3D volume indexed [z, y, x]; metres centred on the slice centre, +y = front (down), z up."""

    def __init__(self, wx, wy, hz, px, sh, pad=1):
        self.px, self.sh = px, sh
        self.W = 2 * math.ceil(wx / px / 2 - 1e-6) + 2 * pad
        self.L = 2 * math.ceil(wy / px / 2 - 1e-6) + 2 * pad
        self.Z = max(1, math.ceil(hz / sh - 1e-6))
        self.m = np.zeros((self.Z, self.L, self.W), np.int16)
        self.x = ((np.arange(self.W) - (self.W - 1) / 2) * px)[None, None, :]
        self.y = ((np.arange(self.L) - (self.L - 1) / 2) * px)[None, :, None]
        self.z = ((np.arange(self.Z) + 0.5) * sh)[:, None, None]
        self.mats = [None]

    # ------------------------------------------------------------ shapes (bool masks, metres)
    def zr(self, z0, z1):
        return (self.z > z0) & (self.z < z1)

    def box(self, x0, x1, y0, y1, z0, z1):
        return (self.x > x0) & (self.x < x1) & (self.y > y0) & (self.y < y1) & self.zr(z0, z1)

    def cbox(self, cx, cy, wx, wy, z0, z1):
        return self.box(cx - wx / 2, cx + wx / 2, cy - wy / 2, cy + wy / 2, z0, z1)

    def cyl(self, cx, cy, r, z0, z1, ry=None):
        ry = r if ry is None else ry
        return (((self.x - cx) / r) ** 2 + ((self.y - cy) / ry) ** 2 < 1) & self.zr(z0, z1)

    def ell(self, cx, cy, cz, rx, ry, rz):
        return ((self.x - cx) / rx) ** 2 + ((self.y - cy) / ry) ** 2 + ((self.z - cz) / rz) ** 2 < 1

    def cone(self, cx, cy, z0, z1, r0, r1, ry_scale=1.0):
        t = np.clip((self.z - z0) / (z1 - z0), 0, 1)
        r = r0 + (r1 - r0) * t
        return ((self.x - cx) ** 2 + ((self.y - cy) / ry_scale) ** 2 < r * r) & self.zr(z0, z1)

    def seg(self, p0, p1, r, r1=None, square=False):
        """Capsule from p0 to p1 (metres). Radius clamps to >= 0.9 px across and >= 0.55 slice tall."""
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        d = p1 - p0
        l2 = max(float(d @ d), 1e-9)
        t = ((self.x - p0[0]) * d[0] + (self.y - p0[1]) * d[1] + (self.z - p0[2]) * d[2]) / l2
        t = np.clip(t, 0, 1)
        rr = r if r1 is None else r + (r1 - r) * t
        rx = np.maximum(rr, 1.05 * self.px)
        rz = np.maximum(rr, 0.55 * self.sh)
        dx = self.x - (p0[0] + t * d[0])
        dy = self.y - (p0[1] + t * d[1])
        dz = self.z - (p0[2] + t * d[2])
        if square:
            return (np.abs(dx) < rx) & (np.abs(dy) < rx) & (np.abs(dz) < rz)
        return (dx * dx + dy * dy) / (rx * rx) + dz * dz / (rz * rz) < 1

    def leg(self, p0, p1, wpx=2):
        """Straight member drawn as a grid-snapped wpx x wpx block per slice (crisp lattice legs that
        never thin out to 1px when the line falls between pixel centres)."""
        mk = np.zeros(self.m.shape, bool)
        (x0, y0, z0), (x1, y1, z1) = p0, p1
        for k in range(self.Z):
            zc = (k + 0.5) * self.sh
            if not (min(z0, z1) <= zc <= max(z0, z1)):
                continue
            t = 0.0 if z1 == z0 else (zc - z0) / (z1 - z0)
            cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            ix = int(round(cx / self.px + (self.W - 1) / 2 - (wpx - 1) / 2))
            iy = int(round(cy / self.px + (self.L - 1) / 2 - (wpx - 1) / 2))
            mk[k, max(iy, 0) : iy + wpx, max(ix, 0) : ix + wpx] = True
        return mk

    def post(self, cx, cy, z0, z1, wpx=2, wpy=None):
        """Axis-aligned post exactly wpx x wpy art pixels, snapped to the pixel grid."""
        wpy = wpx if wpy is None else wpy
        ix = round(cx / self.px + (self.W - 1) / 2 - (wpx - 1) / 2)
        iy = round(cy / self.px + (self.L - 1) / 2 - (wpy - 1) / 2)
        mk = np.zeros((1, self.L, self.W), bool)
        mk[0, max(iy, 0) : iy + wpy, max(ix, 0) : ix + wpx] = True
        return mk & self.zr(z0, z1)

    def bitmap_xz(self, bm, x0, z0, cell_x, cell_z, y0, y1):
        """Extrude a 2D bitmap (row 0 = top) standing in the x-z plane between y0..y1."""
        h, w = bm.shape
        ix = np.floor((self.x - x0) / cell_x).astype(int)
        iz = (h - 1) - np.floor((self.z - z0) / cell_z).astype(int)
        ok = (ix >= 0) & (ix < w) & (iz >= 0) & (iz < h)
        val = np.zeros(np.broadcast_shapes(ix.shape, iz.shape), bool)
        ixb, izb, okb = np.broadcast_arrays(ix, iz, ok)
        val[okb] = bm[izb[okb], ixb[okb]]
        return val & (self.y > y0) & (self.y < y1)

    def bitmap_xy(self, bm, x0, y0, cell, z0, z1):
        """Extrude a 2D bitmap lying flat (row 0 = -y side)."""
        h, w = bm.shape
        ix = np.floor((self.x - x0) / cell).astype(int)
        iy = np.floor((self.y - y0) / cell).astype(int)
        ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        ixb, iyb, okb = np.broadcast_arrays(ix, iy, ok)
        val = np.zeros(okb.shape, bool)
        val[okb] = bm[iyb[okb], ixb[okb]]
        return val & self.zr(z0, z1)

    def _poly(self, pts, a, b):
        import shapely
        from shapely.geometry import Polygon

        A, B = np.broadcast_arrays(a, b)
        return shapely.contains_xy(Polygon(pts), A, B)

    def poly_yz(self, pts, x0, x1):
        """Polygon in (y, z) metres extruded along x between x0..x1."""
        ins = self._poly(pts, self.y[0, :, 0][None, :], self.z[:, 0, 0][:, None])
        return ins[:, :, None] & (self.x > x0) & (self.x < x1)

    def poly_xz(self, pts, y0, y1):
        """Polygon in (x, z) metres extruded along y between y0..y1."""
        ins = self._poly(pts, self.x[0, 0, :][None, :], self.z[:, 0, 0][:, None])
        return ins[:, None, :] & (self.y > y0) & (self.y < y1)

    def poly_xy(self, pts, z0, z1):
        """Polygon in (x, y) metres extruded along z between z0..z1."""
        ins = self._poly(pts, self.x[0, 0, :][None, :], self.y[0, :, 0][:, None])
        return ins[None] & self.zr(z0, z1)

    # ------------------------------------------------------------ editing
    def _mi(self, mat):
        for i, m in enumerate(self.mats):
            if m is mat:
                return i
        self.mats.append(mat)
        return len(self.mats) - 1

    def fill(self, mask, mat):
        self.m[np.broadcast_to(mask, self.m.shape)] = self._mi(mat)

    def under(self, mask, mat):
        """Fill only empty voxels."""
        mk = np.broadcast_to(mask, self.m.shape) & (self.m == 0)
        self.m[mk] = self._mi(mat)

    def paint(self, mask, mat):
        """Recolour existing voxels only."""
        mk = np.broadcast_to(mask, self.m.shape) & (self.m > 0)
        self.m[mk] = self._mi(mat)

    def cut(self, mask):
        self.m[np.broadcast_to(mask, self.m.shape)] = 0

    def occ(self):
        return self.m > 0

    def surface(self):
        o = self.m > 0
        p = np.pad(o, 1)
        inner = p[:-2, 1:-1, 1:-1] & p[2:, 1:-1, 1:-1] & p[1:-1, :-2, 1:-1] & p[1:-1, 2:, 1:-1] \
            & p[1:-1, 1:-1, :-2] & p[1:-1, 1:-1, 2:]
        return o & ~inner

    # ------------------------------------------------------------ shading
    def render(self, despeckle=True, centre="bbox", blur=1):
        m = self.m.copy()
        if despeckle:
            m[~open2(m > 0)] = 0
        occ = m > 0
        Z, L, W = occ.shape
        b = blur3(occ.astype(np.float32), blur)
        b = blur3(b, 1)
        gz, gy, gx = np.gradient(b, self.sh, self.px, self.px)
        nrm = np.sqrt(gx * gx + gy * gy + gz * gz) + 1e-6
        nz = -gz / nrm
        nz[nrm < 1e-3] = 0.0
        # sky occlusion: solid somewhere above after a gap (canopy over trunk, roof over posts)
        anyab = np.zeros_like(occ)
        acc = np.zeros((L, W), bool)
        for z in range(Z - 1, -1, -1):
            acc = acc | occ[z]
            anyab[z] = acc
        cast = np.zeros(occ.shape, np.float32)
        for z in range(Z - 2, -1, -1):
            cast[z] = np.where(occ[z + 1], cast[z + 1], anyab[z + 1])
        cast = blur3(cast, 1) if Z > 2 else cast
        cast = (cast > 0.5).astype(np.float32)
        zi = np.arange(Z)[:, None, None]
        out = np.zeros(m.shape + (4,), np.uint8)
        emit = np.zeros_like(out)
        has_emit = False
        noise_cache = {}
        for i, mat in enumerate(self.mats):
            if i == 0:
                continue
            sel = m == i
            if not sel.any():
                continue
            if mat.tone is not None:
                tone = np.full(int(sel.sum()), mat.tone, int)
            else:
                s = mat.b + mat.kz * nz[sel] - mat.shadow * cast[sel]
                s = s - mat.ao * ((zi == 0) & (nz < 0.5))[sel]
                if mat.noise:
                    key = (str(mat.cell), mat.seed)
                    if key not in noise_cache:
                        noise_cache[key] = value_noise(m.shape, mat.cell, mat.seed)
                    s = s + mat.noise * (noise_cache[key][sel] - 0.5) * 2
                tone = np.clip(np.floor(s), 0, 3).astype(int)
            cols = np.array(mat.r, np.uint8)[tone]
            out[sel, :3] = cols
            out[sel, 3] = 255
            if mat.emit:
                emit[sel] = out[sel]
                has_emit = True
        vol = out
        evol = emit if has_emit else None
        if centre is None:  # caller crops (animation frames share one crop)
            return vol, evol
        return crop_centre(vol, evol, centre)


def crop_centre(vol, evol=None, centre="bbox", pad=1):
    """Crop empty margins. centre='bbox' centres the bounding box; 'origin' keeps the slice centre
    (crops symmetrically) so a pole placed at x=y=0 stays on the pivot."""
    a = vol[..., 3] > 0
    zs = np.nonzero(a.any((1, 2)))[0]
    ys = np.nonzero(a.any((0, 2)))[0]
    xs = np.nonzero(a.any((0, 1)))[0]
    z1 = zs[-1] + 1
    Z, L, W = a.shape

    def rng(idx, n):
        lo, hi = int(idx[0]), int(idx[-1]) + 1
        if centre == "origin":
            m = min(lo, n - hi)
            lo, hi = m, n - m
        size = hi - lo + 2 * pad
        size += size % 2
        c2 = lo + hi  # twice the centre
        s0 = (c2 - size) // 2
        return s0, size

    y0, hh = rng(ys, L)
    x0, ww = rng(xs, W)

    def take(v):
        o = np.zeros((z1, hh, ww, 4), np.uint8)
        sy0, sx0 = max(y0, 0), max(x0, 0)
        sy1, sx1 = min(y0 + hh, L), min(x0 + ww, W)
        o[:, sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = v[:z1, sy0:sy1, sx0:sx1]
        return o

    return take(vol), (take(evol) if evol is not None else None)


# ============================================================================ carve path
OUTLINE = (22, 24, 34, 255)


class View:
    """Native-resolution RGBA canvas for one orthographic view (PIL drawing, no anti-aliasing)."""

    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.w, self.h = w, h

    def rect(self, x0, y0, x1, y1, c):  # inclusive-exclusive
        if x1 > x0 and y1 > y0:
            self.d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=rgb(c) + (255,))
        return self

    def ellipse(self, x0, y0, x1, y1, c):
        self.d.ellipse([x0, y0, x1 - 1, y1 - 1], fill=rgb(c) + (255,))
        return self

    def poly(self, pts, c):
        self.d.polygon(pts, fill=rgb(c) + (255,))
        return self

    def hline(self, y, c, x0=0, x1=None, t=1):
        return self.rect(x0, y, self.w if x1 is None else x1, y + t, c)

    def vline(self, x, c, y0=0, y1=None, t=1):
        return self.rect(x, y0, x + t, self.h if y1 is None else y1, c)

    def recolor_inside(self, c, x0, y0, x1, y1):
        a = np.array(self.im)
        sub = a[y0:y1, x0:x1]
        sub[sub[..., 3] > 0, :3] = rgb(c)
        self.im = Image.fromarray(a)
        self.d = ImageDraw.Draw(self.im)
        return self

    def arr(self):
        a = np.array(self.im)
        m = a[..., 3] > 0
        p = np.pad(m, 1)
        edge = m & ~(p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:])
        a[edge] = OUTLINE
        return a


def carve(pid, top, side, front, back, *, round_=False, shade=0.12):
    """Path (c): 1x4 sheet (8x, 40px gaps, flat white) -> vendored slicer -> volume [z, y, x, 4].

    top: View W x L (front down); side: View L x H (front LEFT); front/back: View W x H."""
    views = [top.arr(), side.arr(), front.arr(), back.arr()]
    H = views[1].shape[0]
    assert views[0].shape[0] == views[1].shape[1], f"{pid}: TOP length != SIDE length"
    assert views[0].shape[1] == views[2].shape[1] == views[3].shape[1], f"{pid}: widths differ"
    assert views[1].shape[0] == views[2].shape[0] == views[3].shape[0], f"{pid}: heights differ"
    S, gap = 8, 48
    big = [np.array(Image.fromarray(v).resize((v.shape[1] * S, v.shape[0] * S), Image.NEAREST)) for v in views]
    sw = gap + sum(b.shape[1] + gap for b in big)
    sh = max(b.shape[0] for b in big) + 2 * gap
    sheet = Image.new("RGBA", (sw, sh), (255, 255, 255, 255))
    x = gap
    for b in big:
        im = Image.fromarray(b)
        sheet.paste(im, (x, gap), im)
        x += b.shape[1] + gap
    (BUILD / "views").mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(BUILD / "views" / f"{pid}.png")
    vol, _ = vts.views_to_slices(
        np.array(sheet.convert("RGBA")), slices=H, top_nose="down", side_nose="left", order="reading",
        colours=0, shade=shade, round_=round_,
    )
    return crop_centre(vol, None, "bbox")[0]


# ============================================================================ registry
PROPS: dict[str, dict] = {}


def prop(pid, name, kind, px, sh, *, solid=True, radius=None, breakable=False, desc="", group=None, extra=None):
    def deco(fn):
        PROPS[pid] = dict(id=pid, name=name, kind=kind, px=px, sliceH=sh, solid=solid, radius=radius,
                          breakable=breakable, desc=desc, group=group, extra=extra or {}, fn=fn)
        return fn

    return deco


class P:
    def __init__(self, meta):
        self.px, self.sh, self.id = meta["px"], meta["sliceH"], meta["id"]


# ============================================================================ materials (shared)
GOLD = ["#6a3d14", "#a9671f", "#dfa233", "#ffe07e"]
CONCRETE = "#a7a49b"


# ############################################################################ PROP BUILDERS
# (registered with @prop; each returns vol | (vol, emit) | {"frames": [vol...]} )
# ---------------------------------------------------------------------------- BUILDERS_START

# ---------------------------------------------------------------------------- shared shapes
def lattice_tower(v, mat, cx, cy, z0, z1, w0, w1, bays, legs_px=2, xbrace=True, girts=True, tri=False,
                  zigzag=False):
    """Tapered 4-leg (or 3-leg) lattice: corner legs, horizontal girts and X bracing per bay."""
    n = 3 if tri else 4
    ang = [math.radians(a) for a in ((90, 210, 330) if tri else (45, 135, 225, 315))]
    k = (1 / math.sqrt(2)) if not tri else 0.5774

    def corner(i, z):
        t = (z - z0) / (z1 - z0)
        half = (w0 + (w1 - w0) * t) * k
        return (cx + math.cos(ang[i]) * half, cy + math.sin(ang[i]) * half, z)

    r = legs_px * v.px * 0.5
    for i in range(n):
        v.fill(v.leg(corner(i, z0), corner(i, z1), legs_px), mat)
    zs = np.linspace(z0, z1, bays + 1)
    for b in range(bays + 1):
        z = zs[b]
        for i in range(n):
            j = (i + 1) % n
            if girts:
                v.fill(v.seg(corner(i, z), corner(j, z), r * 0.9), mat)
            if xbrace and b < bays:
                za = zs[b + 1]
                if zigzag:
                    a0, a1 = (i, j) if (b + i) % 2 == 0 else (j, i)
                    v.fill(v.seg(corner(a0, z), corner(a1, za), r * 0.8), mat)
                else:
                    v.fill(v.seg(corner(i, z), corner(j, za), r * 0.8), mat)
                    v.fill(v.seg(corner(j, z), corner(i, za), r * 0.8), mat)
    return corner


def broadleaf(p, seed, *, height, crown_w, crown_h, crown_z, trunk_r, leaf, leaf2, bark="#6b5242",
              nblob=18, blob_r=(1.4, 2.4), branches=5, shell=0.75, wspread=1.0, ragged=0.34,
              crown_d=None, lean=(0.0, 0.0), trunk_top=None):
    rng = np.random.default_rng(seed)
    crown_d = crown_d or crown_w
    v = Vox(crown_w + 2, crown_d + 2, height + 0.5, p.px, p.sh)
    bark_m = M(bark, noise=0.35, cell=(4, 2, 2), seed=seed + 1, kz=1.0)
    leaf_m = M(ramp=leaf, noise=0.42, cell=(2, 3, 3), seed=seed + 2, b=2.05, kz=1.3)
    leaf2_m = M(ramp=leaf2, noise=0.42, cell=(2, 3, 3), seed=seed + 2, b=2.05, kz=1.3)
    rx, ry, rz = crown_w / 2, crown_d / 2, crown_h / 2
    tt = trunk_top or (crown_z - rz * 0.4)
    lx, ly = lean
    # trunk with root flare
    v.fill(v.seg((0, 0, 0), (lx, ly, tt), trunk_r * 1.15, trunk_r * 0.75), bark_m)
    v.fill(v.cone(0, 0, 0, 0.6, trunk_r * 1.9, trunk_r * 1.1), bark_m)
    # main limbs into the crown
    for i in range(branches):
        a = rng.uniform(0, 2 * math.pi) if i else rng.uniform(0, 1)
        a = a + i * 2 * math.pi / branches
        e = (lx + math.cos(a) * rx * 0.62 * wspread, ly + math.sin(a) * ry * 0.62 * wspread,
             crown_z + rng.uniform(-0.2, 0.35) * rz)
        b0 = (lx * 0.9, ly * 0.9, tt * rng.uniform(0.82, 1.0))
        v.fill(v.seg(b0, e, trunk_r * 0.62, trunk_r * 0.3), bark_m)
    # canopy: core + blobs biased to the shell
    crown = np.zeros(v.m.shape, bool)
    crown |= v.ell(lx, ly, crown_z, rx * 0.72, ry * 0.72, rz * 0.7)
    for i in range(nblob):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        u[2] = abs(u[2]) * 0.9 if rng.random() < 0.7 else u[2]
        d = rng.uniform(shell, 1.0)
        br = rng.uniform(*blob_r)
        c = (lx + u[0] * (rx - br * 0.7) * d, ly + u[1] * (ry - br * 0.7) * d, crown_z + u[2] * (rz - br * 0.55) * d)
        crown |= v.ell(c[0], c[1], c[2], br, br, br * 0.85)
    # ragged edge: nibble the outer shell with clustered noise
    n = value_noise(v.m.shape, 2, seed + 3)
    shellm = crown & ~blur3(crown.astype(np.float32), 1).__ge__(0.999)
    crown &= ~(shellm & (n < ragged))
    v.fill(crown, leaf_m)
    n2 = value_noise(v.m.shape, (3, 4, 4), seed + 4)
    v.paint(crown & (n2 > 0.58), leaf2_m)
    return v


OAK_A = ["#1d3a2c", "#2d5c33", "#4a8a3b", "#8cbc4f"]
OAK_B = ["#25402a", "#3b6a2f", "#5f9a3c", "#a6c95a"]


@prop("oak_1", "Oak", "tree", 0.2, 0.35, radius=0.6, group="oak",
      desc="Broad round-canopied shade oak, 11 m.")
def b_oak_1(p):
    v = broadleaf(p, 11, height=11, crown_w=12.5, crown_h=8.2, crown_z=6.6, trunk_r=0.45,
                  leaf=OAK_A, leaf2=OAK_B, nblob=20)
    return v.render()[0]


@prop("golden_driller", "Golden Driller", "landmark", 0.25, 0.25, radius=4.0,
      desc="76-ft gold statue of an oil worker in a hard hat, right hand resting on a derrick, Expo Square.")
def b_golden_driller(p):
    v = Vox(15, 8, 24, p.px, p.sh)
    gold = M(ramp=GOLD, b=2.1, kz=1.3)
    gold_dk = M(ramp=["#4f2c10", "#83501a", "#b9822a", "#e8bd57"], b=2.1, kz=1.3)
    gold_lt = M(ramp=["#7a4a18", "#c08326", "#f0bb40", "#fff0a0"], b=2.2, kz=1.3)
    steel = M("#6f7783", b=2.0)
    conc = M(CONCRETE, kz=1.0)
    conc_dk = M("#7f7c76", kz=1.0)
    X = 2.6  # figure offset so figure + derrick centre on the pivot
    z0 = 1.25
    # pedestal (two steps) under figure and derrick
    v.fill(v.box(-7.4, 6.0, -3.2, 3.2, 0, 0.6), conc_dk)
    v.fill(v.box(-6.9, 5.5, -2.7, 2.7, 0.5, z0), conc)
    # boots + legs
    for s in (-1, 1):
        fx = X + s * 1.75
        v.fill(v.ell(fx + s * 0.1, 0.6, z0 + 0.45, 0.8, 1.5, 0.55) & v.zr(z0, 9), gold_dk)  # foot
        v.fill(v.cyl(fx, 0.0, 0.78, z0, z0 + 2.8), gold_dk)  # boot shaft
        v.fill(v.seg((fx, 0.0, z0 + 2.6), (X + s * 1.45, 0.1, z0 + 6.3), 0.82, 0.86), gold)  # shin
        v.fill(v.seg((X + s * 1.45, 0.1, z0 + 6.3), (X + s * 1.05, 0.0, z0 + 10.3), 0.88, 1.02), gold)  # thigh
    v.fill(v.ell(X, 0, z0 + 10.8, 2.1, 1.25, 1.05), gold)  # pelvis
    # torso (tapered ellipse) + shoulders
    v.fill(v.cone(X, 0, z0 + 10.8, z0 + 17.4, 1.85, 2.35, ry_scale=0.6), gold)
    v.fill(v.ell(X, 0, z0 + 17.1, 2.6, 1.35, 0.95), gold)
    v.paint(v.zr(z0 + 11.0, z0 + 11.55) & v.cyl(X, 0, 3, 0, 99), gold_dk)  # belt
    v.fill(v.cbox(X, 1.3, 0.75, 0.3, z0 + 10.95, z0 + 11.6), gold_lt)  # buckle
    # neck, head, hard hat
    v.fill(v.cyl(X, 0.05, 0.62, z0 + 17.4, z0 + 18.7), gold)
    v.fill(v.ell(X, 0.1, z0 + 19.45, 1.0, 1.1, 1.25), gold)
    v.fill(v.ell(X, 1.15, z0 + 19.3, 0.28, 0.3, 0.35), gold)  # nose
    v.fill(v.ell(X, 0.05, z0 + 20.35, 1.3, 1.38, 1.05) & v.zr(z0 + 20.1, 99), gold_lt)  # dome
    v.fill(v.cyl(X, 0.2, 1.62, z0 + 20.05, z0 + 20.45, ry=1.85), gold_lt)  # brim
    v.fill(v.cbox(X, 0.05, 0.5, 2.2, z0 + 21.0, z0 + 21.55), gold_lt)  # ridge
    # right arm (his right = -x) resting on the derrick
    sh_r, el_r, wr_r = (X - 2.45, 0, z0 + 17.0), (X - 3.75, 0.25, z0 + 14.3), (X - 4.9, 0.25, z0 + 12.9)
    v.fill(v.seg(sh_r, el_r, 0.72, 0.6), gold)
    v.fill(v.seg(el_r, wr_r, 0.6, 0.5), gold)
    v.fill(v.ell(X - 5.25, 0.25, z0 + 12.75, 0.62, 0.55, 0.5), gold)
    # left arm bent, fist on the belt
    sh_l, el_l, wr_l = (X + 2.45, 0, z0 + 17.0), (X + 3.8, -0.35, z0 + 14.0), (X + 2.55, 0.35, z0 + 11.8)
    v.fill(v.seg(sh_l, el_l, 0.72, 0.6), gold)
    v.fill(v.seg(el_l, wr_l, 0.6, 0.5), gold)
    v.fill(v.ell(X + 2.35, 0.5, z0 + 11.45, 0.6, 0.55, 0.55), gold)
    # derrick under the right hand
    dx = X - 6.2
    lattice_tower(v, steel, dx, 0, z0, z0 + 12.2, 3.4, 1.4, 4, zigzag=True)
    v.fill(v.cbox(dx, 0, 1.9, 1.9, z0 + 12.0, z0 + 12.55), steel)
    return v.render()[0]


@prop("street_lamp", "Street Lamp", "street", 0.125, 0.3, radius=0.25, breakable=True,
      extra={"pivot": "pole"}, desc="Galvanised cobra-head street light; arm reaches 2.5 m toward +y (the road).")
def b_street_lamp(p):
    v = Vox(1.2, 6.2, 9.4, p.px, p.sh)
    galv = M("#8d96a0", kz=1.2)
    dark = M("#4a525c")
    lens = M(ramp=["#c8a050", "#f0c870", "#ffe9a8", "#fff6d8"], emit=True, tone=3)
    v.fill(v.cyl(0, 0, 0.3, 0, 0.5), M(CONCRETE))
    v.fill(v.post(0, 0, 0.3, 1.0, 4), dark)
    v.fill(v.post(0, 0, 0.3, 8.7, 2), galv)
    v.fill(v.seg((0, 0, 8.4), (0, 1.2, 8.85), 0.1), galv)
    v.fill(v.seg((0, 1.2, 8.85), (0, 2.3, 8.95), 0.1), galv)
    v.fill(v.ell(0, 2.75, 8.95, 0.36, 0.75, 0.28), galv)
    v.fill(v.ell(0, 2.8, 8.75, 0.28, 0.55, 0.18) & v.zr(0, 8.85), lens)
    vol, em = v.render(centre="origin")
    return vol, em


@prop("dumpster", "Dumpster", "street", 0.1, 0.1, radius=0.9, desc="Green front-load dumpster with black lids.")
def b_dumpster(p):
    W, L, H = 20, 16, 15
    g = make_ramp("#3d7a4b")
    lid = ["#1b2420", "#28342f", "#34433c", "#51645a"]
    top = View(W, L).rect(0, 0, W, L, lid[2])
    top.rect(0, 0, W, 2, g[1]).rect(0, L - 2, W, L, g[2])  # hinge bar back, front lip
    top.rect(9, 2, 11, L - 2, lid[0]).rect(1, 3, 9, 5, lid[3]).rect(11, 3, 19, 5, lid[3])
    side = View(L, H).poly([(0, 3), (L - 1, 0), (L - 1, H - 1), (0, H - 1)], g[2])
    side.rect(0, 2, L, 4, lid[1]).poly([(0, 2), (L - 1, 0), (L - 1, 1), (0, 3)], lid[2])
    for x in (2, 6, 10):
        side.rect(x, 6, x + 2, H - 2, g[1])
    side.rect(3, 9, 13, 11, g[0]).rect(0, H - 2, L, H, g[0])  # fork pocket, base
    front = View(W, H).rect(0, 0, W, H, g[2]).rect(0, 0, W, 3, lid[2]).rect(9, 0, 11, 3, lid[0])
    for x in (2, 6, 13, 17):
        front.rect(x, 5, x + 2, H - 2, g[1])
    front.rect(0, H - 2, W, H, g[0]).rect(0, 3, W, 4, g[3])
    back = View(W, H).rect(0, 0, W, H, g[2]).rect(0, 0, W, 2, g[1])
    for x in (3, 15):
        back.rect(x, 0, x + 2, 3, "#2a2e33")
    back.rect(0, H - 2, W, H, g[0]).rect(0, 2, W, 3, g[3])
    return carve(p.id, top, side, front, back, shade=0.12)


# ---------------------------------------------------------------------------- landmarks
@prop("blue_whale_catoosa", "Blue Whale of Catoosa", "landmark", 0.35, 0.3, radius=9.0,
      desc="Route 66 roadside icon: 24 m smiling blue whale with an open walk-in mouth, white hat and "
           "raised tail, sitting in its pond with a plank walkway to the mouth.")
def b_blue_whale(p):
    v = Vox(20, 35, 8.0, p.px, p.sh)
    blue = M(ramp=["#1b3474", "#2856aa", "#3d80d6", "#8cc6f2"], kz=1.25)
    navy = M(ramp=["#0e1630", "#18244a", "#22325e", "#33497e"], kz=0.6)
    white = M(ramp=["#8c98aa", "#c4cedb", "#eef2f6", "#ffffff"])
    black = M("#1a1c22", tone=1)
    wood = M("#9a6b40", noise=0.3, cell=(1, 1, 3), seed=5)
    water = M(ramp=["#1d4656", "#285e70", "#33798a", "#5c9fae"], tone=2)
    water_lt = M(ramp=["#1d4656", "#285e70", "#33798a", "#5c9fae"], tone=3)
    stone = M("#8f8a80", noise=0.5, cell=(1, 2, 2), seed=7)
    wl = 0.3  # water surface
    # pond + stone rim
    v.fill(v.cyl(0, 0.6, 9.6, 0, wl, ry=16.9), stone)
    v.fill(v.cyl(0, 0.6, 9.0, 0, wl, ry=16.3), water_lt)
    v.fill(v.cyl(0, 0.6, 8.4, 0, wl, ry=15.7), water)
    # body: half-ellipse cross-sections along y (head at +y)
    yc = v.y[0, :, 0]
    ys = [-9.6, -6.5, -2.5, 2.5, 7.5, 10.4, 12.0]
    ws = [1.25, 2.3, 3.25, 3.75, 3.7, 3.25, 2.1]
    hs = [1.5, 2.8, 4.2, 5.1, 5.35, 4.8, 3.2]
    inr = (yc >= ys[0]) & (yc <= ys[-1])
    w = np.where(inr, np.interp(yc, ys, ws), 0.01)[None, :, None]
    h = np.where(inr, np.interp(yc, ys, hs), 0.01)[None, :, None]
    zz = v.z - wl
    body = ((v.x / w) ** 2 + (zz / h) ** 2 < 1) & (zz > 0) & inr[None, :, None]
    t = 0.85
    hollow = ((v.x / np.maximum(w - t, 0.05)) ** 2 + (zz / np.maximum(h - t, 0.05)) ** 2 < 1) \
        & (zz > 0.55) & ((v.y > -3.5) & (v.y < 11.2))
    inner = ((v.x / np.maximum(w - t - 0.45, 0.05)) ** 2 + (zz / np.maximum(h - t - 0.45, 0.05)) ** 2 >= 1)
    v.fill(body, blue)
    # open mouth: wedge growing toward the front, jaw hinge at y=5.8
    zm = wl + 0.75 + np.clip((v.y - 5.8) / (12.2 - 5.8), 0, 1) * 3.0
    mouth = (v.y > 5.8) & (v.z > wl + 0.75) & (v.z < zm)
    v.paint(body & ~inner & ~mouth, navy)  # inner shell
    v.cut(hollow | mouth)
    # lips: a navy line along both jaws = the big smile
    v.paint((v.y > 5.4) & (v.z > zm) & (v.z < zm + 0.35), navy)
    v.paint((v.y > 5.4) & (v.z > wl + 0.42) & (v.z < wl + 0.75) & ((np.abs(v.x) > w - 1.0) | (v.y > 11.0)), navy)
    v.paint((v.y > 6.2) & (v.y < 11.3) & (np.abs(v.x) < w - 0.8) & (v.z < wl + 0.75), wood)  # deck inside
    # flippers and tail with horizontal flukes
    for s in (-1, 1):
        v.fill(v.ell(s * 3.7, 3.6, wl + 0.55, 1.5, 0.75, 0.32), blue)
    v.fill(v.seg((0, -8.8, wl + 0.9), (0, -11.9, wl + 3.9), 1.0, 0.62), blue)
    v.fill(v.ell(0, -12.4, wl + 4.35, 3.1, 1.05, 0.38), blue)
    v.cut(v.cbox(0, -13.25, 0.7, 0.9, 0, 9))
    # eyes + portholes
    for s in (-1, 1):
        ey, ez = 8.0, wl + 2.95
        ew = float(np.interp(ey, ys, ws)) * math.sqrt(1 - ((ez - wl) / float(np.interp(ey, ys, hs))) ** 2)
        v.paint(v.ell(s * ew, ey, ez, 0.95, 0.95, 0.95), white)
        v.paint(v.ell(s * (ew + 0.2), ey + 0.3, ez + 0.1, 0.6, 0.5, 0.5), black)
        for py in (-1.5, 1.5):
            pw = float(np.interp(py, ys, ws)) * math.sqrt(1 - (1.9 / float(np.interp(py, ys, hs))) ** 2)
            v.paint(v.ell(s * pw, py, wl + 1.9, 0.9, 0.62, 0.62), navy)
    # white hat (sailor style) on the crown of the head
    hz = wl + float(np.interp(5.0, ys, hs))
    v.fill(v.cyl(0, 5.0, 1.9, hz - 0.55, hz + 0.05, ry=1.8), white)
    v.fill(v.ell(0, 5.0, hz + 0.3, 1.45, 1.35, 1.1) & v.zr(hz - 0.2, 99), white)
    v.paint(v.cyl(0, 5.0, 2.0, hz - 0.55, hz - 0.2, ry=1.9), M("#2a4c9a"))  # hat band
    # plank walkway to the shore
    v.fill(v.box(-1.05, 1.05, 11.0, 17.4, wl, wl + 0.3), wood)
    return v.render()[0]


@prop("praying_hands", "Praying Hands", "landmark", 0.25, 0.25, radius=3.6,
      desc="18 m bronze praying hands sculpture (palms pressed, fingertips up, shirt cuffs) on a granite pedestal "
           "at the ORU entrance. Thumbs face +y.")
def b_praying_hands(p):
    v = Vox(9, 9, 18.6, p.px, p.sh)
    bronze = M(ramp=["#22160f", "#4a2f1d", "#82562f", "#cc9a5c"], kz=1.4)
    cuff = M(ramp=["#2a2018", "#55402a", "#86683e", "#c0a068"], kz=1.3)
    sleeve = M(ramp=["#1c130e", "#3a261a", "#5e3e26", "#8e6640"], kz=1.3)
    granite = M("#8b8781", kz=1.0)
    granite_dk = M("#5f5b58", kz=1.0)
    v.fill(v.box(-4.2, 4.2, -4.2, 4.2, 0, 0.75), granite_dk)
    v.fill(v.box(-3.4, 3.4, -3.4, 3.4, 0.75, 2.5), granite)
    v.fill(v.box(-3.6, 3.6, -3.6, 3.6, 2.25, 2.55), granite_dk)
    z0 = 2.5
    zz = v.z - z0
    for s in (-1, 1):
        v.fill(v.seg((s * 1.25, -0.35, z0), (s * 0.95, -0.1, z0 + 4.4), 1.15, 1.0), sleeve)
        v.fill(v.seg((s * 1.0, -0.1, z0 + 3.7), (s * 0.95, -0.05, z0 + 4.7), 1.18), cuff)
        # hand: half-ellipse slab per hand (palm at x=0), width/thickness profiles along z
        hw = np.interp(zz, [4.4, 6.5, 9.0, 11.5, 13.8, 15.2, 15.6], [1.2, 1.75, 1.7, 1.35, 0.8, 0.3, 0.05])
        tx = np.interp(zz, [4.4, 7.0, 10.0, 13.0, 15.6], [0.95, 1.05, 0.85, 0.62, 0.3])
        yo = np.interp(zz, [4.4, 10.0, 15.6], [0.0, 0.15, 0.35])
        hand = (v.x * s >= -0.01) & ((v.x * s / tx) ** 2 + ((v.y - yo) / hw) ** 2 < 1) & v.zr(z0 + 4.4, z0 + 15.6)
        v.fill(hand, bronze)
        v.fill(v.seg((s * 0.55, 1.45, z0 + 6.2), (s * 0.35, 1.75, z0 + 10.0), 0.42, 0.34), bronze)  # thumbs
    # finger grooves on the backs of the hands (dark bronze lines along z)
    for gy in (-0.55, 0.15, 0.85):
        v.paint((np.abs(v.y - gy - 0.12 * np.clip(zz - 9, 0, 9) / 6) < 0.13) & v.zr(z0 + 10.0, z0 + 14.2)
                & (np.abs(v.x) > 0.3), sleeve)
    return v.render()[0]


@prop("oru_prayer_tower", "Prayer Tower", "landmark", 0.5, 0.6, radius=9.0,
      desc="60 m mid-century tower at ORU: finned white shaft, gold glass observation deck ringed with "
           "a crown of spikes, spire and eternal flame (emissive).")
def b_prayer_tower(p):
    v = Vox(28, 28, 61.5, p.px, p.sh)
    white = M("#e2e4e6", kz=1.1)
    trim = M("#9aa4ae")
    gold = M(ramp=["#6a4a1c", "#b07a24", "#e9b748", "#fff1a8"], kz=1.2)
    goldglass = M(ramp=["#5a3c18", "#9a6a22", "#d9a63e", "#ffe48a"], kz=0.9)
    dark = M("#3a4250")
    flame = M(ramp=["#c04010", "#f07020", "#ffb030", "#fff2a0"], emit=True, tone=3)
    flame2 = M(ramp=["#c04010", "#f07020", "#ffb030", "#fff2a0"], emit=True, tone=2)
    v.fill(v.cyl(0, 0, 9.5, 0, 1.0), trim)
    v.fill(v.cyl(0, 0, 8.6, 0.9, 4.4), white)
    v.paint(v.cyl(0, 0, 9, 1.8, 3.4) & ~v.cyl(0, 0, 8.0, 0, 99), dark)  # window band
    v.fill(v.cyl(0, 0, 2.7, 4, 46), white)
    e = 7.2 - (np.clip(v.z, 4, 40) - 4) / 36 * 4.0
    fins = (((np.abs(v.y) < 0.75) & (np.abs(v.x) < e)) | ((np.abs(v.x) < 0.75) & (np.abs(v.y) < e))) & v.zr(4, 40.5)
    v.fill(fins, white)
    v.fill(v.cone(0, 0, 38.8, 43.6, 5.0, 8.6), goldglass)
    v.fill(v.cone(0, 0, 43.6, 47.2, 8.6, 4.6), goldglass)
    v.paint(v.zr(43.2, 43.9), gold)  # rim
    v.fill(v.cone(0, 0, 47.0, 48.0, 4.8, 3.6), white)
    for k in range(16):
        a = (k + 0.5) * 2 * math.pi / 16
        v.fill(v.seg((7.6 * math.cos(a), 7.6 * math.sin(a), 43.0), (13.2 * math.cos(a), 13.2 * math.sin(a), 38.6),
                     0.55, 0.3), gold)
    v.fill(v.cone(0, 0, 47.8, 58.0, 1.6, 0.5), white)
    v.fill(v.cyl(0, 0, 1.2, 57.6, 58.3), gold)
    v.fill(v.ell(0, 0, 59.2, 0.9, 0.9, 1.6), flame2)
    v.fill(v.ell(0, 0, 59.0, 0.55, 0.55, 1.0), flame)
    return v.render()


@prop("center_of_universe", "Center of the Universe", "landmark", 0.1, 0.1, solid=False,
      desc="Small concentric brick circle downtown with an acoustic centre disc; walk-through ground piece.")
def b_center_of_universe(p):
    v = Vox(4.8, 4.8, 0.3, p.px, p.sh)
    r = np.sqrt(v.x ** 2 + v.y ** 2)
    ba = M(ramp=["#5a2a22", "#7e3a2c", "#a24c36", "#c86a4a"], tone=2)
    bb = M(ramp=["#4a2420", "#6a3026", "#8a402f", "#b05a42"], tone=2)
    conc = M(ramp=["#6c6a66", "#9a9790", "#c2beb5", "#e2ddd2"], tone=2)
    conc_t = M(ramp=["#6c6a66", "#9a9790", "#c2beb5", "#e2ddd2"], tone=3)
    v.fill(v.zr(0, 0.1) & (r < 2.35), conc)
    band = np.floor((r - 0.55) / 0.2).astype(int)
    v.fill(v.zr(0, 0.1) & (r < 2.1) & (band % 2 == 0), ba)
    v.fill(v.zr(0, 0.1) & (r < 2.1) & (band % 2 == 1), bb)
    v.fill(v.zr(0.1, 0.2) & (r > 1.15) & (r < 1.4), conc)  # raised concentric ring
    v.fill(v.zr(0, 0.2) & (r < 0.55), conc)
    v.fill(v.zr(0.1, 0.2) & (r < 0.38), conc_t)
    return v.render(despeckle=False)[0]


@prop("buck_atom_space_cowboy", "Space Cowboy Statue", "landmark", 0.1, 0.1, radius=1.3,
      desc="6 m fiberglass Route 66 'space cowboy' giant: bubble helmet, red shirt, jeans, boots, "
           "holding a toy rocket (original take on Buck Atom).")
def b_buck_atom(p):
    v = Vox(3.4, 3.0, 6.8, p.px, p.sh)
    skin = M("#e8b48a")
    red = M(ramp=["#5a1418", "#9a2224", "#d63a32", "#ff7a5a"], kz=1.2)
    jeans = M(ramp=["#1a2448", "#2a3c72", "#3e5aa0", "#7a98d0"])
    boot = M("#7a4a2a")
    white = M(ramp=["#8c98aa", "#c4cedb", "#eef2f6", "#ffffff"])
    silver = M("#aab4c0", kz=1.4)
    glass = M(ramp=["#3a6a8a", "#5aa0c8", "#9ad8f0", "#e8fcff"], kz=1.6, b=2.0)
    yellow = M("#f2c030")
    base = M("#7a7a80")
    z0 = 0.7
    v.fill(v.box(-1.4, 1.4, -1.3, 1.3, 0, z0), base)
    for s in (-1, 1):
        v.fill(v.ell(s * 0.38, 0.18, z0 + 0.15, 0.24, 0.42, 0.2) & v.zr(z0, 9), boot)
        v.fill(v.cyl(s * 0.38, 0.0, 0.25, z0, z0 + 0.85), boot)
        v.fill(v.seg((s * 0.38, 0, z0 + 0.8), (s * 0.3, 0, z0 + 2.45), 0.26, 0.3), jeans)
    v.fill(v.ell(0, 0, z0 + 2.45, 0.6, 0.38, 0.3), jeans)
    v.fill(v.cone(0, 0, z0 + 2.45, z0 + 4.25, 0.56, 0.72, ry_scale=0.62), red)
    v.fill(v.ell(0, 0, z0 + 4.15, 0.82, 0.44, 0.3), red)
    v.paint(v.zr(z0 + 2.5, z0 + 2.7), M("#5a3418"))  # belt
    v.fill(v.cbox(0, 0.4, 0.3, 0.15, z0 + 2.45, z0 + 2.75), yellow)  # buckle
    # arms: down to elbows then forward to hold the rocket
    for s in (-1, 1):
        v.fill(v.seg((s * 0.78, 0, z0 + 4.1), (s * 0.9, 0.1, z0 + 3.25), 0.2, 0.18), red)
        v.fill(v.seg((s * 0.9, 0.1, z0 + 3.25), (s * 0.28, 0.72, z0 + 3.45), 0.17, 0.15), red)
        v.fill(v.ell(s * 0.22, 0.78, z0 + 3.45, 0.16, 0.15, 0.17), white)  # gloves
    # toy rocket held upright in front
    rx, ry = 0.0, 0.88
    v.fill(v.cyl(rx, ry, 0.2, z0 + 2.6, z0 + 4.4), white)
    v.paint(v.zr(z0 + 3.9, z0 + 4.4), red)
    v.fill(v.cone(rx, ry, z0 + 4.4, z0 + 5.0, 0.2, 0.04), red)
    for a in (0, 90, 180, 270):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        v.fill(v.seg((rx + ca * 0.2, ry + sa * 0.2, z0 + 2.7), (rx + ca * 0.42, ry + sa * 0.42, z0 + 2.45), 0.05), red)
    v.fill(v.cone(rx, ry, z0 + 2.3, z0 + 2.6, 0.08, 0.16), M("#ff9a2a", tone=3))
    # head inside an open-faced bubble helmet with a silver collar and antenna
    v.fill(v.cyl(0, 0, 0.36, z0 + 4.3, z0 + 4.55), silver)
    v.fill(v.ell(0, 0.02, z0 + 4.95, 0.32, 0.34, 0.4), skin)
    shell = v.ell(0, 0, z0 + 5.0, 0.62, 0.62, 0.62) & ~v.ell(0, 0, z0 + 5.0, 0.42, 0.42, 0.44) & v.zr(z0 + 4.5, 99)
    v.fill(shell & ~((v.y > 0.12) & v.zr(z0 + 4.6, z0 + 5.35)), glass)
    v.fill(v.seg((0.25, -0.1, z0 + 5.55), (0.3, -0.15, z0 + 5.95), 0.06), silver)
    v.fill(v.ell(0.3, -0.15, z0 + 6.0, 0.12, 0.12, 0.12), red)
    return v.render()[0]


@prop("meadow_gold_sign", "Dairy Neon Sign", "landmark", 0.1, 0.1, radius=3.0,
      desc="Fictional rooftop-style 'MILK' neon sign on a small open pavilion (stand-in for the Route 66 "
           "dairy sign at 11th & Lewis). Neon letters and border glow at night.")
def b_meadow_gold(p):
    v = Vox(6.8, 4.4, 6.4, p.px, p.sh)
    post = M("#d8d2c4")
    roof = M(ramp=["#4a2a20", "#7a3a2a", "#a84c34", "#d47a56"])
    cream = M(ramp=["#9a9078", "#cfc6aa", "#f2ead2", "#fffaf0"])
    green = M(ramp=["#14402a", "#1e6a3c", "#2e9a52", "#6ad48a"])
    neon_r = M(ramp=["#ff2a3a", "#ff2a3a", "#ff3044", "#ffd0d8"], emit=True, tone=2)
    neon_g = M(ramp=["#4aff9a", "#4aff9a", "#7affb0", "#d8ffe8"], emit=True, tone=2)
    for sx in (-2.6, 2.6):
        for sy in (-1.5, 1.5):
            v.fill(v.post(sx, sy, 0, 2.8, 2), post)
    v.fill(v.box(-3.3, 3.3, -2.1, 2.1, 2.8, 3.1), roof)
    v.fill(v.box(-3.0, 3.0, -1.8, 1.8, 3.1, 3.3), roof)
    # sign cabinet standing on the roof, 4 px thick
    v.fill(v.post(-2.2, 0, 3.3, 3.9, 2), green)
    v.fill(v.post(2.2, 0, 3.3, 3.9, 2), green)
    cab = v.box(-3.1, 3.1, -0.2, 0.2, 3.8, 6.2)
    v.fill(cab, green)
    v.paint(v.box(-2.85, 2.85, -1, 1, 4.05, 5.95), cream)
    bm = text_bitmap("MILK")
    cw = 0.2
    x0 = -bm.shape[1] * cw / 2
    v.paint(v.bitmap_xz(bm, x0, 4.3, cw, cw, 0.1, 0.3), neon_r)  # front face
    v.paint(v.bitmap_xz(bm[:, ::-1], x0, 4.3, cw, cw, -0.3, -0.1), neon_r)  # back face, mirrored
    edge = cab & ~v.box(-2.95, 2.95, -1, 1, 3.95, 6.05)
    v.paint(edge & (np.abs(v.y) > 0.1), neon_g)
    return v.render(centre="bbox")


@prop("giant_gas_pump", "Giant Gas Pump", "landmark", 0.25, 0.25, radius=2.6,
      desc="Route 66 roadside giant: ~20 m vintage gas pump with a lit globe, dial face and hose (Sapulpa).")
def b_giant_gas_pump(p):
    v = Vox(7, 6, 20.5, p.px, p.sh)
    red = M(ramp=["#4e1012", "#8e1e20", "#cc3229", "#f6745a"], kz=1.2)
    cream = M(ramp=["#9a9078", "#cfc6aa", "#f2ead2", "#fffaf0"])
    chrome = M("#b4bcc6", kz=1.5)
    black = M("#24262c")
    globe = M(ramp=["#c8c0a8", "#efe8d0", "#fffbe8", "#ffffff"], emit=True, tone=2)
    globe_band = M(ramp=["#ff5040", "#ff5040", "#ff6a50", "#ffc0b0"], emit=True, tone=2)
    conc = M(CONCRETE)
    v.fill(v.box(-3.2, 3.2, -2.7, 2.7, 0, 0.75), conc)
    v.fill(v.box(-2.3, 2.3, -1.6, 1.6, 0.75, 1.5), black)  # plinth
    body = v.box(-2.1, 2.1, -1.45, 1.45, 1.5, 13.5) | (v.cyl(0, 0, 2.1, 13.4, 15.3, ry=9) & (
        ((v.x / 2.1) ** 2 + ((v.z - 13.4) / 1.9) ** 2) < 1) & (np.abs(v.y) < 1.45))
    v.fill(body, red)
    # front + back dial window (cream) with black digits, and a chrome trim line
    for sgn in (1, -1):
        yy0, yy1 = (1.2, 1.5) if sgn > 0 else (-1.5, -1.2)
        v.paint(v.box(-1.6, 1.6, yy0, yy1, 9.0, 12.4), cream)
        for zz in (11.4, 10.0):
            v.paint(v.box(-1.1, 1.1, yy0, yy1, zz - 0.25, zz + 0.25), black)
        v.paint(v.box(-2.2, 2.2, yy0, yy1, 7.9, 8.4), chrome)
        bm = text_bitmap("GAS")
        cw = 0.38
        x0 = -bm.shape[1] * cw / 2
        v.paint(v.bitmap_xz(bm if sgn > 0 else bm[:, ::-1], x0, 4.6, cw, 0.4, yy0, yy1), cream)
    # globe on a neck
    v.fill(v.cyl(0, 0, 0.7, 15.0, 16.2), chrome)
    v.fill(v.ell(0, 0, 17.6, 1.6, 1.6, 1.65), globe)
    v.paint(v.zr(17.2, 18.0), globe_band)
    v.fill(v.cyl(0, 0, 0.6, 19.0, 19.6), chrome)
    # nozzle holster on the right side and a hose loop to the ground
    v.fill(v.box(2.0, 2.7, -0.4, 0.4, 9.0, 10.6), chrome)
    v.fill(v.seg((2.4, 0, 9.0), (2.8, 0.2, 5.0), 0.3), black)
    v.fill(v.seg((2.8, 0.2, 5.0), (2.5, 0.3, 1.8), 0.3), black)
    return v.render()


@prop("route66_rising", "Route 66 Rising", "landmark", 0.25, 0.25, radius=4.0,
      extra={"collision": "arch"},
      desc="Arched road-ribbon sculpture with towering '66' numerals over the old Route 66 (East 11th St).")
def b_route66(p):
    v = Vox(23, 4.2, 11.4, p.px, p.sh)
    asphalt = M(ramp=["#1c1e24", "#2c2f37", "#40444e", "#6a6f7a"], kz=1.1)
    yellow = M("#f2c230")
    white = M("#e6e8ea")
    red = M(ramp=["#5a1010", "#9c1e1c", "#d8392c", "#ff8466"], kz=1.2)
    steel = M("#b8c0c8", kz=1.4)
    conc = M(CONCRETE)
    # ribbon = thick parabola-ish arch between feet at x=+-10.5, apex 6.6 m
    span, apex, th = 10.6, 5.2, 0.75
    a_z = apex * (1 - (v.x / span) ** 2)
    ribbon = (v.z < a_z + th / 2) & (v.z > a_z - th / 2 - 0.2) & (np.abs(v.x) < span) & (np.abs(v.y) < 1.5)
    v.fill(ribbon, asphalt)
    v.paint(ribbon & (v.z > a_z) & (np.abs(v.y) < 0.2) & (np.floor((v.x + 20) / 1.2) % 2 == 0), yellow)
    v.paint(ribbon & (v.z > a_z) & (np.abs(v.y) > 1.2), white)
    for sx in (-1, 1):
        v.fill(v.box(sx * span - 1.3, sx * span + 1.3, -1.9, 1.9, 0, 0.6), conc)
    # 66 numerals standing on the apex, steel-edged red faces
    bm = text_bitmap("66")
    cw = 0.75
    x0 = -bm.shape[1] * cw / 2
    nz0 = apex + th / 2 - 0.15
    v.fill(v.bitmap_xz(bm, x0, nz0, cw, 0.75, -0.75, 0.75), steel)
    v.paint(v.bitmap_xz(bm, x0, nz0, cw, 0.75, 0.25, 0.75), red)
    v.paint(v.bitmap_xz(bm[:, ::-1], x0, nz0, cw, 0.75, -0.75, -0.25), red)
    return v.render()[0]


@prop("oil_derrick", "Oil Derrick", "rural", 0.25, 0.75, radius=3.6,
      desc="30 m steel lattice drilling derrick on a drill floor with crown block and doghouse.")
def b_oil_derrick(p):
    v = Vox(10, 10, 30.0, p.px, p.sh)
    steel = M(ramp=["#3a3438", "#5e5052", "#8a7470", "#c2a594"], kz=1.2)
    red = M(ramp=["#4e1012", "#8e1e20", "#cc3229", "#f6745a"])
    floor = M("#6c6458", noise=0.3, cell=2, seed=9)
    shed = M("#c8b48a")
    v.fill(v.box(-4.5, 4.5, -4.5, 4.5, 0, 0.75), floor)
    v.fill(v.box(-3.9, 3.9, -3.9, 3.9, 0.75, 1.5), steel)
    v.fill(v.box(1.2, 4.4, 2.0, 4.4, 1.5, 3.8), shed)  # doghouse
    v.fill(v.box(1.0, 4.6, 1.8, 4.6, 3.7, 4.3), red)
    lattice_tower(v, steel, 0, 0, 1.5, 28.2, 7.0, 2.0, 7, zigzag=True)
    v.fill(v.box(-1.5, 1.5, -1.5, 1.5, 28.0, 29.4), red)
    v.fill(v.box(-0.6, 0.6, -0.6, 0.6, 29.0, 29.9), steel)
    v.fill(v.box(-2.6, 2.6, -2.6, 2.6, 21.5, 22.3) & ~v.box(-1.9, 1.9, -1.9, 1.9, 0, 99), steel)  # racking board
    return v.render()[0]


def pumpjack_frame(p, phase):
    v = Vox(3.2, 9.8, 5.6, p.px, p.sh)
    skid = M("#6a6e74")
    beam_m = M(ramp=["#1e2420", "#2e3a32", "#46584a", "#7a907a"], kz=1.2)
    head_m = M(ramp=["#6a4210", "#b07418", "#eaa82a", "#ffe07a"], kz=1.2)
    weight = M(ramp=["#4a1410", "#7e2218", "#b23624", "#e2704e"], kz=1.2)
    black = M("#22242a")
    conc = M(CONCRETE)
    # skid + pad
    v.fill(v.box(-1.5, 1.5, -4.9, 4.7, 0, 0.15), conc)
    for sx in (-0.75, 0.75):
        v.fill(v.box(sx - 0.15, sx + 0.15, -4.6, 2.4, 0.15, 0.5), skid)
    v.fill(v.box(-0.9, 0.9, -4.6, -3.9, 0.15, 0.5), skid)
    # samson post (A-frame) to the saddle bearing
    yp, zp = 0.6, 4.35
    for sx in (-1, 1):
        for sy in (-0.9, 0.9):
            v.fill(v.seg((sx * 0.75, yp + sy, 0.45), (sx * 0.22, yp, zp - 0.2), 0.11), skid)
    # walking beam rocking about the saddle
    amp = 0.2
    th = -amp * math.sin(phase)
    dy, dz = math.cos(th), math.sin(th)
    front = (yp + 3.1 * dy, zp + 3.1 * dz)
    rear = (yp - 3.6 * dy, zp - 3.6 * dz)
    v.fill(v.seg((0, rear[0], rear[1]), (0, front[0], front[1]), 0.24, square=True), beam_m)
    v.fill(v.cbox(0, yp, 0.7, 0.5, zp - 0.35, zp + 0.05), skid)  # saddle
    # horse head: polygon in beam-local (u along beam, w up), mapped to world y/z
    loc = [(2.75, 0.32), (3.3, 0.32), (3.72, -0.15), (3.82, -0.9), (3.6, -1.65), (3.2, -1.8), (3.05, -0.7), (2.75, -0.25)]
    pts = [(yp + u * dy - w * dz, zp + u * dz + w * dy) for u, w in loc]
    v.fill(v.poly_yz(pts, -0.3, 0.3), head_m)
    # bridle hangs from the head's arc to the polished rod and wellhead
    hy = yp + 3.8 * dy + 0.9 * dz
    hz = zp + 3.8 * dz - 0.9 * dy
    v.fill(v.post(0, hy, 1.0, hz, 2), black)
    v.fill(v.cbox(0, hy, 0.5, 0.25, hz - 1.4, hz - 1.2), skid)  # carrier bar
    v.fill(v.cyl(0, hy, 0.28, 0.15, 1.2), M("#8a9098"))  # wellhead
    v.fill(v.cyl(0, hy, 0.4, 0.15, 0.4), M("#5a5e66"))
    # gear reducer, cranks, counterweights, pitman arms
    yc, zc, R = -3.0, 1.75, 0.72
    v.fill(v.box(-0.45, 0.45, -3.6, -2.4, 0.5, 2.1), beam_m)
    v.fill(v.box(-0.35, 0.35, -4.5, -3.9, 0.5, 1.25), black)  # motor
    pin = (yc + R * math.cos(phase), zc + R * math.sin(phase))
    for sx in (-1, 1):
        x0, x1 = (0.55, 0.9) if sx > 0 else (-0.9, -0.55)
        ry_, rz_ = v.y - yc, v.z - zc
        rr = np.sqrt(ry_ ** 2 + rz_ ** 2)
        ang = np.arctan2(rz_, ry_)
        dang = np.angle(np.exp(1j * (ang - (phase + math.pi))))
        wt = (rr > 0.35) & (rr < 1.15) & (np.abs(dang) < 0.6) & (v.x > x0) & (v.x < x1)
        v.fill(wt, weight)
        v.fill(v.seg((sx * 0.72, yc, zc), (sx * 0.72, pin[0], pin[1]), 0.14), skid)
        v.fill(v.seg((sx * 0.72, pin[0], pin[1]), (sx * 0.3, rear[0], rear[1]), 0.1), skid)
    v.fill(v.seg((-0.4, rear[0], rear[1]), (0.4, rear[0], rear[1]), 0.12), skid)  # equalizer
    return v


@prop("pumpjack", "Pumpjack", "rural", 0.125, 0.14, radius=2.2,
      extra={"fps": 3, "loop": True},
      desc="Nodding-donkey oil pumpjack (~8 m). 4-frame loop: f0..f3 = crank at 0/90/180/270 degrees.")
def b_pumpjack(p):
    vols = []
    for k in range(4):
        vol, _ = pumpjack_frame(p, k * math.pi / 2).render(centre=None)
        vols.append(vol)
    return {"frames": crop_many(vols)}


def windmill_frame(p, phase):
    v = Vox(4.4, 5.6, 12.3, p.px, p.sh)
    steel = M(ramp=["#3e4248", "#626870", "#8c949e", "#c4ccd4"], kz=1.2)
    blade = M(ramp=["#5a5e64", "#8a9098", "#c0c6cc", "#eef2f4"], kz=0.6)
    red = M(ramp=["#4e1012", "#8e1e20", "#cc3229", "#f6745a"])
    lattice_tower(v, steel, 0, 0, 0, 10.0, 3.0, 0.8, 4, zigzag=True)
    v.fill(v.box(-0.7, 0.7, -0.7, 0.7, 9.9, 10.2), steel)  # platform
    zc, yw = 10.75, 0.75
    v.fill(v.box(-0.25, 0.25, -0.5, 0.9, 10.2, 11.1), red)  # gearbox head
    # fan wheel in the x-z plane facing +y
    rx_, rz_ = v.x, v.z - zc
    rr = np.sqrt(rx_ ** 2 + rz_ ** 2)
    ang = np.arctan2(rz_, rx_)
    nbl = 12
    bl = ((ang / (2 * math.pi) * nbl + phase) % 1.0) < 0.58
    disc = (np.abs(v.y - yw) < 0.15) & (rr < 1.85)
    v.fill(disc & (rr > 0.3) & bl, blade)
    v.fill(disc & (rr > 1.6), steel)
    v.fill(disc & (rr < 0.35), red)
    # tail boom + vane
    v.fill(v.seg((0, -0.4, 10.7), (0, -2.4, 10.8), 0.1), steel)
    v.fill(v.box(-0.15, 0.15, -2.75, -1.6, 10.25, 11.5), red)
    return v


@prop("windmill", "Farm Windmill", "rural", 0.15, 0.32, radius=1.2,
      extra={"fps": 4, "loop": True},
      desc="Old steel farm water-pumping windmill on a lattice tower; 2-frame fan spin (f0, f1).")
def b_windmill(p):
    vols = [windmill_frame(p, ph).render(centre=None)[0] for ph in (0.0, 0.5)]
    return {"frames": crop_many(vols)}


@prop("water_tower", "Water Tower", "landmark", 0.18, 0.55, radius=4.6,
      desc="Generic town water tower: bulb tank on four braced legs with a catwalk (label-free).")
def b_water_tower(p):
    v = Vox(14.5, 14.5, 36, p.px, p.sh)
    tank = M(ramp=["#4e6a7e", "#7ea0b6", "#b8d2e0", "#eef8fc"], kz=1.3)
    steel = M("#7c8894", kz=1.2)
    conc = M(CONCRETE)
    zc = 27.5
    for k in range(4):
        a = math.radians(45 + 90 * k)
        v.fill(v.cyl(5.6 * math.cos(a), 5.6 * math.sin(a), 0.9, 0, 0.9), conc)
        v.fill(v.seg((5.6 * math.cos(a), 5.6 * math.sin(a), 0), (4.0 * math.cos(a), 4.0 * math.sin(a), zc - 1),
                     0.34), steel)
    for z in (8.0, 16.0):
        rr = 5.6 - (5.6 - 4.0) * z / (zc - 1)
        for k in range(4):
            a0, a1 = math.radians(45 + 90 * k), math.radians(135 + 90 * k)
            v.fill(v.seg((rr * math.cos(a0), rr * math.sin(a0), z), (rr * math.cos(a1), rr * math.sin(a1), z), 0.25), steel)
    v.fill(v.cyl(0, 0, 0.95, 0, zc - 3), steel)  # riser
    shell = v.ell(0, 0, zc, 6.4, 6.4, 4.6)
    v.fill(shell, tank)
    # Radial steel roofing sheets meet at a raised breather on the crown.
    # Slightly weather adjacent sheets and the rolled seams at their edges.
    radius = np.hypot(v.x, v.y)
    azimuth = (np.arctan2(v.y, v.x) / math.tau + 1) * 16
    plate = M(ramp=["#4e6677", "#7a96a8", "#abc5d0", "#dce9eb"])
    seam = M(ramp=["#465d69", "#748995", "#97acb9", "#c3d7df"])
    top = shell & (v.z > zc + .25)
    v.paint(top & (np.floor(azimuth) % 4 == 1), plate)
    v.paint(top & (radius > .9) & (np.minimum(azimuth % 1, 1 - azimuth % 1) * radius < .18), seam)
    v.paint(shell & v.zr(zc - 2.0, zc - 1.45), plate)
    v.fill(v.cyl(0, 0, .88, zc + 4.2, zc + 4.95), steel)
    v.fill(v.cone(0, 0, zc + 4.95, zc + 5.65, 1.18, .15), plate)
    # Inspection hatch and ladder, separate from the crown vent.
    v.fill(v.cyl(2.45, .12, .52, zc + 3.85, zc + 4.65), steel)
    v.fill(v.box(2.16, 2.72, -.05, .25, zc + 4.55, zc + 4.91), plate)
    ring = v.cyl(0, 0, 7.1, zc - .85, zc - .36) & ~v.cyl(0, 0, 6.18, 0, 99)
    v.fill(ring, steel)
    rail = v.cyl(0, 0, 7.04, zc + .26, zc + .8) & ~v.cyl(0, 0, 6.83, 0, 99)
    v.fill(rail, seam)
    for k in range(20):
        a = math.tau * k / 20
        v.fill(v.post(6.92 * math.cos(a), 6.92 * math.sin(a), zc - .65, zc + .66, 1), steel)
    for j in (-.34, .34):
        v.fill(v.seg((5.6, j, .65), (4.83, j, zc - 6.0), .10), steel)
    for k in range(1, 26):
        z = k * .8
        x = 5.60 - .77 * (z - .65) / (zc - 6.65)
        v.fill(v.seg((x, -.34, z), (x, .34, z), .085), seam)
    return v.render()[0]


@prop("grain_elevator", "Grain Elevator", "rural", 0.4, 1.0, radius=9.0,
      desc="Concrete grain elevator: 2x3 cluster of tall silos with a headhouse and roof gallery.")
def b_grain_elevator(p):
    v = Vox(22, 15, 40, p.px, p.sh)
    conc = M(ramp=["#6c665c", "#9e968a", "#c9c0b0", "#ece4d2"], noise=0.3, cell=(10, 3, 3), seed=21, kz=1.1)
    conc_dk = M(ramp=["#5a554c", "#857e72", "#aaa292", "#d0c8b6"], kz=1.0)
    metal = M("#8c949c", kz=1.2)
    roofm = M("#6a5a50")
    R = 3.35
    for ix in (-1, 0, 1):
        for iy in (-0.5, 0.5):
            v.fill(v.cyl(ix * 2 * R, iy * 2 * R, R, 0, 30), conc)
            v.fill(v.cyl(ix * 2 * R, iy * 2 * R, R - 0.4, 29.6, 30.3), conc_dk)
    v.fill(v.box(-10.0, 6.5, -1.4, 1.4, 30.0, 33.0), metal)  # gallery
    v.fill(v.box(-10.0, 6.5, -1.4, 1.4, 33.0, 33.6), roofm)
    v.fill(v.box(6.0, 10.6, -3.2, 3.2, 0, 38.0), conc_dk)  # headhouse
    v.fill(v.box(5.8, 10.8, -3.4, 3.4, 38.0, 39.0), roofm)
    v.fill(v.box(9.5, 11.6, -1.0, 1.0, 0, 3.5), metal)  # loading shed
    for z in (8, 15, 22, 29, 35):
        v.paint(v.box(10.4, 11, -2.2, 2.2, z, z + 1.0) | v.box(6.4, 10.4, 3.0, 3.6, z, z + 1.0), M("#3a3e46"))
    return v.render()[0]


def lathe_views(W, H, prof, top_draw, side_cols, front_cols=None):
    """Helper for round props: prof(row) -> half-width in px (H rows, row 0 = top). side/front views share
    the profile; colours per row from side_cols(row) -> hex (flat across the row = rotation-invariant)."""
    side = View(W, H)
    front = View(W, H)
    back = View(W, H)
    for r in range(H):
        hw = prof(r)
        if hw <= 0:
            continue
        x0, x1 = int(round(W / 2 - hw)), int(round(W / 2 + hw))
        for vv, cf in ((side, side_cols), (front, front_cols or side_cols), (back, front_cols or side_cols)):
            vv.rect(x0, r, x1, r + 1, cf(r))
    top = View(W, W)
    top_draw(top)
    return top, side, front, back


@prop("oil_storage_tank", "Oil Storage Tank", "rural", 0.4, 0.4, radius=9.6,
      desc="White 20 m crude storage tank with a low cone roof, stair landing and vent (Port of Catoosa / tank farms).")
def b_oil_tank(p):
    W, H = 50, 31
    wr = make_ramp("#e4e6e2")

    def prof(r):
        return 25 if r >= 3 else 25 - (3 - r) * 7

    def cols(r):
        if r < 3:
            return wr[3]
        if r == 3 or r == 4:
            return wr[2] if r == 4 else "#8a9096"
        if r >= H - 2:
            return wr[0]
        return "#5a6068" if r in (H - 4,) else wr[2] if r % 6 else wr[1]

    def top_draw(t):
        t.ellipse(0, 0, W, W, wr[2])
        t.ellipse(7, 7, W - 7, W - 7, wr[3])
        t.ellipse(18, 18, W - 18, W - 18, wr[2])
        t.ellipse(22, 22, W - 22, W - 22, "#8a9096")
        t.rect(22, W - 4, 28, W, "#8a9096")  # stair landing at the front rim
    top, side, front, back = lathe_views(W, H, prof, top_draw, cols)
    return carve(p.id, top, side, front, back, round_=True, shade=0.1)


@prop("radio_tower", "Radio Tower", "landmark", 0.4, 1.0, radius=1.6,
      desc="40 m red-and-white triangular lattice radio mast with aviation beacons (emissive).")
def b_radio_tower(p):
    v = Vox(5, 5, 41, p.px, p.sh)
    red = M(ramp=["#5a1210", "#9a2420", "#d84030", "#ff8a6a"], kz=1.1)
    white = M(ramp=["#8c98aa", "#c4cedb", "#eef2f6", "#ffffff"], kz=1.1)
    conc = M(CONCRETE)
    beacon = M(ramp=["#ff2020", "#ff2020", "#ff3030", "#ffb0a0"], emit=True, tone=3)
    v.fill(v.box(-2.2, 2.2, -2.2, 2.2, 0, 0.9), conc)
    lattice_tower(v, white, 0, 0, 0.9, 39.5, 2.6, 2.0, 12, tri=True, zigzag=True)
    for k in range(7):
        if k % 2 == 0:
            v.paint(v.zr(0.9 + k * 5.5, 0.9 + (k + 1) * 5.5), red)
    v.fill(v.ell(0, 0, 40.2, 0.45, 0.45, 0.9), beacon)
    for z in (20.5,):
        for k in range(3):
            a = math.radians(90 + 120 * k)
            v.fill(v.ell(1.05 * math.cos(a), 1.05 * math.sin(a), z, 0.4, 0.4, 0.6), beacon)
    return v.render()


@prop("cell_tower", "Cell Tower", "landmark", 0.3, 0.9, radius=1.2,
      desc="35 m galvanised monopole with two triangular antenna arrays and a base cabinet.")
def b_cell_tower(p):
    v = Vox(6, 6, 35, p.px, p.sh)
    galv = M("#9aa2aa", kz=1.2)
    white = M(ramp=["#8c98aa", "#c4cedb", "#eef2f6", "#ffffff"])
    conc = M(CONCRETE)
    cab = M("#c8c6b8")
    v.fill(v.box(-2.6, 2.6, -2.6, 2.6, 0, 0.5), conc)
    v.fill(v.box(0.9, 2.4, -2.2, -0.6, 0.5, 2.3), cab)
    v.fill(v.cone(0, 0, 0.5, 34.0, 0.75, 0.42), galv)
    for zc in (33.0, 28.5):
        tri = v.cyl(0, 0, 2.3, zc - 0.45, zc + 0.45) & ~v.cyl(0, 0, 1.6, 0, 99)
        v.fill(tri, galv)
        for k in range(3):
            a = math.radians(90 + 120 * k)
            for o in (-0.8, 0, 0.8):
                cx = 2.2 * math.cos(a) - o * math.sin(a)
                cy = 2.2 * math.sin(a) + o * math.cos(a)
                v.fill(v.cbox(cx, cy, 0.6, 0.6, zc - 1.2, zc + 1.4), white)
    return v.render()[0]


# ---------------------------------------------------------------------------- trees & nature
OAK_C = ["#183428", "#28502e", "#427a36", "#7fae48"]
ELM = ["#1e3a26", "#2f6234", "#4f9640", "#9cc85e"]
COTTON = ["#24402a", "#3c6e32", "#65a443", "#b8dc6a"]
REDBUD = ["#4a1840", "#86286e", "#c8489a", "#f29ad0"]
REDBUD2 = ["#5a1e4e", "#9c3484", "#dc66b0", "#ffc0e2"]
CEDAR = ["#10221c", "#1a3528", "#284c34", "#4c6e44"]
CEDAR2 = ["#13261c", "#20402c", "#33583a", "#5e8250"]
POSTOAK = ["#232c1a", "#3a4a26", "#5c6e34", "#94a352"]
PINE = ["#0f2420", "#1a3a2c", "#2a5a3a", "#5a8a54"]


@prop("oak_2", "Oak", "tree", 0.2, 0.35, radius=0.6, group="oak",
      desc="Wide, low spreading oak, 9 m.")
def b_oak_2(p):
    v = broadleaf(p, 22, height=9.2, crown_w=14.0, crown_h=6.2, crown_z=5.9, trunk_r=0.5, leaf=OAK_C,
                  leaf2=OAK_A, nblob=26, blob_r=(1.5, 2.5), branches=6, crown_d=12.6, trunk_top=3.6)
    return v.render()[0]


@prop("oak_3", "Oak", "tree", 0.2, 0.35, radius=0.55, group="oak",
      desc="Tall rounded oak with a slightly leaning crown, 12.5 m.")
def b_oak_3(p):
    v = broadleaf(p, 33, height=12.6, crown_w=11.0, crown_h=8.6, crown_z=8.1, trunk_r=0.42, leaf=OAK_B,
                  leaf2=OAK_A, nblob=18, blob_r=(1.3, 2.2), branches=5, lean=(0.5, -0.3), trunk_top=5.0)
    return v.render()[0]


@prop("elm", "American Elm", "tree", 0.2, 0.35, radius=0.5,
      desc="Vase-shaped elm: limbs fork low and fan out into a broad high crown, 14 m.")
def b_elm(p):
    rng = np.random.default_rng(44)
    v = Vox(14, 14, 14, p.px, p.sh)
    bark = M("#6a5a4a", noise=0.3, cell=(4, 2, 2), seed=45)
    v.fill(v.seg((0, 0, 0), (0, 0, 3.6), 0.5, 0.42), bark)
    v.fill(v.cone(0, 0, 0, 0.6, 0.9, 0.5), bark)
    tips = []
    for k in range(6):
        a = k * math.pi / 3 + rng.uniform(-0.3, 0.3)
        tip = (math.cos(a) * 4.8, math.sin(a) * 4.8, 10.6 + rng.uniform(-0.5, 0.5))
        tips.append(tip)
        v.fill(v.seg((0, 0, 3.3), tip, 0.34, 0.16), bark)
    crown = v.ell(0, 0, 11.4, 6.6, 6.6, 2.4)
    for tx, ty, tz in tips:
        crown |= v.ell(tx * 1.08, ty * 1.08, tz + 0.5, 2.5, 2.5, 1.9)
    crown &= v.zr(9.0, 99) & ~v.ell(0, 0, 8.6, 3.6, 3.6, 2.6)
    n = value_noise(v.m.shape, 2, 46)
    crown &= ~((n < 0.3) & ~(blur3(crown.astype(np.float32), 1) >= 0.999))
    lm = M(ramp=ELM, noise=0.42, cell=(2, 3, 3), seed=47, b=2.05, kz=1.3)
    v.fill(crown, lm)
    v.paint(crown & (value_noise(v.m.shape, (3, 4, 4), 48) > 0.6), M(ramp=OAK_B, noise=0.42, cell=(2, 3, 3), seed=47, b=2.05, kz=1.3))
    return v.render()[0]


@prop("cottonwood", "Cottonwood", "tree", 0.25, 0.5, radius=0.8,
      desc="Tall riverbank cottonwood with a pale trunk and loose bright crown, 20 m.")
def b_cottonwood(p):
    v = broadleaf(p, 55, height=20, crown_w=13.5, crown_h=12.5, crown_z=13.2, trunk_r=0.75, leaf=COTTON,
                  leaf2=ELM, bark="#9a958a", nblob=22, blob_r=(1.8, 3.0), branches=6, shell=0.6,
                  ragged=0.4, trunk_top=8.5, lean=(0.6, 0.4))
    return v.render()[0]


@prop("redbud", "Eastern Redbud", "tree", 0.2, 0.25, radius=0.35,
      desc="Oklahoma state tree in spring bloom: small multi-stem tree covered in pink-magenta blossoms, 6 m.")
def b_redbud(p):
    rng = np.random.default_rng(66)
    v = Vox(8, 8, 6.3, p.px, p.sh)
    bark = M("#4e3a34", noise=0.3, cell=(3, 2, 2), seed=67)
    for k in range(3):
        a = k * 2.1 + 0.4
        v.fill(v.seg((0.15 * math.cos(a), 0.15 * math.sin(a), 0), (1.4 * math.cos(a), 1.4 * math.sin(a), 3.0),
                     0.2, 0.12), bark)
    crown = v.ell(0, 0, 4.0, 3.0, 3.0, 1.7)
    for i in range(16):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        crown |= v.ell(u[0] * 2.5, u[1] * 2.5, 4.1 + abs(u[2]) * 1.2, 1.1, 1.1, 0.9)
    crown &= v.zr(2.3, 99)
    n = value_noise(v.m.shape, 2, 68)
    crown &= ~((n < 0.36) & ~(blur3(crown.astype(np.float32), 1) >= 0.999))
    v.fill(crown, M(ramp=REDBUD, noise=0.5, cell=2, seed=69, b=2.05, kz=1.3))
    v.paint(crown & (value_noise(v.m.shape, (2, 3, 3), 70) > 0.62), M(ramp=REDBUD2, noise=0.4, cell=2, seed=69, b=2.05, kz=1.3))
    return v.render()[0]


def cedar(p, seed, height, r0, ramp_a, ramp_b, lumpy=1.0):
    rng = np.random.default_rng(seed)
    v = Vox(2 * r0 + 1.2, 2 * r0 + 1.2, height + 0.2, p.px, p.sh)
    bark = M("#5a3a2c", noise=0.3, cell=(3, 2, 2), seed=seed + 1)
    v.fill(v.cyl(0, 0, 0.28, 0, 1.2), bark)
    zb = 0.5
    t = np.clip((v.z - zb) / (height - zb), 0, 1)
    rr = r0 * (1 - t) ** 0.85 * (0.85 + 0.15 * np.sin(t * 9))
    body = (v.x ** 2 + v.y ** 2 < rr ** 2) & v.zr(zb, height)
    for i in range(int(22 * lumpy)):
        z = rng.uniform(zb + 0.4, height * 0.85)
        tt = (z - zb) / (height - zb)
        a = rng.uniform(0, 2 * math.pi)
        rad = r0 * (1 - tt) ** 0.85
        br = max(0.45, rad * 0.45)
        body |= v.ell(math.cos(a) * rad * 0.8, math.sin(a) * rad * 0.8, z, br, br, br * 1.3)
    n = value_noise(v.m.shape, 2, seed + 2)
    body &= ~((n < 0.3) & ~(blur3(body.astype(np.float32), 1) >= 0.999))
    lm = M(ramp=ramp_a, noise=0.45, cell=(2, 2, 2), seed=seed + 3, b=2.0, kz=1.25)
    v.fill(body, lm)
    v.paint(body & (value_noise(v.m.shape, (3, 3, 3), seed + 4) > 0.6),
            M(ramp=ramp_b, noise=0.45, cell=(2, 2, 2), seed=seed + 3, b=2.0, kz=1.25))
    return v


@prop("eastern_red_cedar_1", "Eastern Red Cedar", "tree", 0.2, 0.35, radius=0.4, group="eastern_red_cedar",
      desc="Dark conical juniper that covers Oklahoma pastures, 8 m.")
def b_cedar_1(p):
    return cedar(p, 77, 8.0, 1.9, CEDAR, CEDAR2).render()[0]


@prop("eastern_red_cedar_2", "Eastern Red Cedar", "tree", 0.2, 0.35, radius=0.4, group="eastern_red_cedar",
      desc="Young bushy red cedar, 5 m.")
def b_cedar_2(p):
    return cedar(p, 88, 5.2, 1.6, CEDAR2, CEDAR, lumpy=1.4).render()[0]


@prop("post_oak", "Post Oak", "tree", 0.2, 0.35, radius=0.45,
      desc="Scrubby Cross Timbers post oak: crooked limbs and separate leaf clumps, 7 m.")
def b_post_oak(p):
    rng = np.random.default_rng(99)
    v = Vox(9, 9, 7.6, p.px, p.sh)
    bark = M("#4e4238", noise=0.35, cell=(3, 2, 2), seed=100)
    lm = M(ramp=POSTOAK, noise=0.45, cell=(2, 3, 3), seed=101, b=2.05, kz=1.3)
    v.fill(v.seg((0, 0, 0), (0.4, -0.2, 2.2), 0.36, 0.3), bark)
    v.fill(v.seg((0.4, -0.2, 2.2), (-0.2, 0.3, 3.4), 0.3, 0.25), bark)
    crown = np.zeros(v.m.shape, bool)
    for k in range(5):
        a = k * 2 * math.pi / 5 + rng.uniform(-0.4, 0.4)
        d = rng.uniform(1.8, 2.9)
        tip = (math.cos(a) * d, math.sin(a) * d, rng.uniform(4.2, 5.8))
        mid = (math.cos(a) * d * 0.5 + rng.uniform(-0.4, 0.4), math.sin(a) * d * 0.5, tip[2] - 1.4)
        v.fill(v.seg((-0.2, 0.3, 3.2), mid, 0.22, 0.17), bark)
        v.fill(v.seg(mid, tip, 0.17, 0.12), bark)
        crown |= v.ell(tip[0], tip[1], tip[2] + 0.4, rng.uniform(1.3, 1.8), rng.uniform(1.3, 1.8), 1.1)
    crown |= v.ell(0, 0, 5.4, 1.6, 1.6, 1.2)
    n = value_noise(v.m.shape, 2, 102)
    crown &= ~((n < 0.36) & ~(blur3(crown.astype(np.float32), 1) >= 0.999))
    v.fill(crown, lm)
    return v.render()[0]


@prop("pine", "Shortleaf Pine", "tree", 0.2, 0.45, radius=0.4,
      desc="Tall straight pine with a tufted crown, 16 m.")
def b_pine(p):
    rng = np.random.default_rng(111)
    v = Vox(8, 8, 16.3, p.px, p.sh)
    bark = M("#6a4030", noise=0.35, cell=(4, 2, 2), seed=112)
    lm = M(ramp=PINE, noise=0.4, cell=(2, 2, 2), seed=113, b=2.0, kz=1.35)
    v.fill(v.seg((0, 0, 0), (0, 0, 15.0), 0.36, 0.14), bark)
    tufts = np.zeros(v.m.shape, bool)
    for i in range(24):
        z = rng.uniform(8.0, 15.4)
        t = (z - 8.0) / 7.4
        reach = (1 - t) * 2.9 + 0.6
        a = rng.uniform(0, 2 * math.pi)
        tip = (math.cos(a) * reach, math.sin(a) * reach, z + 0.4)
        v.fill(v.seg((0, 0, z - 0.5), tip, 0.12), bark)
        tufts |= v.ell(tip[0], tip[1], tip[2] + 0.2, 1.15 - 0.4 * t, 1.15 - 0.4 * t, 0.75)
    tufts |= v.ell(0, 0, 15.3, 0.7, 0.7, 0.9)
    v.fill(tufts, lm)
    return v.render()[0]


@prop("dead_tree", "Dead Tree", "tree", 0.2, 0.35, radius=0.4,
      desc="Bare, sun-bleached dead tree (drought / storm-killed), 9 m.")
def b_dead_tree(p):
    rng = np.random.default_rng(123)
    v = Vox(9, 9, 9.3, p.px, p.sh)
    bark = M(ramp=["#3e3834", "#6a625a", "#948a7e", "#c8beb0"], noise=0.3, cell=(3, 2, 2), seed=124, kz=1.2)

    def grow(p0, direction, length, r, depth):
        d = np.asarray(direction, float)
        d /= np.linalg.norm(d)
        p1 = np.asarray(p0) + d * length
        v.fill(v.seg(p0, p1, r, r * 0.72), bark)
        if depth == 0:
            return
        for k in range(2 if depth < 3 else 3):
            nd = d + rng.normal(size=3) * 0.65
            nd[2] = abs(nd[2]) * 0.8 + 0.25
            grow(p1, nd, length * rng.uniform(0.6, 0.8), r * 0.7, depth - 1)

    v.fill(v.cone(0, 0, 0, 0.7, 0.95, 0.5), bark)
    grow((0, 0, 0), (0.1, 0.05, 1), 3.8, 0.55, 4)
    return v.render()[0]


def bush(p, seed, w, d, h, ramp_a, ramp_b, flowers=None, nblob=9):
    rng = np.random.default_rng(seed)
    v = Vox(w + 0.4, d + 0.4, h + 0.2, p.px, p.sh)
    body = v.ell(0, 0, h * 0.45, w * 0.42, d * 0.42, h * 0.5) & v.zr(0, 99)
    for i in range(nblob):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        br = rng.uniform(0.3, 0.45) * min(w, d)
        body |= v.ell(u[0] * (w / 2 - br), u[1] * (d / 2 - br), h * 0.5 + abs(u[2]) * (h * 0.5 - br * 0.8),
                      br, br, br * 0.9)
    body &= v.zr(0, h)
    n = value_noise(v.m.shape, 2, seed + 1)
    body &= ~((n < 0.33) & ~(blur3(body.astype(np.float32), 1) >= 0.999))
    v.fill(body, M(ramp=ramp_a, noise=0.45, cell=2, seed=seed + 2, b=2.05, kz=1.3))
    v.paint(body & (value_noise(v.m.shape, 3, seed + 3) > 0.62), M(ramp=ramp_b, noise=0.45, cell=2, seed=seed + 2, b=2.05, kz=1.3))
    if flowers:
        surf = v.surface()
        fl = surf & (value_noise(v.m.shape, (1.5, 2, 2), seed + 4) > 0.66) & (v.z > h * 0.3)
        v.paint(fl, M(ramp=flowers, tone=2))
        v.paint(fl & (value_noise(v.m.shape, 2, seed + 5) > 0.6), M(ramp=flowers, tone=3))
    return v


@prop("bush_1", "Bush", "tree", 0.1, 0.15, radius=0.6, group="bush", desc="Round shrub, 1.6 m.")
def b_bush_1(p):
    return bush(p, 131, 1.7, 1.7, 1.3, OAK_A, OAK_B).render()[0]


@prop("bush_2", "Hedge Bush", "tree", 0.1, 0.15, radius=0.6, group="bush", desc="Long clipped hedge segment, 2.6 m.")
def b_bush_2(p):
    return bush(p, 141, 2.6, 1.1, 1.15, CEDAR2, OAK_C, nblob=14).render()[0]


@prop("bush_3", "Flowering Bush", "tree", 0.1, 0.15, radius=0.6, group="bush",
      desc="Crape-myrtle style flowering shrub with pink blooms, 1.9 m.")
def b_bush_3(p):
    return bush(p, 151, 1.9, 1.8, 1.8, ELM, OAK_B, flowers=["#7a2050", "#c03a80", "#f070b0", "#ffd0e8"]).render()[0]


@prop("tall_grass_clump", "Tall Grass", "tree", 0.05, 0.1, solid=False,
      desc="Tallgrass-prairie bunch (big bluestem / switchgrass) with bronze seed heads, 1.3 m. Walk/drive-through.")
def b_tall_grass(p):
    rng = np.random.default_rng(161)
    v = Vox(1.7, 1.7, 1.4, p.px, p.sh)
    g = M(ramp=["#3a4420", "#5e702c", "#8a9c40", "#c4cc74"], kz=0.7)
    g2 = M(ramp=["#4a3e20", "#7a6430", "#a88c48", "#d8c482"], kz=0.7)
    seed_m = M(ramp=["#3a1c1a", "#682e26", "#94482e", "#c87850"], kz=0.6)
    v.fill(v.cyl(0, 0, 0.16, 0, 0.3), g)
    for i in range(22):
        a = i * 2 * math.pi / 22 + rng.uniform(-0.15, 0.15)
        reach = rng.uniform(0.35, 0.78)
        top = rng.uniform(0.7, 1.32) - reach * 0.25
        mid = (math.cos(a) * reach * 0.35, math.sin(a) * reach * 0.35, top * 0.7)
        tip = (math.cos(a) * reach, math.sin(a) * reach, top)
        mat = g if i % 3 else g2
        v.fill(v.seg((0, 0, 0.05), mid, 0.05), mat)
        v.fill(v.seg(mid, tip, 0.045), mat)
        if i % 4 == 0:
            v.fill(v.ell(tip[0], tip[1], tip[2] + 0.04, 0.06, 0.06, 0.1), seed_m)
    return v.render()[0]


# ---------------------------------------------------------------------------- farm & animals
@prop("hay_bale_round", "Round Hay Bale", "rural", 0.1, 0.1, radius=0.8,
      desc="1.6 m round bale lying on its side (axis along x).")
def b_hay_round(p):
    D, Wd = 16, 13
    hy = ["#6a5222", "#9a7a36", "#c8a450", "#ecd284"]
    top = View(Wd, D).rect(0, 0, Wd, D, hy[2])
    for y in range(1, D, 3):
        top.rect(0, y, Wd, y + 1, hy[1])
    top.rect(0, 0, Wd, 2, hy[1]).rect(0, D - 2, Wd, D, hy[1])
    top.rect(0, 4, Wd, 12, hy[3]).rect(0, 6, Wd, 7, hy[2]).rect(0, 9, Wd, 10, hy[2])
    side = View(D, D).ellipse(0, 0, D, D, hy[1]).ellipse(2, 2, D - 2, D - 2, hy[2]).ellipse(5, 5, D - 5, D - 5, hy[1])
    side.ellipse(6, 6, D - 6, D - 6, hy[3]).ellipse(7, 7, D - 7, D - 7, hy[2])
    front = View(Wd, D).rect(0, 0, Wd, D, hy[2])
    for y in range(1, D, 3):
        front.rect(0, y, Wd, y + 1, hy[1])
    front.rect(0, 0, Wd, 3, hy[3]).rect(0, D - 3, Wd, D, hy[0])
    back = View(Wd, D)
    back.im = front.im.copy()
    back.d = ImageDraw.Draw(back.im)
    return carve(p.id, top, side, front, back, shade=0.15)


@prop("hay_bale_square", "Square Hay Bale", "rural", 0.1, 0.1, radius=0.7,
      desc="Large 2.4 x 1.2 x 0.9 m square bale with twine.")
def b_hay_square(p):
    Wd, L, H = 12, 24, 9
    hy = ["#6a5222", "#9a7a36", "#c8a450", "#ecd284"]
    tw = "#4a4030"
    top = View(Wd, L).rect(0, 0, Wd, L, hy[3])
    for y in range(2, L, 4):
        top.rect(0, y, Wd, y + 1, hy[2])
    top.rect(3, 0, 4, L, tw).rect(8, 0, 9, L, tw)
    side = View(L, H).rect(0, 0, L, H, hy[2])
    for x in range(2, L, 4):
        side.rect(x, 0, x + 1, H, hy[1])
    side.rect(0, 0, L, 1, hy[3]).rect(0, H - 1, L, H, hy[0])
    front = View(Wd, H).rect(0, 0, Wd, H, hy[2]).rect(0, 0, Wd, 1, hy[3]).rect(3, 0, 4, H, tw).rect(8, 0, 9, H, tw)
    front.rect(0, H - 1, Wd, H, hy[0])
    back = View(Wd, H)
    back.im = front.im.copy()
    back.d = ImageDraw.Draw(back.im)
    return carve(p.id, top, side, front, back, shade=0.15)


def bovine(p, body_m, head_m, belly_m=None, leg_m=None, tail_m=None, muzzle="#d8a0a0"):
    v = Vox(1.4, 2.9, 1.6, p.px, p.sh)
    leg_m = leg_m or body_m
    hoof = M("#2a2420")
    for sx in (-0.25, 0.25):
        for sy in (-0.7, 0.6):
            v.fill(v.post(sx, sy, 0, 0.8, 2), leg_m)
            v.paint(v.zr(0, 0.12), hoof)
    sup = (np.abs(v.x / 0.46) ** 3 + np.abs((v.y + 0.05) / 1.0) ** 3 + np.abs((v.z - 1.02) / 0.42) ** 3) < 1
    v.fill(sup, body_m)
    if belly_m:
        v.paint(v.zr(0.7, 0.8) & (v.y > -0.3), belly_m)
    v.fill(v.seg((0, 0.85, 1.15), (0, 1.12, 1.02), 0.27), body_m)
    v.fill(v.ell(0, 1.28, 0.98, 0.21, 0.3, 0.24), head_m)
    v.fill(v.ell(0, 1.52, 0.88, 0.17, 0.12, 0.14), M(muzzle))
    for s in (-1, 1):
        v.fill(v.ell(s * 0.27, 1.16, 1.12, 0.13, 0.1, 0.07), head_m)
        v.fill(v.ell(s * 0.11, 1.4, 1.08, 0.06, 0.06, 0.06), M("#1a1418", tone=1))
    v.fill(v.seg((0, -1.0, 1.28), (0, -1.12, 0.6), 0.05), tail_m or body_m)
    v.fill(v.ell(0, -1.12, 0.55, 0.08, 0.08, 0.12), tail_m or body_m)
    return v


@prop("cow_hereford", "Hereford Cow", "rural", 0.1, 0.1, radius=0.8, group="cow",
      extra={"animal": True}, desc="Red-and-white-faced Hereford beef cow, 2.5 m. Faces +y.")
def b_cow_hereford(p):
    red = M(ramp=["#3e1410", "#6a2416", "#9a3c22", "#c8683c"], kz=1.1)
    white = M(ramp=["#8c8a86", "#c8c4bc", "#f0ece2", "#ffffff"])
    v = bovine(p, red, white, belly_m=white, tail_m=white)
    return v.render()[0]


@prop("cow_angus", "Angus Cow", "rural", 0.1, 0.1, radius=0.8, group="cow",
      extra={"animal": True}, desc="Black Angus beef cow, 2.5 m. Faces +y.")
def b_cow_angus(p):
    black = M(ramp=["#0e0d10", "#1c1a1e", "#2e2b30", "#56525a"], kz=1.2)
    v = bovine(p, black, black, muzzle="#4a3a3e")
    return v.render()[0]


@prop("horse", "Horse", "rural", 0.1, 0.1, radius=0.8,
      extra={"animal": True}, desc="Bay quarter horse with black mane, tail and socks, 2.4 m. Faces +y.")
def b_horse(p):
    v = Vox(1.2, 3.0, 2.3, p.px, p.sh)
    bay = M(ramp=["#3a1c10", "#62301a", "#8e4a28", "#c07a46"], kz=1.2)
    blk = M(ramp=["#0e0c0e", "#1e1a1c", "#302a2c", "#585052"])
    for sx in (-0.2, 0.2):
        for sy in (-0.62, 0.55):
            v.fill(v.post(sx, sy, 0, 1.15, 2), bay)
            v.paint(v.zr(0, 0.45) & v.box(sx - 0.2, sx + 0.2, sy - 0.2, sy + 0.2, 0, 1), blk)
    v.fill(v.ell(0, 0, 1.32, 0.36, 0.9, 0.36), bay)
    v.fill(v.seg((0, 0.72, 1.45), (0, 1.0, 1.98), 0.22, 0.17), bay)
    v.fill(v.seg((0, 1.02, 2.02), (0, 1.42, 1.72), 0.15, 0.11), bay)
    v.fill(v.seg((0, 0.62, 1.62), (0, 0.95, 2.15), 0.09), blk)  # mane
    for s in (-1, 1):
        v.fill(v.ell(s * 0.09, 1.0, 2.2, 0.06, 0.06, 0.1), bay)
    v.fill(v.seg((0, -0.86, 1.48), (0, -1.08, 0.75), 0.1, 0.07), blk)
    return v.render()[0]


@prop("bison", "American Bison", "rural", 0.1, 0.1, radius=1.0,
      extra={"animal": True}, desc="Tallgrass-prairie bison (Osage County): shaggy humped front, short horns, 3 m. Faces +y.")
def b_bison(p):
    v = Vox(1.4, 3.2, 2.0, p.px, p.sh)
    shag = M(ramp=["#1e120c", "#3a2416", "#5a3a22", "#866038"], noise=0.45, cell=2, seed=171, kz=1.2)
    hide = M(ramp=["#2a1a10", "#4a2e1a", "#6e4a2c", "#9a744a"], noise=0.3, cell=2, seed=172, kz=1.2)
    horn = M("#d8cfc0")
    for sx in (-0.24, 0.24):
        v.fill(v.post(sx, 0.55, 0, 0.9, 2), shag)
        v.fill(v.post(sx, -0.85, 0, 0.9, 2), hide)
    v.fill(v.ell(0, -0.55, 1.12, 0.43, 0.75, 0.42), hide)
    v.fill(v.ell(0, 0.35, 1.3, 0.52, 0.72, 0.56), shag)
    v.fill(v.ell(0, 0.4, 1.62, 0.36, 0.45, 0.3), shag)  # hump
    v.fill(v.ell(0, 1.15, 0.9, 0.3, 0.36, 0.34), shag)  # head
    v.fill(v.ell(0, 1.2, 0.6, 0.18, 0.2, 0.2), shag)  # beard
    for s in (-1, 1):
        v.fill(v.seg((s * 0.26, 1.1, 1.08), (s * 0.36, 1.18, 1.25), 0.05), horn)
    v.fill(v.seg((0, -1.25, 1.2), (0, -1.35, 0.75), 0.05), hide)
    return v.render()[0]


# ---------------------------------------------------------------------------- street furniture
def paint_img_xz(v, img, x0, z0, cx, cz, y0, y1, emit=False):
    """Paint an RGB image (rows top->bottom) onto existing voxels of the x-z plane band y0..y1."""
    h, w = img.shape[:2]
    cache = {}
    for r in range(h):
        for c in range(w):
            col = tuple(int(t) for t in img[r, c, :3])
            if col not in cache:
                cache[col] = M(col, tone=2, emit=emit)
            zt = z0 + (h - r) * cz
            v.paint(v.box(x0 + c * cx, x0 + (c + 1) * cx, y0, y1, zt - cz, zt), cache[col])


def traffic_light(p, state):
    v = Vox(10, 1.4, 6.8, p.px, p.sh)
    pole = M("#7c858e", kz=1.2)
    dark = M(ramp=["#14161a", "#22252b", "#33373f", "#52575f"])
    yellow = M(ramp=["#6a5410", "#b08a18", "#f0c430", "#fff08a"])
    on = {"red": ["#ff3a2a", "#ff3a2a", "#ff4a3a", "#ffc4b4"], "yellow": ["#ffb020", "#ffb020", "#ffc030", "#fff0b0"],
          "green": ["#2aff8a", "#2aff8a", "#40ffa0", "#c8ffe4"]}
    off = {"red": "#4a1612", "yellow": "#4a3610", "green": "#10301e"}
    v.fill(v.cyl(0, 0, 0.36, 0, 0.3), M(CONCRETE))
    v.fill(v.cyl(0, 0, 0.2, 0.3, 6.6), pole)
    v.fill(v.seg((0.1, 0, 6.25), (4.75, 0, 6.4), 0.12), pole)
    v.fill(v.seg((0.1, 0, 5.4), (1.6, 0, 6.3), 0.09), pole)  # arm brace
    for hx in (2.75, 4.5):
        v.fill(v.box(hx - 0.125, hx + 0.125, -0.125, 0.125, 6.25, 6.4), dark)  # hanger
        v.fill(v.box(hx - 0.375, hx + 0.375, -0.375, -0.25, 4.85, 6.2), yellow)  # backplate, yellow border
        v.fill(v.box(hx - 0.25, hx + 0.25, -0.25, 0.25, 4.95, 6.1), dark)  # housing (4x4 px)
        for k, (col, z0) in enumerate((("red", 5.7), ("yellow", 5.3), ("green", 4.9))):
            lens = v.box(hx - 0.25, hx + 0.25, 0.125, 0.25, z0 + 0.05, z0 + 0.4)
            if col == state:
                v.paint(lens, M(ramp=on[col], emit=True, tone=2))
            else:
                v.paint(lens, M(off[col], tone=2))
            v.fill(v.box(hx - 0.25, hx + 0.25, 0.25, 0.375, z0 + 0.38, z0 + 0.42), dark)  # visor
        # overhead-camera affordance: the active colour also shows as a lamp on the head's top
        v.fill(v.box(hx - 0.25, hx + 0.25, -0.25, 0.25, 6.1, 6.3), M(ramp=on[state], emit=True, tone=2))
    return v.render(centre="origin")


for _st in ("red", "yellow", "green"):
    def _mk(st):
        @prop(f"traffic_light_{st}", f"Traffic Light ({st})", "street", 0.125, 0.2, radius=0.25,
              group="traffic_light", extra={"state": st, "pivot": "pole"},
              desc=f"Mast-arm signal, {st} lit. Arm reaches 4.7 m along +x over the lanes; heads face +y. "
                   "Swap between the three files to change state; lit lens is in the emissive strip.")
        def _b(p):
            return traffic_light(p, st)
        return _b
    _mk(_st)


@prop("stop_sign", "Stop Sign", "sign", 0.05, 0.1, radius=0.1, breakable=True,
      desc="Octagonal red stop sign on a 2.2 m post, face toward +y.")
def b_stop_sign(p):
    v = Vox(0.9, 0.4, 2.55, p.px, p.sh)
    grey = M("#8a929a")
    red = M(ramp=["#5a0e10", "#9a1a1c", "#d22a26", "#ff6a58"], tone=2)
    white = M("#f2f2f0", tone=2)
    v.fill(v.post(0, 0, 0, 2.2, 2), grey)
    r = 0.39
    oct_ = (np.maximum(np.abs(v.x), np.abs(v.z - 2.1)) < r) & (np.abs(v.x) + np.abs(v.z - 2.1) < r * 1.42)
    plate = oct_ & (v.y > 0.05) & (v.y < 0.15)
    v.fill(plate, red)
    inner = (np.maximum(np.abs(v.x), np.abs(v.z - 2.1)) < r - 0.06) & (np.abs(v.x) + np.abs(v.z - 2.1) < (r - 0.06) * 1.42)
    v.paint(plate & ~inner, white)
    v.paint(plate & (np.abs(v.x) < 0.24) & v.zr(2.04, 2.16), white)
    v.fill(oct_ & (v.y > -0.05) & (v.y <= 0.05) & (np.abs(v.x) < 0.3), grey)  # backing
    return v.render(centre="origin")[0]


@prop("fire_hydrant", "Fire Hydrant", "street", 0.05, 0.05, radius=0.25, breakable=True,
      extra={"onBreak": "water_jet"}, desc="Red fire hydrant with silver caps, 0.8 m.")
def b_fire_hydrant(p):
    v = Vox(0.6, 0.6, 0.82, p.px, p.sh)
    red = M(ramp=["#4e0e10", "#8e1a1a", "#d0302a", "#ff7a5e"], kz=1.3)
    cap = M("#c8ccd0", kz=1.3)
    v.fill(v.cyl(0, 0, 0.21, 0, 0.06), red)
    v.fill(v.cyl(0, 0, 0.14, 0.05, 0.56), red)
    v.fill(v.cyl(0, 0, 0.18, 0.5, 0.58), red)
    v.fill(v.ell(0, 0, 0.6, 0.15, 0.15, 0.13), cap)
    v.fill(v.cbox(0, 0, 0.1, 0.1, 0.68, 0.78), cap)
    for s in (-1, 1):
        v.fill(v.seg((s * 0.1, 0, 0.4), (s * 0.22, 0, 0.4), 0.065), red)
        v.fill(v.cyl(s * 0.245, 0, 0.07, 0.33, 0.47, ry=0.07) & (np.abs(v.x) > 0.2), cap)
    v.fill(v.seg((0, 0.1, 0.36), (0, 0.23, 0.36), 0.085), red)
    v.fill(v.cbox(0, 0.255, 0.18, 0.05, 0.27, 0.45), cap)
    return v.render()[0]


@prop("mailbox", "Mail Collection Box", "street", 0.05, 0.05, radius=0.35, breakable=False,
      desc="Blue curbside mail collection box (no insignia), pull-down chute facing +y.")
def b_mailbox(p):
    W, L, H = 12, 10, 26
    b = ["#0e2050", "#1a3478", "#2a4ea8", "#6a8ed8"]
    top = View(W, L).rect(0, 0, W, L, b[3]).rect(2, 2, W - 2, L - 2, b[2]).rect(0, L - 2, W, L, b[2])

    def body(vw, w, front_detail):
        vw.rect(0, 3, w, H - 3, b[2]).rect(1, 1, w - 1, 3, b[2]).rect(2, 0, w - 2, 1, b[3])
        vw.rect(0, 3, w, 4, b[3]).rect(0, H - 4, w, H - 3, b[1])
        vw.rect(0, H - 3, 2, H, b[0]).rect(w - 2, H - 3, w, H, b[0])  # legs
        if front_detail:
            vw.rect(2, 5, w - 2, 8, b[0]).rect(3, 6, w - 3, 7, "#c8ccd4")  # chute + handle
            vw.rect(3, 12, w - 3, 15, "#e8ecf0")  # notice plate
        return vw
    side = body(View(L, H), L, False)
    front = body(View(W, H), W, True)
    back = body(View(W, H), W, False)
    back.rect(4, 10, W - 4, 12, b[1])
    return carve(p.id, top, side, front, back, shade=0.12)


@prop("residential_mailbox", "Mailbox on Post", "street", 0.05, 0.05, radius=0.15, breakable=True,
      desc="Rural/residential mailbox on a wooden post with a raised red flag; door faces +y.")
def b_res_mailbox(p):
    v = Vox(0.5, 0.7, 1.35, p.px, p.sh)
    wood = M("#8a6a44", noise=0.3, cell=(3, 1, 1), seed=181)
    box = M(ramp=["#14161a", "#262a30", "#3a4048", "#6a727c"], kz=1.4)
    red = M("#d8302a")
    v.fill(v.post(0, -0.05, 0, 1.0, 4), wood)
    v.fill(v.box(-0.15, 0.15, -0.3, 0.3, 0.95, 1.0), wood)
    body = (v.box(-0.12, 0.12, -0.27, 0.27, 1.0, 1.12)) | (v.cyl(0, 0, 0.12, 0, 99, ry=99) &
                                                           ((v.x / 0.12) ** 2 + ((v.z - 1.12) / 0.13) ** 2 < 1) &
                                                           (np.abs(v.y) < 0.27) & (v.z > 1.1))
    v.fill(body, box)
    v.fill(v.box(0.12, 0.22, -0.2, -0.1, 1.05, 1.32), red)  # flag up
    v.fill(v.box(0.12, 0.22, -0.2, 0.05, 1.22, 1.32), red)
    return v.render()[0]


@prop("bench", "Park Bench", "street", 0.1, 0.1, radius=0.6, breakable=True,
      desc="Slatted wooden bench with cast-iron ends; seat faces +y.")
def b_bench(p):
    v = Vox(2.0, 0.9, 0.95, p.px, p.sh)
    wood = M(ramp=["#4a2e1a", "#7a4c2a", "#a8703e", "#d4a064"], kz=1.1)
    iron = M("#2a2c30")
    for sx in (-0.85, 0.85):
        v.fill(v.poly_yz([(-0.35, 0), (-0.15, 0), (-0.1, 0.4), (0.2, 0.4), (0.22, 0), (0.35, 0), (0.3, 0.62),
                          (-0.2, 0.62), (-0.32, 0.9), (-0.42, 0.9)], sx - 0.1, sx + 0.1), iron)
    v.fill(v.box(-0.95, 0.95, -0.25, 0.3, 0.4, 0.5), wood)
    v.fill(v.box(-0.95, 0.95, -0.4, -0.2, 0.55, 0.9), wood)
    v.paint(v.box(-1, 1, -0.4, -0.2, 0.68, 0.74), M("#3a2414"))
    return v.render()[0]


@prop("trash_can", "Trash Can", "street", 0.05, 0.05, radius=0.3, breakable=True,
      desc="Round dark-green slatted metal litter bin with an open top.")
def b_trash_can(p):
    W, H = 12, 19
    g = ["#10201a", "#1c3428", "#2c4e3a", "#5a8264"]

    def cols(r):
        if r <= 1:
            return g[3] if r == 0 else g[2]
        if r in (5, 11):
            return g[3]
        return g[1] if r >= H - 2 else g[2]

    def top_draw(t):
        t.ellipse(0, 0, W, W, g[3]).ellipse(2, 2, W - 2, W - 2, g[1]).ellipse(3, 3, W - 3, W - 3, "#14181a")
    top, side, front, back = lathe_views(W, H, lambda r: 6 if r >= 1 else 5, top_draw, cols)
    return carve(p.id, top, side, front, back, round_=True, shade=0.1)


@prop("newspaper_box", "Newspaper Box", "street", 0.05, 0.05, radius=0.3, breakable=True,
      desc="Yellow coin-op newspaper vending box with a window, door faces +y.")
def b_newspaper_box(p):
    W, L, H = 10, 9, 22
    y_ = ["#6a4a0a", "#b07e14", "#ecbc2a", "#fff07a"]
    top = View(W, L).rect(0, 0, W, L, y_[3]).rect(0, 0, W, 2, y_[2]).rect(1, 3, W - 1, 4, y_[2])

    def body(vw, w, kind):
        vw.rect(0, 0, w, 15, y_[2]).rect(0, 0, w, 1, y_[3]).rect(0, 14, w, 15, y_[1])
        c = w // 2
        vw.rect(c - 2, 15, c + 2, H, "#3a3e44")  # pedestal
        if kind == "front":
            vw.rect(1, 3, w - 1, 10, "#9ab8c8").rect(2, 5, w - 2, 9, "#f0f0ea").rect(3, 6, w - 3, 7, "#3a3a3a")
            vw.rect(w - 3, 11, w - 1, 13, "#8a9098")
        return vw
    side = body(View(L, H), L, "side")
    front = body(View(W, H), W, "front")
    back = body(View(W, H), W, "back")
    return carve(p.id, top, side, front, back, shade=0.12)


@prop("payphone", "Payphone", "street", 0.05, 0.075, radius=0.3, breakable=False,
      extra={"interact": "phone"},
      desc="Classic pole-mounted payphone (no booth) with a bright yellow lit 'phone' sign; used for missions. Faces +y.")
def b_payphone(p):
    v = Vox(0.8, 0.7, 2.2, p.px, p.sh)
    steel = M(ramp=["#3a4048", "#5e6872", "#8e9aa6", "#d0d8e0"], kz=1.3)
    dark = M("#202328")
    yellow = M(ramp=["#7a5a08", "#c09010", "#ffd21e", "#fff59a"], kz=1.0)
    sign_y = M(ramp=["#ffd21e", "#ffd21e", "#ffe040", "#fff8b0"], emit=True, tone=2)
    black = M("#121316", tone=1)
    v.fill(v.cbox(0, 0, 0.3, 0.3, 0, 0.06), steel)
    v.fill(v.post(0, -0.05, 0, 1.1, 4), steel)
    v.fill(v.box(-0.22, 0.22, -0.16, 0.16, 1.05, 1.7), steel)  # housing
    v.fill(v.box(-0.3, 0.3, -0.22, 0.24, 1.7, 1.78), yellow)  # hood
    v.fill(v.box(-0.3, 0.3, -0.1, 0.1, 1.78, 2.2), sign_y)  # lit sign panel (4 px thick)
    glyph = np.array([[c == "1" for c in row] for row in
                      [".########.", "##########", "###....###", "##......##"]], bool)  # handset
    v.paint(v.bitmap_xz(glyph, -0.25, 1.83, 0.05, 0.075, 0.0, 0.11), black)
    v.paint(v.bitmap_xz(glyph[:, ::-1], -0.25, 1.83, 0.05, 0.075, -0.11, 0.0), black)
    # front details: keypad, coin slot, cradle + handset, cord
    v.paint(v.box(-0.05, 0.15, 0.1, 0.2, 1.22, 1.45), M("#c8ccd2"))
    v.paint(v.box(0.0, 0.1, 0.1, 0.2, 1.27, 1.4), dark)
    v.paint(v.box(-0.05, 0.15, 0.1, 0.2, 1.55, 1.62), M("#3ad070", emit=True, tone=2))  # display
    v.fill(v.box(-0.22, -0.08, 0.16, 0.26, 1.22, 1.6), black)  # handset
    v.fill(v.seg((-0.15, 0.24, 1.22), (-0.1, 0.32, 1.0), 0.05), black)
    v.fill(v.seg((-0.1, 0.32, 1.0), (0.05, 0.24, 1.15), 0.05), black)
    return v.render()


@prop("bus_stop_shelter", "Bus Stop Shelter", "street", 0.1, 0.1, radius=1.0,
      extra={"collision": "back_wall"},
      desc="Glass bus shelter with bench and lit ad panel; open side faces +y (the curb).")
def b_bus_shelter(p):
    v = Vox(4.6, 2.1, 2.7, p.px, p.sh)
    frame = M("#3a4250")
    glass = M(ramp=["#5a7a88", "#8ab0bc", "#b8dce4", "#e8fcff"], kz=0.4, b=2.2)
    roof = M(ramp=["#1a2a3a", "#2a4258", "#3c5c78", "#6a90b0"])
    wood = M("#9a6a3e")
    ad = M(ramp=["#ff6a3a", "#ff6a3a", "#ff8a4a", "#fff0c0"], emit=True, tone=2)
    ad2 = M(ramp=["#3ac0ff", "#3ac0ff", "#5ad0ff", "#e0f8ff"], emit=True, tone=2)
    for sx in (-1.95, 1.95):
        for sy in (-0.7, 0.6):
            v.fill(v.post(sx, sy, 0, 2.4, 2), frame)
    v.fill(v.box(-1.95, 1.95, -0.8, -0.6, 0.15, 2.3), glass)  # back wall
    v.fill(v.box(-2.05, -1.85, -0.7, 0.2, 0.15, 2.3), glass)  # left side
    v.fill(v.box(1.85, 2.05, -0.7, 0.3, 0.15, 2.3), ad)  # right side: ad box
    v.paint(v.box(1.85, 2.05, -0.7, 0.3, 0.15, 1.1), ad2)
    v.fill(v.box(-2.25, 2.25, -1.0, 0.95, 2.3, 2.5), roof)
    v.fill(v.box(-2.25, 2.25, 0.75, 0.95, 2.2, 2.5), frame)
    v.fill(v.box(-1.6, 1.6, -0.6, -0.25, 0.42, 0.5), wood)
    for sx in (-1.3, 1.3):
        v.fill(v.post(sx, -0.45, 0, 0.42, 2), frame)
    return v.render()


@prop("parking_meter", "Parking Meter", "street", 0.05, 0.05, radius=0.12, breakable=True,
      desc="Single-head coin parking meter with a red expired flag, face toward +y.")
def b_parking_meter(p):
    v = Vox(0.4, 0.35, 1.45, p.px, p.sh)
    grey = M(ramp=["#2e3238", "#4e545c", "#7a838e", "#b8c2cc"], kz=1.3)
    v.fill(v.post(0, 0, 0, 1.05, 2), grey)
    v.fill(v.box(-0.12, 0.12, -0.08, 0.08, 1.0, 1.3), grey)
    v.fill(v.cyl(0, 0, 0.12, 0, 99, ry=99) & ((v.x / 0.12) ** 2 + ((v.z - 1.3) / 0.1) ** 2 < 1) & (np.abs(v.y) < 0.08)
           & (v.z > 1.28), grey)
    v.paint(v.box(-0.08, 0.08, 0.04, 0.09, 1.15, 1.32), M("#e8e4c8"))
    v.paint(v.box(-0.06, 0.06, 0.04, 0.09, 1.18, 1.25), M("#e8302a"))
    return v.render()[0]


@prop("gas_station_pump", "Gas Pump", "street", 0.05, 0.075, radius=0.6,
      extra={"explosive": True},
      desc="Modern double-sided fuel dispenser on its island with bumper posts, lit header and screens.")
def b_gas_pump(p):
    v = Vox(2.0, 1.0, 2.2, p.px, p.sh)
    conc = M(CONCRETE)
    body = M(ramp=["#6a7078", "#a8b0b8", "#dfe4e8", "#ffffff"], kz=1.1)
    dark = M("#22262c")
    hdr = M(ramp=["#c42a22", "#c42a22", "#e0382c", "#ff8a6a"], emit=True, tone=2)
    stripe = M("#f2f2f2", emit=True, tone=2)
    screen = M(ramp=["#2ad06a", "#2ad06a", "#3ae07a", "#c0ffd8"], emit=True, tone=2)
    yel = M(ramp=["#6a5410", "#b08a18", "#f0c430", "#fff08a"])
    v.fill(v.box(-0.95, 0.95, -0.45, 0.45, 0, 0.15), conc)
    for sx in (-0.82, 0.82):
        v.fill(v.cyl(sx, 0, 0.08, 0.15, 0.9), yel)
    v.fill(v.box(-0.5, 0.5, -0.22, 0.22, 0.15, 1.85), body)
    v.paint(v.box(-0.5, 0.5, -0.3, 0.3, 0.15, 0.45), M("#5a6068"))
    v.fill(v.box(-0.55, 0.55, -0.27, 0.27, 1.85, 2.15), hdr)
    v.paint(v.box(-0.6, 0.6, -0.3, 0.3, 1.95, 2.02), stripe)
    for sg in (-1, 1):
        yy = (0.15, 0.25) if sg > 0 else (-0.25, -0.15)
        v.paint(v.box(-0.3, 0.3, *yy, 1.35, 1.65), dark)
        v.paint(v.box(-0.25, 0.25, *yy, 1.42, 1.6), screen)
        for k, col in enumerate(("#1a1a1a", "#e8c020", "#28a048")):
            xx = -0.3 + k * 0.25
            v.fill(v.box(xx, xx + 0.1, sg * 0.22 - 0.05, sg * 0.22 + 0.05, 0.85, 1.15), M(col))
    v.fill(v.seg((0.48, 0.0, 1.5), (0.62, 0.05, 0.6), 0.05), dark)
    v.fill(v.seg((-0.48, 0.0, 1.5), (-0.62, -0.05, 0.6), 0.05), dark)
    return v.render()


@prop("gas_station_canopy", "Gas Station Canopy", "street", 0.25, 0.25, solid=False, radius=0,
      extra={"overhead": True, "colliders": [[-5.0, 0.0, 0.35], [5.0, 0.0, 0.35]]},
      desc="20 x 10 m flat fuel canopy, 4.5 m clearance, two columns on the pump-island centreline "
           "(see colliders). Lit fascia stripe. Draw above cars; fade when the player is under it.")
def b_gas_canopy(p):
    v = Vox(20.6, 10.6, 5.5, p.px, p.sh)
    col = M(ramp=["#5a6068", "#8a929c", "#c0c8d0", "#e8eef2"])
    fascia = M(ramp=["#5a0e10", "#9a1a1c", "#cf2c26", "#ff6a58"], kz=0.8)
    stripe = M("#f6f6f2", emit=True, tone=2)
    roof = M(ramp=["#6a6e74", "#9ca2a8", "#c4c9ce", "#e2e6ea"], tone=2)
    unit = M("#7a8088")
    for sx in (-5.0, 5.0):
        v.fill(v.cbox(sx, 0, 0.6, 0.6, 0, 4.6), col)
        v.fill(v.cbox(sx, 0, 1.2, 1.2, 0, 0.3), M(CONCRETE))
    slab = v.box(-10.2, 10.2, -5.2, 5.2, 4.5, 5.4)
    v.fill(slab, fascia)
    v.paint(slab & v.zr(4.85, 5.05), stripe)
    v.fill(v.box(-9.8, 9.8, -4.8, 4.8, 5.2, 5.4), roof)
    v.fill(v.box(-2.0, 0.0, -1.5, 0.5, 5.4, 5.65), unit)
    return v.render()


@prop("billboard", "Billboard", "sign", 0.2, 0.3, radius=0.5,
      desc="Roadside billboard on two poles with a colourful fictional burger ad (front, +y) and lit catwalk.")
def b_billboard(p):
    v = Vox(10.8, 2.4, 11.0, p.px, p.sh)
    steel = M("#6a727c", kz=1.2)
    back = M(ramp=["#2a2e34", "#40464e", "#5a626c", "#8a929c"])
    lamp = M(ramp=["#ffe6a0", "#ffe6a0", "#fff0c0", "#ffffff"], emit=True, tone=2)
    for sx in (-2.6, 2.6):
        v.fill(v.cyl(sx, 0, 0.35, 0, 7.2), steel)
    v.fill(v.box(-5.2, 5.2, -0.4, 0.4, 7.0, 10.6), back)
    v.fill(v.box(-5.0, 5.0, 0.4, 1.2, 6.7, 6.95), steel)  # catwalk
    for lx in (-3.5, 0.0, 3.5):
        v.fill(v.box(lx - 0.2, lx + 0.2, 0.8, 1.2, 6.95, 7.25), lamp)
    ad = np.zeros((12, 50, 3), np.uint8)
    ad[:] = (88, 186, 236)
    ad[9:] = (60, 150, 210)
    yy, xx = np.mgrid[0:12, 0:50]
    ad[((xx - 9) ** 2 + (yy - 3.5) ** 2) < 9] = (255, 214, 64)  # sun
    bx = (xx >= 2) & (xx < 24) & (yy >= 2) & (yy < 11)
    ad[bx & (yy >= 5)] = (214, 52, 42)
    bm = text_bitmap("EAT")
    ad[3:10, 5:22][bm] = (255, 255, 255)
    ad[bx & ~(yy >= 5) & (((xx - 9) ** 2 + (yy - 3.5) ** 2) >= 9)] = ad[bx & ~(yy >= 5) & (((xx - 9) ** 2 + (yy - 3.5) ** 2) >= 9)]
    # cartoon burger on the right
    cx_, cy_ = 37, 6
    e = ((xx - cx_) / 10.0) ** 2 + ((yy - cy_) / 5.2) ** 2 < 1
    ad[e & (yy <= 4)] = (232, 150, 60)
    ad[e & (yy == 5)] = (90, 190, 60)
    ad[e & (yy >= 6) & (yy <= 7)] = (110, 56, 30)
    ad[e & (yy == 8)] = (250, 200, 40)
    ad[e & (yy >= 9)] = (232, 150, 60)
    ad[e & (yy == 2) & (xx % 4 == 0)] = (255, 236, 190)
    ad[:, :1] = ad[:, -1:] = (240, 240, 236)
    ad[:1] = ad[-1:] = (240, 240, 236)
    paint_img_xz(v, ad, -5.0, 7.0, 0.2, 0.3, 0.0, 0.4)
    return v.render()


@prop("traffic_cone", "Traffic Cone", "street", 0.05, 0.05, solid=False, breakable=True,
      desc="Orange traffic cone with a reflective band, 0.7 m. Walk/drive-through, gets knocked over.")
def b_traffic_cone(p):
    v = Vox(0.42, 0.42, 0.72, p.px, p.sh)
    orange = M(ramp=["#6a2208", "#b0400e", "#f26a1a", "#ffb070"], kz=1.2)
    white = M("#f4f4f0", kz=1.2)
    v.fill(v.cbox(0, 0, 0.38, 0.38, 0, 0.05), M("#22242a"))
    v.fill(v.cone(0, 0, 0.05, 0.7, 0.16, 0.05), orange)
    v.paint(v.zr(0.3, 0.42), white)
    return v.render()[0]


@prop("barricade", "Police Barricade", "street", 0.05, 0.05, radius=0.4, breakable=True,
      extra={"roadblock": True},
      desc="Sawhorse roadblock barricade with orange/white diagonal stripes and a flashing amber lamp.")
def b_barricade(p):
    v = Vox(2.2, 0.8, 1.25, p.px, p.sh)
    frame = M("#5a5e66")
    orange = M(ramp=["#6a2208", "#b0400e", "#f26a1a", "#ffb070"], tone=2)
    white = M("#f4f4f0", tone=2)
    amber = M(ramp=["#ffa020", "#ffa020", "#ffb030", "#fff0b0"], emit=True, tone=2)
    for sx in (-0.85, 0.85):
        for sy in (-0.32, 0.32):
            v.fill(v.seg((sx, sy, 0), (sx, 0, 1.0), 0.05), frame)
    for z0 in (0.45, 0.8):
        b = v.box(-1.05, 1.05, -0.05, 0.05, z0, z0 + 0.22)
        v.fill(b, orange)
        v.paint(b & (np.floor((v.x + v.z) / 0.14) % 2 == 0), white)
    v.fill(v.cbox(-0.85, 0, 0.12, 0.12, 1.02, 1.08), frame)
    v.fill(v.ell(-0.85, 0, 1.15, 0.08, 0.08, 0.08), amber)
    return v.render()


@prop("jersey_barrier", "Jersey Barrier", "street", 0.05, 0.05, radius=0.4,
      extra={"box": [3.0, 0.6]}, desc="3 m precast concrete Jersey barrier, long axis along x.")
def b_jersey(p):
    W, L, H = 60, 12, 16
    c = make_ramp("#b4b0a6")

    def hw(row):  # half width in px for row (0 = top)
        h = (H - row - 0.5) * 0.05
        if h < 0.08:
            return 6
        if h < 0.33:
            return 6 - (h - 0.08) / 0.25 * 2.0
        return 4 - (h - 0.33) / 0.47 * 2.4

    top = View(W, L).rect(0, 0, W, L, c[1]).rect(0, 3, W, 9, c[2]).rect(0, 5, W, 7, c[3])
    side = View(L, H)
    for r in range(H):
        w = hw(r)
        x0, x1 = int(round(L / 2 - w)), int(round(L / 2 + w))
        side.rect(x0, r, x1, r + 1, c[3] if r == 0 else c[2] if r < 10 else c[1])
    front = View(W, H).rect(0, 0, W, H, c[2]).rect(0, 0, W, 1, c[3]).rect(0, 10, W, H, c[1])
    for x in (8, 46):
        front.rect(x, 13, x + 6, 15, c[0])
    front.rect(0, H - 1, W, H, c[0])
    back = View(W, H)
    back.im = front.im.copy()
    back.d = ImageDraw.Draw(back.im)
    return carve(p.id, top, side, front, back, shade=0.12)


@prop("picnic_table", "Picnic Table", "street", 0.1, 0.1, radius=0.8, breakable=True,
      desc="Wooden park picnic table with attached benches.")
def b_picnic(p):
    v = Vox(2.0, 1.8, 0.8, p.px, p.sh)
    wood = M(ramp=["#4a2e1a", "#7a4c2a", "#a8703e", "#d4a064"], kz=1.1)
    wood2 = M(ramp=["#3e2616", "#6a4224", "#946238", "#c4925a"], kz=1.1)
    v.fill(v.box(-0.9, 0.9, -0.38, 0.38, 0.7, 0.78), wood)
    for sy in (-0.65, 0.65):
        v.fill(v.box(-0.9, 0.9, sy - 0.15, sy + 0.15, 0.4, 0.48), wood)
    for sx in (-0.6, 0.6):
        v.fill(v.seg((sx, -0.75, 0), (sx, 0.1, 0.72), 0.06), wood2)
        v.fill(v.seg((sx, 0.75, 0), (sx, -0.1, 0.72), 0.06), wood2)
        v.fill(v.box(sx - 0.05, sx + 0.05, -0.8, 0.8, 0.33, 0.4), wood2)
    v.paint(v.box(-1, 1, -0.06, 0.06, 0.7, 0.8), wood2)
    return v.render()[0]


@prop("playground_slide", "Playground Slide", "street", 0.1, 0.1, radius=0.9,
      desc="Kids' slide: ladder at the back, guarded platform, yellow chute sloping down toward +y.")
def b_slide(p):
    v = Vox(1.2, 4.0, 2.4, p.px, p.sh)
    blue = M(ramp=["#10285a", "#1c4490", "#2e64c8", "#7aa8f0"])
    red = M(ramp=["#5a1010", "#9c1e1c", "#d8392c", "#ff8466"])
    yellow = M(ramp=["#7a5a08", "#c09010", "#ffd21e", "#fff59a"], kz=1.0)
    for sx in (-0.4, 0.4):
        v.fill(v.seg((sx, -1.8, 0), (sx, -1.2, 1.5), 0.08), blue)
        v.fill(v.post(sx, -0.7, 0, 1.5, 2), blue)
        v.fill(v.post(sx, -1.2, 1.5, 2.2, 2), red)
        v.fill(v.post(sx, -0.7, 1.5, 2.2, 2), red)
        v.fill(v.box(sx - 0.1, sx + 0.1, -1.25, -0.65, 2.0, 2.15), red)
    for k in range(5):
        z = 0.3 * (k + 1)
        y = -1.8 + 0.6 * z / 1.5
        v.fill(v.seg((-0.4, y, z), (0.4, y, z), 0.05), blue)
    v.fill(v.box(-0.5, 0.5, -1.3, -0.6, 1.4, 1.5), blue)
    yy = v.y
    zc = 1.45 - (yy + 0.6) / 2.4 * 1.15
    chute = (yy > -0.6) & (yy < 1.9) & (np.abs(v.x) < 0.32) & (v.z > zc - 0.1) & (v.z < zc + 0.05)
    walls = (yy > -0.6) & (yy < 1.9) & (np.abs(v.x) > 0.22) & (np.abs(v.x) < 0.36) & (v.z > zc - 0.1) & (v.z < zc + 0.28)
    v.fill(chute | walls, yellow)
    v.fill(v.post(0.3, 1.4, 0, 0.4, 2) | v.post(-0.3, 1.4, 0, 0.4, 2), blue)
    return v.render()[0]


@prop("basketball_hoop", "Basketball Hoop", "street", 0.1, 0.1, radius=0.2,
      extra={"pivot": "pole"}, desc="Driveway/park basketball hoop: pole at the pivot, backboard and rim toward +y.")
def b_hoop(p):
    v = Vox(2.0, 3.4, 4.0, p.px, p.sh)
    pole = M("#3a3e46", kz=1.2)
    board = M(ramp=["#9aa0a8", "#d4d8dc", "#f6f8fa", "#ffffff"], tone=2)
    orange = M(ramp=["#6a2208", "#b0400e", "#f26a1a", "#ffb070"], kz=1.0)
    net = M("#e8ecf0")
    v.fill(v.cbox(0, 0, 0.6, 0.6, 0, 0.15), M(CONCRETE))
    v.fill(v.post(0, 0, 0, 3.3, 2), pole)
    v.fill(v.seg((0, 0, 3.25), (0, 0.6, 3.45), 0.1), pole)
    v.fill(v.seg((0, 0.6, 3.45), (0, 0.95, 3.4), 0.1), pole)
    bd = v.box(-0.9, 0.9, 0.95, 1.15, 2.85, 3.9)
    v.fill(bd, board)
    v.paint(bd & ~v.box(-0.82, 0.82, 0, 9, 2.93, 3.82), orange)
    v.paint(bd & v.box(-0.3, 0.3, 1.1, 1.2, 3.05, 3.5) & ~v.box(-0.22, 0.22, 0, 9, 3.12, 3.5), orange)
    rr = np.sqrt(v.x ** 2 + (v.y - 1.45) ** 2)
    v.fill((rr < 0.28) & (rr > 0.14) & v.zr(3.0, 3.1), orange)
    v.fill(v.box(-0.08, 0.08, 1.12, 1.2, 3.0, 3.1), orange)
    v.fill((rr < 0.24) & (rr > 0.1) & v.zr(2.7, 3.0), net)
    return v.render(centre="origin")[0]


@prop("portapotty", "Porta-Potty", "street", 0.1, 0.1, radius=0.6, breakable=False,
      desc="Blue portable toilet with a white roof and vented door facing +y.")
def b_portapotty(p):
    W, L, H = 12, 12, 23
    b = ["#0e2a5a", "#1a4488", "#2a62b8", "#6a9ae0"]
    w_ = ["#8a96a4", "#c4ccd6", "#eef2f6", "#ffffff"]
    top = View(W, L).rect(0, 0, W, L, w_[2]).rect(2, 2, W - 2, L - 2, w_[3]).rect(5, 5, 7, 7, w_[1])

    def body(vw, w, door):
        vw.rect(0, 2, w, H, b[2]).rect(1, 0, w - 1, 2, w_[2]).rect(0, 2, w, 3, w_[1])
        vw.rect(0, H - 1, w, H, b[0]).rect(0, 4, w, 5, b[3])
        if door:
            vw.rect(2, 5, w - 2, H - 1, b[1]).rect(3, 7, w - 3, 8, b[0]).rect(3, 9, w - 3, 10, b[0])
            vw.rect(w - 4, 13, w - 3, 15, "#e8e8e8").rect(3, 5, 6, 6, "#30c060")
        else:
            vw.rect(3, 6, w - 3, 7, b[1]).rect(3, 8, w - 3, 9, b[1])
        return vw
    side = body(View(L, H), L, False)
    front = body(View(W, H), W, True)
    back = body(View(W, H), W, False)
    return carve(p.id, top, side, front, back, shade=0.12)


@prop("construction_crane", "Tower Crane", "misc", 0.5, 1.0, radius=1.6,
      extra={"pivot": "mast"},
      desc="Coarse yellow tower crane: 38 m mast at the pivot, 30 m jib along +x, counter-jib with weights. "
           "Can be spun about its pivot.")
def b_crane(p):
    v = Vox(62, 6, 43, p.px, p.sh)
    yellow = M(ramp=["#6a4a08", "#b07e10", "#f0b41e", "#ffe27a"], kz=1.2)
    conc = M(CONCRETE)
    cab = M("#e8ecef")
    steel = M("#4a4e56")
    v.fill(v.cbox(0, 0, 6, 6, 0, 1.0), conc)
    lattice_tower(v, yellow, 0, 0, 1.0, 36.0, 2.6, 2.6, 9, zigzag=True)
    v.fill(v.cbox(0, 0, 3.0, 3.0, 35.5, 37.0), yellow)
    v.fill(v.cbox(0.5, 2.1, 1.8, 1.6, 34.5, 36.8), cab)
    v.fill(v.box(-1.5, 30.0, -0.75, 0.75, 37.0, 38.0), yellow)  # jib
    v.fill(v.box(-11.0, -1.5, -1.0, 1.0, 37.0, 38.0), yellow)  # counter-jib
    v.fill(v.box(-11.0, -7.5, -1.2, 1.2, 35.5, 38.0), conc)  # counterweights
    v.fill(v.seg((-0.6, 0, 38), (0, 0, 42.5), 0.45) | v.seg((0.6, 0, 38), (0, 0, 42.5), 0.45), yellow)
    v.fill(v.seg((0, 0, 42.3), (28.0, 0, 38.2), 0.25), steel)
    v.fill(v.seg((0, 0, 42.3), (-10.5, 0, 38.2), 0.25), steel)
    v.fill(v.cbox(18.0, 0, 1.2, 1.4, 36.3, 37.0), steel)  # trolley
    v.fill(v.post(18.0, 0, 22.0, 36.4, 2), steel)
    v.fill(v.cbox(18.0, 0, 1.0, 1.0, 20.5, 22.0), M("#d8392c"))
    return v.render(centre="origin")[0]


@prop("utility_pole", "Utility Pole", "street", 0.125, 0.3, radius=0.2,
      extra={"pivot": "pole"}, desc="Wooden power pole with two crossarms, insulators and a transformer can.")
def b_utility_pole(p):
    v = Vox(2.8, 1.4, 10.6, p.px, p.sh)
    wood = M(ramp=["#3a2618", "#5e4028", "#84603e", "#b08a60"], noise=0.3, cell=(5, 1, 1), seed=191, kz=1.1)
    ins = M(ramp=["#4a6a5a", "#7aa08a", "#b4d4c0", "#e8fff0"])
    can = M("#8a9098", kz=1.3)
    v.fill(v.cyl(0, 0, 0.2, 0, 10.4), wood)
    for z, half in ((9.6, 1.2), (8.7, 0.9)):
        v.fill(v.box(-half, half, -0.125, 0.125, z, z + 0.3), wood)
        for ix in ((-half + 0.15), (half - 0.15)):
            v.fill(v.cbox(ix, 0, 0.25, 0.25, z + 0.3, z + 0.6), ins)
    v.fill(v.cbox(0, 0, 0.25, 0.25, 10.4, 10.7), ins)
    v.fill(v.cyl(0, -0.45, 0.3, 6.8, 7.9), can)
    v.fill(v.cbox(0, -0.2, 0.25, 0.25, 7.2, 7.5), can)
    return v.render(centre="origin")[0]


# ---------------------------------------------------------------------------- pickups (float + spin in game)
def superbox(v, cx, cy, cz, rx, ry, rz, n=4):
    return (np.abs((v.x - cx) / rx) ** n + np.abs((v.y - cy) / ry) ** n + np.abs((v.z - cz) / rz) ** n) < 1


@prop("pickup_cash", "Cash", "pickup", 0.05, 0.05, solid=False, extra={"pickup": "cash", "spin": True},
      desc="Two crossed bundles of green bills with a paper band and a glowing '$'.")
def b_pickup_cash(p):
    v = Vox(1.0, 1.0, 0.62, p.px, p.sh)
    green = M(ramp=["#123a1c", "#1f6233", "#36924a", "#86d688"], kz=1.1)
    edge = M(ramp=["#c8d8b0", "#dce8c4", "#eef6dc", "#ffffff"], tone=1)
    band = M(ramp=["#8a7a40", "#c8b260", "#f0dc8a", "#fff6c8"], kz=1.0)
    dollar = M(ramp=["#fff27a", "#fff27a", "#fff8b0", "#ffffff"], emit=True, tone=2)
    top_g = M(ramp=["#123a1c", "#1f6233", "#36924a", "#86d688"], tone=1)
    a = v.box(-0.46, 0.46, -0.22, 0.22, 0.0, 0.3)
    v.fill(a, green)
    v.paint(a & (np.abs(v.x) > 0.44) & (np.floor(v.z / 0.05) % 2 == 0), edge)
    v.paint(a & (np.abs(v.x) < 0.09), band)
    b = v.box(-0.22, 0.22, -0.46, 0.46, 0.3, 0.6)
    v.fill(b, green)
    v.paint(b & (np.abs(v.y) > 0.44) & (np.floor(v.z / 0.05) % 2 == 0), edge)
    v.paint(b & (np.abs(v.y) > 0.27) & (np.abs(v.y) < 0.36), band)
    v.paint(b & v.zr(0.55, 0.6) & (np.abs(v.y) < 0.27), top_g)
    v.paint(v.bitmap_xy(text_bitmap("$"), -0.125, -0.175, 0.05, 0.55, 0.6), dollar)
    return v.render()


@prop("pickup_health", "Health", "pickup", 0.05, 0.05, solid=False, extra={"pickup": "health", "spin": True},
      desc="White first-aid box with a red cross on every face.")
def b_pickup_health(p):
    v = Vox(0.85, 0.85, 0.72, p.px, p.sh)
    white = M(ramp=["#8a96a6", "#c6ced8", "#f0f3f6", "#ffffff"], kz=1.2)
    red = M(ramp=["#ff2a2a", "#ff2a2a", "#ff3a34", "#ffb0a0"], emit=True, tone=2)
    v.fill(superbox(v, 0, 0, 0.35, 0.41, 0.41, 0.35, 6), white)
    bar = 0.1
    cross_top = ((np.abs(v.x) < bar) & (np.abs(v.y) < 0.3)) | ((np.abs(v.y) < bar) & (np.abs(v.x) < 0.3))
    v.paint(cross_top & v.zr(0.6, 0.75), red)
    zc = 0.35
    for ax in ("x", "y"):
        u = v.x if ax == "y" else v.y
        n = v.y if ax == "y" else v.x
        cr = ((np.abs(u) < bar) & (np.abs(v.z - zc) < 0.24)) | ((np.abs(v.z - zc) < bar) & (np.abs(u) < 0.24))
        v.paint(cr & (np.abs(n) > 0.32), red)
    return v.render()


@prop("pickup_armor", "Body Armor", "pickup", 0.05, 0.05, solid=False, extra={"pickup": "armor", "spin": True},
      desc="Blue ballistic vest standing upright (shoulder straps, arm holes, chest plate).")
def b_pickup_armor(p):
    v = Vox(0.8, 0.5, 0.85, p.px, p.sh)
    blue = M(ramp=["#0e1e4a", "#1c3680", "#2e56b8", "#7aa0ee"], kz=1.2)
    strap = M(ramp=["#0a1230", "#142250", "#1e3270", "#3a5498"])
    plate = M(ramp=["#7a8ab0", "#aab8d8", "#d4def4", "#ffffff"], emit=True, tone=2)
    body = superbox(v, 0, 0, 0.42, 0.33, 0.17, 0.4, 4) & v.zr(0.02, 0.82)
    v.fill(body, blue)
    for s in (-1, 1):
        v.cut(v.ell(s * 0.36, 0, 0.62, 0.14, 0.3, 0.2))
    v.cut(v.ell(0, 0, 0.84, 0.15, 0.3, 0.17))
    v.paint(v.zr(0.18, 0.26) | v.zr(0.36, 0.42), strap)
    v.paint(v.box(-0.12, 0.12, 0.1, 0.3, 0.46, 0.62), plate)
    return v.render()


@prop("pickup_weapon_crate", "Weapon Crate", "pickup", 0.05, 0.05, solid=False,
      extra={"pickup": "weapon", "spin": True},
      desc="Olive-drab ammo/weapon crate with steel corners, rope handles and a yellow rifle stencil.")
def b_pickup_weapon(p):
    v = Vox(1.2, 0.7, 0.6, p.px, p.sh)
    olive = M(ramp=["#1e2412", "#343e1e", "#505e2e", "#8a9a52"], kz=1.1)
    steel = M("#5a5e64")
    yellow = M(ramp=["#ffd23a", "#ffd23a", "#ffe050", "#fff4b0"], emit=True, tone=2)
    rope = M("#c8b080")
    c = v.box(-0.55, 0.55, -0.3, 0.3, 0.0, 0.52)
    v.fill(c, olive)
    v.paint(c & (np.floor(v.z / 0.05) % 4 == 3) & ((np.abs(v.x) > 0.52) | (np.abs(v.y) > 0.27)), M("#262e16"))
    v.paint(c & (np.abs(np.abs(v.x) - 0.5) < 0.05) & (np.abs(np.abs(v.y) - 0.25) < 0.05), steel)
    v.paint(c & v.zr(0.45, 0.52) & ((np.abs(v.x) > 0.48) | (np.abs(v.y) > 0.23)), steel)
    rifle = np.array([[ch == "1" for ch in r] for r in [
        "000000000000000000",
        "111111111111111100",
        "111111111111111111",
        "000111001110000000",
        "000110000000000000"]], bool)
    v.paint(v.bitmap_xy(rifle, -0.45, -0.125, 0.05, 0.45, 0.55), yellow)
    for s in (-1, 1):
        v.fill(v.box(s * 0.55 - 0.05, s * 0.55 + 0.05, -0.12, 0.12, 0.25, 0.4) & ~v.box(-0.55, 0.55, -1, 1, 0, 1), rope)
    return v.render()


@prop("pickup_package", "Hidden Package", "pickup", 0.05, 0.05, solid=False,
      extra={"pickup": "package", "collectible": True, "spin": True},
      desc="Taped brown cardboard parcel with a shipping label - the hidden-package collectible.")
def b_pickup_package(p):
    v = Vox(0.8, 0.65, 0.55, p.px, p.sh)
    card = M(ramp=["#4a2e16", "#7a5228", "#ae7c42", "#dcae72"], kz=1.1)
    tape = M(ramp=["#8a7a50", "#bca870", "#e2d29a", "#fff2c8"], tone=2)
    label = M("#f4f2ea", tone=2)
    b = v.box(-0.35, 0.35, -0.27, 0.27, 0.0, 0.5)
    v.fill(b, card)
    v.paint(b & (np.abs(v.y) < 0.06) & (v.z > 0.45), tape)
    v.paint(b & (np.abs(v.y) < 0.06) & (np.abs(v.x) > 0.32), tape)
    v.paint(b & v.box(0.08, 0.3, 0.07, 0.24, 0.45, 0.5), label)
    v.paint(b & v.box(0.12, 0.26, 0.12, 0.16, 0.45, 0.5), M("#2a2a2a", tone=2))
    return v.render()[0]


@prop("pickup_rampage", "Rampage Token", "pickup", 0.05, 0.05, solid=False,
      extra={"pickup": "rampage", "spin": True},
      desc="Glowing red coin token with a white '!' on both faces - starts a rampage challenge.")
def b_pickup_rampage(p):
    v = Vox(1.0, 0.3, 1.05, p.px, p.sh)
    red = M(ramp=["#ff2030", "#ff2030", "#ff3040", "#ffb0b0"], emit=True, tone=2)
    gold = M(ramp=["#7a5210", "#c08a1c", "#f2c232", "#fff0a0"], emit=True, kz=1.0)
    white = M("#ffffff", emit=True, tone=2)
    zc = 0.52
    rr = np.sqrt(v.x ** 2 + (v.z - zc) ** 2)
    v.fill((rr < 0.47) & (np.abs(v.y) < 0.1), gold)
    v.paint((rr < 0.38), red)
    bang = np.array([[c == "1" for c in r] for r in ["111", "111", "111", "111", "111", "000", "111", "111"]], bool)
    v.paint(v.bitmap_xz(bang, -0.075, zc - 0.3, 0.05, 0.075, 0.05, 0.1), white)
    v.paint(v.bitmap_xz(bang, -0.075, zc - 0.3, 0.05, 0.075, -0.1, -0.05), white)
    return v.render()


@prop("pickup_bribe", "Bribe Star", "pickup", 0.05, 0.05, solid=False,
      extra={"pickup": "bribe", "spin": True},
      desc="Generic gold six-point star badge token (no insignia); lowers the wanted level.")
def b_pickup_bribe(p):
    v = Vox(1.0, 0.3, 1.05, p.px, p.sh)
    gold = M(ramp=["#7a5210", "#c08a1c", "#f2c232", "#fff0a0"], emit=True, kz=1.0)
    blue = M(ramp=["#2a5ad8", "#2a5ad8", "#3a6ae8", "#a8c4ff"], emit=True, tone=2)
    zc = 0.52
    pts = []
    for k in range(12):
        a = math.pi / 2 + k * math.pi / 6
        r = 0.44 if k % 2 == 0 else 0.25
        pts.append((r * math.cos(a), zc + r * math.sin(a)))
    v.fill(v.poly_xz(pts, -0.1, 0.1), gold)
    for k in range(6):
        a = math.pi / 2 + k * math.pi / 3
        v.fill(v.ell(0.44 * math.cos(a), 0, zc + 0.44 * math.sin(a), 0.065, 0.1, 0.065), gold)
    rr = np.sqrt(v.x ** 2 + (v.z - zc) ** 2)
    v.paint((rr < 0.15), blue)
    return v.render()


# ---------------------------------------------------------------------------- misc
@prop("car_wreck", "Burnt-out Car", "misc", 0.1, 0.1, radius=1.3,
      extra={"box": [1.8, 4.5]}, desc="Generic burnt-out sedan husk on its rims: charred shell, rust, gutted cabin. Nose +y.")
def b_car_wreck(p):
    v = Vox(2.0, 4.8, 1.45, p.px, p.sh)
    burnt = M(ramp=["#141012", "#261c18", "#3c2e26", "#5e4a3c"], noise=0.35, cell=3, seed=201)
    rust = M(ramp=["#3a180c", "#682c12", "#984a20", "#c4743e"], noise=0.35, cell=3, seed=202)
    char = M("#0e0c0e", tone=1)
    rim = M("#5a5c60", kz=1.2)
    for sx in (-0.8, 0.8):
        for sy in (-1.45, 1.4):
            v.fill(v.cyl(sx, sy, 0.15, 0, 99, ry=99) & ((np.abs(v.x - sx) < 0.12)) &
                   ((v.y - sy) ** 2 + (v.z - 0.3) ** 2 < 0.29 ** 2), rim)
    body = superbox(v, 0, 0, 0.55, 0.88, 2.28, 0.38, 6) & v.zr(0.2, 0.9)
    v.fill(body, burnt)
    v.cut(v.box(-0.68, 0.68, -1.05, 0.75, 0.6, 2))  # gutted cabin tub
    v.fill(v.box(-0.6, 0.6, 0.05, 0.4, 0.3, 0.85), char)  # front seat frames
    v.fill(v.box(-0.6, 0.6, -0.95, -0.6, 0.3, 0.8), char)
    for sx in (-0.78, 0.78):
        for sy, top in ((0.82, 1.28), (-0.15, 1.33), (-1.08, 1.28)):
            v.fill(v.post(sx, sy, 0.8, top, 2), burnt)
    v.fill(v.box(-0.82, 0.82, -1.1, 0.85, 1.24, 1.36), burnt)  # roof
    v.cut(v.box(-0.4, 0.3, -0.7, 0.2, 1.2, 1.4))  # burnt-through hole
    n = value_noise(v.m.shape, (3, 5, 5), 203)
    v.paint((n > 0.6), rust)
    v.cut(v.surface() & (value_noise(v.m.shape, 2, 204) < 0.18) & (v.y > 1.2) & (v.z > 0.7))  # crumpled hood
    return v.render()[0]


@prop("tire_stack", "Tire Stack", "misc", 0.05, 0.05, radius=0.4,
      desc="Stack of four worn tyres (junkyards, tyre shops).")
def b_tire_stack(p):
    v = Vox(0.8, 0.8, 0.92, p.px, p.sh)
    rub = M(ramp=["#0c0c0e", "#1a1b1e", "#2c2e32", "#4e5258"], kz=1.4)
    offs = [(0.0, 0.0), (0.03, -0.02), (-0.02, 0.03), (0.02, 0.02)]
    for k, (ox, oy) in enumerate(offs):
        zc = 0.11 + k * 0.22
        rr = np.sqrt((v.x - ox) ** 2 + (v.y - oy) ** 2)
        v.fill(((rr - 0.255) / 0.09) ** 2 + ((v.z - zc) / 0.115) ** 2 < 1, rub)
    return v.render()[0]


@prop("oil_barrel", "Oil Drum", "misc", 0.05, 0.05, radius=0.3, breakable=True,
      extra={"explosive": True}, desc="Red 55-gallon steel drum with rolling hoops (explodes when shot).")
def b_oil_barrel(p):
    W, H = 12, 18
    r_ = ["#4e0e10", "#8e1e1c", "#c8322a", "#f2765c"]

    def cols(r):
        if r == 0:
            return r_[3]
        if r in (5, 12):
            return r_[3]
        if r in (6, 13):
            return r_[1]
        return r_[0] if r == H - 1 else r_[2]

    def top_draw(t):
        t.ellipse(0, 0, W, W, r_[3]).ellipse(1, 1, W - 1, W - 1, r_[2]).ellipse(2, 2, W - 2, W - 2, r_[3])
        t.rect(3, 3, 5, 5, "#3a3e44").rect(7, 7, 9, 9, "#3a3e44")
    top, side, front, back = lathe_views(W, H, lambda r: 6 if r not in (0, H - 1) else 5.5, top_draw, cols)
    return carve(p.id, top, side, front, back, round_=True, shade=0.1)


@prop("pallet_stack", "Pallet Stack", "misc", 0.05, 0.05, radius=0.55, breakable=True,
      desc="Stack of five wooden shipping pallets, slightly askew.")
def b_pallets(p):
    v = Vox(1.35, 1.15, 0.78, p.px, p.sh)
    rng = np.random.default_rng(211)
    for k in range(5):
        ox, oy = rng.integers(-1, 2) * 0.05, rng.integers(-1, 2) * 0.05
        base = M(["#a8875a", "#9a8a70", "#b89460"][k % 3], kz=1.1)
        dark = M("#5a4630")
        z0 = k * 0.15
        for i in range(5):
            x0 = ox - 0.575 + i * 0.25
            v.fill(v.box(x0, x0 + 0.15, oy - 0.5, oy + 0.5, z0 + 0.1, z0 + 0.15), base)
        for j in (-1, 0, 1):
            for i in (-1, 0, 1):
                v.fill(v.cbox(ox + i * 0.5, oy + j * 0.4, 0.15, 0.15, z0 + 0.05, z0 + 0.1), dark)
        for j in (-1, 0, 1):
            v.fill(v.box(ox - 0.6, ox + 0.6, oy + j * 0.4 - 0.075, oy + j * 0.4 + 0.075, z0, z0 + 0.05), base)
    return v.render()[0]


def container(p, base):
    W, L, H = 24, 61, 26
    c = make_ramp(base)
    top = View(W, L).rect(0, 0, W, L, c[2])
    for y in range(3, L - 3, 4):
        top.rect(1, y, W - 1, y + 1, c[1])
    top.rect(0, 0, W, 1, c[3]).rect(0, L - 1, W, L, c[3]).rect(0, 0, 1, L, c[3]).rect(W - 1, 0, W, L, c[3])
    top.rect(0, 0, 2, 2, "#2a2c30").rect(W - 2, 0, W, 2, "#2a2c30").rect(0, L - 2, 2, L, "#2a2c30").rect(W - 2, L - 2, W, L, "#2a2c30")
    side = View(L, H).rect(0, 0, L, H, c[2])
    for x in range(3, L - 3, 4):
        side.rect(x, 2, x + 2, H - 2, c[1])
    side.rect(0, 0, L, 2, c[3]).rect(0, H - 2, L, H, c[0]).rect(0, 0, 2, H, c[0]).rect(L - 2, 0, L, H, c[0])
    front = View(W, H).rect(0, 0, W, H, c[2])
    for x in range(3, W - 3, 4):
        front.rect(x, 2, x + 2, H - 2, c[1])
    front.rect(0, 0, W, 2, c[3]).rect(0, H - 2, W, H, c[0]).rect(0, 0, 2, H, c[0]).rect(W - 2, 0, W, H, c[0])
    back = View(W, H).rect(0, 0, W, H, c[2]).rect(11, 2, 13, H - 2, c[0])
    for x in (4, 8, 15, 19):
        back.rect(x, 2, x + 1, H - 2, "#b8bec4")
    for y in (5, 19):
        back.rect(2, y, 4, y + 2, "#3a3e44").rect(W - 4, y, W - 2, y + 2, "#3a3e44")
    back.rect(0, 0, W, 2, c[3]).rect(0, H - 2, W, H, c[0]).rect(0, 0, 2, H, c[0]).rect(W - 2, 0, W, H, c[0])
    return top, side, front, back


for _cid, _col, _hex in (("red", "red", "#b23a2c"), ("blue", "blue", "#2c5c9e"), ("green", "green", "#2e7a4c")):
    def _mkc(cid, col, hx):
        @prop(f"shipping_container_{cid}", f"Shipping Container ({col})", "misc", 0.1, 0.1, radius=1.3,
              group="shipping_container", extra={"box": [2.44, 6.1]},
              desc=f"20 ft corrugated steel shipping container, {col} (Tulsa Port of Catoosa). Doors at -y.")
        def _b(p):
            return carve(p.id, *container(p, hx), shade=0.1)
        return _b
    _mkc(_cid, _col, _hex)


@prop("barge_crate", "Cargo Crate", "misc", 0.1, 0.1, radius=0.9,
      desc="Large wooden cargo crate with braced sides and stencil marks (Port of Catoosa barge freight).")
def b_barge_crate(p):
    W, L, H = 20, 16, 15
    w = ["#4a3018", "#7a5430", "#a87c4a", "#d8ae78"]
    top = View(W, L).rect(0, 0, W, L, w[2])
    for y in range(3, L, 3):
        top.rect(1, y, W - 1, y + 1, w[1])
    top.rect(0, 0, W, 2, w[3]).rect(0, L - 2, W, L, w[3]).rect(0, 0, 2, L, w[3]).rect(W - 2, 0, W, L, w[3])
    top.rect(7, 6, 13, 10, "#2a2420")

    def face(n):
        f = View(n, H).rect(0, 0, n, H, w[2])
        for y in range(3, H, 3):
            f.rect(0, y, n, y + 1, w[1])
        f.rect(0, 0, n, 2, w[3]).rect(0, H - 2, n, H, w[1]).rect(0, 0, 2, H, w[3]).rect(n - 2, 0, n, H, w[3])
        for i in range(2, n - 2):
            y = 2 + int((i - 2) * (H - 5) / (n - 5))
            f.rect(i, y, i + 1, y + 2, w[3])
        return f
    side = face(L)
    front = face(W).rect(4, 4, 8, 6, "#1e1a18").rect(12, 4, 16, 6, "#1e1a18")
    back = face(W)
    return carve(p.id, top, side, front, back, shade=0.12)


@prop("boat_dock_post", "Dock Piling", "misc", 0.05, 0.05, radius=0.25,
      desc="Weathered wooden mooring piling with rope wraps and a waterline algae band.")
def b_dock_post(p):
    W, H = 10, 30
    wd = ["#3a2a1e", "#5e4630", "#86684a", "#b49470"]

    def cols(r):
        if r == 0:
            return wd[3]
        if r in (5, 6, 8, 9):
            return "#d8c89a" if r in (5, 8) else "#a8986a"
        if r >= H - 6:
            return "#2e4a30" if r < H - 2 else "#1e3222"
        return wd[2] if (r // 4) % 2 else wd[1]

    def top_draw(t):
        t.ellipse(0, 0, W, W, wd[2]).ellipse(2, 2, W - 2, W - 2, wd[3]).ellipse(4, 4, W - 4, W - 4, wd[1])
    top, side, front, back = lathe_views(W, H, lambda r: 5 if r else 4.5, top_draw, cols)
    return carve(p.id, top, side, front, back, round_=True, shade=0.1)
# ---------------------------------------------------------------------------- BUILDERS_END


# ============================================================================ output
def crop_many(vols, centre="bbox", pad=1):
    """Joint crop for animation frames so every frame shares (w, h, count) and pivot."""
    a = np.any([v[..., 3] > 0 for v in vols], axis=0)
    zz = int(np.nonzero(a.any((1, 2)))[0][-1]) + 1
    L, W = a.shape[1:]
    ys = np.nonzero(a.any((0, 2)))[0]
    xs = np.nonzero(a.any((0, 1)))[0]

    def rng(idx, n):
        lo, hi = int(idx[0]), int(idx[-1]) + 1
        if centre == "origin":
            mm = min(lo, n - hi)
            lo, hi = mm, n - mm
        size = hi - lo + 2 * pad
        size += size % 2
        return (lo + hi - size) // 2, size

    y0, hh = rng(ys, L)
    x0, ww = rng(xs, W)
    outs = []
    for v in vols:
        o = np.zeros((zz, hh, ww, 4), np.uint8)
        sy0, sx0 = max(y0, 0), max(x0, 0)
        sy1, sx1 = min(y0 + hh, L), min(x0 + ww, W)
        o[:, sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = v[:zz, sy0:sy1, sx0:sx1]
        outs.append(o)
    return outs


def to_strip(vol):
    return np.concatenate(list(vol), axis=1)


def save_png(arr, path):
    Image.fromarray(arr, "RGBA").save(path, optimize=True)


def load_strip(path, count):
    a = np.array(Image.open(path).convert("RGBA"))
    h, tw = a.shape[:2]
    assert tw % count == 0, f"{path}: width {tw} not divisible by count {count}"
    w = tw // count
    return np.stack([a[:, i * w : (i + 1) * w] for i in range(count)])


def render_angle(vol, angle, spacing, squash=0.75):
    Z = vol.shape[0]
    if spacing > 1.01:  # repeat slices so tall voxels fill their full height (no see-through gaps)
        n = max(1, round(Z * spacing))
        idx = np.minimum((np.arange(n) / spacing).astype(int), Z - 1)
        return vts.render_stack_image(vol[idx], angle, squash=squash, spacing=1.0)
    return vts.render_stack_image(vol, angle, squash=squash, spacing=spacing)


def contact_sheet(entries, path, cell=170, cols=6, max_scale=6, title=None):
    font = ImageFont.load_default(size=13)
    small = ImageFont.load_default(size=11)
    tiles = []
    for e in entries:
        vol = load_strip(OUT / e["file"], e["count"])
        sp = e["sliceH"] / e["px"]
        r1, r2 = render_angle(vol, 30, sp), render_angle(vol, 210, sp)
        mw, mh = max(r1.width, r2.width), max(r1.height, r2.height)
        s = max(1, min(max_scale, cell // max(mw, mh)))
        if max(mw, mh) * s > cell:  # very large: shrink (nearest) to fit
            f = cell / max(mw, mh)
            r1 = r1.resize((max(1, int(r1.width * f)), max(1, int(r1.height * f))), Image.NEAREST)
            r2 = r2.resize((max(1, int(r2.width * f)), max(1, int(r2.height * f))), Image.NEAREST)
            s = 1
        tiles.append((e, r1.resize((r1.width * s, r1.height * s), Image.NEAREST),
                      r2.resize((r2.width * s, r2.height * s), Image.NEAREST), s))
    cw, ch = cell * 2 + 24, cell + 44
    rows = math.ceil(len(tiles) / cols)
    top = 30 if title else 0
    sheet = Image.new("RGB", (cols * cw, rows * ch + top), (232, 236, 228))
    d = ImageDraw.Draw(sheet)
    if title:
        d.text((8, 6), title, fill=(30, 34, 40), font=font)
    for i, (e, a, b, s) in enumerate(tiles):
        cx, cy = (i % cols) * cw, (i // cols) * ch + top
        d.rectangle([cx + 2, cy + 2, cx + cw - 3, cy + ch - 3], fill=(214, 220, 208))
        for j, im in enumerate((a, b)):
            ox = cx + 8 + j * (cell + 8) + (cell - im.width) // 2
            oy = cy + 6 + (cell - im.height)
            sheet.paste(im, (ox, oy), im)
        d.text((cx + 8, cy + cell + 10), e["id"], fill=(20, 24, 30), font=font)
        info = f'{e["w"]}x{e["h"]}x{e["count"]}  {e["px"]}m/px {e["sliceH"]}m/sl  x{s}'
        d.text((cx + 8, cy + cell + 26), info, fill=(80, 88, 96), font=small)
    sheet.save(path)


def footprint_m(vol, px):
    a = vol[..., 3] > 0
    ys = np.nonzero(a.any((0, 2)))[0]
    xs = np.nonzero(a.any((0, 1)))[0]
    return [round((xs[-1] - xs[0] + 1) * px, 2), round((ys[-1] - ys[0] + 1) * px, 2)]


def build(pid):
    meta = PROPS[pid]
    res = meta["fn"](P(meta))
    frames, emit = None, None
    if isinstance(res, dict):
        frames = res["frames"]
        emit = res.get("emit")
    elif isinstance(res, tuple):
        vol, emit = res
        frames = [vol]
    else:
        frames = [res]
    if len(frames) > 1:
        shapes = {f.shape for f in frames}
        assert len(shapes) == 1, f"{pid}: frame shapes differ {shapes}"
    vol = frames[0]
    Z, L, W = vol.shape[:3]
    entry = {"id": pid, "name": meta["name"]}
    files = []
    if len(frames) > 1:
        for k, f in enumerate(frames):
            fn = f"{pid}_f{k}.png"
            save_png(to_strip(f), OUT / fn)
            files.append(fn)
        entry["file"] = files[0]
    else:
        save_png(to_strip(vol), OUT / f"{pid}.png")
        entry["file"] = f"{pid}.png"
    entry.update(w=W, h=L, count=Z, px=meta["px"], sliceH=meta["sliceH"])
    fp = footprint_m(np.concatenate(frames, 0) if len(frames) > 1 else vol, meta["px"])
    radius = meta["radius"]
    if radius is None:
        radius = round(0.42 * max(fp), 2)
    entry.update(solid=meta["solid"], radius=radius if meta["solid"] else 0, kind=meta["kind"],
                 breakable=meta["breakable"])
    if emit is not None:
        en = f"{pid}_emit.png"
        save_png(to_strip(emit), OUT / en)
        entry["emissive"] = en
    if len(frames) > 1:
        entry["frames"] = files
    if meta["group"]:
        entry["group"] = meta["group"]
    entry["footprint"] = fp
    entry["height"] = round(Z * meta["sliceH"], 2)
    entry.update(meta["extra"])
    entry["desc"] = meta["desc"]
    warns = []
    for k, f in enumerate(frames):
        for z0, z1 in vts.thin_runs(f):
            warns.append(f"frame {k} slices {z0}-{z1} hold a 1px-thin part")
    return entry, warns


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", default="", help="comma-separated prop ids to rebuild")
    ap.add_argument("--no-sheet", action="store_true", help="skip contact sheets")
    a = ap.parse_args()
    ids = [s.strip() for s in a.only.split(",") if s.strip()] or list(PROPS)
    bad = [i for i in ids if i not in PROPS]
    if bad:
        sys.exit(f"unknown prop ids: {bad}")
    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    cat_path = OUT / "catalog.json"
    old = {}
    if cat_path.exists():
        old = {e["id"]: e for e in json.loads(cat_path.read_text())["props"]}
    for pid in ids:
        entry, warns = build(pid)
        old[pid] = entry
        print(f"{pid:28s} {entry['w']:3d}x{entry['h']:3d}x{entry['count']:3d}"
              + (f"  frames={len(entry['frames'])}" if "frames" in entry else "")
              + ("  emit" if "emissive" in entry else ""))
        for w in warns:
            print(f"   warning: {w}")
    entries = [old[p] for p in PROPS if p in old]
    cat_path.write_text(json.dumps({"props": entries}, indent=1) + "\n")
    from build_sprite_bundles import write_sprite_bundle
    write_sprite_bundle(OUT)
    if not a.no_sheet:
        contact_sheet(entries, BUILD / "contact_sheet.png", title="GTPolly props - two angles, squash 0.75")
        kinds = sorted({e["kind"] for e in entries})
        for k in kinds:
            sub = [e for e in entries if e["kind"] == k]
            contact_sheet(sub, BUILD / f"sheet_{k}.png", cell=260, cols=4, max_scale=10, title=k)
    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    print(f"{len(entries)} props, assets/props PNG total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
