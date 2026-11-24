// Extruded buildings with GTA-style perspective: walls between the footprint and a
// roof that is scaled about the screen centre; hip roofs on houses, windows, rooftop clutter.
import { hash2 } from './math.js';
import { paintRoofMaterial, paintWallMaterial } from './building-materials.js';
import { paintRoofPhoto, roofPhoto } from './roof-photos.js';
import { drawSurveyShadow, surveyCoversFocus } from './survey-roofs.js';
import { applyLandmarkStyle, displayedLandmarkHeight } from './landmark-buildings.js';

const L = (() => { const x = -0.55, y = -0.83; const n = Math.hypot(x, y); return [x / n, y / n]; })(); // light from NNW

const PAL = {
  brick: ['#9a4b3b', '#8c5643', '#a8644a', '#7f4a3c', '#b47c5c', '#9e8068'],
  siding: ['#cfc7b4', '#b9b3a6', '#a6aeb2', '#c8b897', '#8e9aa0', '#d8d2c4', '#a8b49c'],
  shingle: ['#4a4a50', '#5a4c42', '#3e3f45', '#665a4c', '#53595e', '#6e5244', '#46403c'],
  stucco: ['#cdbfa6', '#bba98f', '#d6cdbb', '#a9a69c', '#c4b49a'],
  flat: ['#b9b9b4', '#c6c4bc', '#a9aaa8', '#bfb6a8'],
  metal: ['#8d979f', '#a2a9aa', '#9b8f7c', '#7f8a95', '#b0b5b5'],
  glass: ['#3b5873', '#2e4a5f', '#55697a', '#43505b', '#36606a', '#5b6878'],
  stone: ['#c5b9a0', '#b3a58a', '#d0c6b2', '#a89c86'],
  barn: ['#8a2f25', '#7d3a2a', '#9a3b2c'],
};

function pick(arr, r) { return arr[Math.floor(r * arr.length) % arr.length]; }
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f)), g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f)), b = Math.min(255, Math.max(0, (n & 255) * f));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function styleFor(b) {
  const p = b.pts;
  const r1 = hash2(Math.floor(p[0] * 10), Math.floor(p[1] * 10), 11);
  const r2 = hash2(Math.floor(p[0] * 10), Math.floor(p[1] * 10), 12);
  const r3 = hash2(Math.floor(p[0] * 10), Math.floor(p[1] * 10), 13);
  // signed area (y-down): >0 means outward normal of edge e is (ey, -ex)
  let A = 0;
  const n = p.length >> 1;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; A += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
  const area = Math.abs(A) / 2;
  let t = b.t;
  if (t === 0) t = area < 260 ? 1 : area < 900 ? 4 : b.h > 25 ? 7 : 6;
  if (b.h >= 28 && t !== 15) t = 7;
  let wall, roof, roofType = 'flat', windows = 'office', lit = 0.35;
  switch (t) {
    case 1: case 2: case 16:
      wall = r1 < 0.55 ? pick(PAL.brick, r2) : pick(PAL.siding, r2); roof = pick(PAL.shingle, r3); roofType = 'hip'; windows = 'house'; lit = 0.5; break;
    case 3: case 17: wall = r1 < 0.5 ? pick(PAL.brick, r2) : pick(PAL.stucco, r2); roof = pick(PAL.flat, r3); windows = 'apt'; lit = 0.55; break;
    case 4: case 5: case 20: wall = pick(PAL.stucco, r2); roof = pick(PAL.flat, r3); windows = 'shop'; break;
    case 6: case 14: wall = pick(PAL.metal, r2); roof = pick(PAL.metal, r3); roofType = 'ribbed'; windows = 'none'; lit = 0.1; break;
    case 7:
      if (b.h >= 18) { wall = pick(PAL.glass, r2); roof = '#5c6066'; windows = 'tower'; }
      else {
        wall = pick(r1 < 0.6 ? PAL.brick : PAL.stone, r2); roof = pick(PAL.flat, r3);
        windows = b.h < 6 && area < 700 ? 'shop' : 'office';
      }
      lit = 0.45; break;
    case 8: wall = r1 < 0.6 ? pick(PAL.brick, r2) : pick(PAL.stone, r2); roof = '#4d4540'; roofType = area < 1500 ? 'hip' : 'flat'; windows = 'church'; break;
    case 9: case 19: wall = r1 < 0.6 ? pick(PAL.brick, r2) : pick(PAL.stone, r2); roof = pick(PAL.flat, r3); windows = 'office'; break;
    case 10: wall = '#d9d8d2'; roof = '#b8bcc0'; windows = 'office'; lit = 0.6; break;
    case 11: case 12: wall = pick(PAL.siding, r2); roof = pick(PAL.metal, r3); roofType = area < 120 ? 'hip' : 'flat'; windows = 'none'; break;
    case 13: wall = pick(PAL.barn, r2); roof = pick(PAL.metal, r3); roofType = 'hip'; windows = 'none'; break;
    case 15: wall = '#d8d8d4'; roof = '#e2e2de'; windows = 'none'; roofType = 'flat'; break;
    case 18: wall = pick(PAL.stone, r2); roof = '#9aa0a4'; windows = 'none'; break;
    default: wall = pick(PAL.stucco, r2); roof = pick(PAL.flat, r3);
  }
  const facade = PAL.brick.includes(wall) ? 'brick' : PAL.siding.includes(wall) ? 'siding' : PAL.metal.includes(wall) ? 'metal' : null;
  // surveyed buildings (GT Tulsa data): the roof shape, ridge direction and eave height are measured
  let eave = b.h;
  if (b.roof !== undefined) {
    if (b.roof > 0 && b.h - b.eave > 0.3) {
      roofType = 'model';
      eave = b.eave;
      if (t === 1 || t === 2 || t === 16 || t === 0) roof = pick(PAL.shingle, r3);
      else if (t === 11 || t === 12 || t === 13 || t === 6 || t === 14) roof = pick(PAL.metal, r3);
      else if (t === 8) roof = '#4d4540';
      else roof = pick(PAL.shingle, r3);
    } else if (b.roof >= 0 && roofType === 'hip') roofType = 'flat';
    if (b.wc) wall = b.wc;
    if (b.rc) roof = b.rc;
    if (t === 1 || t === 16) windows = 'house';
  }
  // Use the long edge for roof orientation and as a stable facade for the entry.
  let best = 0, axis = [1, 0], front = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ex = p[j * 2] - p[i * 2], ey = p[j * 2 + 1] - p[i * 2 + 1], l = Math.hypot(ex, ey);
    if (l > best) { best = l; axis = [ex / l, ey / l]; front = i; }
  }
  let kind = b.roof;
  if (roofType === 'hip') {
    // Area / long span estimates the width even on an L-shaped house or an attached garage.
    const rise = Math.min(3.2, area / Math.max(1, best) * 0.28, b.h * 0.43);
    eave = b.h - rise;
    kind = r2 < 0.46 ? 1 : 2;
    roofType = 'model';
  }
  const metal = t === 6 || t === 11 || t === 12 || t === 13 || t === 14;
  const material = metal ? 'metal' : roofType === 'model' ? 'shingle' : 'membrane';
  const floors = Math.max(1, Math.round(eave / 3.4));
  return applyLandmarkStyle(b, { wall, roof, roofType, material, facade, kind, windows, lit, A, area, floors, seed: r1, t, axis, front, eave });
}

