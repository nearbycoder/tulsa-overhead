import { fetchJsonGz, streetData } from './street-data.js';
// World streaming worker: fetches + decodes region files, rasterises a surface mask,
// builds spatial buckets and scatters trees. Runs off the main thread.
import { REGION, MASK_M, MASK_N, CELL, CELLS, S, LANE_W, F, roadWidth, curbWalk } from './shared.js';
import { pointInPoly } from '../engine/math.js';
const F_ONEWAY = F.ONEWAY, F_BRIDGE = F.BRIDGE, F_TUNNEL = F.TUNNEL, F_UNPAVED = F.UNPAVED, F_AISLE = F.AISLE, F_DRIVEWAY = F.DRIVEWAY;

// area kind (build_map AREA_KIND) -> surface
const AREA_SURF = {
  1: S.FARM, 2: S.GROUND, 3: S.PARK, 4: S.LAWN, 5: S.LOT, 6: S.LOT, 7: S.FOREST, 8: S.PARK, 9: S.GOLF,
  10: S.CEMETERY, 11: S.PITCH, 12: S.PARKING, 13: S.WATER, 14: S.DIRT, 15: S.WETLAND, 16: S.LOT, 17: S.PARK,
  18: S.POOL, 19: S.RUNWAY, 20: S.GROUND, 21: S.DIRT, 22: S.DIRT, 23: S.DIRT, 24: S.LAWN, 25: S.LAWN, 26: S.GROUND,
  27: S.PITCH, 28: S.DIRT, 29: S.FARM, 30: S.LAWN, 31: S.WALK,
};
// draw order of areas (low first)
const AREA_ORDER = [1, 2, 29, 23, 4, 26, 24, 25, 30, 5, 6, 16, 21, 22, 7, 20, 8, 17, 9, 10, 27, 11, 28, 31, 12, 19, 14, 15, 13, 18];

function decLine(arr) {
  const n = arr.length >> 1;
  const out = new Float32Array(n * 2);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    x += arr[i * 2]; y += arr[i * 2 + 1];
    out[i * 2] = x / 10; out[i * 2 + 1] = y / 10;
  }
  return out;
}

