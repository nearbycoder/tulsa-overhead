// Traffic: lane-following AI drivers over the real road graph, spawning/despawning, parked cars.
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/ped.js';
import { RC, F, S } from '../world/shared.js';
import { pointAt, projectS, laneOffset, lanesPerDir, chooseNext, cum, zAt } from './roads.js';
import { approachControls, controlState } from './traffic-controls.js';
import { rng, clamp, wrapAngle, mulberry32, hash2 } from '../engine/math.js';
import { settings } from '../engine/settings.js';
import { SPECIAL_SPAWNS } from '../data/spawns.js';

const tmp = [0, 0, 0, 0];
const tmp2 = [0, 0, 0, 0];

export class DriverAI {
  constructor(game, veh, road, dir, lane, s) {
    this.game = game; this.v = veh;
    this.road = road; this.dir = dir; this.lane = lane; this.s = s;
    this.next = null;
    this.style = 0.88 + rng() * 0.3;
    this.mode = 'cruise';   // cruise | flee | pursue | goto | stop | wander
    this.target = null;     // [x,y] for pursue/goto
    this.reproj = 0;
    this.blockedT = 0;
    this.reverseT = 0;
    this.lost = false;
    this.honked = 0;
    this.maxSpeed = null;
  }

  laneOff(road = this.road) { return laneOffset(road, Math.min(this.lane, lanesPerDir(road, this.dir) - 1), this.dir) + (this.overtakeT > 0 ? this.overShift : 0); }

  reassign() {
    const v = this.v;
    const near = this.game.world.nearestRoad(v.x, v.y, 60, (r) => r.cls !== RC.PATH && r.cls !== RC.TRACK && !(r.flags & F.DRIVEWAY));
    if (!near) { this.lost = true; return false; }
    const r = near.road;
    cum(r);
    // pick travel direction aligned with heading (respect one-way)
    pointAt(r, 1, near.s, 0, tmp);
    let dir = Math.cos(v.h) * tmp[2] + Math.sin(v.h) * tmp[3] >= 0 ? 1 : -1;
    if (r.flags & F.ONEWAY) dir = 1;
    this.road = r; this.dir = dir; this.s = dir > 0 ? near.s : r.len - near.s;
    this.lane = Math.floor(rng() * lanesPerDir(r, dir));
    this.next = null; this.lost = false;
    return true;
  }