// ---------------------------------------------------------------- measured pitched roofs
// The roof is a height field z(x, y) over the footprint, split into planar facets by clipping the footprint
// against half-planes in the ridge frame (u along the ridge, v across it). Built once per building.
function clipPoly(pts, a, b, c) {
  // keep the part of the (u,v) polygon where a*u + b*v + c >= 0
  const out = [];
  const n = pts.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ui = pts[i * 2], vi = pts[i * 2 + 1], uj = pts[j * 2], vj = pts[j * 2 + 1];
    const di = a * ui + b * vi + c, dj = a * uj + b * vj + c;
    if (di >= 0) out.push(ui, vi);
    if ((di >= 0) !== (dj >= 0)) { const t = di / (di - dj); out.push(ui + (uj - ui) * t, vi + (vj - vi) * t); }
  }
  return out;
}
function roofModel(b, st) {
  if (st.model) return st.model;
  const p = b.pts, n = p.length >> 1;
  // ridge direction: measured bearing (0 = north, y is south in game space) or the footprint's long axis
  let ux, uy;
  if (b.az != null && b.az >= 0) { const a = b.az * Math.PI / 180; ux = Math.sin(a); uy = -Math.cos(a); } else { ux = st.axis[0]; uy = st.axis[1]; }
  const vx = -uy, vy = ux;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += p[i * 2]; cy += p[i * 2 + 1]; }
  cx /= n; cy /= n;
  const uv = [];
  let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
  for (let i = 0; i < n; i++) {
    const dx = p[i * 2] - cx, dy = p[i * 2 + 1] - cy, u = dx * ux + dy * uy, v = dx * vx + dy * vy;
    uv.push(u, v);
    if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const mu = (umin + umax) / 2, m = (vmin + vmax) / 2, w = Math.max(0.5, (vmax - vmin) / 2), Lh = Math.max(0.5, (umax - umin) / 2);
  const R = b.h, E = st.eave, rise = R - E;
  const kind = st.kind;
  const facets = []; // {uv, z: (u,v)=>z, nu, nv}
  const s1 = rise / w;
  if (kind === 3) {
    facets.push({ uv, z: (u, v) => E + rise * (v - vmin) / (2 * w), nu: 0, nv: -rise / (2 * w) });
  } else if (kind === 1) {
    facets.push({ uv: clipPoly(uv, 0, 1, -m), z: (u, v) => R - s1 * (v - m), nu: 0, nv: s1 });
    facets.push({ uv: clipPoly(uv, 0, -1, m), z: (u, v) => R - s1 * (m - v), nu: 0, nv: -s1 });
  } else {
    // hip (2), pyramid/cone/dome (4, 5): sides slope across, ends slope along the ridge
    const e = kind === 2 ? Math.max(0, Lh - w) : 0;
    const s2 = kind === 2 ? s1 : rise / Lh;
    // side facets: s1*|v-m| >= s2*(|u-mu|-e)
    let f = clipPoly(uv, 0, 1, -m); f = clipPoly(f, -s2, s1, -s1 * m + s2 * mu + s2 * e); f = clipPoly(f, s2, s1, -s1 * m - s2 * mu + s2 * e);
    facets.push({ uv: f, z: (u, v) => R - s1 * (v - m), nu: 0, nv: s1 });
    f = clipPoly(uv, 0, -1, m); f = clipPoly(f, -s2, -s1, s1 * m + s2 * mu + s2 * e); f = clipPoly(f, s2, -s1, s1 * m - s2 * mu + s2 * e);
    facets.push({ uv: f, z: (u, v) => R - s1 * (m - v), nu: 0, nv: -s1 });
    // end facets: s2*(u-mu-e) >= s1*|v-m|
    f = clipPoly(uv, 1, 0, -mu - e); f = clipPoly(f, s2, -s1, -s2 * mu - s2 * e + s1 * m); f = clipPoly(f, s2, s1, -s2 * mu - s2 * e - s1 * m);
    facets.push({ uv: f, z: (u, v) => R - s2 * (u - mu - e), nu: s2, nv: 0 });
    f = clipPoly(uv, -1, 0, mu - e); f = clipPoly(f, -s2, -s1, s2 * mu - s2 * e + s1 * m); f = clipPoly(f, -s2, s1, s2 * mu - s2 * e - s1 * m);
    facets.push({ uv: f, z: (u, v) => R - s2 * (mu - u - e), nu: -s2, nv: 0 });
  }
  // to world: each facet as flat [x, y, z, ...]; light from the facet's downhill direction
  const out = [];
  for (const F of facets) {
    const k = F.uv.length >> 1;
    if (k < 3) continue;
    const pts = new Float32Array(k * 3);
    for (let i = 0; i < k; i++) {
      const u = F.uv[i * 2], v = F.uv[i * 2 + 1];
      pts[i * 3] = cx + u * ux + v * vx; pts[i * 3 + 1] = cy + u * uy + v * vy; pts[i * 3 + 2] = Math.max(E, Math.min(R, F.z(u, v)));
    }
    // downhill vector in world xy
    const gx = F.nu * ux + F.nv * vx, gy = F.nu * uy + F.nv * vy, gl = Math.hypot(gx, gy) || 1;
    let winding = 0, centerX = 0, centerY = 0;
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      winding += pts[i * 3] * pts[j * 3 + 1] - pts[j * 3] * pts[i * 3 + 1];
      centerX += pts[i * 3]; centerY += pts[i * 3 + 1];
    }
    out.push({ pts, sp: new Float32Array(k * 2), k, winding, x: centerX / k, y: centerY / k,
      ux: -gy / gl, uy: gx / gl, slope: gl, lit: (gx * L[0] + gy * L[1]) / gl * Math.min(1, gl * 1.6) });
  }
  // height of the roof surface at any footprint point (walls rise to it)
  const zAt = (x, y) => {
    const dx = x - cx, dy = y - cy, u = dx * ux + dy * uy, v = dx * vx + dy * vy;
    let z;
    if (kind === 3) z = E + rise * (v - vmin) / (2 * w);
    else if (kind === 1) z = R - s1 * Math.abs(v - m);
    else { const e = kind === 2 ? Math.max(0, Lh - w) : 0, s2 = kind === 2 ? s1 : rise / Lh; z = R - Math.max(s1 * Math.abs(v - m), s2 * (Math.abs(u - mu) - e)); }
    return Math.max(E, Math.min(R, z));
  };
  st.model = { facets: out, zAt, ux, uy, vx, vy, cx, cy, m, kind };
  return st.model;
}

