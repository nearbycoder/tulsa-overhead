// Pedestrian AI: sidewalk wandering over the road graph, crossing, panic, fighting back.
import { Ped } from '../entities/ped.js';
import { RC, F, S } from '../world/shared.js';
import { pointAt, cum, endNode } from './roads.js';
import { rng, clamp, wrapAngle } from '../engine/math.js';
import { settings } from '../engine/settings.js';
import { WEAPONS } from '../data/weapons.js';

const tmp = [0, 0, 0, 0];

function walkable(r) { return r.walkSide === 1 && !(r.flags & F.BRIDGE) && r.cls !== RC.MOTORWAY && r.cls !== RC.TRUNK; }

function availableSide(road, dir, side) {
  return road.sides?.[dir * side > 0 ? 1 : 0] === 0 ? -side : side;
}

function walkPoint(world, road, dir, s, side, out) {
  pointAt(road, dir, s, (road.w / 2 + 2) * side, out);
  if (road.sides?.[dir * side > 0 ? 1 : 0] !== 2 || world.surfaceAt(out[0], out[1]) === S.WALK) return;
  // Separately surveyed sidewalks can bend away from the curb at corners.
  const nx = -out[3] * side, ny = out[2] * side;
  for (let offset = -1; offset <= 10; offset++) {
    const x = out[0] + nx * offset, y = out[1] + ny * offset;
    const surface = world.surfaceAt(x, y);
    if (surface === S.BUILDING || surface === S.WATER) break;
    if (surface === S.WALK) { out[0] = x; out[1] = y; return; }
  }
}

export class WalkerAI {
  constructor(game, ped, road, dir, side, s) {
    this.game = game; this.p = ped;
    this.kind = 'walker';
    this.road = road; this.dir = dir; this.side = side; this.s = s;
    this.state = 'walk';     // walk | idle | cross | flee | attack | wander
    this.t = 0;
    this.threat = null;
    this.target = null;
    this.speed = 1.1 + rng() * 0.5;
    this.brave = rng();
    this.crossFrom = null;
  }

  onDamage(by) {
    const p = this.p;
    if (!by || by === p) return;
    if ((p.faction || this.brave > 0.86 || p.armed) && !p.isCop) { this.state = 'attack'; this.target = by; this.t = 20; if (!p.hasWeapon(p.weapon) || p.weapon === 'fists') { if (p.armed) p.weapon = p.armed; } }
    else this.panic(by.x, by.y, 8);
  }
  panic(x, y, t = 7) {
    if (this.state === 'attack') return;
    this.state = 'flee'; this.threat = [x, y]; this.t = t + rng() * 3;
    if (this.p.speech <= 0 && rng() < 0.35) { this.game.audio.play(this.game.assets.pedModel(this.p.model).sex === 'f' ? 'scream_f' : 'scream_m', { x: this.p.x, y: this.p.y, vol: 0.7 }); this.p.speech = 4; }
  }

  update(dt) {
    const p = this.p, g = this.game;
    if (p.dead || p.vehicle) return;
    this.t -= dt;
    p.aiming = false;
    if (this.state === 'flee') {
      const dx = p.x - this.threat[0], dy = p.y - this.threat[1];
      const d = Math.hypot(dx, dy) || 1;
      p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = 4.8;
      if (this.t <= 0) this.resume();
      return;
    }
    if (this.state === 'attack') {
      const T = this.target;
      if (!T || T.dead || this.t <= 0 || Math.hypot(T.x - p.x, T.y - p.y) > 60) { this.resume(); return; }
      const tx = T.vehicle ? T.vehicle.x : T.x, ty = T.vehicle ? T.vehicle.y : T.y;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      const w = WEAPONS[p.weapon] || WEAPONS.fists;
      const range = w.type === 'melee' ? w.range * 0.9 : Math.min(w.range * 0.6, 20);
      p.face = Math.atan2(dy, dx);
      if (d > range) { p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = 4.2; p.aiming = false; }
      else {
        p.move.x = 0; p.move.y = 0; p.aiming = w.type !== 'melee';
        if (w.type === 'melee' || g.world.lineOfSight(p.x, p.y, tx, ty)) g.combat.tryFire(p, p.face + (rng() - 0.5) * 0.1);
      }
      return;
    }
    if (this.state === 'wander') {
      // parks / no sidewalks: random walk
      if (this.t <= 0) { const a = rng() * Math.PI * 2; this.wd = [Math.cos(a), Math.sin(a)]; this.t = 3 + rng() * 6; if (rng() < 0.3) this.wd = [0, 0]; }
      p.move.x = this.wd ? this.wd[0] : 0; p.move.y = this.wd ? this.wd[1] : 0; p.moveSpeed = this.speed;
      const surf = g.world.surfaceAt(p.x + p.move.x * 2, p.y + p.move.y * 2);
      if (surf === S.ROAD || surf === S.WATER || surf === S.BUILDING) { this.wd = [-this.wd[0], -this.wd[1]]; }
      return;
    }
    if (this.state === 'idle') { p.move.x = p.move.y = 0; if (this.t <= 0) this.state = 'walk'; return; }
    const road = this.road;
    if (!road || road.dead) { this.state = 'wander'; this.t = 0; return; }
    cum(road);
    if (this.state === 'cross') {
      // walk straight to the other side
      const [cx, cy] = this.crossTo;
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy);
      if (d < 0.8 || this.t <= 0) { this.state = 'walk'; return; }
      // wait for cars
      let wait = false;
      for (const v of g.nearbyVehicles(p.x, p.y, 25)) { if (v.speed > 3) { const rel = (p.x - v.x) * v.vx + (p.y - v.y) * v.vy; if (rel > 0 && Math.hypot(p.x - v.x, p.y - v.y) < 22) wait = true; } }
      p.move.x = wait ? 0 : dx / d; p.move.y = wait ? 0 : dy / d; p.moveSpeed = this.speed * 1.3;
      return;
    }
    // walking along sidewalk
    this.s += this.speed * dt;
    if (this.s >= road.len) {
      const n = endNode(road, this.dir);
      const opts = n ? n.edges.filter((e) => e.road !== road && walkable(e.road)) : [];
      if (!opts.length) { this.dir = -this.dir; this.s = 0; this.side = -this.side; }
      else {
        const e = opts[Math.floor(rng() * opts.length)];
        this.road = e.road; this.dir = e.dir; this.s = 0;
        cum(this.road);
        this.side = availableSide(this.road, this.dir, this.side);
        // keep the same physical side roughly: random flip
        if (rng() < 0.15) { this.startCross(); return; }
      }
      if (rng() < 0.1) { this.state = 'idle'; this.t = 2 + rng() * 5; }
    }
    walkPoint(g.world, this.road, this.dir, Math.min(this.road.len, this.s + 2.5), this.side, tmp);
    const dx = tmp[0] - p.x, dy = tmp[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = this.speed;
    if (rng() < dt * 0.02) this.startCross();
  }