  update(dt) {
    const g = this.game, v = this.v;
    if (this.releasedControl && Math.hypot(v.x - this.releaseX, v.y - this.releaseY) > 28) this.releasedControl = null;
    if (!v.driver || v.dead) return;
    v.ctrl.allowReverse = false;
    if (this.overtakeT > 0) this.overtakeT -= dt;
    // live pursuit target (set by m.pursue)
    if (v._pursueTarget) { const t = v._pursueTarget; if (t.dead) v._pursueTarget = null; else this.target = [t.vehicle ? t.vehicle.x : t.x, t.vehicle ? t.vehicle.y : t.y]; }
    if (v.isBoat) return this.updateBoat(dt);
    let road = this.road;
    if (!road || road.dead) { if (!this.reassign()) { v.ctrl.throttle = 0; v.ctrl.brake = 1; return; } road = this.road; }
    cum(road);
    // progress along the lane
    this.s += Math.max(0, v.vf) * dt;
    this.reproj -= dt;
    if (this.reproj <= 0) {
      this.reproj = 0.6;
      const pr = projectS(road, v.x, v.y);
      const s2 = this.dir > 0 ? pr.s : road.len - pr.s;
      if (pr.d > 14 && this.reassign()) road = this.road;
      else this.s = s2;
    }
    const pursuing = this.mode === 'pursue' && this.target;
    // choose next segment early
    if (this.next?.road.dead) this.next = null;
    if (!this.next && this.s > road.len - 40) {
      const options = pursuing || this.mode === 'goto'
        ? { target: this.target, strict: this.mode === 'goto', allowService: this.mode === 'goto' }
        : { lane: this.mode === 'cruise' ? this.lane : undefined };
      this.next = chooseNext(road, this.dir, rng, options);
      if (!this.next) {
        // dead end: U-turn if allowed
        if (!(road.flags & F.ONEWAY)) this.next = { road, dir: -this.dir, uturn: true };
      }
    }
    if (this.s >= road.len - 0.5) {
      if (this.next) {
        const carry = this.s - road.len;
        this.road = this.next.road; this.dir = this.next.dir; this.s = Math.max(0, carry);
        cum(this.road);
        this.lane = Math.min(this.lane, lanesPerDir(this.road, this.dir) - 1);
        this.next = null; road = this.road;
      } else {
        // end of known world: stop and let the spawner recycle us
        v.ctrl.throttle = 0; v.ctrl.brake = 1; this.blockedT += dt;
        return;
      }
    }
    // target point ahead
    const sp = Math.max(0, v.vf);
    const look = 5 + sp * 0.55;
    let tx, ty, turnAngle = 0;
    const rem = road.len - this.s;
    pointAt(road, this.dir, this.s, this.laneOff(road), tmp);
    const curTx = tmp[2], curTy = tmp[3];
    if (look < rem || !this.next) {
      pointAt(road, this.dir, Math.min(road.len, this.s + look), this.laneOff(road), tmp);
      tx = tmp[0]; ty = tmp[1];
    } else {
      const nr = this.next.road;
      cum(nr);
      pointAt(nr, this.next.dir, Math.min(nr.len, look - rem), laneOffset(nr, Math.min(this.lane, lanesPerDir(nr, this.next.dir) - 1), this.next.dir), tmp);
      tx = tmp[0]; ty = tmp[1];
    }
    if (this.next && rem < 35) {
      const nr = this.next.road;
      pointAt(nr, this.next.dir, Math.min(nr.len, 4), 0, tmp2);
      turnAngle = Math.acos(clamp(curTx * tmp2[2] + curTy * tmp2[3], -1, 1));
    }
    // goto / pursue: U-turn when the target is behind us on a two-way road
    if ((this.mode === 'goto' || this.mode === 'pursue') && this.target && !(road.flags & F.ONEWAY)) {
      this.uturnCd = (this.uturnCd || 0) - dt;
      const tdx = this.target[0] - v.x, tdy = this.target[1] - v.y, td = Math.hypot(tdx, tdy);
      if (td > 45 && this.uturnCd <= 0 && (tdx * curTx + tdy * curTy) < -0.4 * td) {
        this.dir = -this.dir; this.s = Math.max(0, road.len - this.s); this.next = null; this.uturnCd = 8;
      }
    }
    // pursuit: when close and in view, drive straight at the target
    let wantSpeed = (this.maxSpeed || road.speed) * this.style;
    if (pursuing) {
      const dx = this.target[0] - v.x, dy = this.target[1] - v.y;
      const d = Math.hypot(dx, dy);
      wantSpeed = Math.max(wantSpeed * 1.35, 24);
      if (d < 55 && g.world.lineOfSight(v.x, v.y, this.target[0], this.target[1])) {
        tx = this.target[0] + (this.targetV ? this.targetV[0] * 0.5 : 0); ty = this.target[1] + (this.targetV ? this.targetV[1] * 0.5 : 0);
        wantSpeed = d < 10 ? Math.max(6, (this.targetSpeed || 0) + 3) : 40;
        turnAngle = 0;
      }
    }
    if (this.mode === 'flee') wantSpeed = Math.max(wantSpeed * 1.5, 26);
    if (this.mode === 'cruise') wantSpeed = Math.min(wantSpeed, this.controlSpeed(dt, sp, rem));
    if (this.mode === 'stop') wantSpeed = 0;
    // goto: ease in and stop on arrival
    if (this.mode === 'goto' && this.target) {
      const td = Math.hypot(this.target[0] - v.x, this.target[1] - v.y);
      this.arrived = td < (this.arriveR || 12);
      if (td < 45) wantSpeed = Math.min(wantSpeed, Math.max(0, (td - 6) * 0.7));
    }
    if (turnAngle > 0.5 && rem < 30) wantSpeed = Math.min(wantSpeed, 4 + (Math.PI - turnAngle) * 4 + rem * 0.3);
    if (this.next && this.next.uturn && rem < 20) wantSpeed = Math.min(wantSpeed, 3);
    // obstacles ahead
    if (this.mode !== 'flee' || rng() < 0.5) {
      const obst = this.scanAhead(sp);
      if (obst < Infinity) {
        const stopD = Math.max(0, obst - 3.5);
        wantSpeed = Math.min(wantSpeed, stopD * 0.9);
        if (stopD < 1.5) {
          const b = this.blocker;
          // Leave room for a queue to start moving. A driven car waiting for
          // another car can be several blocks back from the actual red light.
          if (b.driver && b.ai?.mode === 'cruise' && !b.dead && !b.parked) this.blockedT = 0;
          else this.blockedT += dt;
          if (!this.blockerIsPlayer && (b.parked || b.dead && b.wid) && this.blockedT > 1.5 &&
              !(this.overtakeT > 0) && rem > 22 && !this.waitControl) this.tryPassing(b);
          if (this.blockedT > 2.5 && this.honked <= 0 && this.blockerIsPlayer) { g.audio.play('horn_' + (v.m.horn || 'mid'), { x: v.x, y: v.y, vol: 0.8 }); this.honked = 3 + rng() * 4; v.horn = 0.4; }
        } else this.blockedT = 0;
      } else this.blockedT = 0;
    }
    if (this.honked > 0) this.honked -= dt;
    if (this.overtakeT > 0) wantSpeed = Math.min(wantSpeed, 4.5);
    // steering
    const desired = Math.atan2(ty - v.y, tx - v.x);
    let err = wrapAngle(desired - v.h);
    // stuck recovery: back up
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.ctrl.allowReverse = true;
      v.ctrl.throttle = 0; v.ctrl.brake = 1; v.ctrl.steer = -Math.sign(err); v.ctrl.handbrake = false;
      return;
    }
    if (sp < 0.5 && wantSpeed > 3 && this.mode !== 'stop') { this.stuckT = (this.stuckT || 0) + dt; if (this.stuckT > 2.5) { this.reverseT = 1.2; this.stuckT = 0; } }
    else this.stuckT = 0;
    v.ctrl.steer = clamp(err * 2.2, -1, 1);
    if (Math.abs(err) > 1.2 && sp < 8) wantSpeed = Math.min(wantSpeed, 5);
    const dv = wantSpeed - v.vf;
    if (dv > 0.3) { v.ctrl.throttle = clamp(dv / 4, 0.15, 1); v.ctrl.brake = 0; }
    else if (dv < -1) { v.ctrl.throttle = 0; v.ctrl.brake = clamp(-dv / 5, 0.2, 1); }
    else if (wantSpeed < 0.5) { v.ctrl.throttle = 0; v.ctrl.brake = v.vf > 0.1 ? 1 : 0.4; } // hold position
    else { v.ctrl.throttle = 0.05; v.ctrl.brake = 0; }
    v.ctrl.handbrake = pursuing && Math.abs(err) > 1.0 && sp > 12;
  }

  controlSpeed(dt, speed, remaining) {
    let control, distance;
    const horizon = 15 + speed * 1.5 + speed * speed / 9;
    const upcoming = (road, dir, travelled) => {
      for (const candidate of approachControls(road, dir)) {
        const d = candidate.s - travelled;
        if (d < -1.5) continue;
        if (candidate === this.releasedControl) {
          // A yellow-light commitment ends if a queue stops us short of the line.
          if (!candidate.group || speed > 0.6 || d <= this.v.len / 2 + 0.5) continue;
          this.releasedControl = null;
        }
        if (d > horizon) break;
        control = candidate;
        distance = d;
        return;
      }
    };
    upcoming(this.road, this.dir, this.s);
    if (!control && this.next && !this.next.uturn && remaining < horizon) {
      upcoming(this.next.road, this.next.dir, -remaining);
    }
    if (this.waitControl !== control) {
      this.holdTime = 0;
      this.arrivedAtStop = null;
    }
    this.waitControl = control;
    if (!control) return Infinity;
    const gap = distance - this.v.len / 2 - 0.7;
    const state = controlState(control, this.game.time);
    if (state === 'green') return Infinity;
    if (state === 'yellow' && speed > 1 && gap < speed * 0.35 + speed * speed / 10) {
      this.clearControl(control);
      return Infinity;
    }
    if (state === 'stop' && gap < 1.1 && speed < 0.5) {
      this.arrivedAtStop ??= this.game.time;
      this.holdTime += dt;
      if (this.holdTime >= 0.8 && !this.crossingTraffic()) {
        this.clearControl(control);
        return Infinity;
      }
    }
    if (gap < 0.55) return 0;
    return Math.min(Math.sqrt(8 * gap), 1.15 * gap);
  }

  clearControl(control) {
    this.releasedControl = control;
    this.releaseX = this.v.x;
    this.releaseY = this.v.y;
    this.releaseTime = this.game.time;
  }

  // At a stop sign, look ahead of the bumper for traffic crossing our path.
  crossingTraffic() {
    const v = this.v, fx = Math.cos(v.h), fy = Math.sin(v.h);
    for (const other of this.game.nearbyVehicles(v.x, v.y, 58)) {
      if (other === v || !other.driver || Math.abs(other.z - v.z) > 2.5 ||
          (other.isHeli && other.alt > 2)) continue;
      const dx = other.x - v.x, dy = other.y - v.y;
      // On an all-way stop, the first waiting driver has priority. Retain it
      // briefly while they pull away, before their velocity becomes measurable.
      const ai = other.ai;
      if (other.speed < 2 && ai && Math.hypot(dx, dy) < 26 &&
          Math.abs(Math.cos(v.h - other.h)) < 0.8) {
        const going = ai.releasedControl?.group === 0 && this.game.time - ai.releaseTime < 1.8;
        const first = ai.arrivedAtStop != null && (ai.arrivedAtStop < this.arrivedAtStop ||
          ai.arrivedAtStop === this.arrivedAtStop && other.id < v.id);
        if (going || first) return true;
      }
      if (other.speed < 1) continue;
      const crossSpeed = fx * other.vy - fy * other.vx;
      if (Math.abs(crossSpeed) < 0.4 * other.speed) continue;
      const arrival = (fy * dx - fx * dy) / crossSpeed;
      const ahead = (dx + arrival * other.vx) * fx + (dy + arrival * other.vy) * fy;
      if (arrival >= -0.35 && arrival < 2.7 && ahead >= 0 && ahead < 24) return true;
    }
    return false;
  }

  tryPassing(obstacle) {
    const v = this.v, road = this.road, lane = this.lane;
    const lanes = lanesPerDir(road, this.dir);
    if (lanes < 2 && road.flags & F.ONEWAY) return;
    const shift = lanes > 1
      ? laneOffset(road, lane > 0 ? lane - 1 : lane + 1, this.dir) - laneOffset(road, lane, this.dir)
      : -laneOffset(road, lane, this.dir) - laneOffset(road, 0, -this.dir);
    if (Math.abs(shift) < (v.wid + obstacle.wid) / 2 + 0.2) return;
    const fx = Math.cos(v.h), fy = Math.sin(v.h);
    const clearance = lanes > 1 ? 55 : Math.max(55, (road.speed + 5) * 6);
    for (const other of this.game.nearbyVehicles(v.x, v.y, clearance)) {
      if (other === v || other === obstacle || Math.abs(other.z - v.z) > 2.5 || (other.isHeli && other.alt > 2)) continue;
      const dx = other.x - v.x, dy = other.y - v.y;
      if (dx * fx + dy * fy < -10) continue;
      if (Math.abs(-dx * fy + dy * fx - shift) < (v.wid + other.wid) / 2 + 0.6) return;
    }
    this.overShift = shift;
    this.overtakeT = 6;
    this.ignore = obstacle;
  }

  // boats: steer straight for the target (or away from the player when fleeing), feeling for open water
  updateBoat(dt) {
    const g = this.game, v = this.v;
    const water = (x, y) => { const s = g.world.surfaceAt(x, y); return s === S.WATER || s === S.BRIDGE || s === S.CREEK; };
    let want = v.h;
    if (this.mode === 'flee') { const P = g.player; want = Math.atan2(v.y - P.y, v.x - P.x); }
    else if (this.target) want = Math.atan2(this.target[1] - v.y, this.target[0] - v.x);
    // probe fan for water
    let best = want, bestScore = -Infinity;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
      const a = want + off;
      let free = 0;
      for (const d of [6, 12, 20]) if (water(v.x + Math.cos(a) * d, v.y + Math.sin(a) * d)) free++; else break;
      const score = free * 10 - Math.abs(off) * 4;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    const err = wrapAngle(best - v.h);
    v.ctrl.steer = clamp(err * 2, -1, 1);
    const dist = this.target ? Math.hypot(this.target[0] - v.x, this.target[1] - v.y) : Infinity;
    const go = this.mode !== 'stop' && (this.target || this.mode === 'flee') && dist > 10;
    v.ctrl.throttle = go ? (Math.abs(err) > 1.2 ? 0.4 : 1) * (this.maxSpeed && v.speed > this.maxSpeed ? 0 : 1) : 0;
    v.ctrl.brake = go ? 0 : 0.5;
    v.ctrl.handbrake = false;
  }

  // distance to nearest obstacle in our path (Infinity if clear)
  scanAhead(sp) {
    const g = this.game, v = this.v;
    const fx = Math.cos(v.h), fy = Math.sin(v.h);
    const range = 10 + v.len + sp * sp / 10 + sp * 0.8;
    let best = Infinity;
    this.blockerIsPlayer = false;
    const cx = v.x + fx * range / 2, cy = v.y + fy * range / 2;
    for (const o of g.nearbyVehicles(cx, cy, range / 2 + 4)) {
      if (o === v || (o.isHeli && o.alt > 2) || Math.abs(o.z - v.z) > 2.5) continue;
      if (this.overtakeT > 0 && o === this.ignore) continue;
      const dx = o.x - v.x, dy = o.y - v.y;
      const ahead = dx * fx + dy * fy;
      if (ahead <= 0 || ahead > range) continue;
      const lat = -dx * fy + dy * fx;
      if (Math.abs(lat) > v.wid / 2 + o.wid / 2 + 0.3) continue;
      // ignore oncoming traffic in its own lane (heading opposite and offset)
      const hd = Math.cos(o.h - v.h);
      if (hd < -0.5 && Math.abs(lat) > 1.2) continue;
      const d = ahead - v.len / 2 - o.len / 2;
      if (d < best) { best = d; this.blockerIsPlayer = !!(o.driver && o.driver.isPlayer); this.blocker = o; }
    }
    for (const p of g.nearbyPeds(cx, cy, range / 2 + 2)) {
      if (p.dead || p.vehicle || Math.abs((p.z || 0) - v.z) > 2.5) continue;
      if (this.overtakeT > 0 && p === this.ignore) continue;
      const dx = p.x - v.x, dy = p.y - v.y;
      const ahead = dx * fx + dy * fy;
      if (ahead <= 0 || ahead > range) continue;
      const lat = -dx * fy + dy * fx;
      if (Math.abs(lat) > v.wid / 2 + 0.8) continue;
      const d = ahead - v.len / 2;
      if (d < best) { best = d; this.blockerIsPlayer = p.isPlayer; this.blocker = p; }
    }
    return best;
  }
}

