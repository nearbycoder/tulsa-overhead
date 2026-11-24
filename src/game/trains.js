// Freight trains on the real OSM rail lines: procedurally built sprite-stacked locomotive + cars,
// chained across rail segments, horns, and they flatten anything left on the tracks.
import { StackSprite } from '../engine/stacks.js';
import { rng } from '../engine/math.js';

const CAR_LEN = 17.5, GAP = 1.2;
const PX = 0.2, SH = 0.25;

function makeCarStrip(type) {
  const w = 16, h = Math.round(CAR_LEN / PX), count = 17;
  const c = document.createElement('canvas');
  c.width = w * count; c.height = h;
  const x = c.getContext('2d');
  const col = { loco: ['#d0661e', '#1d1d1f'], hopper: ['#8b8f93', '#5c6064'], box: ['#7a2e22', '#4e1d16'], tank: ['#26282b', '#111214'], flat: ['#6a5a44', '#3d3326'] }[type];
  for (let z = 0; z < count; z++) {
    const ox = z * w;
    if (z < 3) { // trucks/wheels
      x.fillStyle = '#1a1a1a';
      x.fillRect(ox + 2, 6, w - 4, 14); x.fillRect(ox + 2, h - 20, w - 4, 14);
      if (z === 2) { x.fillStyle = '#2a2a2a'; x.fillRect(ox + 1, 2, w - 2, h - 4); }
      continue;
    }
    const t = (z - 3) / (count - 4);
    if (type === 'loco') {
      // long hood + cab near the front (front = +y = bottom of the slice)
      if (t < 0.75 || (t >= 0.75 && false)) { x.fillStyle = t > 0.6 ? col[0] : '#9a4a14'; x.fillRect(ox + 2, 4, w - 4, h - 8); }
      if (t >= 0.75) { x.fillStyle = col[0]; x.fillRect(ox + 2, h - 34, w - 4, 26); }
      if (t > 0.92) { x.fillStyle = col[1]; x.fillRect(ox + 3, h - 32, w - 6, 22); x.fillStyle = '#9fc8e8'; x.fillRect(ox + 4, h - 12, w - 8, 3); }
      if (z === count - 5) { x.fillStyle = '#1d1d1f'; x.fillRect(ox + 2, h * 0.45, w - 4, 6); x.fillStyle = '#f2c233'; x.fillRect(ox + 2, h - 8, w - 4, 2); }
    } else if (type === 'hopper') {
      const inset = Math.round((1 - t) * 3);
      x.fillStyle = z % 3 === 0 ? col[1] : col[0];
      x.fillRect(ox + 1 + inset, 3, w - 2 - inset * 2, h - 6);
      if (z === count - 1) { x.fillStyle = '#4a3a2a'; x.fillRect(ox + 3, 8, w - 6, h - 16); }
    } else if (type === 'box') {
      x.fillStyle = col[0]; x.fillRect(ox + 1, 3, w - 2, h - 6);
      if (z === count - 1) { x.fillStyle = col[1]; x.fillRect(ox + 1, 3, w - 2, h - 6); x.fillStyle = '#a0a0a0'; x.fillRect(ox + w / 2 - 1, 3, 2, h - 6); }
      if (z === 8) { x.fillStyle = '#e8e2c8'; x.fillRect(ox, h / 2 - 12, 1, 24); x.fillRect(ox + w - 1, h / 2 - 12, 1, 24); }
    } else if (type === 'tank') {
      const r = Math.sin(Math.min(1, t * 1.05) * Math.PI) * (w / 2 - 1.5);
      x.fillStyle = t > 0.7 ? '#3a3d41' : col[0];
      x.fillRect(ox + w / 2 - r, 8, r * 2, h - 16);
      if (z === count - 1) { x.fillStyle = '#555'; x.fillRect(ox + w / 2 - 2, h / 2 - 2, 4, 4); }
    } else {
      if (z < 5) { x.fillStyle = col[0]; x.fillRect(ox + 1, 3, w - 2, h - 6); }
      else if (z < 11) { x.fillStyle = '#5a5e62'; x.fillRect(ox + 3, 10, w - 6, h * 0.4); x.fillStyle = '#7a6040'; x.fillRect(ox + 3, h * 0.55, w - 6, h * 0.38); }
    }
  }
  return new StackSprite(c, w, h, count, PX, SH);
}

