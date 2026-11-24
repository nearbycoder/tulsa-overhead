// Offline road geometry and directed junction graph. Decoding and A* run in a worker.
import { F, RC } from '../world/shared.js';
import { Heap, roadCost } from './route-cost.js';

const CELL = 256;
const key = (x, y) => x * 65536 + y;

// Weak connectivity is sufficient to reject a disconnected pair before A*
// searches a whole county. Direction-dependent reachability stays with A*.
function roadComponents(ends, nodes) {
  const root = Int32Array.from({ length: nodes }, (_, i) => i);
  function find(n) {
    while (n !== root[n]) {
      root[n] = root[root[n]];
      n = root[n];
    }
    return n;
  }
  for (let i = 0; i < ends.length; i += 2) root[find(ends[i])] = find(ends[i + 1]);
  for (let n = 0; n < nodes; n++) root[n] = find(n);
  return root;
}

export class RouteGraph {
  constructor(buffer, mode = 'road') {
    this.walking = mode === 'walk';
    const header = new DataView(buffer);
    if (header.getUint32(0) !== 0x47505331) throw Error('Unknown GPS format');
    const nodes = header.getUint32(4, true),
      edges = header.getUint32(8, true);
    const pointCount = header.getUint32(12, true);
    let byte = 16;
    const take = (n) => {
      const view = new Int32Array(buffer, byte, n);
      byte += n * 4;
      return view;
    };
    this.ends = take(edges * 2);
    this.offset = take(edges + 1);
    this.names = take(edges);
    this.kind = take(edges);
    this.xy = take(pointCount * 2);
    if (byte !== buffer.byteLength || this.offset[edges] !== pointCount) throw Error('Incomplete GPS graph');

    this.cells = new Map();
    this.length = new Float32Array(edges);
    this.weight = new Float32Array(edges);
    this.along = new Float32Array(pointCount);
    this.nodeXY = new Float32Array(nodes * 2);
    this.adj = new Uint32Array(nodes + 1);
    for (let e = 0; e < edges; e++) {
      const start = this.offset[e],
        end = this.offset[e + 1];
      let px = 0,
        py = 0,
        length = 0;
      const cells = new Set();
      for (let i = start; i < end; i++) {
        const x = (this.xy[i * 2] += px),
          y = (this.xy[i * 2 + 1] += py);
        if (i > start) {
          length += Math.hypot(x - px, y - py) / 10;
          for (
            let cy = Math.floor(Math.min(y, py) / (CELL * 10));
            cy <= Math.floor(Math.max(y, py) / (CELL * 10));
            cy++
          ) {
            for (
              let cx = Math.floor(Math.min(x, px) / (CELL * 10));
              cx <= Math.floor(Math.max(x, px) / (CELL * 10));
              cx++
            )
              cells.add(key(cx, cy));
          }
        }
        this.along[i] = length;
        px = x;
        py = y;
      }
      for (const cell of cells) {
        if (!this.cells.has(cell)) this.cells.set(cell, []);
        this.cells.get(cell).push(e);
      }
      this.length[e] = length;
      const cls = this.kind[e] & 255;
      this.weight[e] = this.walking ? walkingCost(cls) : roadCost(cls, this.kind[e] >> 8);
      const a = this.ends[e * 2],
        b = this.ends[e * 2 + 1];
      this.nodeXY[a * 2] = this.xy[start * 2] / 10;
      this.nodeXY[a * 2 + 1] = this.xy[start * 2 + 1] / 10;
      this.nodeXY[b * 2] = px / 10;
      this.nodeXY[b * 2 + 1] = py / 10;
      this.adj[a + 1]++;
      if (!this.oneWay(e)) this.adj[b + 1]++;
    }
    for (let i = 0; i < nodes; i++) this.adj[i + 1] += this.adj[i];
    this.arcs = new Int32Array(this.adj[nodes]);
    this.component = roadComponents(this.ends, nodes);
    const cursor = this.adj.slice();
    for (let e = 0; e < edges; e++) {
      this.arcs[cursor[this.ends[e * 2]]++] = e + 1;
      if (!this.oneWay(e)) this.arcs[cursor[this.ends[e * 2 + 1]]++] = -(e + 1);
    }
  }

  oneWay(e) {
    return !!((this.kind[e] >> 8) & F.ONEWAY);
  }

