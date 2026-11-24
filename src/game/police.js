// Wanted level + police response: pursuit cars, foot cops, arrests, helicopter, roadblocks, evasion.
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/ped.js';
import { DriverAI } from './traffic.js';
import { RC, F } from '../world/shared.js';
import { pointAt, laneOffset, cum } from './roads.js';
import { rng, clamp } from '../engine/math.js';

const THRESH = [0, 1, 4, 10, 20, 34, 52];
const CRIME = { carjack: 1.2, steal: 0.8, hit_ped: 0.6, kill_ped: 2.5, assault: 0.6, shoot: 1.2, kill_cop: 7, attack_cop: 3, explosion: 2.2, destroy_vehicle: 1.8, attack_police_car: 2.5, steal_cop_car: 3, rampage: 0 };

export class Police {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.level = 0;
    this.lastSeen = 0;       // seconds since a cop saw the player
    this.searchT = 0;
    this.spawnT = 0;
    this.units = new Set();  // cop vehicles
    this.heli = null;
    this.flash = 0;
    this.lastKnown = null;
    this.maxLevel = 6;
    this.frozen = false;
  }

  get stars() { return this.level; }

  setLevel(l) {
    l = clamp(Math.round(l), 0, this.maxLevel);
    const prev = this.level;
    this.level = l;
    this.heat = THRESH[l] + (l > 0 ? 0.5 : 0);
    this.lastSeen = 0; // a fresh report: the evasion clock restarts
    if (l > prev) { this.game.audio.play('wanted_up'); this.flash = 2; }
    if (this.game.player) this.lastKnown = [this.game.player.x, this.game.player.y];
    if (l === 0 && prev > 0) { this.game.audio.play('wanted_lost'); this.clearUnits(false); }
  }

  // crime committed by player at (x,y). witnessed check: any cop within range with LOS, or chance for civilians
  crime(type, x, y) {
    if (this.frozen) return;
    const g = this.game;
    let w = CRIME[type] || 1;
    const cop = this.copNear(x, y, 70, true) || (this.heli && !this.heli.dead && Math.hypot(this.heli.x - x, this.heli.y - y) < 70 ? this.heli : null);
    const loud = type === 'kill_ped' || type === 'shoot' || type === 'explosion' || type === 'kill_cop' || type === 'attack_cop' || type === 'attack_police_car';
    // a cop who sees it reports it in full; otherwise a civilian may phone it in (always, for loud crimes once
    // the police are already looking). Unwitnessed fender-benders and bumped pedestrians count for less.
    let witnessed = !!cop;
    if (!witnessed) witnessed = rng() < (loud ? 0.8 : type === 'carjack' ? 0.35 : this.level > 0 ? 0.45 : 0.25);
    if (!witnessed) return;
    if (!cop && !loud) w *= 0.6;
    if (cop) this.lastSeen = 0;
    this.addHeat(w * (g.difficulty || 1));
    this.lastKnown = [x, y];
  }
  addHeat(h) {
    this.heat += h;
    let l = 0;
    for (let i = 1; i < THRESH.length; i++) if (this.heat >= THRESH[i]) l = i;
    l = Math.min(l, this.maxLevel);
    if (l > this.level) { this.level = l; this.game.audio.play('wanted_up'); this.flash = 2; this.game.hud && this.game.hud.pulseStars(); this.dispatchCall(l); }
  }
  // voiced police-radio callouts (Qwen3-TTS lines in src/story/radio.js)
  dispatchCall(level, kind) {
    const g = this.game, V = g.missions && g.missions.voice;
    if (!V || g.dialogActive || (this.lastCall != null && g.time - this.lastCall < 12)) return;
    let id;
    if (kind) id = kind;
    else if (level >= 5) id = 'disp_swat';
    else if (level >= 3 && !this.heli) id = 'disp_heli';
    else {
      const P = g.player, vx = P.vx, vy = P.vy;
      if (Math.hypot(vx, vy) > 4 && Math.random() < 0.6) id = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'disp_dir_e' : 'disp_dir_w') : (vy > 0 ? 'disp_dir_s' : 'disp_dir_n');
      else id = 'disp_up_' + (1 + Math.floor(Math.random() * 4));
    }
    if (!V[id]) return;
    this.lastCall = g.time;
    g.audio.playVoice('assets/voice/' + V[id], {channel: 'dispatch'}).catch(() => { });
  }
  // gunfire etc: alerts nearby peds and cops
  noise(x, y, by, loud = 1) {
    const g = this.game;
    for (const p of g.nearbyPeds(x, y, 25 + loud * 10)) {
      if (p === by || p.dead || p.isPlayer) continue;
      if (p.ai && p.ai.panic && !p.isCop) p.ai.panic(x, y, 6 + loud * 2);
    }
    if (by && by.isPlayer && loud > 0) {
      const cop = this.copNear(x, y, 60, true);
      if (cop) this.crime('shoot', x, y);
      else if (rng() < 0.08 * loud) this.crime('shoot', x, y);
    }
  }

  copNear(x, y, r, needLOS) {
    const g = this.game;
    for (const p of g.nearbyPeds(x, y, r)) {
      if (!p.isCop || p.dead) continue;
      if (!needLOS || g.world.lineOfSight(p.x, p.y, x, y)) return p;
    }
    return null;
  }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl) return;
    if (this.flash > 0) this.flash -= dt;
    const P = pl.vehicle || pl.ped;
    // cop units bookkeeping
    for (const v of [...this.units]) if (v.dead || !g.vehicles.includes(v)) this.units.delete(v);
    // does any cop see the player?
    let seen = false;
    for (const p of g.nearbyPeds(P.x, P.y, 80)) {
      if (!p.isCop || p.dead) continue;
      if (Math.hypot(p.x - P.x, p.y - P.y) < 80 && g.world.lineOfSight(p.x, p.y, P.x, P.y)) { seen = true; break; }
    }
    if (this.heli && !this.heli.dead && Math.hypot(this.heli.x - P.x, this.heli.y - P.y) < 70) seen = true;
    if (seen) { this.lastSeen = 0; this.lastKnown = [P.x, P.y]; } else this.lastSeen += dt;
    if (this.level > 0) {
      // evasion: out of sight long enough -> drop a level
      const need = 8 + this.level * 4;
      this.searching = this.lastSeen > 3;
      if (this.lastSeen > need) {
        this.level -= 1; this.heat = THRESH[this.level] + 0.2; this.lastSeen = 0;
        if (this.level === 0) { g.audio.play('wanted_lost'); this.clearUnits(true); this.dispatchCall(0, 'disp_lost'); }
      }
      // dispatch
      this.spawnT -= dt;
      const want = [0, 2, 3, 5, 7, 9, 12][this.level];
      if (this.spawnT <= 0 && this.units.size < want) { this.spawnT = Math.max(1.2, 5 - this.level * 0.6); this.dispatchCar(); }
      if (this.level >= 3 && (!this.heli || this.heli.dead)) this.dispatchHeli();
      if (this.level >= 4) { this.rbT = (this.rbT || 0) - dt; if (this.rbT <= 0) { this.rbT = 25; this.roadblock(); } }
      // steer pursuers
      for (const v of this.units) {
        if (v.ai && v.driver) { v.ai.mode = 'pursue'; v.ai.target = this.searching && this.lastKnown ? this.lastKnown : [P.x, P.y]; v.ai.targetV = [P.vx || 0, P.vy || 0]; v.ai.targetSpeed = Math.hypot(P.vx || 0, P.vy || 0); v.sirenOn = true; }
      }
    } else {
      this.searching = false;
      for (const v of this.units) { v.sirenOn = false; if (v.ai) v.ai.mode = 'cruise'; }
    }
    // helicopter
    if (this.heli && !this.heli.dead) this.updateHeli(dt, P);
  }

  makeCopPed(x, y, kind = 'cop') {
    const g = this.game;
    const p = new Ped(g, g.assets.special(kind), x, y);
    p.isCop = true; p.faction = 'police';
    p.give('pistol', 120); p.weapon = 'pistol';
    if (kind === 'swat') { p.give('rifle', 300); p.weapon = 'rifle'; p.armor = 60; p.health = 140; }
    if (kind === 'trooper') { p.give('shotgun', 60); p.weapon = 'shotgun'; p.health = 120; }
    p.accuracy = 2.2 - this.level * 0.15;
    p.dmgMul = 0.35 + this.level * 0.05;
    p.ai = new CopAI(g, p);
    return p;
  }

  copModel(kind = 'car') {
    const g = this.game, A = g.assets, lvl = this.level;
    const pick = (ids) => { const l = ids.map((i) => A.vehicle(i)).filter(Boolean); return l.length ? l[Math.floor(rng() * l.length)] : null; };
    let m = null;
    if (kind === 'car') {
      if (lvl >= 5) m = pick(rng() < 0.5 ? ['arkvalley_tactical'] : ['cimarron_pursuit', 'arkvalley_tactical', 'osage_meridian_detective']);
      else if (lvl >= 3) m = pick(['cimarron_pursuit', 'osage_ledger_police', 'redfork_outrider_police', 'osage_meridian_detective', 'redfork_roughneck_sheriff']);
      else {
        const rural = g.world.densityAt(g.player.x, g.player.y) === 0;
        m = pick(rural ? ['redfork_roughneck_sheriff', 'cimarron_lawman', 'redfork_outrider_police'] : ['osage_ledger_police', 'redfork_outrider_police', 'cimarron_lawman', 'ozark_longroad_patrol']);
      }
    }
    if (!m) { const list = A.byRole('police').filter((v) => kind === 'car' ? (v.kind === 'car' || v.kind === 'truck') : v.kind === kind); m = list[Math.floor(rng() * list.length)]; }
    return m || A.vehicles.find((v) => v.kind === 'car');
  }

  dispatchCar() {
    const g = this.game, pl = g.player;
    const P = pl.vehicle || pl.ped;
    const near = g.traffic.findSpot(P, 120, 210, (r) => r.cls <= 7 || (r.cls >= 10 && r.cls <= 14));
    if (!near) return;
    const road = near.road; cum(road);
    // head toward the player
    pointAt(road, 1, near.s, 0, this._t || (this._t = [0, 0, 0, 0]));
    const t = this._t;
    let dir = ((P.x - t[0]) * t[2] + (P.y - t[1]) * t[3]) > 0 ? 1 : -1;
    if (road.flags & F.ONEWAY) dir = 1;
    const s = dir > 0 ? near.s : road.len - near.s;
    pointAt(road, dir, s, laneOffset(road, 0, dir), t);
    const model = this.copModel('car');
    if (!model) return;
    const v = new Vehicle(g, model, t[0], t[1], Math.atan2(t[3], t[2]));
    v.vx = t[2] * 12; v.vy = t[3] * 12;
    const kind = this.level >= 5 ? (rng() < 0.5 ? 'swat' : 'trooper') : this.level >= 4 && rng() < 0.4 ? 'trooper' : 'cop';
    const d = this.makeCopPed(v.x, v.y, kind);
    d.vehicle = v; v.driver = d;
    if (this.level >= 2) { const p2 = this.makeCopPed(v.x, v.y, kind); p2.vehicle = v; v.passengers.push(p2); g.peds.push(p2); }
    v.ai = new DriverAI(g, v, road, dir, 0, s);
    v.ai.cop = true; v.ai.mode = 'pursue'; v.ai.style = 1.2;
    v.sirenOn = true; v.copUnit = true;
    g.addVehicle(v); g.peds.push(d);
    this.units.add(v);
  }

  dispatchHeli() {
    const g = this.game, pl = g.player;
    const P = pl.vehicle || pl.ped;
    let model = g.assets.vehicles.find((m) => m.kind === 'heli' && m.role === 'police') || g.assets.vehicles.find((m) => m.kind === 'heli');
    if (!model) return;
    const a = rng() * Math.PI * 2;
    const v = new Vehicle(g, model, P.x + Math.cos(a) * 160, P.y + Math.sin(a) * 160, a + Math.PI);
    v.alt = 40; v.heliAltTarget = 40;
    const d = this.makeCopPed(v.x, v.y, 'swat');
    d.vehicle = v; v.driver = d; v.persist = true; v.copUnit = true;
    g.addVehicle(v); g.peds.push(d);
    this.heli = v;
  }

  updateHeli(dt, P) {
    const v = this.heli, g = this.game;
    if (this.level < 3) {
      // fly away and despawn
      v.ctrl.throttle = 1; v.ctrl.steer = 0;
      if (Math.hypot(v.x - P.x, v.y - P.y) > 260) { g.removeVehicle(v); this.heli = null; }
      return;
    }
    const lk = this.lastKnown || [P.x, P.y];
    const tx = (this.searching ? lk[0] : P.x), ty = (this.searching ? lk[1] : P.y);
    const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy);
    const want = Math.atan2(dy, dx);
    const err = Math.atan2(Math.sin(want - v.h), Math.cos(want - v.h));
    v.ctrl.steer = clamp(err * 2, -1, 1);
    v.ctrl.throttle = d > 25 ? clamp(d / 60, 0.2, 1) : 0;
    v.ctrl.brake = d < 15 ? 0.6 : 0;
    // spotlight follows target
    v.spotX = (v.spotX ?? v.x) + (tx - (v.spotX ?? v.x)) * Math.min(1, dt * 2.5);
    v.spotY = (v.spotY ?? v.y) + (ty - (v.spotY ?? v.y)) * Math.min(1, dt * 2.5);
    // sniper at 4+ stars
    if (this.level >= 4 && v.driver && d < 50 && !this.searching) {
      const sh = v.driver;
      sh.x = v.x; sh.y = v.y;
      sh.fireT = (sh.fireT || 0) - dt;
      if (sh.fireT <= 0) {
        sh.fireT = 0.9;
        const a = Math.atan2(P.y - v.y, P.x - v.x);
        const target = g.player.vehicle || g.player.ped;
        if (rng() < 0.35) {
          g.effects.tracer(v.x, v.y, target.x, target.y, '#fff', 6);
          g.audio.play('rifle', { x: v.x, y: v.y, vol: 0.8 });
          if (g.player.vehicle) g.player.vehicle.damage(25, sh); else g.player.ped.damage(9, sh, 'bullet');
        } else { g.effects.tracer(v.x, v.y, target.x + (rng() - 0.5) * 4, target.y + (rng() - 0.5) * 4, '#fff', 6); g.audio.play('rifle', { x: v.x, y: v.y, vol: 0.6 }); }
      }
    }
  }

  roadblock() {
    const g = this.game, pl = g.player;
    if (!pl.vehicle) return;
    const v0 = pl.vehicle;
    const ahead = 140;
    const x = v0.x + Math.cos(v0.h) * ahead, y = v0.y + Math.sin(v0.h) * ahead;
    const near = g.world.nearestRoad(x, y, 50, (r) => r.cls <= 6 || (r.cls >= 10 && r.cls <= 14));
    if (!near || g.onScreen(near.x, near.y, 5)) return;
    const road = near.road; cum(road);
    const t = [0, 0, 0, 0];
    pointAt(road, 1, near.s, 0, t);
    const nx = -t[3], ny = t[2];
    const half = road.w / 2;
    const model = this.copModel('car');
    for (const off of [-half * 0.5, half * 0.5]) {
      const v = new Vehicle(g, model, t[0] + nx * off, t[1] + ny * off, Math.atan2(ny, nx) + (off < 0 ? 0 : Math.PI));
      v.sirenOn = true; v.copUnit = true; v.roadblock = true; v.persist = false;
      g.addVehicle(v);
      const c = this.makeCopPed(v.x + t[2] * 3, v.y + t[3] * 3, this.level >= 5 ? 'swat' : 'cop');
      g.peds.push(c);
    }
    const bar = g.assets.props.get('barricade');
    if (bar) g.addProp('barricade', t[0], t[1], Math.atan2(ny, nx), { temp: 90 });
    this.dispatchCall(this.level, 'disp_block');
  }

  clearUnits(driveOff) {
    for (const v of this.units) { v.sirenOn = false; if (v.ai) { v.ai.mode = 'cruise'; } }
    this.units.clear();
    if (this.heli) { this.heli.persist = false; }
    const g = this.game;
    for (const p of g.peds) if (p.isCop && !p.vehicle && p.ai) p.ai.calmDown && p.ai.calmDown();
  }
}

