// Mission and waypoint navigation across the full map. The streamed graph also
// supports local synchronous queries from the driving bot and a network fallback.
import { RC, F } from '../world/shared.js';
import { cum, pointAt, projectS } from './roads.js';
import { Heap, roadCost } from './route-cost.js';

export class GPS {
  constructor(game) {
    this.game = game;
    this.target = null;
    this.route = null;
    this.requestId = 0;
    this.cooldown = 0;
    this.tick = 0;
  }

  clearRoute() {
    this.route = null;
    this.partial = false;
    this.access = -1;
    this.lengths = null;
    this.turns = [];
    this.segment = 0;
    this.progress = 0;
    this.remaining = null;
    this.nextTurn = null;
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.requestId++;
    this.clearRoute();
  }

  update(dt) {
    const pl = this.game.player;
    if (!pl) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const g = this.game;
    const source = (g.waypointIsManual && g.waypoint) || g.markers.find((m) => m.blip !== false && !m.gpsSkip) || g.waypoint;
    if (!source) {
      if (this.target) {
        this.requestId++;
        this.target = null;
        this.source = null;
        this.pending = false;
        this.clearRoute();
      }
      return;
    }
    const target = Array.isArray(source) ? source : [source.x, source.y];
    const mode = !pl.vehicle ? 'walk' : pl.vehicle.isHeli || pl.vehicle.isBoat ? 'bearing' : 'road';
    const changed = this.source !== source || this.mode !== mode;
    this.tick -= dt;
    if (!changed && this.tick > 0) return;
    this.tick = 0.16;
    if (changed) {
      this.source = source;
      this.target = [...target];
      this.mode = mode;
      this.pending = false;
      this.requestId++;
      this.cooldown = 0;
      this.clearRoute();
    }
    const direct = Math.hypot(pl.x - target[0], pl.y - target[1]);
    if (mode === 'bearing' || direct < 10) {
      if (this.pending) {
        this.requestId++;
        this.pending = false;
      }
      this.clearRoute();
      this.remaining = direct;
      this.status = direct < 10 ? 'Arrived' : 'Direct bearing';
      if (mode === 'bearing' && direct >= 10) this.route = [pl.x, pl.y, ...target];
      this.target = [...target];
      return;
    }
    // A moving mission vehicle keeps its last good route while the new endpoint is solved.
    const moved = Math.hypot(target[0] - this.target[0], target[1] - this.target[1]) > 16;
    const error = this.track(pl.x, pl.y);
    if (this.pending || this.cooldown > 0 || (this.route && error < 22 && !this.partial && !moved)) return;
    this.target = [...target];
    this.request(pl.x, pl.y, target, pl.vehicle && pl.vehicle.speed > 2 ? pl.vehicle.h : null);
  }

  request(x, y, target, heading) {
    const id = ++this.requestId;
    this.pending = true;
    this.status = this.route ? 'Rerouting' : 'Finding route';
    this.cooldown = 1.5;
    const fallback = () => {
      if (id !== this.requestId) return;
      this.pending = false;
      if (this.mode === 'walk') {
        this.clearRoute();
        this.status = 'Walking map unavailable';
      } else {
        const points = this.solve(x, y, ...target);
        this.accept(points && { points, turns: [] }, true);
      }
      this.cooldown = 5;
    };
    try {
      this.worker ??= new Worker(new URL('./route-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.id !== this.requestId || data.id !== id) return;
        if (data.unavailable) {
          fallback();
          return;
        }
        this.pending = false;
        this.accept(data.route, false);
        if (!data.route) this.cooldown = 5;
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        fallback();
      };
      this.worker.postMessage({
        id,
        mode: this.mode,
        base: new URL(this.game.world.base, location.href).href,
        coords: [x, y, ...target],
        heading
      });
    } catch {
      fallback();
    }
  }

  accept(result, partial) {
    this.clearRoute();
    this.partial = partial;
    if (!result || result.points.length < 4) {
      this.status = this.mode === 'walk' ? 'No walking route' : 'No road route';
      return;
    }
    this.route = result.points;
    this.access = result.access ?? -1;
    this.turns = result.turns;
    const n = this.route.length / 2;
    this.lengths = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const k = i * 2,
        p = this.route;
      this.lengths[i] = this.lengths[i - 1] + Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    }
    this.status = partial ? 'Local route' : '';
    this.track(this.game.player.x, this.game.player.y);
  }