function bboxOf(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

// ------------------------------------------------------------ rasteriser (no anti-aliasing)
class Raster {
  constructor(ox, oy) {
    this.ox = ox; this.oy = oy;
    this.m = new Uint8Array(MASK_N * MASK_N);
    this.xs = new Float64Array(4096);
    this.quad = new Float32Array(8);
    this.left = new Float64Array(MASK_N);
    this.right = new Float64Array(MASK_N);
  }
  span(row, left, right, val, onlyIf) {
    const c0 = Math.max(0, Math.ceil((left - this.ox) / MASK_M - 0.5));
    const c1 = Math.min(MASK_N - 1, Math.floor((right - this.ox) / MASK_M - 0.5));
    if (c1 < c0) return;
    const start = row * MASK_N + c0, end = row * MASK_N + c1 + 1;
    if (onlyIf) {
      for (let i = start; i < end; i++) if (onlyIf(this.m[i])) this.m[i] = val;
    } else this.m.fill(val, start, end);
  }
  // rings: array of Float32Array in world coords; even-odd fill
  fillPolys(rings, val, onlyIf) {
    let y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 1; i < r.length; i += 2) { if (r[i] < y0) y0 = r[i]; if (r[i] > y1) y1 = r[i]; }
    let r0 = Math.max(0, Math.floor((y0 - this.oy) / MASK_M)), r1 = Math.min(MASK_N - 1, Math.ceil((y1 - this.oy) / MASK_M));
    for (let row = r0; row <= r1; row++) {
      const wy = this.oy + (row + 0.5) * MASK_M;
      let n = 0;
      for (const r of rings) {
        const k = r.length >> 1;
        for (let i = 0, j = k - 1; i < k; j = i++) {
          const ay = r[j * 2 + 1], by = r[i * 2 + 1];
          if ((ay > wy) !== (by > wy)) {
            const ax = r[j * 2], bx = r[i * 2];
            if (n < this.xs.length) this.xs[n++] = ax + (wy - ay) * (bx - ax) / (by - ay);
          }
        }
      }
      if (n < 2) continue;
      // Roads and ordinary building outlines intersect a row just twice.
      // Keep the two endpoints in order without creating a view or sorting it.
      const xs = this.xs;
      if (n === 2) {
        if (xs[1] < xs[0]) { const x = xs[0]; xs[0] = xs[1]; xs[1] = x; }
      } else xs.subarray(0, n).sort();
      for (let i = 0; i + 1 < n; i += 2) this.span(row, xs[i], xs[i + 1], val, onlyIf);
    }
  }
  // Each road segment is a clockwise convex strip. Trace each edge only for
  // the rows it actually crosses. Every covered row gets one endpoint per side.
  fillStrip(val, onlyIf) {
    const q = this.quad;
    let first = MASK_N, last = 0;
    for (let i = 0, j = 6; i < 8; j = i, i += 2) {
      const ax = q[j], ay = q[j+1], bx = q[i], by = q[i+1];
      if (ay === by) continue;
      const start = Math.max(0, Math.ceil((Math.min(ay, by) - this.oy) / MASK_M - 0.5));
      const end = Math.min(MASK_N, Math.ceil((Math.max(ay, by) - this.oy) / MASK_M - 0.5));
      const edge = by > ay ? this.left : this.right;
      for (let row = start; row < end; row++) {
        const wy = this.oy + (row + 0.5) * MASK_M;
        edge[row] = ax + (wy - ay) * (bx - ax) / (by - ay);
      }
      first = Math.min(first, start);
      last = Math.max(last, end);
    }
    for (let row = first; row < last; row++) this.span(row, this.left[row], this.right[row], val, onlyIf);
  }
  thickLine(pts, width, val, onlyIf) {
    const hw = Math.max(width / 2, MASK_M * 0.6);
    const quad = this.quad;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      if (L < 1e-4) continue;
      const nx = -dy / L * hw, ny = dx / L * hw;
      quad[0] = ax + nx; quad[1] = ay + ny; quad[2] = bx + nx; quad[3] = by + ny;
      quad[4] = bx - nx; quad[5] = by - ny; quad[6] = ax - nx; quad[7] = ay - ny;
      this.fillStrip(val, onlyIf);
      if (i > 0) this.disc(ax, ay, hw, val, onlyIf);
    }
    // caps
    this.disc(pts[0], pts[1], hw, val, onlyIf);
    this.disc(pts[pts.length - 2], pts[pts.length - 1], hw, val, onlyIf);
  }
  disc(x, y, r, val, onlyIf) {
    const r0 = Math.max(0, Math.floor((y - r - this.oy) / MASK_M)), r1 = Math.min(MASK_N - 1, Math.floor((y + r - this.oy) / MASK_M));
    for (let row = r0; row <= r1; row++) {
      const wy = this.oy + (row + 0.5) * MASK_M - y;
      const s = r * r - wy * wy;
      if (s < 0) continue;
      const hx = Math.sqrt(s);
      this.span(row, x - hx, x + hx, val, onlyIf);
    }
  }
}

