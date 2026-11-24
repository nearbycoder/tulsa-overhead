// World manager: streams regions via the worker, keeps the drivable road graph,
// answers spatial queries (surface, buildings, roads), collisions and raycasts.
import { REGION, MASK_M, MASK_N, CELL, CELLS, S, F, RC, CLASS_SPEED, roadWidth } from './shared.js';
import { pointInPoly, closestOnSeg, segIntersect } from '../engine/math.js';

const tmp3 = [0, 0, 0];

export class World {
  constructor(base = 'assets/map') {
    this.base = base;
    this.buildingOverhangs = new Map(); // target region -> cells touched by neighbouring footprints
    this.sharedRoads = new Map(); // boundary edges keep one identity while any touching region is loaded
    this.regions = new Map();     // key -> region
    this.regionRevision = 0;
    this.pending = new Map();     // key -> promise
    this.retryAfter = new Map();  // failed requests remain eligible while the region is wanted
    this.nodes = new Map();       // node id -> {id, x, y, edges: [{road, dir}]}
    this.stamp = 1;
    this.loadRadius = 1;
    this.listeners = { load: [], unload: [] };
    this.msgId = 1;
    this.waiters = new Map();
    this.treeDensity = 1;
  }

  async init() {
    const [meta, canopy, streets] = await Promise.all([
      fetch(`${this.base}/meta.json`).then(r => r.json()),
      fetch(`${this.base}/canopy/index.json`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${this.base}/streets/index.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    this.meta = meta;
    this.canopyRegions = new Set(canopy?.regions.map(([x, y]) => this.key(x, y)));
    this.streetRegions = new Set(streets?.regions.map(([x, y]) => this.key(x, y)));
    this.streetChunk = streets?.chunk;
    this.names = this.meta.names;
    this.exists = new Set(this.meta.regions.map((r) => `${r[0]},${r[1]}`));
    const toF = (poly) => { const a = new Float32Array(poly.length * 2); poly.forEach((p, i) => { a[i * 2] = p[0]; a[i * 2 + 1] = p[1]; }); return a; };
    this.cities = this.meta.cities.map((c) => ({ name: c.n, area: c.a, polys: c.poly.map(toF), bb: bbOfPolys(c.poly) }));
    this.counties = this.meta.counties.map((c) => ({ name: c.n, polys: c.poly.map(toF), bb: bbOfPolys(c.poly) }));
    this.worldPolys = this.meta.world.map(toF);
    this.pois = this.meta.pois;
    this.places = this.meta.places;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
  }

  on(ev, fn) {
    this.listeners[ev].push(fn);
    return () => { this.listeners[ev] = this.listeners[ev].filter(listener => listener !== fn); };
  }
  key(rx, ry) { return `${rx},${ry}`; }

  onWorker(msg) {
    const w = this.waiters.get(msg.id);
    if (!w) return;
    this.waiters.delete(msg.id);
    if (msg.type === 'error') { console.error('region load error', msg.rx, msg.ry, msg.error); w.resolve(null); return; }
    w.resolve(msg.region);
  }

  requestRegion(rx, ry) {
    const k = this.key(rx, ry);
    if (this.regions.has(k)) return Promise.resolve(this.regions.get(k));
    if (this.pending.has(k)) return this.pending.get(k);
    if (performance.now() < (this.retryAfter.get(k) || 0)) return Promise.resolve(null);
    if (!this.exists.has(k) && !this.streetRegions.has(k)) {
      const empty = { rx, ry, ox: rx * REGION, oy: ry * REGION, empty: true };
      this.addRegion(k, empty);
      return Promise.resolve(empty);
    }
    const id = this.msgId++;
    const p = new Promise((resolve) => this.waiters.set(id, { resolve }))
      .then((r) => {
        this.pending.delete(k);
        if (!r) {
          const retry = performance.now() + 2000;
          this.retryAfter.set(k, retry);
          if (this.streamWindow) this.streamWindow.retry = Math.min(this.streamWindow.retry, retry);
          return null;
        }
        this.retryAfter.delete(k);
        if (!this.wanted || this.wanted.has(k)) this.addRegion(k, r);
        return r;
      });
    this.pending.set(k, p);
    this.worker.postMessage({ type: 'load', id, base: new URL(this.base, location.href).href, rx, ry, opts: {
      treeDensity: this.treeDensity, canopy: this.canopyRegions.has(k),
      streetChunk: this.streetRegions.has(k) ? this.streetChunk : 0, spillOnly: !this.exists.has(k),
    } });
    return p;
  }

  addRegion(k, r) {
    r.key = k;
    r.overhangs = this.buildingOverhangs.get(k);
    if (!r.empty) {
      for (let i = 0; i < r.roads.length; i++) {
        const road = r.roads[i];
        if (road.sharedId) {
          const existing = this.sharedRoads.get(road.sharedId);
          if (existing) {
            existing.regions++;
            r.roads[i] = existing.road;
            continue;
          }
          this.sharedRoads.set(road.sharedId, { road, regions: 1 });
        }
        road.speed = road.ms > 0 ? road.ms * 0.447 : CLASS_SPEED[road.cls];
        if (road.cls === RC.PATH || road.n0 === 0) continue;
        this.linkNode(road.n0, road.pts[0], road.pts[1], road, 1);
        const n = road.pts.length;
        this.linkNode(road.n1, road.pts[n - 2], road.pts[n - 1], road, -1);
      }
      for (const b of r.blds) {
        b.region = r;
        if (b.bb[0] < r.ox || b.bb[1] < r.oy || b.bb[2] >= r.ox + REGION || b.bb[3] >= r.oy + REGION) this.indexOverhang(b);
      }
    }
    this.regions.set(k, r);
    this.regionRevision++;
    for (const fn of this.listeners.load) fn(r);
  }

  // A footprint lives in its centroid region on disk. Index the rest of the
  // polygon for rendering and collision when only the adjacent block is queried.
  indexOverhang(b) {
    const owner = b.region;
    for (let ry = Math.floor(b.bb[1] / REGION); ry <= Math.floor(b.bb[3] / REGION); ry++) {
      for (let rx = Math.floor(b.bb[0] / REGION); rx <= Math.floor(b.bb[2] / REGION); rx++) {
        if (rx === owner.rx && ry === owner.ry) continue;
        const key = this.key(rx, ry);
        let cells = this.buildingOverhangs.get(key);
        if (!cells) {
          cells = new Map();
          this.buildingOverhangs.set(key, cells);
          const target = this.regions.get(key);
          if (target) target.overhangs = cells;
        }
        const x0 = Math.max(0, Math.floor(b.bb[0] / CELL) - rx * CELLS);
        const x1 = Math.min(CELLS - 1, Math.floor(b.bb[2] / CELL) - rx * CELLS);
        const y0 = Math.max(0, Math.floor(b.bb[1] / CELL) - ry * CELLS);
        const y1 = Math.min(CELLS - 1, Math.floor(b.bb[3] / CELL) - ry * CELLS);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const id = y * CELLS + x;
          if (!cells.has(id)) cells.set(id, new Set());
          cells.get(id).add(b);
          (owner.overhangEntries ??= []).push({ key, id, b });
        }
      }
    }
  }

  linkNode(id, x, y, road, dir) {
    let n = this.nodes.get(id);
    if (!n) { n = { id, x, y, edges: [] }; this.nodes.set(id, n); }
    n.edges.push({ road, dir });
    if (dir === 1) road.node0 = n; else road.node1 = n;
  }

  removeRegion(k) {
    const r = this.regions.get(k);
    if (!r) return;
    this.regions.delete(k);
    this.regionRevision++;
    this.streamWindow = null;
    for (const { key, id, b } of r.overhangEntries || []) {
      const cells = this.buildingOverhangs.get(key);
      const buildings = cells.get(id);
      buildings.delete(b);
      if (!buildings.size) cells.delete(id);
      if (!cells.size) {
        this.buildingOverhangs.delete(key);
        const target = this.regions.get(key);
        if (target) target.overhangs = null;
      }
    }
    if (!r.empty) {
      for (const road of r.roads) {
        if (road.sharedId) {
          const shared = this.sharedRoads.get(road.sharedId);
          if (--shared.regions) continue;
          this.sharedRoads.delete(road.sharedId);
        }
        if (road.cls === RC.PATH || road.n0 === 0) continue;
        for (const id of [road.n0, road.n1]) {
          const n = this.nodes.get(id);
          if (!n) continue;
          n.edges = n.edges.filter((e) => e.road !== road);
          if (n.edges.length === 0) this.nodes.delete(id);
        }
        road.dead = true;
      }
    }
    for (const fn of this.listeners.unload) fn(r);
  }

  // Keep a (2R+1)^2 block of regions around (x, y) loaded. Returns a promise resolving when the centre block is ready.
  update(x, y, radius = this.loadRadius) {
    const cx = Math.floor(x / REGION), cy = Math.floor(y / REGION);
    const fx = (x - cx * REGION) / REGION, fy = (y - cy * REGION) / REGION;
    const px = fx < 0.25 ? -1 : fx > 0.75 ? 1 : 0, py = fy < 0.25 ? -1 : fy > 0.75 ? 1 : 0;
    const active = this.streamWindow;
    if (active && cx === active.cx && cy === active.cy && radius === active.radius &&
        px === active.px && py === active.py && performance.now() < active.retry) return active.ready;
    // The set of required regions only changes at region edges and prefetch thresholds.
    const want = new Set();
    const promises = [];
    let retry = Infinity;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) want.add(this.key(cx + dx, cy + dy));
    if (px) for (let dy = -radius; dy <= radius; dy++) want.add(this.key(cx + px * (radius + 1), cy + dy));
    if (py) for (let dx = -radius; dx <= radius; dx++) want.add(this.key(cx + dx, cy + py * (radius + 1)));
    if (px && py) want.add(this.key(cx + px * (radius + 1), cy + py * (radius + 1)));
    this.wanted = new Set(want);
    // keep anything within radius+1 to avoid thrash
    for (let dy = -radius - 1; dy <= radius + 1; dy++) for (let dx = -radius - 1; dx <= radius + 1; dx++) this.wanted.add(this.key(cx + dx, cy + dy));
    for (const k of want) {
      const [rx, ry] = k.split(',').map(Number);
      const p = this.requestRegion(rx, ry);
      if (!this.pending.has(k) && this.retryAfter.has(k)) retry = Math.min(retry, this.retryAfter.get(k));
      if (Math.abs(rx - cx) <= radius && Math.abs(ry - cy) <= radius) promises.push(p);
    }
    for (const k of [...this.regions.keys()]) if (!this.wanted.has(k)) this.removeRegion(k);
    const ready = Promise.all(promises);
    this.streamWindow = { cx, cy, radius, px, py, ready, retry };
    return ready;
  }

  isLoadedAt(x, y) { const r = this.regionAt(x, y); return !!r; }

  regionAt(x, y) {
    return this.regions.get(this.key(Math.floor(x / REGION), Math.floor(y / REGION)));
  }

  surfaceAt(x, y) {
    const r = this.regionAt(x, y);
    if (!r) return -1;
    if (r.overhangs && this.inOverhang(r, x, y)) return S.BUILDING;
    if (r.empty) return this.inWorld(x, y) ? S.GROUND : -2;
    const cx = Math.floor((x - r.ox) / MASK_M), cy = Math.floor((y - r.oy) / MASK_M);
    const value = r.mask[cy * MASK_N + cx];
    if (r.spillOnly && value === S.GROUND && !this.inWorld(x, y)) return -2;
    return value;
  }

  inOverhang(r, x, y) {
    const cell = Math.floor((y - r.oy) / CELL) * CELLS + Math.floor((x - r.ox) / CELL);
    const buildings = r.overhangs.get(cell);
    if (buildings) for (const b of buildings) if (pointInPoly(x, y, b.pts)) return true;
    return false;
  }

  densityAt(x, y) {
    const r = this.regionAt(x, y);
    if (!r || r.empty) return 0;
    const cx = Math.floor((x - r.ox) / CELL), cy = Math.floor((y - r.oy) / CELL);
    return r.dens[cy * CELLS + cx];
  }

  inWorld(x, y) {
    for (const p of this.worldPolys) if (pointInPoly(x, y, p)) return true;
    return false;
  }

  // Iterate roads, raised decks, buildings, areas or lines touching a rect, once each.
  forEachInRect(type, x0, y0, x1, y1, fn) {
    const st = ++this.stamp;
    const rx0 = Math.floor(x0 / REGION), rx1 = Math.floor(x1 / REGION);
    const ry0 = Math.floor(y0 / REGION), ry1 = Math.floor(y1 / REGION);
    for (let ry = ry0; ry <= ry1; ry++) for (let rx = rx0; rx <= rx1; rx++) {
      const r = this.regions.get(this.key(rx, ry));
      const spills = type === 'blds' && r?.overhangs;
      if (!r || (r.empty && !spills)) continue;
      const items = type === 'decks' ? r.roads : r[type];
      const bk = r.buckets?.[type];
      const c0 = Math.max(0, Math.floor((x0 - r.ox) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((x1 - r.ox) / CELL));
      const r0 = Math.max(0, Math.floor((y0 - r.oy) / CELL)), r1 = Math.min(CELLS - 1, Math.floor((y1 - r.oy) / CELL));
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
        const cell = row * CELLS + col;
        const crossing = spills && spills.get(cell);
        if (crossing) for (const it of crossing) {
          if (it._s === st) continue;
          it._s = st;
          const b = it.bb;
          if (b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1 && fn(it, it.region) === false) return;
        }
        if (!bk) continue;
        for (let i = bk.offs[cell]; i < bk.offs[cell + 1]; i++) {
          const it = items[bk.idxs[i]];
          if (it._s === st) continue;
          it._s = st;
          const b = it.bb;
          if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
          if (fn(it, r) === false) return;
        }
      }
    }
  }

  // trees: fn(x, y, type, scale, rot)
  forEachTree(x0, y0, x1, y1, fn) {
    const rx0 = Math.floor(x0 / REGION), rx1 = Math.floor(x1 / REGION);
    const ry0 = Math.floor(y0 / REGION), ry1 = Math.floor(y1 / REGION);
    for (let ry = ry0; ry <= ry1; ry++) for (let rx = rx0; rx <= rx1; rx++) {
      const r = this.regions.get(this.key(rx, ry));
      if (!r || r.empty) continue;
      const T = r.trees, bk = r.buckets.trees;
      const c0 = Math.max(0, Math.floor((x0 - r.ox) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((x1 - r.ox) / CELL));
      const r0 = Math.max(0, Math.floor((y0 - r.oy) / CELL)), r1 = Math.min(CELLS - 1, Math.floor((y1 - r.oy) / CELL));
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
        const cell = row * CELLS + col;
        for (let i = bk.offs[cell]; i < bk.offs[cell + 1]; i++) {
          const k = bk.idxs[i] * 5;
          const x = T[k], y = T[k + 1];
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (r.overhangs && this.inOverhang(r, x, y)) continue;
          fn(x, y, T[k + 2], T[k + 3], T[k + 4], r, bk.idxs[i]);
        }
      }
    }
  }

  // nearest drivable road to (x,y)
  // Raised road surface (overpass, bridge deck, ramp) under (x, y) whose height is within maxDz of zHint.
  // Returns {z, road, lat, hw, dx, dy} (lat = signed sideways offset from the centre line, (dx, dy) = road direction) or null.
  deckAt(x, y, zHint = 0, maxDz = 2.5, pad = 0.6, out = null) {
    let best = null, bScore = Infinity;
    this.forEachInRect('decks', x - 30, y - 30, x + 30, y + 30, (road) => {
      if (!road.z || road.zmax < 0.05 || road.dead) return;
      const p = road.pts, z = road.z, hw = road.w / 2;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
        if (L2 < 1e-6) continue;
        let t = ((x - ax) * ex + (y - ay) * ey) / L2;
        if (t < -0.02 || t > 1.02) continue;
        t = Math.max(0, Math.min(1, t));
        const L = Math.sqrt(L2), lat = ((x - ax) * -ey + (y - ay) * ex) / L;
        if (Math.abs(lat) > hw + pad) continue;
        const zz = z[i >> 1] + (z[(i >> 1) + 1] - z[i >> 1]) * t;
        const dz = Math.abs(zz - zHint);
        if (dz > maxDz) continue;
        const score = dz + Math.max(0, Math.abs(lat) - hw) * 2;
        if (score < bScore) { bScore = score; best = out || {}; best.z = zz; best.road = road; best.lat = lat; best.hw = hw; best.dx = ex / L; best.dy = ey / L; }
      }
    });
    return best;
  }