export class Traffic {
  constructor(game) {
    this.game = game;
    this.spawnT = 0;
    this.parkT = 0;
    this.rng = mulberry32(12345);
  }

  zoneAt(x, y, road) {
    const g = this.game;
    const d = g.world.densityAt(x, y);
    if (road && (road.cls <= 1 || road.cls === 10 || road.cls === 11)) return 'highway';
    if (Math.hypot(x, y) < 1800) return 'downtown';
    if (d >= 3) return 'urban';
    if (d >= 1) return 'suburb';
    return 'rural';
  }

  updateSpecials() {
    const g = this.game, P = g.focus();
    if (!this.specials) this.specials = SPECIAL_SPAWNS.map((s) => { const q = g.world.project(s.lat, s.lon); return { ...s, x: q[0], y: q[1], v: null }; });
    for (const s of this.specials) {
      const d = Math.hypot(s.x - P.x, s.y - P.y);
      if (s.v && (s.v.dead || !g.vehicles.includes(s.v))) s.v = null;
      if (s.v || d > 320 || d < 60 || !g.world.isLoadedAt(s.x, s.y)) continue;
      const m = g.assets.vehicle(s.model);
      if (!m) continue;
      let x = s.x, y = s.y, h = 0, ok = false;
      if (s.water) {
        for (let r = 0; r < 160 && !ok; r += 8) for (let a = 0; a < 6.28 && !ok; a += 0.5) {
          const px = s.x + Math.cos(a) * r, py = s.y + Math.sin(a) * r;
          if ([[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]].every(([dx, dy]) => g.world.surfaceAt(px + dx, py + dy) === S.WATER)) { x = px; y = py; h = a; ok = true; }
        }
      } else {
        const near = g.world.nearestRoad(s.x, s.y, 80, (r) => r.cls !== RC.PATH);
        if (near) { cum(near.road); pointAt(near.road, 1, near.s, near.road.w / 2 - 1.2, tmp); x = tmp[0]; y = tmp[1]; h = Math.atan2(tmp[3], tmp[2]); ok = true; }
      }
      if (!ok || g.onScreen(x, y, 4)) continue;
      const v = new Vehicle(g, m, x, y, h, m.paint && m.paint.length ? g.assets.randomPaint(rng) : -1);
      v.parked = true;
      if (m.kind === 'heli') v.alt = 0;
      g.addVehicle(v);
      s.v = v;
    }
  }