  // Follow the next stretch of the route rather than jumping ahead at a
  // hairpin, parallel highway or overpass. A distant jump triggers a new solve.
  track(x, y) {
    if (!this.lengths) return Infinity;
    const p = this.route,
      d = this.lengths;
    let best = Infinity,
      segment = this.segment,
      tBest = 0;
    for (let i = Math.max(0, this.segment - 2); i + 1 < d.length && d[i] < this.progress + 180; i++) {
      const k = 2 * i,
        dx = p[k + 2] - p[k],
        dy = p[k + 3] - p[k + 1];
      const t = Math.max(0, Math.min(1, ((x - p[k]) * dx + (y - p[k + 1]) * dy) / (dx * dx + dy * dy || 1)));
      const error = Math.hypot(p[k] + t * dx - x, p[k + 1] + t * dy - y);
      if (error < best) {
        best = error;
        segment = i;
        tBest = t;
      }
    }
    this.segment = segment;
    this.progress = d[segment] + tBest * (d[segment + 1] - d[segment]);
    this.remaining = d[d.length - 1] - this.progress;
    this.nextTurn = this.turns.find((turn) => d[turn.i] > this.progress + 4) || null;
    return best;
  }

  nearestNode(x, y) {
    const near = this.game.world.nearestRoad(
      x,
      y,
      150,
      (r) => r.cls !== RC.PATH && !(r.flags & (F.AISLE | F.DRIVEWAY))
    );
    if (!near) return null;
    return { road: near.road, s: near.s, x: near.x, y: near.y };
  }

  // candidate start roads near (x,y): the nearest one plus other roads within 35 m (e.g. the far carriageway)
  startCandidates(x, y) {
    const W = this.game.world,
      out = [],
      seen = new Set();
    const first = this.nearestNode(x, y);
    if (!first) return out;
    out.push(first);
    seen.add(first.road);
    W.forEachInRect('roads', x - 35, y - 35, x + 35, y + 35, (r) => {
      if (seen.has(r) || r.cls === RC.PATH || r.flags & (F.AISLE | F.DRIVEWAY) || r.dead) return;
      seen.add(r);
      const { s, d } = projectS(r, x, y);
      if (d > 35) return;
      const [px, py] = pointAt(r, 1, s, 0, []);
      out.push({ road: r, s, x: px, y: py, d });
    });
    const rest = out
      .slice(1)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    return [first, ...rest];
  }