const Q = [0, 0];
function drawModelBuilding(ctx, cam, b, st, detail, night, P, n, photo) {
  const p = b.pts, M = roofModel(b, st);
  const ox = cam.x + cam.shakeX, oy = cam.y + cam.shakeY;
  const outSign = st.A > 0 ? 1 : -1;
  const nightF = 1 - night * NIGHT_SELF * 0.9, rf = 1 - night * NIGHT_SELF;
  // walls: visible edges, far to near; the top follows the roof surface (gable ends rise to the ridge)
  const walls = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = p[j * 2] - p[i * 2], ey = p[j * 2 + 1] - p[i * 2 + 1];
    const nx = ey * outSign, ny = -ex * outSign;
    const mx = (p[i * 2] + p[j * 2]) * 0.5 - ox, my = (p[i * 2 + 1] + p[j * 2 + 1]) * 0.5 - oy;
    if (nx * mx + ny * my >= 0) continue;
    const ln = Math.hypot(nx, ny) || 1;
    walls.push([i, j, mx * mx + my * my, (nx * L[0] + ny * L[1]) / ln, Math.hypot(ex, ey)]);
  }
  walls.sort((a, c) => c[2] - a[2]);
  const sEave = cam.D / (cam.D - cam.ch(st.eave));
  for (const [i, j, , lit, len] of walls) {
    const f = (0.62 + 0.38 * Math.max(-0.3, lit)) * nightF;
    ctx.fillStyle = shade(st.wall, f);
    ctx.beginPath();
    ctx.moveTo(P[i * 2], P[i * 2 + 1]); ctx.lineTo(P[j * 2], P[j * 2 + 1]);
    // top edge from j back to i, sampled so gable peaks follow the roof
    const steps = Math.max(1, Math.min(12, Math.ceil(len / 1.2)));
    for (let k = steps; k >= 0; k--) {
      const t = k / steps, x = p[i * 2] + (p[j * 2] - p[i * 2]) * t, y = p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t;
      cam.toScreen(x, y, M.zAt(x, y), Q); ctx.lineTo(Q[0], Q[1]);
    }
    ctx.closePath(); ctx.fill();
    if (detail > 0) drawFacade(ctx, cam, b, st, i, j, f, night, sEave, detail);
  }
  // roof facets: skip those folded away from the camera (projected winding flips); far first
  const vis = [];
  for (const F of M.facets) {
    const { pts, sp, k } = F;
    let area = 0;
    for (let i = 0; i < k; i++) {
      cam.toScreen(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], Q);
      sp[i * 2] = Q[0]; sp[i * 2 + 1] = Q[1];
    }
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      area += sp[i * 2] * sp[j * 2 + 1] - sp[j * 2] * sp[i * 2 + 1];
    }
    if (F.winding * area <= 0 || Math.abs(area) < 0.5) continue;
    F.d = (F.x - ox) ** 2 + (F.y - oy) ** 2;
    vis.push(F);
  }
  vis.sort((a, c) => c.d - a.d);
  const zoom = cam.zoom;
  for (const F of vis) {
    ctx.fillStyle = shade(st.roof, (0.86 + 0.3 * F.lit) * rf);
    ctx.beginPath(); ctx.moveTo(F.sp[0], F.sp[1]);
    for (let i = 1; i < F.k; i++) ctx.lineTo(F.sp[i * 2], F.sp[i * 2 + 1]);
    ctx.closePath();
    const { pts, ux, uy, slope } = F;
    if (photo) paintRoofPhoto(ctx, cam, photo, pts[0], pts[1], pts[2], -uy * slope, ux * slope, (0.96 + 0.04 * F.lit) * rf);
    else ctx.fill();
    if (detail > 1) paintRoofMaterial(ctx, cam, st.material, pts[0], pts[1], pts[2], ux, uy, slope);
    if (zoom > 4) { ctx.strokeStyle = shade(st.roof, 0.55 * rf); ctx.lineWidth = 1; ctx.stroke(); }
  }
  // chimney on some houses
  if (!photo && detail > 0 && zoom > 5 && st.windows === 'house' && st.seed > 0.55 && M.kind !== 3) {
    const t = (st.seed * 13 % 0.6) - 0.3, off = (st.seed * 7 % 1) < 0.5 ? -1 : 1;
    const x = M.cx + M.ux * t * 6 + M.vx * (M.m + off * 0.8), y = M.cy + M.uy * t * 6 + M.vy * (M.m + off * 0.8);
    if (!inPoly(x, y, p)) return;
    const z0 = M.zAt(x, y), z1 = b.h + 0.8;
    const c0 = cam.toScreen(x, y, z0 - 0.2, [0, 0]), c1 = cam.toScreen(x, y, z1, [0, 0]);
    const w = 0.7 * zoom;
    ctx.strokeStyle = shade('#7a4a3a', rf * 0.8); ctx.lineWidth = w * 1.4;
    ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.stroke();
    ctx.fillStyle = shade('#8e5a46', rf); ctx.fillRect(c1[0] - w * 0.7, c1[1] - w * 0.7, w * 1.4, w * 1.4);
  }
}