  update(dt) {
    const g = this.game;
    const P = g.focus();
    if ((this.spT = (this.spT || 0) - dt) <= 0) { this.spT = 2; this.updateSpecials(); }
    const dens = settings.get('trafficDensity') ?? 1;
    // despawn far vehicles
    for (const v of g.vehicles) {
      if (v.persist || v.mission || (g.player && g.player.vehicle === v)) continue;
      const d = Math.hypot(v.x - P.x, v.y - P.y);
      const lim = v.parked ? 260 : 340;
      const blocked = v.ai && v.ai.blockedT > 20 && d > 60 && !g.onScreen(v.x, v.y, 10);
      if ((d > lim && !g.onScreen(v.x, v.y, 20)) || blocked || (v.dead && v.deadTime > 60 && d > 120) || (v.ai && v.ai.lost && d > 80 && !g.onScreen(v.x, v.y, 10))) g.removeVehicle(v);
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.25;
      const local = g.world.densityAt(P.x, P.y);
      const target = Math.round((local >= 2 ? 22 : local >= 1 ? 15 : 7) * dens);
      let moving = 0, parked = 0;
      for (const v of g.vehicles) { if (v.ai && v.driver && !v.ai.cop) moving++; else if (v.parked) parked++; }
      if (moving < target) this.spawnMoving(P);
      const ptarget = Math.round((local >= 1 ? 14 : 4) * dens);
      if (parked < ptarget) this.spawnParked(P);
    }
  }