export class Trains {
  constructor(game) {
    this.game = game;
    this.trains = [];
    this.t = 20;
    this.sprites = null;
  }
  sprite(type) {
    if (!this.sprites) this.sprites = { loco: makeCarStrip('loco'), hopper: makeCarStrip('hopper'), box: makeCarStrip('box'), tank: makeCarStrip('tank'), flat: makeCarStrip('flat') };
    return this.sprites[type];
  }

  // chain rail polylines into a path starting from a point
  buildPath(line, startAtEnd) {
    const W = this.game.world;
    const pts = [];
    const push = (arr, rev) => { const n = arr.length >> 1; for (let i = 0; i < n; i++) { const k = rev ? n - 1 - i : i; pts.push(arr[k * 2], arr[k * 2 + 1]); } };
    push(line.pts, startAtEnd);
    const used = new Set([line]);
    for (let hop = 0; hop < 40; hop++) {
      const ex = pts[pts.length - 2], ey = pts[pts.length - 1];
      const px = pts[pts.length - 4], py = pts[pts.length - 3];
      const dx = ex - px, dy = ey - py, dl = Math.hypot(dx, dy) || 1;
      let best = null, bestScore = -2;
      W.forEachInRect('lines', ex - 7, ey - 7, ex + 7, ey + 7, (l) => {
        if (used.has(l) || l.k !== 0) return;
        const p = l.pts, n = p.length >> 1;
        for (const [rev, ix] of [[false, 0], [true, n - 1]]) {
          const sx = p[ix * 2], sy = p[ix * 2 + 1];
          if (Math.hypot(sx - ex, sy - ey) > 6) continue;
          const jx = rev ? p[(n - 2) * 2] : p[2], jy = rev ? p[(n - 2) * 2 + 1] : p[3];
          const score = ((jx - sx) * dx + (jy - sy) * dy) / ((Math.hypot(jx - sx, jy - sy) || 1) * dl);
          if (score > bestScore) { bestScore = score; best = { l, rev }; }
        }
      });
      if (!best || bestScore < 0.6) break;
      used.add(best.l);
      const before = pts.length;
      push(best.l.pts, best.rev);
      pts.splice(before, 2); // drop duplicate joint
    }
    // cumulative
    const n = pts.length >> 1;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    return { pts, cum, len: cum[n - 1] };
  }

  at(path, s, out) {
    const { pts, cum } = path;
    const n = cum.length;
    if (s <= 0) s = 0; if (s >= path.len) s = path.len - 0.01;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const L = cum[hi] - cum[lo] || 1e-6, t = (s - cum[lo]) / L;
    out[0] = pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t; out[1] = pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t;
    out[2] = Math.atan2(pts[hi * 2 + 1] - pts[lo * 2 + 1], pts[hi * 2] - pts[lo * 2]);
    return out;
  }