// buildings darken themselves only a little at night: the lighting layer does the rest
let NIGHT_SELF = 0.6;
export function setNightSelf(v) { NIGHT_SELF = v; }

let P = new Float32Array(256 * 2);
let R = new Float32Array(256 * 2);

// Draw one building. night: 0..1
export function drawBuilding(ctx, cam, b, detail, night, focus, survey) {
  const st = b._st || (b._st = styleFor(b));
  const p = b.pts;
  const n = p.length >> 1;
  if (p.length > P.length) { P = new Float32Array(p.length); R = new Float32Array(p.length); }
  const zoom = cam.zoom;
  const cx = cam.W * 0.5, cy = cam.H * 0.5;
  const ox = cam.x + cam.shakeX, oy = cam.y + cam.shakeY;
  const landmarkHeight = st.drawLandmark ? displayedLandmarkHeight(b, detail) : null;
  const he = cam.ch(survey?.mesh.eave ?? landmarkHeight ?? (st.roofType === 'model' ? st.eave : b.h));
  const s = cam.D / (cam.D - he);
  for (let i = 0; i < n; i++) {
    const bx = (p[i * 2] - ox) * zoom, by = (p[i * 2 + 1] - oy) * zoom;
    P[i * 2] = cx + bx; P[i * 2 + 1] = cy + by;
    R[i * 2] = cx + bx * s; R[i * 2 + 1] = cy + by * s;
  }
  // fade buildings that hide the player (point inside roof or near-side walls)
  let faded = false;
  if (focus && (survey?.mesh.peak ?? landmarkHeight ?? b.h) > 4) {
    const fx = focus[0], fy = focus[1];
    let inside = false;
    // The eave and its walls lie between the footprint and its projection.
    // Faraway blocks never need individual wall/player intersection tests.
    const bb = b.bb;
    const left = (bb[0] - ox) * zoom, top = (bb[1] - oy) * zoom;
    const right = (bb[2] - ox) * zoom, bottom = (bb[3] - oy) * zoom;
    const nearFocus = fx >= cx + Math.min(left, left*s) - 1 && fx <= cx + Math.max(right, right*s) + 1 &&
      fy >= cy + Math.min(top, top*s) - 1 && fy <= cy + Math.max(bottom, bottom*s) + 1;
    if (nearFocus) for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = R[i * 2], yi = R[i * 2 + 1], xj = R[j * 2], yj = R[j * 2 + 1];
      if ((yi > fy) !== (yj > fy) && fx < ((xj - xi) * (fy - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (nearFocus && !inside) {
      // inside the hull between footprint and roof? test against each wall quad
      for (let i = 0; i < n && !inside; i++) {
        const j = (i + 1) % n;
        const qx = [P[i * 2], P[j * 2], R[j * 2], R[i * 2]], qy = [P[i * 2 + 1], P[j * 2 + 1], R[j * 2 + 1], R[i * 2 + 1]];
        let c = false;
        for (let a = 0, bq = 3; a < 4; bq = a++) if ((qy[a] > fy) !== (qy[bq] > fy) && fx < ((qx[bq] - qx[a]) * (fy - qy[a])) / (qy[bq] - qy[a]) + qx[a]) c = !c;
        if (c) inside = true;
      }
    }
    if (inside || (survey && surveyCoversFocus(survey, cam, fx, fy))) { faded = true; ctx.globalAlpha = 0.32; }
  }
  if (st.drawLandmark?.(ctx, cam, b, st, detail, night)) {
    if (faded) ctx.globalAlpha = 1;
    return;
  }
  const photo = !survey && detail > 1 ? roofPhoto(ctx, b, st) : null;
  if (!survey && st.roofType === 'model') { drawModelBuilding(ctx, cam, b, st, detail, night, P, n, photo); if (faded) ctx.globalAlpha = 1; return; }
  const outSign = st.A > 0 ? 1 : -1;
  const facade = survey ? (survey.mesh.facade ||= { ...st, roofType: 'model', eave: survey.mesh.eave,
    floors: Math.max(1, Math.round(survey.mesh.eave / 3.4)) }) : st;
  // visible walls
  const walls = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = p[j * 2] - p[i * 2], ey = p[j * 2 + 1] - p[i * 2 + 1];
    const nx = ey * outSign, ny = -ex * outSign;
    const mx = (p[i * 2] + p[j * 2]) * 0.5 - ox, my = (p[i * 2 + 1] + p[j * 2 + 1]) * 0.5 - oy;
    if (nx * mx + ny * my >= 0) continue;
    const ln = Math.hypot(nx, ny) || 1;
    const lit = (nx * L[0] + ny * L[1]) / ln;
    walls.push(i, j, mx * mx + my * my, lit);
  }
  // sort walls far->near
  const wc = walls.length / 4;
  const order = [];
  for (let k = 0; k < wc; k++) order.push(k);
  if (wc > 2) order.sort((a, b2) => walls[b2 * 4 + 2] - walls[a * 4 + 2]);
  const nightF = 1 - night * NIGHT_SELF * 0.9;
  for (const k of order) {
    const i = walls[k * 4], j = walls[k * 4 + 1], lit = walls[k * 4 + 3];
    const f = (0.62 + 0.38 * Math.max(-0.3, lit)) * nightF;
    ctx.fillStyle = shade(st.wall, f);
    ctx.beginPath();
    ctx.moveTo(P[i * 2], P[i * 2 + 1]); ctx.lineTo(P[j * 2], P[j * 2 + 1]);
    ctx.lineTo(R[j * 2], R[j * 2 + 1]); ctx.lineTo(R[i * 2], R[i * 2 + 1]);
    ctx.closePath();
    ctx.fill();
    if (detail > 0) drawFacade(ctx, cam, b, facade, i, j, f, night, s, detail);
  }
  if (survey) {
    const { canvas, sx, sy, sw, sh, x, y, w, h } = survey;
    ctx.drawImage(canvas, sx, sy, sw, sh, x, y, w, h);
    if (faded) ctx.globalAlpha = 1;
    return;
  }
  // roof
  ctx.beginPath();
  ctx.moveTo(R[0], R[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(R[i * 2], R[i * 2 + 1]);
  ctx.closePath();
  const rf = 1 - night * NIGHT_SELF;
  if (photo) paintRoofPhoto(ctx, cam, photo, p[0], p[1], b.h, 0, 0, rf);
  else {
    ctx.fillStyle = shade(st.roof, rf);
    ctx.fill();
  }
  if (detail > 1 && st.t !== 15 && st.t !== 18) {
    paintRoofMaterial(ctx, cam, st.material, p[0], p[1], b.h, st.axis[0], st.axis[1]);
  }
  if (detail > 0 && st.roofType === 'flat' && st.t !== 15 && zoom * s > 3) {
    // The coping band and its shadow sit inside the measured footprint.
    const pw = Math.max(1, zoom * s * 0.32);
    ctx.save(); ctx.clip(); ctx.lineJoin = 'bevel';
    ctx.strokeStyle = shade(st.roof, 0.74 * rf); ctx.lineWidth = pw * 2 + Math.max(1, zoom * s * 0.25); ctx.stroke();
    ctx.strokeStyle = shade(st.roof, 1.10 * rf); ctx.lineWidth = pw * 2; ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = shade(st.roof, 0.65 * rf); ctx.lineWidth = 1; ctx.stroke();
  if (!photo && detail > 1 && zoom * s > 3 && st.area > 140 && st.t !== 15 && st.t !== 18) {
    drawRoofFeatures(ctx, cam, b, st, rf, zoom);
  }
  if (!photo && st.t === 15 && detail > 0) drawTankRoof(ctx, cam, b, st, rf);
  if (!photo && st.t === 7 && b.h > 30 && detail > 0) drawPenthouse(ctx, cam, b, st, rf);
  if (faded) ctx.globalAlpha = 1;
}

// Tank plates converge on the central hatch; clip radial seams to the mapped outline.
function drawTankRoof(ctx, cam, b, st, rf) {
  const bb = b.bb;
  const c = cam.toScreen((bb[0] + bb[2]) * 0.5, (bb[1] + bb[3]) * 0.5, b.h, Q);
  const radius = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * cam.zoom * cam.pf(cam.ch(b.h)) * 0.52;
  if (radius < 7) return;
  ctx.save(); ctx.clip();
  ctx.beginPath();
  const count = radius > 35 ? 16 : 8;
  for (let i = 0; i < count; i++) {
    const a = i * Math.PI * 2 / count;
    ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] + radius * Math.cos(a), c[1] + radius * Math.sin(a));
  }
  ctx.strokeStyle = shade(st.roof, 0.82 * rf); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = shade(st.roof, 0.68 * rf);
  ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1.5, Math.min(radius * 0.13, cam.zoom * 0.7)), 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}

// raised mechanical penthouse (and a helipad on the tallest towers)
function drawPenthouse(ctx, cam, b, st, rf) {
  const p = b.pts, n = p.length >> 1;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += p[i * 2]; cy += p[i * 2 + 1]; }
  cx /= n; cy /= n;
  const k = 0.42, h0 = b.h, h1 = b.h + Math.min(6, b.h * 0.06);
  const base = [], top = [];
  for (let i = 0; i < n; i++) {
    const x = cx + (p[i * 2] - cx) * k, y = cy + (p[i * 2 + 1] - cy) * k;
    base.push(cam.toScreen(x, y, h0, [0, 0])); top.push(cam.toScreen(x, y, h1, [0, 0]));
  }
  ctx.fillStyle = shade(st.roof, 0.7 * rf);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.beginPath(); ctx.moveTo(base[i][0], base[i][1]); ctx.lineTo(base[j][0], base[j][1]); ctx.lineTo(top[j][0], top[j][1]); ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = shade('#8a8f96', rf);
  ctx.beginPath(); top.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill();
  if (b.h > 90) {
    const c = cam.toScreen(cx, cy, h1, [0, 0]);
    const r = cam.zoom * cam.pf(cam.ch(h1)) * 2.2;
    ctx.strokeStyle = shade('#e8e2c8', rf); ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c[0] - r * 0.4, c[1] - r * 0.5); ctx.lineTo(c[0] - r * 0.4, c[1] + r * 0.5); ctx.moveTo(c[0] + r * 0.4, c[1] - r * 0.5); ctx.lineTo(c[0] + r * 0.4, c[1] + r * 0.5); ctx.moveTo(c[0] - r * 0.4, c[1]); ctx.lineTo(c[0] + r * 0.4, c[1]); ctx.stroke();
  }
}