  // find a road position in a ring around (x,y), off-screen
  findSpot(P, rMin, rMax, filter, tries = 6) {
    const g = this.game;
    for (let t = 0; t < tries; t++) {
      const a = rng() * Math.PI * 2;
      const r = rMin + rng() * (rMax - rMin);
      const x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
      if (!g.world.isLoadedAt(x, y)) continue;
      const near = g.world.nearestRoad(x, y, 70, filter);
      if (!near) continue;
      if (g.onScreen(near.x, near.y, 12)) continue;
      return near;
    }
    return null;
  }

  spawnMoving(P) {
    const g = this.game;
    const near = this.findSpot(P, 110, 230, (r) => r.cls <= 7 || (r.cls >= 10 && r.cls <= 14) || r.cls === RC.UNCLASSIFIED);
    if (!near) return null;
    const road = near.road;
    cum(road);
    let dir = rng() < 0.5 ? 1 : -1;
    if (road.flags & F.ONEWAY) dir = 1;
    const lanes = lanesPerDir(road, dir);
    const lane = Math.floor(rng() * lanes);
    const s = dir > 0 ? near.s : road.len - near.s;
    pointAt(road, dir, s, laneOffset(road, lane, dir), tmp);
    // clearance
    for (const o of g.nearbyVehicles(tmp[0], tmp[1], 14)) if (Math.hypot(o.x - tmp[0], o.y - tmp[1]) < 12) return null;
    const zone = this.zoneAt(tmp[0], tmp[1], road);
    const model = g.assets.pickVehicle(rng, zone, (m) => road.cls <= 1 || road.cls === 10 ? (m.kind !== 'bike' && m.kind !== 'tractor' && m.kind !== 'atv') : true);
    if (!model) return null;
    const v = new Vehicle(g, model, tmp[0], tmp[1], Math.atan2(tmp[3], tmp[2]), model.paint && model.paint.length ? g.assets.randomPaint(rng) : -1);
    const speed = road.speed * 0.8;
    v.vx = tmp[2] * speed; v.vy = tmp[3] * speed;
    v.z = zAt(road, dir, s); // spawned up on an overpass or ramp
    const driver = new Ped(g, g.assets.pickPed(rng, zone), v.x, v.y);
    driver.vehicle = v; v.driver = driver;
    v.ai = new DriverAI(g, v, road, dir, lane, s);
    driver.ai = { kind: 'driver', onDamage: (by) => { if (by && by.isPlayer) v.ai.mode = 'flee'; } };
    g.addVehicle(v);
    g.peds.push(driver);
    return v;
  }