// ------------------------------------------------------------ spatial buckets (CSR)
function buildBuckets(ox, oy, items, getBBox, pad = 0) {
  const lists = new Array(CELLS * CELLS);
  for (let i = 0; i < lists.length; i++) lists[i] = [];
  items.forEach((it, idx) => {
    const b = getBBox(it);
    if (!b) return;
    const c0 = Math.max(0, Math.floor((b[0] - pad - ox) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((b[2] + pad - ox) / CELL));
    const r0 = Math.max(0, Math.floor((b[1] - pad - oy) / CELL)), r1 = Math.min(CELLS - 1, Math.floor((b[3] + pad - oy) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * CELLS + c].push(idx);
  });
  const offs = new Int32Array(CELLS * CELLS + 1);
  let total = 0;
  for (let i = 0; i < lists.length; i++) { offs[i] = total; total += lists[i].length; }
  offs[lists.length] = total;
  const idxs = new Int32Array(total);
  let k = 0;
  for (const l of lists) for (const v of l) idxs[k++] = v;
  return { offs, idxs };
}

function hash2(x, y, s) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------ load
function isUrbanRoad(cls) { return cls >= 2 && cls <= 7 || cls === 12 || cls === 13 || cls === 14; }

async function loadRegion(base, rx, ry, opts) {
  const ox = rx * REGION, oy = ry * REGION;
  const [region, canopy, streets] = await Promise.all([
    opts.spillOnly ? null : fetchJsonGz(`${base}/r/${rx}_${ry}.json.gz`),
    opts.canopy ? fetchJsonGz(`${base}/canopy/${rx}_${ry}.json.gz`).catch(() => null) : null,
    streetData(base, rx, ry, opts.streetChunk),
  ]);
  if (!region && !opts.spillOnly) throw Error(`Missing region geometry: ${rx},${ry}`);
  const d = region || (streets ? { roads: [], areas: [], bld: [], lines: [] } : null);
  const out = { rx, ry, ox, oy, empty: !d };
  if (!d) return out;
  out.spillOnly = !!opts.spillOnly;
  // roads
  function decodeRoad(r, ownerX, ownerY, index, traits) {
    const pts = decLine(r[8]);
    const cls = r[0], flags = r[1], lanes = r[2];
    let len = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    const w = roadWidth(cls, lanes, flags);
    // Include painted stalls, verges and deck shadows in all tile/cell queries.
    const bb = bboxOf(pts, w / 2 + (flags & F.AISLE ? 5.2 : 3.6));
    const o = { cls, flags, lanes, layer: r[3], name: r[4], n0: r[5], n1: r[6], ms: r[7], pts, len, w, bb, ...traits };
    // The storage index includes a conservative 32 m border. Keep an identical
    // graph identity even for copies that only touch that conservative margin.
    if (ownerX !== rx || ownerY !== ry || bb[0] < ox + 32 || bb[1] < oy + 32 ||
        bb[2] >= ox + REGION - 32 || bb[3] >= oy + REGION - 32) {
      o.sharedId = `${ownerX},${ownerY},${index}`;
    }
    // raised roads (overpasses, bridges, ramps): per-vertex deck height in metres (tools/road_levels.py)
    if (r[9]) { const z = new Float32Array(r[9].length); let zm = 0; for (let i = 0; i < z.length; i++) { z[i] = r[9][i] / 10; if (z[i] > zm) zm = z[i]; } o.z = z; o.zmax = zm; }
    return o;
  }
  const roads = d.roads.map((r, i) => decodeRoad(r, rx, ry, i, streets?.local[i]));
  if (streets) for (const [sx, sy, i, row, traits] of streets.cross) {
    const road = decodeRoad(row, sx, sy, i, traits);
    const b = road.bb;
    if (b[2] >= ox && b[0] < ox + REGION && b[3] >= oy && b[1] < oy + REGION) roads.push(road);
  }
  if (streets?.walks) for (const [id, width, material, flags, encoded] of streets.walks) {
    const pts = decLine(encoded), w = width / 10;
    roads.push({ cls: 15, flags, lanes: 1, w, pts, bb: bboxOf(pts, w / 2 + 0.25),
      n0: 0, n1: 0, name: -1, layer: 0, material, sidewalk: true, sharedId: `walk/${id}` });
  }
  if (opts.spillOnly && !roads.length) return { ...out, empty: true };
  const blds = d.bld.map((b) => { const pts = decLine(b[3]); const o = { t: b[0], h: b[1], name: b[2], pts, bb: bboxOf(pts) }; if (b.length > 4) { o.roof = b[4]; o.eave = b[5] / 10; o.az = b[6]; o.rc = b[7] || null; o.wc = b[8] || null; } return o; });
  const areas = d.areas.map((a) => { const rings = a[1].map(decLine); return { k: a[0], rings, bb: bboxOf(rings[0]) }; });
  const lines = d.lines.map((l) => { const pts = decLine(l[3]); return { k: l[0], w: l[1], bridge: l[2], pts, bb: bboxOf(pts) }; });
  // ---------------- surface mask
  const R = new Raster(ox, oy);
  const byKind = new Map();
  for (const a of areas) { if (!byKind.has(a.k)) byKind.set(a.k, []); byKind.get(a.k).push(a); }
  for (const k of AREA_ORDER) {
    const list = byKind.get(k); if (!list) continue;
    const sv = AREA_SURF[k] ?? S.GROUND;
    for (const a of list) R.fillPolys(a.rings, sv);
  }
  // waterways
  for (const l of lines) {
    if (l.k === 2 || l.k === 4) R.thickLine(l.pts, l.w, S.WATER);
    else if (l.k === 3 || l.k === 5) R.thickLine(l.pts, Math.max(l.w, 2.5), S.CREEK, (v) => v !== S.WATER);
  }
  // sidewalks under urban roads (only where land is developed: lawn/lot/park etc.)
  const notWater = (v) => v !== S.WATER && v !== S.CREEK;
  const walkGround = v => v === S.LAWN || v === S.LOT || v === S.GROUND || v === S.PARK || v === S.PARKING;
  for (const r of roads) {
    if ((!isUrbanRoad(r.cls) && !r.sides) || (r.flags & (F_BRIDGE | F_TUNNEL))) continue;
    if (r.sides) {
      for (let side = 0; side < 2; side++) if (r.sides[side] === 1 || (r.sides[side] === null && isUrbanRoad(r.cls))) {
        R.thickLine(curbWalk(r, side ? 1 : -1), 1.8, S.WALK, walkGround);
      }
    } else R.thickLine(r.pts, r.w + 6, S.WALK, walkGround);
  }
  // runways
  for (const l of lines) if (l.k === 6 || l.k === 7) R.thickLine(l.pts, l.w, S.RUNWAY);
  // roads (non-bridge first, then bridges)
  for (const pass of [0, 1]) {
    for (const r of roads) {
      if (r.cls === 15) continue;
      const isBridge = !!(r.flags & F_BRIDGE);
      if ((pass === 1) !== isBridge) continue;
      if (r.flags & F_TUNNEL) continue;
      const v = isBridge ? S.BRIDGE : (r.flags & F_UNPAVED) ? S.DIRTROAD : S.ROAD;
      R.thickLine(r.pts, r.w, v);
    }
  }
  // Crossing a footpath leaves the underlying carriageway drivable.
  const pathGround = v => notWater(v) && v !== S.ROAD && v !== S.DIRTROAD && v !== S.BRIDGE && v !== S.RUNWAY;
  for (const r of roads) if (r.cls === 15 && !(r.flags & F_TUNNEL)) {
    R.thickLine(r.pts, r.sidewalk ? r.w : 2, (r.flags & F_BRIDGE) ? S.BRIDGE : S.WALK, (r.flags & F_BRIDGE) ? null : pathGround);
  }
  // rail
  for (const l of lines) if (l.k === 0 || l.k === 1) R.thickLine(l.pts, 3, l.bridge ? S.BRIDGE : S.RAIL, l.bridge ? null : (v) => v !== S.ROAD && v !== S.BRIDGE && v !== S.WATER);
  // buildings
  for (const b of blds) R.fillPolys([b.pts], S.BUILDING);
  const mask = R.m;
  // development density per 64 m cell: 0 rural, 1-2 suburban, 3 dense urban
  const dens = new Uint8Array(CELLS * CELLS);
  {
    const acc = new Float32Array(CELLS * CELLS);
    for (const b of blds) {
      const c = Math.min(CELLS - 1, Math.max(0, Math.floor(((b.bb[0] + b.bb[2]) / 2 - ox) / CELL)));
      const r = Math.min(CELLS - 1, Math.max(0, Math.floor(((b.bb[1] + b.bb[3]) / 2 - oy) / CELL)));
      const a = (b.bb[2] - b.bb[0]) * (b.bb[3] - b.bb[1]);
      acc[r * CELLS + c] += a;
    }
    for (const rd of roads) {
      if (rd.cls === 15 || rd.cls === 9 || rd.cls === 0 || rd.cls === 1) continue;
      // Allocate street area along the actual polyline. Charging a whole road to
      // its midpoint made long rural roads look like dense city blocks at seams.
      const p = rd.pts;
      for (let i = 2; i < p.length; i += 2) {
        const dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1];
        const len = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(len / (CELL / 2)));
        for (let j = 0; j < steps; j++) {
          const t = (j + 0.5) / steps;
          const c = Math.floor((p[i - 2] + dx * t - ox) / CELL);
          const r = Math.floor((p[i - 1] + dy * t - oy) / CELL);
          if (c >= 0 && c < CELLS && r >= 0 && r < CELLS) acc[r * CELLS + c] += len / steps * rd.w * 0.6;
        }
      }
    }
    for (let i = 0; i < acc.length; i++) {
      const f = acc[i] / (CELL * CELL);
      dens[i] = f > 0.42 ? 3 : f > 0.16 ? 2 : f > 0.05 ? 1 : 0;
    }
    // apply to mask: undeveloped ground inside developed cells becomes lawn / lot
    const pixelsPerCell = CELL / MASK_M;
    for (let cell = 0; cell < dens.length; cell++) {
      if (!dens[cell]) continue;
      const cover = dens[cell] >= 3 ? S.LOT : S.LAWN;
      let start = Math.floor(cell / CELLS) * pixelsPerCell * MASK_N + (cell % CELLS) * pixelsPerCell;
      for (let row = 0; row < pixelsPerCell; row++, start += MASK_N) {
        for (let i = start, end = start + pixelsPerCell; i < end; i++) if (mask[i] === S.GROUND) mask[i] = cover;
      }
    }
  }

  // ---------------- trees
  const trees = [];
  const tdens = opts.treeDensity ?? 1;
  const G = 9; // grid metres
  const n = REGION / G;
  const probs = new Float32Array(32);
  probs[S.FOREST] = 0.62; probs[S.PARK] = 0.26; probs[S.LAWN] = 0.08; probs[S.GROUND] = 0.025; probs[S.GOLF] = 0.09;
  probs[S.CEMETERY] = 0.12; probs[S.WETLAND] = 0.35; probs[S.FARM] = 0.002; probs[S.LOT] = 0.01; probs[S.DIRT] = 0.01;
  const at = (x, y) => {
    const cx = Math.floor((x - ox) / MASK_M), cy = Math.floor((y - oy) / MASK_M);
    if (cx < 0 || cy < 0 || cx >= MASK_N || cy >= MASK_N) return 255;
    return mask[cy * MASK_N + cx];
  };
  const blocked = (v) => v === S.ROAD || v === S.BUILDING || v === S.WATER || v === S.WALK || v === S.DIRTROAD || v === S.BRIDGE || v === S.PARKING || v === S.RAIL || v === S.RUNWAY || v === S.PITCH || v === S.POOL || v === 255;
  // Surveyed crowns carry a centre and a height. Species are inferred for the
  // sprites. Reject crowns where a newer footprint or road occupies the trunk.
  if (canopy) {
    const points = canopy[1];
    for (let i = 0; i < points.length; i += 3) {
      const x = ox + points[i] / 10, y = oy + points[i + 1] / 10;
      const surface = at(x, y), h = points[i + 2] / 10;
      if (surface !== S.PARKING && blocked(surface)) continue;
      const r = hash2(Math.round(x), Math.round(y), 4);
      const t = h < 7 ? (r < 0.16 ? 3 : 5)
        : h > 15 ? (r < 0.4 ? 2 : 1)
        : r < 0.12 ? 4 : r < 0.28 ? 1 : 0;
      const modelHeight = [10.5, 13.65, 19.5, 6, 7.7, 6.65][t];
      const scale = Math.max(0.55, Math.min(1.65, h / modelHeight));
      trees.push(x, y, t, scale, r * Math.PI * 2);
    }
  }
  // Along the survey edge, keep procedural foliage on the unsurveyed side.
  const edge = canopy?.[0];
  for (let j = 0; !opts.spillOnly && (!canopy || edge.length) && j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = rx * n + i, gy = ry * n + j;
      const x = ox + (i + 0.15 + hash2(gx, gy, 1) * 0.7) * G;
      const y = oy + (j + 0.15 + hash2(gx, gy, 2) * 0.7) * G;
      if (edge && pointInPoly(x, y, edge)) continue;
      const v = at(x, y);
      let p = probs[v] || 0;
      if (v === S.GROUND || v === S.FARM) {
        // creeks attract trees (Oklahoma cross-timbers along drainages)
        if (at(x + 6, y) === S.CREEK || at(x - 6, y) === S.CREEK || at(x, y + 6) === S.CREEK || at(x, y - 6) === S.CREEK || at(x + 12, y) === S.CREEK || at(x, y + 12) === S.CREEK) p = 0.55;
      }
      if (p <= 0) continue;
      if (hash2(gx, gy, 3) > p * tdens) continue;
      // clearance
      if (blocked(at(x + 3, y)) || blocked(at(x - 3, y)) || blocked(at(x, y + 3)) || blocked(at(x, y - 3)) || blocked(v)) continue;
      if (v === S.LAWN && (at(x + 5, y) === S.BUILDING || at(x - 5, y) === S.BUILDING || at(x, y + 5) === S.BUILDING || at(x, y - 5) === S.BUILDING)) continue;
      const r = hash2(gx, gy, 4);
      // tree type code: 0 oak,1 elm,2 cottonwood,3 redbud,4 cedar,5 post oak,6 pine,7 bush,8 dead
      let t;
      if (v === S.FOREST) t = r < 0.35 ? 5 : r < 0.6 ? 4 : r < 0.8 ? 0 : r < 0.9 ? 1 : 7;
      else if (v === S.LAWN) t = r < 0.3 ? 0 : r < 0.5 ? 3 : r < 0.65 ? 1 : r < 0.75 ? 6 : 7;
      else if (v === S.PARK || v === S.GOLF || v === S.CEMETERY) t = r < 0.35 ? 0 : r < 0.5 ? 1 : r < 0.62 ? 3 : r < 0.75 ? 2 : r < 0.85 ? 6 : 7;
      else if (v === S.WETLAND) t = r < 0.6 ? 2 : 8;
      else t = r < 0.4 ? 4 : r < 0.65 ? 5 : r < 0.85 ? 2 : r < 0.95 ? 7 : 8;
      trees.push(x, y, t, 0.8 + hash2(gx, gy, 5) * 0.45, hash2(gx, gy, 6) * Math.PI * 2);
    }
  }
  const treeArr = new Float32Array(trees);

  // ---------------- buckets
  const bRoads = buildBuckets(ox, oy, roads, (r) => r.bb);
  // Car and pedestrian physics check deck height every step. Most road cells
  // have no raised geometry, so keep those checks away from ordinary streets.
  const bDecks = buildBuckets(ox, oy, roads, (r) => r.zmax >= 0.05 ? r.bb : null);
  const bBld = buildBuckets(ox, oy, blds, (b) => b.bb, 0);
  const bAreas = buildBuckets(ox, oy, areas, (a) => a.bb, 0);
  const bLines = buildBuckets(ox, oy, lines, (l) => l.bb, 30);
  const nt = treeArr.length / 5;
  const tLists = Array.from({ length: CELLS * CELLS }, () => []);
  for (let i = 0; i < nt; i++) {
    const c = Math.min(CELLS - 1, Math.max(0, Math.floor((treeArr[i * 5] - ox) / CELL)));
    const r = Math.min(CELLS - 1, Math.max(0, Math.floor((treeArr[i * 5 + 1] - oy) / CELL)));
    tLists[r * CELLS + c].push(i);
  }
  const tOffs = new Int32Array(CELLS * CELLS + 1); let tt = 0;
  for (let i = 0; i < tLists.length; i++) { tOffs[i] = tt; tt += tLists[i].length; }
  tOffs[tLists.length] = tt;
  const tIdx = new Int32Array(tt); let k = 0; for (const l of tLists) for (const v of l) tIdx[k++] = v;

  Object.assign(out, { roads, blds, areas, lines, mask, dens, trees: treeArr, buckets: { roads: bRoads, decks: bDecks, blds: bBld, areas: bAreas, lines: bLines, trees: { offs: tOffs, idxs: tIdx } } });
  return out;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      const r = await loadRegion(msg.base, msg.rx, msg.ry, msg.opts || {});
      const transfer = [];
      if (!r.empty) {
        transfer.push(r.mask.buffer, r.trees.buffer, r.dens.buffer);
        for (const bucket of Object.values(r.buckets)) transfer.push(bucket.offs.buffer, bucket.idxs.buffer);
      }
      self.postMessage({ type: 'region', id: msg.id, region: r }, transfer);
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, rx: msg.rx, ry: msg.ry, error: String(err && err.stack || err) });
    }
  }
};