  // try the nearby start roads and keep the shortest route
  solve(sx, sy, tx, ty) {
    const cands = this.startCandidates(sx, sy);
    if (!cands.length) return null;
    let best = null,
      bestL = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const r = this.solveFrom(cands[i], sx, sy, tx, ty);
      if (!r) continue;
      let L = 0;
      for (let k = 2; k < r.length; k += 2) L += Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1]);
      // a small bias toward the nearest road so ties don't flip-flop
      L += Math.hypot(cands[i].x - sx, cands[i].y - sy) * 2;
      const ex = r[r.length - 2],
        ey = r[r.length - 1];
      if (Math.hypot(ex - tx, ey - ty) > 5) L += 5000; // didn't reach the goal
      if (L < bestL) {
        bestL = L;
        best = r;
      }
    }
    return best;
  }

  solveFrom(a, sx, sy, tx, ty) {
    const W = this.game.world;
    if (!a) return null;
    const b = this.nearestNode(tx, ty) || null;
    const pts = [sx, sy];
    const appendRoad = (road, from, to) => {
      const lengths = cum(road),
        first = pointAt(road, 1, from, 0, []),
        last = pointAt(road, 1, to, 0, []);
      pts.push(first[0], first[1]);
      const forward = from <= to,
        lower = Math.min(from, to),
        upper = Math.max(from, to);
      for (let i = forward ? 0 : lengths.length - 1; i >= 0 && i < lengths.length; i += forward ? 1 : -1) {
        if (lengths[i] > lower && lengths[i] < upper) pts.push(road.pts[2 * i], road.pts[2 * i + 1]);
      }
      pts.push(last[0], last[1]);
    };
    if (b && a.road === b.road && (!(a.road.flags & F.ONEWAY) || b.s >= a.s)) {
      appendRoad(a.road, a.s, b.s);
      pts.push(tx, ty);
      return pts;
    }
    const goalNodes = new Set();
    if (b) {
      cum(b.road);
      if (b.road.node0) goalNodes.add(b.road.node0.id);
      if (b.road.node1 && (!(b.road.flags & F.ONEWAY) || b.road.len - b.s < 0.05))
        goalNodes.add(b.road.node1.id);
    }
    const open = new Heap();
    const gScore = new Map(),
      came = new Map();
    const h = (n) => Math.hypot(n.x - tx, n.y - ty) * 0.55;
    cum(a.road);
    // seed with both ends of the start road (respecting one-way)
    const seed = (node, dist, dir) => {
      if (!node) return;
      if (a.road.flags & F.ONEWAY && dir < 0) return;
      const c = dist * roadCost(a.road.cls, a.road.flags);
      if (!gScore.has(node.id) || c < gScore.get(node.id)) {
        gScore.set(node.id, c);
        came.set(node.id, { start: true, road: a.road, dir, s: a.s });
        open.push(node, c + h(node));
      }
    };
    seed(a.road.node1, a.road.len - a.s, 1);
    seed(a.road.node0, a.s, -1);
    let best = null,
      bestH = Infinity,
      found = null;
    let iter = 0;
    while (open.size && iter++ < 25000) {
      const n = open.pop();
      const gn = gScore.get(n.id);
      const hn = Math.hypot(n.x - tx, n.y - ty);
      if (hn < bestH) {
        bestH = hn;
        best = n;
      }
      if (goalNodes.has(n.id)) {
        found = n;
        break;
      }
      for (const e of n.edges) {
        const r = e.road;
        if (r.dead || r.cls === RC.PATH) continue;
        if (r.flags & F.ONEWAY && e.dir < 0) continue;
        const m = e.dir > 0 ? r.node1 : r.node0;
        if (!m) continue;
        cum(r);
        const c = gn + r.len * roadCost(r.cls, r.flags);
        if (!gScore.has(m.id) || c < gScore.get(m.id)) {
          gScore.set(m.id, c);
          came.set(m.id, { from: n, road: r, dir: e.dir });
          open.push(m, c + h(m));
        }
      }
    }
    const end = found || best;
    if (!end) return null;
    // rebuild polyline
    const segs = [];
    let cur = end;
    let guard = 0;
    while (cur && guard++ < 5000) {
      const c = came.get(cur.id);
      if (!c) break;
      segs.push(c);
      if (c.start) break;
      cur = c.from;
    }
    segs.reverse();
    for (const c of segs) {
      const from = c.start ? a.s : c.dir > 0 ? 0 : c.road.len;
      appendRoad(c.road, from, c.dir > 0 ? c.road.len : 0);
    }
    if (found && b) {
      appendRoad(b.road, found === b.road.node0 ? 0 : b.road.len, b.s);
      pts.push(tx, ty);
    }
    return pts;
  }

  drawOn(ctx, toScreenX, toScreenY, width, color = '#d64ad6', limit = Infinity) {
    if (!this.route) return;
    const p = this.route;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    const start = this.segment || 0;
    const dashed = this.mode === 'bearing' || (this.access >= 0 && start >= this.access);
    const dash = [width * 2, width * 1.5];
    if (dashed) ctx.setLineDash(dash);
    const k = start * 2;
    const d = this.lengths;
    const t = d ? (this.progress - d[start]) / (d[start + 1] - d[start] || 1) : 0;
    ctx.moveTo(toScreenX(p[k] + t * (p[k + 2] - p[k])), toScreenY(p[k + 1] + t * (p[k + 3] - p[k + 1])));
    for (let i = start + 1; i < p.length / 2; i++) {
      ctx.lineTo(toScreenX(p[i * 2]), toScreenY(p[i * 2 + 1]));
      if (d && d[i] > this.progress + limit) break;
      if (i === this.access) {
        ctx.stroke();
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.moveTo(toScreenX(p[i * 2]), toScreenY(p[i * 2 + 1]));
      }
    }
    ctx.stroke();
    if (dashed || this.access >= 0) ctx.setLineDash([]);
  }
}
