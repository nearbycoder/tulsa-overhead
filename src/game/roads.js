// Road polyline helpers + lane geometry shared by traffic, police and pedestrians.
import { RC, F, LANE_W } from '../world/shared.js';

export function cum(road) {
  if (road._cum) return road._cum;
  const p = road.pts, n = p.length >> 1;
  const c = new Float32Array(n);
  for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
  road._cum = c;
  road.len = c[n - 1];
  return c;
}

// point at distance s from the start (dir=+1) or from the end (dir=-1), offset to the RIGHT of travel.
// out = [x, y, tx, ty]
export function pointAt(road, dir, s, offset, out) {
  const c = cum(road);
  const L = road.len;
  let d = dir > 0 ? s : L - s;
  if (d < 0) d = 0; if (d > L) d = L;
  const p = road.pts, n = p.length >> 1;
  // binary search segment
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const segL = c[hi] - c[lo] || 1e-6;
  const t = (d - c[lo]) / segL;
  const ax = p[lo * 2], ay = p[lo * 2 + 1], bx = p[hi * 2], by = p[hi * 2 + 1];
  let tx = (bx - ax) / segL, ty = (by - ay) / segL;
  if (dir < 0) { tx = -tx; ty = -ty; }
  const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
  out[0] = x + (-ty) * offset; out[1] = y + tx * offset; out[2] = tx; out[3] = ty;
  return out;
}

// deck height (overpasses / ramps) at distance s along the road in travel direction dir
export function zAt(road, dir, s) {
  if (!road.z) return 0;
  const c = cum(road), L = road.len;
  let d = dir > 0 ? s : L - s;
  if (d <= 0) return road.z[0];
  if (d >= L) return road.z[road.z.length - 1];
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const t = (d - c[lo]) / (c[hi] - c[lo] || 1e-6);
  return road.z[lo] + (road.z[hi] - road.z[lo]) * t;
}

// project a point onto road -> distance along road from start
export function projectS(road, x, y) {
  const c = cum(road);
  const p = road.pts, n = p.length >> 1;
  let best = Infinity, bs = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - x, qy = ay + dy * t - y;
    const d = qx * qx + qy * qy;
    if (d < best) { best = d; bs = c[i] + t * Math.sqrt(L2); }
  }
  return { s: bs, d: Math.sqrt(best) };
}

export function lanesPerDir(road, dir = 1) {
  if (road.flags & F.ONEWAY) return road.lanes;
  if (road.split) return road.split[dir > 0 ? 2 : 0];
  return Math.max(1, Math.floor(road.lanes / 2));
}
export function laneWidth(road) {
  return Math.min(LANE_W[road.cls] || 3, road.w / Math.max(1, road.lanes));
}
// Lanes count outwards from the divider, in travel direction coordinates.
export function laneOffset(road, lane, dir = 1) {
  if (road.lanes <= 1) return !(road.flags & F.ONEWAY) && road.w > 4.5 ? road.w * 0.22 : 0;
  return (road.lanes / 2 - lanesPerDir(road, dir) + lane + 0.5) * laneWidth(road);
}
// Lateral paint offsets are measured to the right of the stored way direction.
// Bridges and ground tiles use the same widths and directional allocation as traffic.
export function laneStripes(road) {
  if (road.stripes) return road.stripes;
  const stripes = [];
  const stripe = (offset, yellow = false, dash = false) => stripes.push({ offset, yellow, dash });
  const { cls, flags, lanes } = road;
  const lw = laneWidth(road), half = lanes * lw / 2;
  if (flags & F.ONEWAY) {
    if (cls <= RC.TERTIARY || cls === RC.MOTORWAY_LINK || cls === RC.TRUNK_LINK) {
      stripe(-half + 0.16, true);
      stripe(half - 0.16);
    }
    for (let k = 1; k < lanes; k++) stripe(-half + k * lw, false, true);
  } else if (lanes >= 2 && (cls <= RC.TERTIARY || cls >= RC.PRIMARY_LINK && cls <= RC.TERTIARY_LINK || road.split)) {
    const back = lanesPerDir(road, -1), ahead = lanesPerDir(road, 1);
    const left = -half + back * lw, right = half - ahead * lw;
    if (right - left > lw / 2) {
      stripe(left - 0.09, true); stripe(left + 0.12, true, true);
      stripe(right + 0.09, true); stripe(right - 0.12, true, true);
    } else {
      stripe(left - 0.11, true); stripe(left + 0.11, true);
    }
    for (let k = 1; k < back; k++) stripe(-half + k * lw, false, true);
    for (let k = 1; k < ahead; k++) stripe(half - k * lw, false, true);
  } else if (cls === RC.UNCLASSIFIED && lanes >= 2) {
    stripe(0, true, true);
  }
  road.stripes = stripes;
  return stripes;
}
export function canTravel(road, dir) { return !(road.flags & F.ONEWAY) || dir > 0; }
export function isDrivable(road, allowService = false) {
  if (road.cls === RC.PATH) return false;
  if (!allowService && (road.cls === RC.SERVICE || road.cls === RC.TRACK)) return false;
  if (road.flags & F.TUNNEL) return true;
  return true;
}
export function endNode(road, dir) { return dir > 0 ? road.node1 : road.node0; }
export function startNode(road, dir) { return dir > 0 ? road.node0 : road.node1; }