  snap(x, y, radius, heading) {
    const seen = new Set(),
      candidates = [];
    for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) {
      for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
        const roads = this.cells.get(key(cx, cy));
        if (!roads) continue;
        for (const e of roads) {
          if (seen.has(e)) continue;
          seen.add(e);
          let closest = null;
          for (let i = this.offset[e]; i + 1 < this.offset[e + 1]; i++) {
            const ax = this.xy[2 * i] / 10,
              ay = this.xy[2 * i + 1] / 10;
            const dx = this.xy[2 * i + 2] / 10 - ax,
              dy = this.xy[2 * i + 3] / 10 - ay;
            const len = Math.hypot(dx, dy);
            if (len < 0.01) continue;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
            const px = ax + t * dx,
              py = ay + t * dy,
              distance = Math.hypot(px - x, py - y);
            if (distance > radius || (closest && closest.distance <= distance)) continue;
            let score = distance;
            if (heading != null && this.oneWay(e))
              score += 5 * (1 - (Math.cos(heading) * dx + Math.sin(heading) * dy) / len);
            closest = { e, x: px, y: py, s: this.along[i] + len * t, distance, score };
          }
          if (closest) candidates.push(closest);
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.filter((c) => c.score <= candidates[0].score + 20).slice(0, 3);
  }

  solve(sx, sy, tx, ty, heading) {
    const nearby = (x, y, h) => {
      const close = this.snap(x, y, 65, h);
      return close.length ? close : this.snap(x, y, 500, h);
    };
    const starts = nearby(sx, sy, heading),
      goals = nearby(tx, ty, null);
    // Try exact carriageways first. Consider another nearby access road only
    // if the nearest pair is disconnected (common for parking and service ways).
    for (const a of starts)
      for (const b of goals) {
        const legs = this.search(a, b);
        if (legs) return this.polyline(legs, sx, sy, tx, ty);
      }
    return null;
  }

  search(a, b) {
    if (this.component[this.ends[a.e * 2]] !== this.component[this.ends[b.e * 2]]) return null;
    const leg = (e, from, to) => ({ e, from, to });
    let directCost = Infinity;
    if (a.e === b.e && (a.s <= b.s || !this.oneWay(a.e))) directCost = Math.abs(a.s - b.s) * this.weight[a.e];
    const dist = new Float64Array(this.adj.length - 1).fill(Infinity);
    const via = new Int32Array(dist.length);
    const closed = new Uint8Array(dist.length);
    const open = new Heap();
    const minCost = this.walking ? 1 : 0.55;
    const heuristic = (n) => Math.hypot(this.nodeXY[n * 2] - b.x, this.nodeXY[n * 2 + 1] - b.y) * minCost;
    const startEnd = new Map();
    const seed = (n, cost, endS) => {
      if (cost >= dist[n]) return;
      dist[n] = cost;
      startEnd.set(n, endS);
      open.push(n, cost + heuristic(n));
    };
    seed(this.ends[a.e * 2 + 1], (this.length[a.e] - a.s) * this.weight[a.e], this.length[a.e]);
    if (!this.oneWay(a.e) || a.s < 0.05) seed(this.ends[a.e * 2], a.s * this.weight[a.e], 0);
    const finish = new Map([[this.ends[b.e * 2], { from: 0, distance: b.s }]]);
    if (!this.oneWay(b.e) || this.length[b.e] - b.s < 0.05) {
      const n = this.ends[b.e * 2 + 1],
        length = this.length[b.e] - b.s;
      if (length < (finish.get(n)?.distance ?? Infinity))
        finish.set(n, { from: this.length[b.e], distance: length });
    }
    let bestCost = directCost,
      end = -1;
    while (open.size) {
      const n = open.pop();
      if (closed[n]) continue;
      if (dist[n] + heuristic(n) >= bestCost) break;
      closed[n] = 1;
      if (finish.has(n)) {
        const cost = dist[n] + finish.get(n).distance * this.weight[b.e];
        if (cost < bestCost) {
          bestCost = cost;
          end = n;
        }
      }
      for (let i = this.adj[n]; i < this.adj[n + 1]; i++) {
        const arc = this.arcs[i],
          e = Math.abs(arc) - 1,
          m = this.ends[e * 2 + (arc > 0 ? 1 : 0)];
        const cost = dist[n] + this.length[e] * this.weight[e];
        if (cost >= dist[m] || closed[m]) continue;
        dist[m] = cost;
        via[m] = arc;
        open.push(m, cost + heuristic(m));
      }
    }
    if (end < 0) return Number.isFinite(directCost) ? [leg(a.e, a.s, b.s)] : null;
    const goalStart = finish.get(end).from;
    const legs = [leg(b.e, goalStart, b.s)];
    let n = end;
    while (via[n]) {
      const arc = via[n],
        e = Math.abs(arc) - 1,
        forward = arc > 0;
      legs.push(leg(e, forward ? 0 : this.length[e], forward ? this.length[e] : 0));
      n = this.ends[e * 2 + (forward ? 0 : 1)];
    }
    legs.push(leg(a.e, a.s, startEnd.get(n)));
    return legs.reverse();
  }

  polyline(legs, sx, sy, tx, ty) {
    const points = [],
      transitions = [];
    const add = (x, y) => {
      if (points.length && Math.hypot(x - points.at(-2), y - points.at(-1)) < 0.05) return;
      points.push(x, y);
    };
    const pointAt = (e, s) => {
      const first = this.offset[e],
        last = this.offset[e + 1] - 1;
      let lo = first,
        hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.along[mid] <= s) lo = mid;
        else hi = mid;
      }
      const t = Math.max(0, Math.min(1, (s - this.along[lo]) / (this.along[hi] - this.along[lo] || 1)));
      add(
        (this.xy[lo * 2] + (this.xy[hi * 2] - this.xy[lo * 2]) * t) / 10,
        (this.xy[lo * 2 + 1] + (this.xy[hi * 2 + 1] - this.xy[lo * 2 + 1]) * t) / 10
      );
    };
    add(sx, sy);
    let previous = null;
    for (const { e, from, to } of legs) {
      pointAt(e, from);
      if (Math.abs(to - from) < 0.05) continue;
      if (previous !== null) transitions.push({ i: points.length / 2 - 1, previous, e });
      const first = this.offset[e],
        end = this.offset[e + 1];
      const forward = from <= to;
      for (let k = 0; k < end - first; k++) {
        const i = forward ? first + k : end - 1 - k,
          s = this.along[i];
        if (s > Math.min(from, to) && s < Math.max(from, to))
          add(this.xy[i * 2] / 10, this.xy[i * 2 + 1] / 10);
      }
      pointAt(e, to);
      previous = e;
    }
    const access = Math.hypot(tx - points.at(-2), ty - points.at(-1)) > 18 ? points.length / 2 - 1 : -1;
    add(tx, ty);
    const turns = [];
    for (const { i, previous, e } of transitions) {
      let a = i - 1,
        b = i + 1;
      const x = points[2 * i],
        y = points[2 * i + 1];
      while (a > 0 && Math.hypot(points[a * 2] - x, points[a * 2 + 1] - y) < 8) a--;
      while (b < points.length / 2 - 1 && Math.hypot(points[b * 2] - x, points[b * 2 + 1] - y) < 8) b++;
      if (a < 0 || b >= points.length / 2) continue;
      const ax = x - points[a * 2],
        ay = y - points[a * 2 + 1],
        bx = points[b * 2] - x,
        by = points[b * 2 + 1] - y;
      const angle = (Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI;
      const before = this.kind[previous],
        after = this.kind[e];
      const wasRoundabout = (before >> 8) & F.ROUND,
        roundabout = (after >> 8) & F.ROUND;
      let action;
      if (roundabout && !wasRoundabout) action = 'Enter roundabout';
      else if (wasRoundabout && !roundabout) action = 'Exit roundabout';
      else if ((before & 255) <= RC.TRUNK && [RC.MOTORWAY_LINK, RC.TRUNK_LINK].includes(after & 255))
        action = 'Take exit';
      else if (!roundabout && Math.abs(angle) >= 38)
        action = Math.abs(angle) > 152 ? 'U-turn' : angle > 0 ? 'Turn right' : 'Turn left';
      if (action) turns.push({ i, name: this.names[e], action });
    }
    return { points: new Float32Array(points), turns, access };
  }
}

// Favor surveyed walking paths, then quiet streets. Speed limits and car travel times
// have no bearing on the route a pedestrian should take.
function walkingCost(cls) {
  if (cls === RC.PATH) return 1;
  if (cls === RC.PRIMARY || cls === RC.PRIMARY_LINK) return 2.2;
  if (cls === RC.SECONDARY || cls === RC.SECONDARY_LINK) return 1.65;
  if (cls === RC.TERTIARY || cls === RC.TERTIARY_LINK) return 1.35;
  return 1.15;
}