function drawFacade(ctx, cam, b, st, i, j, f, night, s, detail) {
  const p = b.pts;
  const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
  const wl = Math.hypot(bx - ax, by - ay);
  if (wl < 2.5) return;
  // screen height of the wall
  const zoom = cam.zoom;
  const mx = ((ax + bx) / 2 - cam.x) * zoom, my = ((ay + by) / 2 - cam.y) * zoom;
  const wallPx = Math.abs((bx - ax) * my - (by - ay) * mx) / wl * (s - 1);
  if (wallPx < 2.5) return;
  // Leave room for details which project past the wall, including shop awnings.
  const pad = 2 + zoom * s * 1.2;
  const minX = Math.min(P[i*2], P[j*2], R[i*2], R[j*2]) - pad;
  const maxX = Math.max(P[i*2], P[j*2], R[i*2], R[j*2]) + pad;
  const minY = Math.min(P[i*2+1], P[j*2+1], R[i*2+1], R[j*2+1]) - pad;
  const maxY = Math.max(P[i*2+1], P[j*2+1], R[i*2+1], R[j*2+1]) + pad;
  if (maxX < 0 || maxY < 0 || minX > cam.W || minY > cam.H) return;
  const clipped = minX < 0 || minY < 0 || maxX > cam.W || maxY > cam.H;
  const close = detail > 1 && wallPx >= 7 && zoom > 4;
  if (close && st.facade && wallPx / st.eave > 2.5) {
    paintWallMaterial(ctx, st.facade, P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1],
      R[i * 2], R[i * 2 + 1], wl, st.eave);
  }
  const front = i === st.front;
  const industrial = [6, 11, 13, 14].includes(st.t);
  if (st.windows === 'none' && !(front && industrial)) return;
  const floors = st.floors;
  const lightCol = night > 0.3 ? 'rgba(255,214,120,0.95)' : null;
  const dark = st.windows === 'tower' ? shade(st.wall, f * 1.25) : `rgba(30,40,55,${0.55 + 0.2 * (1 - f)})`;
  const cx = cam.W * 0.5, cy = cam.H * 0.5;
  let prevH0, prevH1, scale0, scale1;
  const quad = (t0, t1, h0, h1, col, overhang = 0) => {
    const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
    const off = overhang * (st.A > 0 ? 1 : -1) / wl;
    const dx = (by - ay) * off, dy = (ax - bx) * off;
    // Windows across a storey share both perspective factors.
    if (h0 !== prevH0) { prevH0 = h0; scale0 = h0 > 0 ? cam.pf(cam.ch(h0)) : 1; }
    if (h1 !== prevH1) { prevH1 = h1; scale1 = h1 > 0 ? cam.pf(cam.ch(h1)) : 1; }
    const bottomLeftX = cx + (x0 + dx - cam.x - cam.shakeX) * zoom * scale0;
    const bottomLeftY = cy + (y0 + dy - cam.y - cam.shakeY) * zoom * scale0;
    const bottomRightX = cx + (x1 + dx - cam.x - cam.shakeX) * zoom * scale0;
    const bottomRightY = cy + (y1 + dy - cam.y - cam.shakeY) * zoom * scale0;
    const topRightX = cx + (x1 - cam.x - cam.shakeX) * zoom * scale1;
    const topRightY = cy + (y1 - cam.y - cam.shakeY) * zoom * scale1;
    const topLeftX = cx + (x0 - cam.x - cam.shakeX) * zoom * scale1;
    const topLeftY = cy + (y0 - cam.y - cam.shakeY) * zoom * scale1;
    if (clipped && (Math.max(bottomLeftX, bottomRightX, topRightX, topLeftX) < -1 ||
        Math.min(bottomLeftX, bottomRightX, topRightX, topLeftX) > cam.W + 1 ||
        Math.max(bottomLeftY, bottomRightY, topRightY, topLeftY) < -1 ||
        Math.min(bottomLeftY, bottomRightY, topRightY, topLeftY) > cam.H + 1)) return;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(bottomLeftX, bottomLeftY); ctx.lineTo(bottomRightX, bottomRightY);
    ctx.lineTo(topRightX, topRightY); ctx.lineTo(topLeftX, topLeftY);
    ctx.closePath(); ctx.fill();
  };
  const fh = (st.roofType === 'model' ? st.eave : b.h) / floors;
  const maxFloors = Math.min(floors, Math.max(1, Math.floor(wallPx / 2.2)));
  const step = floors / maxFloors;
  const nWin = Math.max(1, Math.min(24, Math.floor(wl / (st.windows === 'house' ? 4.5 : 3.2))));
  const seed = st.seed * 1000;
  if (st.windows === 'tower') {
    // continuous glass bands with mullions
    for (let fl = 0; fl < maxFloors; fl++) {
      const f0 = Math.floor(fl * step);
      const h0 = f0 * fh + fh * 0.18, h1 = f0 * fh + fh * 0.82;
      quad(0.03, 0.97, h0, h1, dark);
      if (lightCol) {
        for (let w = 0; w < nWin; w++) if (hash2(seed + w, f0, i) < st.lit * night) quad((w + 0.1) / nWin, (w + 0.9) / nWin, h0, h1, lightCol);
      }
    }
    if (close) {
      const half = 0.07 / wl;
      for (let w = 1; w < nWin; w++) quad(w / nWin - half, w / nWin + half, 0.25, st.eave - 0.15, shade(st.wall, f * 0.64));
    }
    return;
  }
  if (st.windows === 'shop') {
    const top = Math.min(st.eave * 0.86, 3.2);
    const glass = lightCol && night > 0.5 ? 'rgba(255,225,166,0.83)' : shade('#536c78', f);
    quad(0.05, 0.95, 0.38, top, glass);
    if (close) {
      const bays = Math.max(1, Math.min(22, Math.round(wl / 2.4)));
      for (let w = 1; w < bays; w++) {
        const t = 0.05 + 0.9 * w / bays;
        quad(t - 0.065 / wl, t + 0.065 / wl, 0.38, top, shade('#a7a69c', f));
      }
      quad(0.05, 0.95, top * 0.78, top * 0.82, shade('#a7a69c', f));
      if (front && wl > 5) {
        quad(0.45, 0.55, 0, top * 0.75, shade('#2b3c41', f));
        if (st.area < 1800 && wl < 50) {
          const fabric = pick(['#824d44', '#3f6259', '#455d72', '#b29c76'], st.seed);
          quad(0.045, 0.955, top * 0.88, top, shade(fabric, f * 1.2), 1.05);
        }
      }
    }
    return;
  }
  if (st.windows === 'none') {
    const count = Math.min(5, Math.max(1, Math.floor(wl / 9)));
    const half = Math.min(0.38 / count, (st.t === 14 ? 6 : 2) / wl);
    const top = Math.min(st.eave * 0.8, st.t === 11 ? 2.4 : 4.1);
    for (let door = 0; door < count; door++) {
      const t = (door + 0.5) / count;
      quad(t - half, t + half, 0, top, shade('#a09c91', f * 0.83));
      if (close) for (let k = 1; k < 5; k++) {
        quad(t - half, t + half, top * k / 5, top * k / 5 + 0.08, shade('#595c5a', f));
      }
    }
    return;
  }
  for (let fl = 0; fl < maxFloors; fl++) {
    const f0 = Math.floor(fl * step);
    const h0 = f0 * fh + fh * 0.32, h1 = f0 * fh + fh * 0.78;
    for (let w = 0; w < nWin; w++) {
      if (close && front && f0 === 0 && w === Math.floor(nWin / 2)) {
        const t = (w + 0.5) / nWin, half = Math.min(0.55 / wl, 0.4 / nWin);
        const top = Math.min(2.15, st.eave * 0.82);
        quad(t - half - 0.08 / wl, t + half + 0.08 / wl, 0, top + 0.10, shade('#c6b99f', f));
        quad(t - half, t + half, 0, top, shade('#554b42', f));
        quad(t - half * 0.65, t + half * 0.65, top * 0.49, top * 0.88, lightCol || dark);
        continue;
      }
      if (st.windows === 'house' && hash2(seed + w, f0, i + 5) < 0.35) continue;
      const on = lightCol && hash2(seed + w, f0, i) < st.lit * night;
      const left = (w + 0.25) / nWin, right = (w + 0.75) / nWin;
      if (close && (st.windows === 'house' || st.windows === 'apt' || st.windows === 'church')) {
        quad(left - 0.08 / wl, right + 0.08 / wl, h0 - 0.12, h1 + 0.12, shade('#c0b5a4', f));
      }
      quad(left, right, h0, h1, on ? lightCol : dark);
    }
  }
}