// choose the next road at the end of (road, dir). returns {road, dir} or null
export function chooseNext(road, dir, rng, opts = {}) {
  const n = endNode(road, dir);
  if (!n) return null;
  const tmp = [0, 0, 0, 0];
  pointAt(road, dir, road.len - 0.5, 0, tmp);
  const inx = tmp[2], iny = tmp[3];
  let cands = [];
  const laneMask = (dir > 0 ? road.ahead : road.back)?.[opts.lane] || 0;
  for (const e of n.edges) {
    const r = e.road;
    if (r === road || r.dead) continue;
    if (!isDrivable(r, opts.allowService || road.cls === RC.SERVICE)) continue;
    if (r.flags & (F.DRIVEWAY | F.AISLE) && !opts.allowService) continue;
    const d = e.dir; // +1: node is r.n0 -> travel forward
    if (!canTravel(r, d)) continue;
    pointAt(r, d, 0.5, 0, tmp);
    const dot = inx * tmp[2] + iny * tmp[3];
    const angle = Math.atan2(inx * tmp[3] - iny * tmp[2], dot) * 180 / Math.PI;
    const bend = Math.abs(angle);
    let movement = bend <= 25 ? 1 : angle < 0 ? 2 : 4;
    if (bend >= 7 && bend <= 65) movement |= angle < 0 ? 8 : 16;
    let w = Math.exp(dot * 1.4);
    if (opts.target) {
      // greedy toward target
      pointAt(r, d, Math.min(r.len || 30, 60), 0, tmp);
      const dd = Math.hypot(opts.target[0] - tmp[0], opts.target[1] - tmp[1]);
      w = Math.exp(-dd / 40) * 10 + w * 0.05;
    }
    if (r.cls <= 4 && road.cls <= 4) w *= 1.5;
    if (r.cls === RC.SERVICE) w *= 0.15;
    cands.push({ road: r, dir: d, w, movement });
  }
  if (!cands.length) return null;
  if (laneMask && cands.length > 1) {
    const permitted = cands.filter(c => c.movement & laneMask);
    // An OSM way may end before its actual junction or at the streaming boundary.
    if (permitted.length) cands = permitted;
  }
  if (opts.target) { cands.sort((a, b) => b.w - a.w); if (opts.strict || rng() < 0.85) return cands[0]; }
  let x = rng() * cands.reduce((sum, c) => sum + c.w, 0);
  for (const c of cands) { x -= c.w; if (x <= 0) return c; }
  return cands[cands.length - 1];
}