// Cop on foot (also drives the cop's behaviour while inside a car)
export class CopAI {
  constructor(game, p) { this.game = game; this.p = p; this.kind = 'cop'; this.bustT = 0; this.t = 0; this.calm = false; }
  calmDown() { this.calm = true; }
  onDamage(by) { if (by && by.isPlayer) { this.game.police.crime('attack_cop', this.p.x, this.p.y); this.calm = false; } }
  update(dt) {
    const g = this.game, p = this.p, pol = g.police, pl = g.player;
    if (p.dead) return;
    p.aiming = false;
    // in a car: hop out if the player is on foot nearby or their car stopped close by
    if (p.vehicle) {
      const v = p.vehicle;
      const target = pl.vehicle || pl.ped;
      const d = Math.hypot(target.x - v.x, target.y - v.y);
      if (pol.level > 0 && v.speed < 3 && d < 22 && !v.isHeli && (!pl.vehicle || pl.vehicle.speed < 4)) g.exitVehicle(p, true);
      return;
    }
    if (this.calm || pol.level === 0) {
      // return to car if any nearby; otherwise just walk away
      p.move.x = 0; p.move.y = 0;
      this.t += dt;
      if (this.t > 20 && !g.onScreen(p.x, p.y, 5)) g.removePed(p);
      return;
    }
    const T = pl.vehicle ? pl.vehicle : pl.ped;
    const dx = T.x - p.x, dy = T.y - p.y, d = Math.hypot(dx, dy);
    p.face = Math.atan2(dy, dx);
    const los = d < 70 && g.world.lineOfSight(p.x, p.y, T.x, T.y);
    if (pol.level >= 2 && los && d < 32) {
      // shoot
      p.aiming = true;
      if (d > 9) { p.move.x = dx / d * 0.4; p.move.y = dy / d * 0.4; p.moveSpeed = 1.5; }
      else { p.move.x = 0; p.move.y = 0; }
      if (rng() < 0.6) g.combat.tryFire(p, p.face);
      if (d < 1.8 && !pl.vehicle) this.tryBust(dt);
      return;
    }
    if (d > 1.2) { p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = 5.2; }
    else { p.move.x = 0; p.move.y = 0; }
    if (d < 2.2) this.tryBust(dt);
    else this.bustT = 0;
  }
  tryBust(dt) {
    const g = this.game, pl = g.player;
    if (pl.vehicle && pl.vehicle.speed > 2) { this.bustT = 0; return; }
    // story missions that keep the heat at one star don't end in handcuffs
    const run = g.missions && g.missions.active;
    if (run && run.maxWantedCap != null && run.maxWantedCap <= 1) { this.bustT = 0; return; }
    if (pl.ped.knock > 0 && !pl.vehicle) { this.bustT += dt * 2; }
    // a player who keeps running slips the cuffs
    else if (!pl.vehicle && (pl.ped.curSpeed || 0) > 5) { this.bustT = Math.max(0, this.bustT - dt); return; }
    this.bustT += dt;
    if (this.bustT > (pl.vehicle ? 1.6 : 1.0)) g.busted();
  }
}