// Rooftop kit: AC units, vents, stair huts, skylights, water tanks and solar arrays,
// generated once per building and drawn as tiny extruded boxes in the same perspective.
function roofFeatures(b, st) {
  if (st.feat) return st.feat;
  const feat = [];
  const p = b.pts, bb = b.bb;
  const ux = st.axis[0], uy = st.axis[1];
  const seed = st.seed * 7919;
  let k = 0;
  const R = () => hash2(seed, k++, 77);
  const fits = (x, y, rad) => inPoly(x, y, p) && edgeDist(x, y, p) > rad + 1.1;
  const sample = (rad, tries = 8) => {
    for (let t = 0; t < tries; t++) {
      const x = bb[0] + (bb[2] - bb[0]) * R(), y = bb[1] + (bb[3] - bb[1]) * R();
      if (fits(x, y, rad)) return [x, y];
    }
    return null;
  };
  const big = st.area > 2500, retail = st.windows === 'shop', old = st.windows === 'office' || st.windows === 'apt';
  // stair / elevator hut
  if (st.area > 220 && b.h > 7 && st.roofType === 'flat') {
    const q = sample(2.5);
    if (q) feat.push({ k: 'box', x: q[0], y: q[1], l: 3.2 + R() * 2, w: 2.6 + R(), h: 2.6, col: st.wall, top: st.roof, topF: 0.9 });
  }
  // water tank on older mid-rise buildings
  if (old && b.h > 14 && b.h < 60 && R() < 0.45) {
    const q = sample(2.2);
    if (q) feat.push({ k: 'tank', x: q[0], y: q[1], r: 1.5 + R() * 0.6, h: 4.5, col: '#6b4f3a', top: '#7d6650' });
  }
  // HVAC units in rows on big boxes, scattered elsewhere
  const nAC = Math.min(big ? 16 : 6, Math.floor(st.area / (big ? 260 : 160)));
  for (let i = 0; i < nAC; i++) {
    const sz = big ? 2.4 + R() * 1.4 : 1.4 + R() * 1.2;
    const q = sample(sz * 0.8, 5);
    if (!q) continue;
    feat.push({ k: 'ac', x: q[0], y: q[1], l: sz * (1.1 + R() * 0.5), w: sz, h: 1.1 + R() * 0.6, col: '#8b9196', top: '#c3c8cc' });
  }
  // skylights on retail / industrial
  if ((retail || st.roofType === 'ribbed') && st.area > 900) {
    const n = Math.min(10, Math.floor(st.area / 500));
    for (let i = 0; i < n; i++) { const q = sample(2.5, 4); if (q) feat.push({ k: 'flat', x: q[0], y: q[1], l: 3.6, w: 1.6, h: 0.15, top: '#9fc0d4' }); }
  }
  // solar array on some newer flat roofs
  if (!old && st.roofType === 'flat' && st.area > 300 && R() < 0.18) {
    const q = sample(5);
    if (q) for (let i = -1; i <= 1; i++) feat.push({ k: 'flat', x: q[0] - uy * i * 2.3, y: q[1] + ux * i * 2.3, l: 7, w: 1.8, h: 0.4, top: '#2c3e5c' });
  }
  // little vent stacks
  const nV = Math.min(8, Math.floor(st.area / 120));
  for (let i = 0; i < nV; i++) { const q = sample(0.6, 3); if (q) feat.push({ k: 'vent', x: q[0], y: q[1], r: 0.3 + R() * 0.25, h: 0.6 }); }
  st.feat = feat;
  return feat;
}