  startCross() {
    const p = this.p, road = this.road;
    if (availableSide(road, this.dir, -this.side) === this.side) return;
    walkPoint(this.game.world, road, this.dir, Math.min(road.len, this.s + 1), -this.side, tmp);
    this.crossTo = [tmp[0], tmp[1]];
    this.side = -this.side;
    this.state = 'cross';
    this.t = 12;
  }

  resume() {
    const g = this.game, p = this.p;
    const near = g.world.nearestRoad(p.x, p.y, 50, walkable);
    if (!near) { this.state = 'wander'; this.t = 0; return; }
    this.road = near.road; this.dir = rng() < 0.5 ? 1 : -1; cum(this.road);
    this.s = this.dir > 0 ? near.s : this.road.len - near.s;
    this.side = availableSide(this.road, this.dir, rng() < 0.5 ? 1 : -1);
    this.state = 'walk';
  }
}

export class PedSystem {
  constructor(game) { this.game = game; this.t = 0; }
  update(dt) {
    const g = this.game, P = g.focus();
    const dens = settings.get('pedDensity') ?? 1;
    // despawn
    for (const p of g.peds) {
      if (p.isPlayer || p.vehicle || p.persist || p.mission) continue;
      const d = Math.hypot(p.x - P.x, p.y - P.y);
      if ((d > 150 && !g.onScreen(p.x, p.y, 5)) || (p.dead && p.deadT > 30)) g.removePed(p);
    }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    const local = g.world.densityAt(P.x, P.y);
    const target = Math.round((local >= 3 ? 34 : local >= 2 ? 24 : local >= 1 ? 12 : 3) * dens);
    let n = 0;
    for (const p of g.peds) if (!p.vehicle && !p.isPlayer && !p.isCop && !p.dead) n++;
    if (n < target) this.spawn(P);
  }
  spawn(P) {
    const g = this.game;
    for (let t = 0; t < 4; t++) {
      const a = rng() * Math.PI * 2, r = 45 + rng() * 75;
      const x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
      if (!g.world.isLoadedAt(x, y)) continue;
      const near = g.world.nearestRoad(x, y, 45, walkable);
      let px, py, ai, road, dir, side, s;
      const zone = g.traffic.zoneAt(x, y);
      if (near) {
        road = near.road; cum(road);
        dir = rng() < 0.5 ? 1 : -1; side = availableSide(road, dir, rng() < 0.5 ? 1 : -1);
        s = dir > 0 ? near.s : road.len - near.s;
        walkPoint(g.world, road, dir, s, side, tmp);
        px = tmp[0]; py = tmp[1];
      } else {
        const surf = g.world.surfaceAt(x, y);
        if (surf !== S.PARK && surf !== S.LAWN && surf !== S.PITCH) continue;
        px = x; py = y;
      }
      if (g.onScreen(px, py, 3)) continue;
      const surf = g.world.surfaceAt(px, py);
      if (surf === S.BUILDING || surf === S.WATER || surf === S.ROAD) continue;
      const ped = new Ped(g, g.assets.pickPed(rng, zone), px, py, rng() * 6.28);
      ai = new WalkerAI(g, ped, road, dir, side, s);
      if (!near) { ai.state = 'wander'; ai.t = 0; }
      ped.ai = ai;
      // some Okies carry
      if (rng() < 0.08) { const w = rng() < 0.6 ? 'pistol' : rng() < 0.5 ? 'bat' : 'shotgun'; ped.give(w, 30); ped.armed = w; }
      g.peds.push(ped);
      return ped;
    }
    return null;
  }
}