  nearestRoad(x, y, maxD = 60, filter = null) {
    let best = null, bd = maxD * maxD;
    this.forEachInRect('roads', x - maxD, y - maxD, x + maxD, y + maxD, (road) => {
      if (road.cls === RC.PATH) return;
      if (filter && !filter(road)) return;
      const p = road.pts;
      let acc = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        closestOnSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3], tmp3);
        const segL = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        const d = (tmp3[0] - x) ** 2 + (tmp3[1] - y) ** 2;
        if (d < bd) { bd = d; best = { road, seg: i >> 1, t: tmp3[2], s: acc + tmp3[2] * segL, x: tmp3[0], y: tmp3[1], dist: Math.sqrt(d) }; }
        acc += segL;
      }
    });
    return best;
  }

  // A venue pin can be in the center of an arena. Recognize arrival along
  // the outside wall of its own footprint, including the far side of the block.
  atDestinationBuilding(x, y, tx, ty, reach) {
    let arrived = false;
    this.forEachInRect('blds', x-reach, y-reach, x+reach, y+reach, b => {
      const [left,top,right,bottom] = b.bb, p = b.pts;
      if (tx < left || ty < top || tx > right || ty > bottom || !pointInPoly(tx,ty,p)) return;
      if (pointInPoly(x,y,p)) { arrived = true; return false; }
      for (let i = 0, last = p.length - 2; i < p.length; last = i, i += 2) {
        closestOnSeg(x,y,p[last],p[last+1],p[i],p[i+1],tmp3);
        if ((tmp3[0]-x)**2 + (tmp3[1]-y)**2 <= reach*reach) { arrived = true; return false; }
      }
    });
    return arrived;
  }

  // Reuse known clearance on open streets. The distance to a footprint can
  // shrink by at most the distance the actor has moved since the last query.
  // Near a wall we always use the original ordered polygon contact solver.
  mayTouchBuilding(actor, radius) {
    const { x, y } = actor;
    const area = actor._wallArea || (actor._wallArea = {});
    if (area.revision === this.regionRevision && area.radius === radius) {
      const dx = x - area.x, dy = y - area.y;
      if (dx * dx + dy * dy <= area.travelSquared) return area.nearWall;
    }
    const scan = radius + 8;
    let distanceSquared = scan * scan;
    this.forEachInRect('blds', x - scan, y - scan, x + scan, y + scan, b => {
      const [left, top, right, bottom] = b.bb;
      const dx = Math.max(left - x, 0, x - right), dy = Math.max(top - y, 0, y - bottom);
      if (dx * dx + dy * dy >= distanceSquared) return;
      const pts = b.pts;
      if (dx === 0 && dy === 0 && pointInPoly(x, y, pts)) distanceSquared = 0;
      else for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        closestOnSeg(x, y, pts[j], pts[j + 1], pts[i], pts[i + 1], tmp3);
        distanceSquared = Math.min(distanceSquared, (tmp3[0] - x) ** 2 + (tmp3[1] - y) ** 2);
      }
      if (distanceSquared <= radius * radius) return false;
    });
    const clearance = Math.sqrt(distanceSquared) - radius - 0.001;
    area.revision = this.regionRevision; area.x = x; area.y = y; area.radius = radius;
    // In close quarters, favor the exact solver for the next metre of travel.
    area.nearWall = clearance < 1;
    area.travelSquared = area.nearWall ? 1 : clearance * clearance;
    return area.nearWall;
  }

  // Push a circle out of buildings. Returns {nx, ny, depth} of deepest contact or null; mutates pos via out.
  collideCircle(x, y, r, out) {
    let px = x, py = y, hit = null;
    this.forEachInRect('blds', x - r - 1, y - r - 1, x + r + 1, y + r + 1, (b) => {
      const p = b.pts, n = p.length >> 1;
      // closest edge point
      let bd = Infinity, bx = 0, by = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        closestOnSeg(px, py, p[j * 2], p[j * 2 + 1], p[i * 2], p[i * 2 + 1], tmp3);
        const d = (tmp3[0] - px) ** 2 + (tmp3[1] - py) ** 2;
        if (d < bd) { bd = d; bx = tmp3[0]; by = tmp3[1]; }
      }
      const inside = pointInPoly(px, py, p);
      const d = Math.sqrt(bd);
      if (!inside && d >= r) return;
      let nx, ny;
      if (d < 1e-6) { nx = 1; ny = 0; } else { nx = (px - bx) / d; ny = (py - by) / d; }
      if (inside) { nx = -nx; ny = -ny; }
      const depth = inside ? d + r : r - d;
      px += nx * depth; py += ny * depth;
      if (!hit || depth > hit.depth) hit = { nx, ny, depth, b };
    });
    if (out) { out[0] = px; out[1] = py; }
    return hit;
  }

  // Raycast against building walls. Returns {t, x, y, nx, ny, b} for first hit or null.
  raycastBuildings(x0, y0, x1, y1) {
    let best = null, bt = 1;
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    this.forEachInRect('blds', minx, miny, maxx, maxy, (b) => {
      const p = b.pts, n = p.length >> 1;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const t = segIntersect(x0, y0, x1, y1, p[j * 2], p[j * 2 + 1], p[i * 2], p[i * 2 + 1]);
        if (t >= 0 && t < bt) {
          bt = t;
          const ex = p[i * 2] - p[j * 2], ey = p[i * 2 + 1] - p[j * 2 + 1];
          const L = Math.hypot(ex, ey) || 1;
          let nx = -ey / L, ny = ex / L;
          if (nx * (x1 - x0) + ny * (y1 - y0) > 0) { nx = -nx; ny = -ny; }
          best = { t, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny, b };
        }
      }
    });
    return best;
  }

  lineOfSight(x0, y0, x1, y1) { return !this.raycastBuildings(x0, y0, x1, y1); }

  cityAt(x, y) {
    for (const c of this.cities) {
      if (x < c.bb[0] || x > c.bb[2] || y < c.bb[1] || y > c.bb[3]) continue;
      for (const p of c.polys) if (pointInPoly(x, y, p)) return c.name;
    }
    return null;
  }
  countyAt(x, y) {
    for (const c of this.counties) {
      if (x < c.bb[0] || x > c.bb[2] || y < c.bb[1] || y > c.bb[3]) continue;
      for (const p of c.polys) if (pointInPoly(x, y, p)) return c.name;
    }
    return null;
  }

  roadName(road) { return road && road.name >= 0 ? this.names[road.name] : ''; }

  // lat/lon -> world metres
  project(lat, lon) {
    const o = this.meta.origin;
    return [(lon - o.lon) * o.kx, -(lat - o.lat) * o.ky];
  }
  unproject(x, y) {
    const o = this.meta.origin;
    return [o.lat - y / o.ky, o.lon + x / o.kx];
  }

  findPoi(pred) { return this.pois.find(pred); }
}

function bbOfPolys(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

export { S, RC, F, roadWidth };
