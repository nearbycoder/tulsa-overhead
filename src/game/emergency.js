// Ambient emergency services: ambulances answer bodies (paramedics revive them),
// fire engines answer burning wrecks.
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/ped.js';
import { DriverAI } from './traffic.js';
import { WalkerAI } from './pedai.js';
import { cum, pointAt, laneOffset } from './roads.js';
import { rng } from '../engine/math.js';

export class Emergency {
  constructor(game) { this.game = game; this.calls = []; this.units = []; this.t = 0; }

  report(kind, target) {
    if (this.calls.some((c) => c.target === target)) return;
    if (this.calls.length + this.units.length > 3) return;
    this.calls.push({ kind, target, delay: 6 + rng() * 8 });
  }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl) return;
    // queue -> dispatch
    for (const c of [...this.calls]) {
      c.delay -= dt;
      if (c.delay > 0) continue;
      this.calls.splice(this.calls.indexOf(c), 1);
      const T = c.target;
      if (Math.hypot(T.x - pl.x, T.y - pl.y) > 200) continue;
      if (c.kind === 'medic' && (!T.dead || T.mission || T.isPlayer)) continue;
      this.dispatch(c.kind, T);
    }
    for (const u of [...this.units]) this.updateUnit(u, dt);
  }

  dispatch(kind, T) {
    const g = this.game;
    const model = g.assets.vehicle(kind === 'medic' ? 'arkvalley_medic' : 'heartland_pumper') || g.assets.vehicles.find((m) => m.siren === (kind === 'medic' ? 'ambulance' : 'fire'));
    if (!model) return;
    const near = g.traffic.findSpot({ x: T.x, y: T.y }, 120, 190, (r) => r.cls <= 7);
    if (!near) return;
    cum(near.road);
    const t = [0, 0, 0, 0];
    pointAt(near.road, 1, near.s, 0, t);
    let dir = ((T.x - t[0]) * t[2] + (T.y - t[1]) * t[3]) > 0 ? 1 : -1;
    if (near.road.flags & 1) dir = 1;
    pointAt(near.road, dir, dir > 0 ? near.s : near.road.len - near.s, laneOffset(near.road, 0, dir), t);
    const v = new Vehicle(g, model, t[0], t[1], Math.atan2(t[3], t[2]));
    const d = new Ped(g, g.assets.special(kind === 'medic' ? 'paramedic' : 'firefighter'), v.x, v.y);
    d.vehicle = v; v.driver = d; d.ai = { kind: 'driver' };
    v.ai = new DriverAI(g, v, near.road, dir, 0, dir > 0 ? near.s : near.road.len - near.s);
    v.ai.mode = 'goto'; v.ai.target = [T.x, T.y]; v.ai.style = 1.15;
    v.sirenOn = true; v.persist = true;
    g.addVehicle(v); g.peds.push(d);
    this.units.push({ kind, v, d, T, stage: 'drive', t: 0 });
  }

  updateUnit(u, dt) {
    const g = this.game;
    const { v, d, T } = u;
    u.t += dt;
    // also stand down if somebody (usually the player) has taken the truck
    const gone = v.dead || !g.vehicles.includes(v) || d.dead || !v.ai || (v.driver && v.driver !== d);
    if (gone || u.t > 90) { this.release(u); return; }
    if (u.stage === 'drive') {
      v.ai.target = [T.x, T.y];
      if (Math.hypot(v.x - T.x, v.y - T.y) < 18) { v.ai.mode = 'stop'; u.stage = 'park'; }
    } else if (u.stage === 'park') {
      v.ai.mode = 'stop';
      if (v.speed < 0.8 || u.t > 12) {
        u.stage = 'work'; u.t = 0;
        if (u.kind === 'medic') { g.exitVehicle(d, true); d.ai = null; }
      }
    } else if (u.stage === 'work') {
      if (u.kind === 'medic') {
        // walk to the body, kneel, revive
        const dx = T.x - d.x, dy = T.y - d.y, dist = Math.hypot(dx, dy);
        if (dist > 1.2) { d.move.x = dx / dist; d.move.y = dy / dist; d.moveSpeed = 3; }
        else {
          d.move.x = d.move.y = 0;
          u.work = (u.work || 0) + dt;
          if (u.work > 3.5) {
            if (T.dead && g.peds.includes(T) && !T.isPlayer) {
              T.dead = false; T.health = 50; T.knock = 0.5; T.deadT = 0;
              T.ai = new WalkerAI(g, T, null, 1, 1, 0); T.ai.state = 'wander';
              g.effects.text(T.x, T.y, 'REVIVED', '#7ed36b');
            }
            u.stage = 'leave'; u.t = 0;
          }
        }
      } else {
        v.sirenOn = true;
        if (Math.random() < dt * 25) g.effects.splash(T.x + (rng() - 0.5) * 3, T.y + (rng() - 0.5) * 3, 0.5);
        if (u.t > 4) { T.fire = 0; u.stage = 'leave'; u.t = 0; }
      }
    } else if (u.stage === 'leave') {
      if (u.kind === 'medic' && !d.vehicle) {
        const dx = v.x - d.x, dy = v.y - d.y, dist = Math.hypot(dx, dy);
        if (dist > 3) { d.move.x = dx / dist; d.move.y = dy / dist; d.moveSpeed = 3; return; }
        g.enterVehicle(d, v);
      }
      v.sirenOn = false; v.ai.mode = 'cruise'; v.ai.reassign();
      this.release(u);
    }
  }
  release(u) {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    u.v.persist = false;
  }
}