  spawnParked(P) {
    const g = this.game;
    // parking aisles first, then residential curbs
    const useLot = rng() < 0.65;
    const near = this.findSpot(P, 50, 200, useLot ? (r) => (r.flags & F.AISLE) || ((r.cls === RC.SERVICE) && r.w >= 5) : (r) => r.cls === RC.RESIDENTIAL || r.cls === RC.UNCLASSIFIED || r.cls === RC.LIVING, 4);
    if (!near) return null;
    const road = near.road;
    cum(road);
    const side = rng() < 0.5 ? 1 : -1;
    pointAt(road, 1, near.s, 0, tmp);
    let x, y, h;
    if (useLot) {
      const off = road.w / 2 + 2.6;
      x = tmp[0] + (-tmp[3]) * off * side; y = tmp[1] + tmp[2] * off * side;
      h = Math.atan2(tmp[2] * side, -tmp[3] * side) + (rng() < 0.5 ? Math.PI : 0);
      // snap along aisle to stall grid
    } else {
      // wide streets: at the kerb inside the lane; narrow ones: up on the grass verge so the lanes stay clear
      const off = road.w >= 8 ? road.w / 2 - 0.95 : road.w / 2 + 0.95;
      x = tmp[0] + (-tmp[3]) * off * side; y = tmp[1] + tmp[2] * off * side;
      h = Math.atan2(tmp[3], tmp[2]) + (side < 0 ? Math.PI : 0);
    }
    const surf = g.world.surfaceAt(x, y);
    if (surf === S.BUILDING || surf === S.WATER) return null;
    for (const o of g.nearbyVehicles(x, y, 8)) if (Math.hypot(o.x - x, o.y - y) < 5.5) return null;
    const zone = this.zoneAt(x, y, road);
    const model = g.assets.pickVehicle(rng, zone, (m) => m.kind === 'car' || m.kind === 'truck' || (m.kind === 'motorbike' && rng() < 0.3));
    if (!model) return null;
    const v = new Vehicle(g, model, x, y, h, model.paint && model.paint.length ? g.assets.randomPaint(rng) : -1);
    v.parked = true;
    if (g.world.collideCircle(x, y, Math.min(v.len, v.wid) * 0.5) || !this.clearOfOtherRoads(v, road)) return null;
    g.addVehicle(v);
    return v;
  }

  clearOfOtherRoads(v, parkingRoad) {
    // An aisle can run all the way to Main Street. Its last perpendicular
    // parking spot can put the whole vehicle across a through lane.
    const body = [];
    const radius = v.circlePositions(body) + 0.35;
    const search = v.radius + 30;
    let clear = true;
    this.game.world.forEachInRect('roads', v.x - search, v.y - search, v.x + search, v.y + search, road => {
      if (road === parkingRoad || road.cls === RC.PATH) return;
      for (let i = 0; i < body.length; i += 3) {
        const p = projectS(road, body[i], body[i + 1]);
        if (p.d < road.w / 2 + radius && Math.abs(zAt(road, 1, p.s) - v.z) < 2.5) {
          clear = false;
          return false;
        }
      }
    });
    return clear;
  }
}