const QA = [0, 0], QB = [0, 0], QC = [0, 0], QD = [0, 0], QE = [0, 0], QF = [0, 0], QG = [0, 0], QH = [0, 0];
function drawRoofFeatures(ctx, cam, b, st, rf, zoom) {
  const feat = roofFeatures(b, st);
  if (!feat.length) return;
  const ux = st.axis[0], uy = st.axis[1], vx = -uy, vy = ux;
  const h0 = b.h;
  // shadow offset (screen px) for the little boxes
  const shx = zoom * 0.55, shy = zoom * 0.4;
  for (const f of feat) {
    if (f.k === 'vent') {
      if (zoom < 6) continue;
      const c = cam.toScreen(f.x, f.y, h0 + f.h, QA);
      const r = Math.max(1, f.r * zoom * 1.1);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.arc(c[0] + r * 0.6, c[1] + r * 0.5, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = shade('#6c7074', rf); ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, 6.283); ctx.fill();
      ctx.fillStyle = shade('#2c2e30', rf); ctx.beginPath(); ctx.arc(c[0], c[1], r * 0.5, 0, 6.283); ctx.fill();
      continue;
    }
    if (f.k === 'tank') {
      const c0 = cam.toScreen(f.x, f.y, h0, QA), c1 = cam.toScreen(f.x, f.y, h0 + f.h, QB);
      const r = f.r * zoom * (c1[0] !== c0[0] || c1[1] !== c0[1] ? 1.05 : 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(c0[0] + shx * 2, c0[1] + shy * 2, r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = shade(f.col, rf * 0.8); ctx.lineWidth = r * 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = shade(f.top, rf); ctx.beginPath(); ctx.arc(c1[0], c1[1], r * 1.04, 0, 6.283); ctx.fill();
      ctx.fillStyle = shade(f.col, rf * 0.7); ctx.beginPath(); ctx.moveTo(c1[0], c1[1] - r * 0.9); ctx.lineTo(c1[0] + r * 0.9, c1[1]); ctx.lineTo(c1[0], c1[1] + r * 0.9); ctx.lineTo(c1[0] - r * 0.9, c1[1]); ctx.closePath(); ctx.globalAlpha *= 0.35; ctx.fill(); ctx.globalAlpha /= 0.35;
      continue;
    }
    const hl = f.l / 2, hw = f.w / 2;
    const ax = ux * hl, ay = uy * hl, bx = vx * hw, by = vy * hw;
    const top = h0 + f.h;
    const corners = [[f.x - ax - bx, f.y - ay - by], [f.x + ax - bx, f.y + ay - by], [f.x + ax + bx, f.y + ay + by], [f.x - ax + bx, f.y - ay + by]];
    const T = [cam.toScreen(corners[0][0], corners[0][1], top, QA), cam.toScreen(corners[1][0], corners[1][1], top, QB), cam.toScreen(corners[2][0], corners[2][1], top, QC), cam.toScreen(corners[3][0], corners[3][1], top, QD)];
    if (f.k === 'flat') {
      ctx.fillStyle = shade(f.top, rf);
      ctx.beginPath(); ctx.moveTo(T[0][0], T[0][1]); ctx.lineTo(T[1][0], T[1][1]); ctx.lineTo(T[2][0], T[2][1]); ctx.lineTo(T[3][0], T[3][1]); ctx.closePath(); ctx.fill();
      if (zoom > 7) { ctx.strokeStyle = shade(f.top, rf * 0.7); ctx.lineWidth = 1; ctx.stroke(); }
      continue;
    }
    const B = [cam.toScreen(corners[0][0], corners[0][1], h0, QE), cam.toScreen(corners[1][0], corners[1][1], h0, QF), cam.toScreen(corners[2][0], corners[2][1], h0, QG), cam.toScreen(corners[3][0], corners[3][1], h0, QH)];
    // drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    const sh = f.h * 1.2;
    ctx.beginPath(); ctx.moveTo(B[0][0] + shx * sh, B[0][1] + shy * sh); ctx.lineTo(B[1][0] + shx * sh, B[1][1] + shy * sh); ctx.lineTo(B[2][0] + shx * sh, B[2][1] + shy * sh); ctx.lineTo(B[3][0] + shx * sh, B[3][1] + shy * sh); ctx.closePath(); ctx.fill();
    // sides
    ctx.fillStyle = shade(f.col, rf * 0.78);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      ctx.beginPath(); ctx.moveTo(B[i][0], B[i][1]); ctx.lineTo(B[j][0], B[j][1]); ctx.lineTo(T[j][0], T[j][1]); ctx.lineTo(T[i][0], T[i][1]); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = shade(f.top, rf * (f.topF || 1));
    ctx.beginPath(); ctx.moveTo(T[0][0], T[0][1]); ctx.lineTo(T[1][0], T[1][1]); ctx.lineTo(T[2][0], T[2][1]); ctx.lineTo(T[3][0], T[3][1]); ctx.closePath(); ctx.fill();
    if (f.topF) { ctx.strokeStyle = shade(f.top, rf * 0.65); ctx.lineWidth = 1; ctx.stroke(); }
    if (f.k === 'ac' && zoom > 6) {
      // fan grille
      const cxs = (T[0][0] + T[2][0]) / 2, cys = (T[0][1] + T[2][1]) / 2;
      const r = Math.min(f.l, f.w) * 0.32 * zoom;
      ctx.fillStyle = shade('#4a4f54', rf); ctx.beginPath(); ctx.arc(cxs, cys, r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = shade('#9aa0a5', rf); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cxs - r, cys); ctx.lineTo(cxs + r, cys); ctx.moveTo(cxs, cys - r); ctx.lineTo(cxs, cys + r); ctx.stroke();
    }
  }
}

function edgeDist(x, y, pts) {
  let best = Infinity; const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[j * 2], ay = pts[j * 2 + 1], bx = pts[i * 2] - ax, by = pts[i * 2 + 1] - ay;
    const L2 = bx * bx + by * by || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L2));
    const dx = x - (ax + bx * t), dy = y - (ay + by * t);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function inPoly(x, y, pts) {
  let inside = false; const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// shadow polygon(s) into an opaque shadow layer
export function drawBuildingShadow(sctx, cam, b, sunX, sunY, detail) {
  if (b.towerSprite) {
    const { sprite, x, y } = b.towerSprite;
    sprite.drawShadow(sctx, cam, x, y, Math.PI / 2, sunX, sunY);
    return;
  }
  if (drawSurveyShadow(sctx, cam, b, sunX, sunY, detail)) return;
  const p = b.pts, n = p.length >> 1;
  const height = (b._st?.landmark && displayedLandmarkHeight(b, detail)) ?? b.h;
  const len = Math.min(cam.ch(height), 60);
  const dx = sunX * len, dy = sunY * len;
  const zoom = cam.zoom, cx = cam.W * 0.5, cy = cam.H * 0.5, ox = cam.x + cam.shakeX, oy = cam.y + cam.shakeY;
  sctx.beginPath();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = (p[i * 2] - ox) * zoom + cx, ay = (p[i * 2 + 1] - oy) * zoom + cy;
    const bx = (p[j * 2] - ox) * zoom + cx, by = (p[j * 2 + 1] - oy) * zoom + cy;
    // keep every quad wound the same way so the nonzero union never cancels
    const cross = (bx - ax) * (dy * zoom) - (by - ay) * (dx * zoom);
    if (cross >= 0) { sctx.moveTo(ax, ay); sctx.lineTo(bx, by); sctx.lineTo(bx + dx * zoom, by + dy * zoom); sctx.lineTo(ax + dx * zoom, ay + dy * zoom); }
    else { sctx.moveTo(ax, ay); sctx.lineTo(ax + dx * zoom, ay + dy * zoom); sctx.lineTo(bx + dx * zoom, by + dy * zoom); sctx.lineTo(bx, by); }
    sctx.closePath();
  }
  sctx.fill('nonzero');
}