  spawn() {
    const g = this.game, pl = g.player;
    let cand = [];
    g.world.forEachInRect('lines', pl.x - 450, pl.y - 450, pl.x + 450, pl.y + 450, (l) => { if (l.k === 0 && l.pts.length >= 4) cand.push(l); });
    if (!cand.length) return;
    const line = cand[Math.floor(rng() * cand.length)];
    const path = this.buildPath(line, rng() < 0.5);
    if (path.len < 600) return;
    // start so the head enters ~250 m before the closest approach to the player
    let bestS = 0, bd = Infinity;
    const tmp = [0, 0, 0];
    for (let s = 0; s < path.len; s += 20) { this.at(path, s, tmp); const d = Math.hypot(tmp[0] - pl.x, tmp[1] - pl.y); if (d < bd) { bd = d; bestS = s; } }
    if (bd > 300) return;
    const nCars = 6 + Math.floor(rng() * 12);
    const startS = Math.max(nCars * (CAR_LEN + GAP) + 5, bestS - 260);
    const types = ['loco'];
    if (rng() < 0.4) types.push('loco');
    const kind = rng();
    for (let i = 0; i < nCars; i++) types.push(kind < 0.4 ? 'hopper' : kind < 0.6 ? 'tank' : rng() < 0.6 ? 'box' : rng() < 0.5 ? 'hopper' : 'flat');
    this.trains.push({ path, s: startS, speed: 13 + rng() * 9, types, hornT: 0 });
  }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl) return;
    this.t -= dt;
    if (this.t <= 0 && this.trains.length < 2) { this.t = 50 + rng() * 70; this.spawn(); }
    const tmp = [0, 0, 0];
    for (const tr of [...this.trains]) {
      tr.s += tr.speed * dt;
      const tail = tr.s - tr.types.length * (CAR_LEN + GAP);
      if (tail > tr.path.len - 1 || (Math.hypot(this.at(tr.path, tr.s, tmp)[0] - pl.x, tmp[1] - pl.y) > 900)) { this.trains.splice(this.trains.indexOf(tr), 1); if (tr.snd) tr.snd.stop && tr.snd.stop(); continue; }
      this.at(tr.path, Math.min(tr.s, tr.path.len - 0.1), tmp);
      const hx = tmp[0], hy = tmp[1];
      const dpl = Math.hypot(hx - pl.x, hy - pl.y);
      tr.hornT -= dt;
      if (dpl < 220 && tr.hornT <= 0) { g.audio.play('train_horn', { x: hx, y: hy, vol: 1 }); tr.hornT = 9 + rng() * 6; }
      if (dpl < 120 && rng() < dt * 0.3) g.audio.play('train_bell', { x: hx, y: hy, vol: 0.6 });
      // collisions: anything on the tracks gets hit
      for (let i = 0; i < tr.types.length; i++) {
        const s = tr.s - i * (CAR_LEN + GAP) - CAR_LEN / 2;
        if (s < 0 || s > tr.path.len) continue;
        this.at(tr.path, s, tmp);
        const cx = tmp[0], cy = tmp[1], h = tmp[2];
        const fx = Math.cos(h), fy = Math.sin(h);
        for (const v of g.nearbyVehicles(cx, cy, 14)) {
          if (v.isHeli && v.alt > 2) continue;
          const dx = v.x - cx, dy = v.y - cy, lx = dx * fx + dy * fy, ly = -dx * fy + dy * fx;
          if (Math.abs(lx) < CAR_LEN / 2 + v.len / 2 - 0.5 && Math.abs(ly) < 1.6 + v.wid / 2) {
            const side = ly >= 0 ? 1 : -1;
            v.vx = fx * tr.speed * 1.2 - fy * side * 9; v.vy = fy * tr.speed * 1.2 + fx * side * 9; v.av += side * 3;
            v.x += -fy * side * 1.5; v.y += fx * side * 1.5;
            if (!v._trainHit || g.time - v._trainHit > 1) { v._trainHit = g.time; g.impact(v, 30, null); v.damage(500, null); }
          }
        }
        for (const p of g.nearbyPeds(cx, cy, 12)) {
          if (p.vehicle || p.dead) continue;
          const dx = p.x - cx, dy = p.y - cy, lx = dx * fx + dy * fy, ly = -dx * fy + dy * fx;
          if (Math.abs(lx) < CAR_LEN / 2 + 0.4 && Math.abs(ly) < 2) {
            const side = ly >= 0 ? 1 : -1;
            p.knockDown(fx * tr.speed - fy * side * 6, fy * tr.speed + fx * side * 6, 1.5);
            p.damage(200, null, 'impact');
            g.effects.blood(p.x, p.y, fx * 8, fy * 8, 10);
          }
        }
      }
    }
  }

  render(R, x0, y0, x1, y1) {
    const tmp = [0, 0, 0];
    for (const tr of this.trains) {
      for (let i = 0; i < tr.types.length; i++) {
        const s = tr.s - i * (CAR_LEN + GAP) - CAR_LEN / 2;
        if (s < 0 || s > tr.path.len) continue;
        this.at(tr.path, s, tmp);
        const x = tmp[0], y = tmp[1], h = tmp[2] + (i === 1 && tr.types[1] === 'loco' ? Math.PI : 0);
        if (x < x0 - 20 || x > x1 + 20 || y < y0 - 20 || y > y1 + 20) continue;
        const spr = this.sprite(tr.types[i]);
        R.add(x, y, CAR_LEN / 2, (ctx, c) => spr.draw(ctx, c, x, y, h), (sc, c, sx, sy) => spr.drawShadow(sc, c, x, y, h, sx, sy));
      }
    }
  }

  blips(out) { for (const tr of this.trains) { const t = this.at(tr.path, Math.min(tr.s, tr.path.len - 0.1), [0, 0, 0]); out.push({ x: t[0], y: t[1], col: '#ddd', shape: 'square', size: 3 }); } }
}
