// Side activities: taxi fares, vigilante (police cars), paramedic (ambulances), firefighter, rampages.
import { input } from '../engine/input.js';
import { Ped } from '../entities/ped.js';
import { Vehicle } from '../entities/vehicle.js';
import { DriverAI } from './traffic.js';
import { WalkerAI } from './pedai.js';
import { MissionPedAI } from './missions.js';
import { rng, mulberry32 } from '../engine/math.js';
import { cum, pointAt } from './roads.js';
import { RC } from '../world/shared.js';
import { WEAPONS } from '../data/weapons.js';

const tmp = [0, 0, 0, 0];

function jobKind(v) {
  const id = (v.m.id + ' ' + v.m.name + ' ' + (v.m.class || '')).toLowerCase();
  if (/taxi|cab/.test(id)) return 'taxi';
  if (v.m.siren === 'police' || v.m.role === 'police') return 'vigilante';
  if (v.m.siren === 'ambulance' || /ambulance/.test(id)) return 'paramedic';
  if (v.m.siren === 'fire' || /fire/.test(id)) return 'firefighter';
  return null;
}

export class Jobs {
  constructor(game) {
    this.game = game;
    this.job = null;          // {kind, level, target, ...}
    this.hintT = 0;
    const r = mulberry32(4242);
    // rampage tokens at notable parks / landmarks around the metro
    const spots = game.world.pois.filter((p) => /leisure=park|leisure=stadium|amenity=parking/.test(p.k));
    const weps = ['smg', 'shotgun', 'rifle', 'molotov', 'grenade', 'flamer', 'minigun', 'rocket', 'pistol', 'bat', 'sniper', 'revolver'];
    this.rampages = [];
    for (let i = 0; i < 24 && spots.length; i++) {
      const p = spots[Math.floor(r() * spots.length)];
      const w = weps[i % weps.length];
      this.rampages.push({ id: i, x: p.x + 5, y: p.y + 5, weapon: w, goal: w === 'rocket' || w === 'grenade' ? 8 : 20, cars: w === 'rocket' || w === 'grenade', time: 120, done: false });
    }
  }

  get active() { return !!this.job; }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl || g.respawning || g.missions?.retrying) return;
    const v = pl.vehicle;
    // rampage tokens
    if (!this.job && !(g.missions && g.missions.active)) {
      for (const rp of this.rampages) {
        if (rp.done || Math.abs(rp.x - pl.x) > 3 || Math.abs(rp.y - pl.y) > 3) continue;
        if (Math.hypot(rp.x - pl.x, rp.y - pl.y) < 1.8 && !v) this.startRampage(rp);
      }
    }
    if (!this.job) {
      if (v && v.driver === pl.ped && !g.missions?.quickRetry && !g.missions?.active) {
        const k = jobKind(v);
        if (k) {
          if (this.hintT <= 0) { g.hud.message(`Press {phone} to start ${k === 'taxi' ? 'Taxi fares' : k === 'vigilante' ? 'Vigilante' : k === 'paramedic' ? 'Paramedic' : 'Firefighter'} missions.`, 4); this.hintT = 30; }
          if (input.wasPressed('phone')) this.start(k, v);
        }
      }
      this.hintT -= dt;
      return;
    }
    const J = this.job;
    if (J.kind === 'rampage') return this.updateRampage(dt);
    if (input.wasPressed('phone') || (J.vehicle && (J.vehicle.dead || pl.vehicle !== J.vehicle) && (J.leaveT = (J.leaveT || 0) + dt) > 8)) return this.end(J.vehicle && J.vehicle.dead ? 'Vehicle destroyed.' : 'Job ended.');
    if (pl.vehicle === J.vehicle) J.leaveT = 0;
    J.time -= dt;
    g.hud.timer = { label: J.kind.toUpperCase(), value: J.time };
    if (J.time <= 0) return this.end('Out of time.');
    if (J.kind === 'taxi') this.updateTaxi(dt);
    else if (J.kind === 'vigilante') this.updateVigilante(dt);
    else if (J.kind === 'paramedic') this.updateParamedic(dt);
    else if (J.kind === 'firefighter') this.updateFire(dt);
  }

  start(kind, v) {
    const g = this.game;
    this.job = { kind, vehicle: v, level: 1, time: 0, earned: 0, stage: 'find' };
    g.audio.play('mission_start');
    g.hud.bigMessage(kind.toUpperCase(), 'Press {phone} to quit', '#f2b233', 2.5);
    this.next();
  }

  end(reason) {
    const g = this.game, J = this.job;
    if (!J) return;
    for (const e of J.cleanup || []) { e.blip = null; e.mission = false; e.persist = false; }
    if (J.marker) { const i = g.markers.indexOf(J.marker); if (i >= 0) g.markers.splice(i, 1); }
    g.hud.timer = null; g.hud.counter = null;
    g.hud.bigMessage(`${J.kind.toUpperCase()} OVER`, `${reason}  Earned $${J.earned}`, '#d9452b', 3);
    this.job = null;
  }

  setMarker(x, y, col = '#f2c233') {
    const g = this.game, J = this.job;
    if (J.marker) { const i = g.markers.indexOf(J.marker); if (i >= 0) g.markers.splice(i, 1); }
    J.marker = { x, y, r: 4, col, flash: true };
    g.markers.push(J.marker);
  }
  clearMarker() { const g = this.game, J = this.job; if (J && J.marker) { const i = g.markers.indexOf(J.marker); if (i >= 0) g.markers.splice(i, 1); J.marker = null; } }

  // random roadside spot dist away
  spot(minD, maxD, sidewalk = false) {
    const g = this.game, pl = g.player;
    for (let t = 0; t < 12; t++) {
      const a = rng() * Math.PI * 2, d = minD + rng() * (maxD - minD);
      const x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d;
      if (!g.world.isLoadedAt(x, y)) continue;
      const near = g.world.nearestRoad(x, y, 60, (r) => r.cls >= 2 && r.cls <= 7);
      if (!near) continue;
      cum(near.road);
      pointAt(near.road, 1, near.s, sidewalk ? near.road.w / 2 + 2 : 0, tmp);
      return { x: tmp[0], y: tmp[1], h: Math.atan2(tmp[3], tmp[2]), road: near.road };
    }
    return null;
  }

  next() {
    const g = this.game, J = this.job;
    J.stage = 'find';
    J.cleanup = J.cleanup || [];
    if (J.kind === 'taxi') {
      const s = this.spot(80, 260, true);
      if (!s) return this.end('No fares around.');
      const ped = new Ped(g, g.assets.pickPed(rng, 'urban'), s.x, s.y, 0);
      ped.persist = true; ped.mission = true; ped.blip = '#4af';
      ped.ai = new MissionPedAI(g, ped, 'idle', {});
      g.peds.push(ped);
      J.fare = ped; J.cleanup.push(ped);
      J.time = Math.max(J.time, 0) + 45;
      g.hud.setObjective('Pick up the fare.', 5);
    } else if (J.kind === 'vigilante') {
      const s = this.spot(140, 300);
      if (!s) return this.end('No suspects around.');
      const m = g.assets.pickVehicle(rng, 'urban', (x) => x.kind === 'car');
      const v = new Vehicle(g, m, s.x, s.y, s.h, m.paint && m.paint.length ? g.assets.randomPaint(rng) : -1);
      const d = new Ped(g, g.assets.pickPed(rng, 'urban'), v.x, v.y);
      d.give(J.level > 3 ? 'smg' : 'pistol', 200); d.weapon = J.level > 3 ? 'smg' : 'pistol';
      v.driver = d; d.vehicle = v;
      v.ai = new DriverAI(g, v, s.road, 1, 0, 0); v.ai.reassign(); v.ai.mode = 'flee'; v.ai.style = 1.25;
      d.ai = { kind: 'driver' };
      v.persist = true; v.mission = true; v.blip = '#e33'; v.health = v.maxHealth = 600 + J.level * 120;
      g.addVehicle(v); g.peds.push(d);
      J.suspect = v; J.cleanup.push(v, d);
      J.time = Math.max(J.time, 0) + 90 + J.level * 5;
      g.hud.setObjective(`Level ${J.level}: take out the suspect vehicle.`, 5);
    } else if (J.kind === 'paramedic') {
      const n = Math.min(3, 1 + Math.floor(J.level / 3));
      J.patients = [];
      for (let i = 0; i < n; i++) {
        const s = this.spot(100, 280, true);
        if (!s) continue;
        const p = new Ped(g, g.assets.pickPed(rng, 'urban'), s.x, s.y, 0);
        p.persist = true; p.mission = true; p.blip = '#7ed36b'; p.lying = true; p.health = 30;
        p.ai = new MissionPedAI(g, p, 'idle', {});
        g.peds.push(p); J.patients.push(p); J.cleanup.push(p);
      }
      if (!J.patients.length) return this.end('No patients around.');
      J.picked = 0;
      J.time = Math.max(J.time, 0) + 60 + n * 30;
      g.hud.setObjective(`Level ${J.level}: pick up ${J.patients.length} patient(s).`, 5);
    } else if (J.kind === 'firefighter') {
      const s = this.spot(140, 320);
      if (!s) return this.end('No fires around.');
      const m = g.assets.pickVehicle(rng, 'urban', (x) => x.kind === 'car');
      const v = new Vehicle(g, m, s.x, s.y, s.h);
      v.fire = 999; v.health = v.maxHealth * 0.1; v.persist = true; v.mission = true; v.blip = '#f80';
      g.addVehicle(v);
      J.burning = v; J.douse = 0; J.cleanup.push(v);
      J.time = Math.max(J.time, 0) + 70;
      g.hud.setObjective(`Level ${J.level}: put out the car fire (park next to it).`, 5);
    }
  }

  reward(base) {
    const g = this.game, J = this.job;
    const amt = Math.round(base);
    g.player.addMoney(amt); J.earned += amt;
    g.audio.play('cash');
    g.effects.text(g.player.x, g.player.y, '+$' + amt);
    J.level++;
    if (J.level % 5 === 0) { g.player.addMoney(J.level * 200); g.hud.bigMessage(`${J.kind.toUpperCase()} LEVEL ${J.level}`, `Bonus $${J.level * 200}`, '#7ed36b', 3); }
    this.next();
  }

  updateTaxi(dt) {
    const g = this.game, J = this.job, pl = g.player, v = J.vehicle;
    const f = J.fare;
    if (!f || f.dead) { this.clearMarker(); g.hud.message('Fare lost!', 2); J.fare = null; this.next(); return; }
    if (J.stage === 'find') {
      if (Math.hypot(f.x - v.x, f.y - v.y) < 7 && v.speed < 2) {
        f.vehicle = v; v.passengers.push(f); f.blip = null;
        const dest = this.spot(400, 1400, true);
        if (!dest) { this.end('No destination.'); return; }
        J.dest = dest; J.stage = 'ride';
        J.fareDist = Math.hypot(dest.x - v.x, dest.y - v.y);
        J.time = Math.max(J.time, 25 + J.fareDist / 11);
        const poi = this.nearestPoiName(dest.x, dest.y);
        this.setMarker(dest.x, dest.y, '#7ed36b');
        g.hud.setObjective(`Take the fare to ${poi}.`, 6);
      }
    } else if (J.stage === 'ride') {
      if (Math.hypot(J.dest.x - v.x, J.dest.y - v.y) < 9 && v.speed < 2) {
        v.passengers = v.passengers.filter((p) => p !== f);
        f.vehicle = null; f.x = v.x + 2; f.y = v.y; f.mission = false; f.persist = false;
        f.ai = new WalkerAI(g, f, null, 1, 1, 0); f.ai.state = 'wander';
        this.clearMarker();
        this.reward(15 + J.fareDist * 0.035 + Math.max(0, J.time) * 0.5);
      }
    }
  }
  nearestPoiName(x, y) {
    let best = null, bd = 400;
    for (const p of this.game.world.pois) { if (Math.abs(p.x - x) > bd || Math.abs(p.y - y) > bd) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.n; } }
    return best || (this.game.world.cityAt(x, y) || 'the marker');
  }
  updateVigilante() {
    const J = this.job, s = J.suspect;
    if (s && (s.dead || s.sunk || (s.driver && s.driver.dead) || !s.driver)) { this.reward(120 * J.level); }
  }
  updateParamedic() {
    const g = this.game, J = this.job, v = J.vehicle;
    for (const p of J.patients) {
      if (p.picked || p.dead) continue;
      if (Math.hypot(p.x - v.x, p.y - v.y) < 7 && v.speed < 2) { p.picked = true; p.blip = null; p.vehicle = v; v.passengers.push(p); J.picked++; g.audio.play('pickup'); J.time += 8; }
    }
    const remaining = J.patients.filter((p) => !p.picked && !p.dead).length;
    if (remaining === 0 && J.picked > 0 && J.stage === 'find') {
      J.stage = 'hospital';
      const h = g.nearest(g.hospitals);
      J.hosp = h;
      this.setMarker(h.x, h.y, '#7ed36b');
      g.hud.setObjective(`Rush the patients to ${h.name || 'the hospital'}.`, 6);
    }
    if (J.stage === 'hospital' && Math.hypot(J.hosp.x - v.x, J.hosp.y - v.y) < 30 && v.speed < 3) {
      for (const p of J.patients) { if (p.vehicle === v) { v.passengers = v.passengers.filter((q) => q !== p); g.removePed(p); } }
      this.clearMarker();
      this.reward(90 * J.level * J.picked);
    }
    if (J.stage === 'find' && J.patients.every((p) => p.dead)) { this.end('The patients died.'); }
  }
  updateFire(dt) {
    const g = this.game, J = this.job, v = J.vehicle, b = J.burning;
    if (!b || b.dead) { if (b && b.dead) { this.end('The car exploded.'); } return; }
    b.fire = 999;
    if (Math.hypot(b.x - v.x, b.y - v.y) < 12 && v.speed < 3) {
      J.douse += dt;
      g.hud.bar2 = { label: 'EXTINGUISH', value: J.douse / 3, col: '#5aa0e8' };
      if (Math.random() < dt * 30) g.effects.splash(b.x + (rng() - 0.5) * 2, b.y + (rng() - 0.5) * 2, 0.4);
      if (J.douse > 3) { b.fire = 0; b.blip = null; g.hud.bar2 = null; this.reward(100 * J.level); }
    }
  }

  // ---------------------------------------------------------------- rampages
  startRampage(rp) {
    const g = this.game, P = g.player.ped;
    this.job = { kind: 'rampage', rp, kills: 0, time: rp.time, prevWeapon: P.weapon, earned: 0 };
    P.give(rp.weapon, WEAPONS[rp.weapon].clip > 1 ? WEAPONS[rp.weapon].clip * 20 : 40);
    P.weapon = rp.weapon;
    g.audio.play('mission_start');
    g.hud.bigMessage('RAMPAGE!', `${rp.cars ? 'Destroy' : 'Waste'} ${rp.goal} ${rp.cars ? 'vehicles' : 'people'} in ${rp.time}s`, '#d9452b', 3);
    this.job.onKill = (what) => { if ((what === 'car') === !!rp.cars) this.job.kills++; };
  }
  updateRampage(dt) {
    const g = this.game, J = this.job;
    J.time -= dt;
    g.hud.timer = { label: 'RAMPAGE', value: J.time };
    g.hud.counter = { label: J.rp.cars ? 'WRECKED' : 'KILLS', value: J.kills, max: J.rp.goal };
    if (J.kills >= J.rp.goal) {
      J.rp.done = true;
      const amt = 4000 + J.rp.goal * 100;
      g.player.addMoney(amt); g.player.stats.rampages++;
      g.audio.play('mission_pass');
      g.hud.bigMessage('RAMPAGE COMPLETE', `$${amt}`, '#7ed36b', 3.5);
      g.hud.timer = null; g.hud.counter = null; this.job = null;
    } else if (J.time <= 0 || g.player.ped.dead) {
      g.audio.play('mission_fail');
      g.hud.bigMessage('RAMPAGE FAILED', '', '#d9452b', 3);
      g.hud.timer = null; g.hud.counter = null; this.job = null;
    }
  }
  notifyKill(kind) { if (this.job && this.job.kind === 'rampage' && this.job.onKill) this.job.onKill(kind); }
  blips(out) {
    for (const rp of this.rampages) if (!rp.done) out.push({ x: rp.x, y: rp.y, col: '#d9452b', shape: 'square', size: 3 });
  }
  drawTokens(game) {
    const R = game.renderer;
    const def = game.assets.props.get('pickup_rampage');
    if (!def) return;
    const [x0, y0, x1, y1] = game.cam.viewRect(4);
    for (const rp of this.rampages) {
      if (rp.done || rp.x < x0 || rp.x > x1 || rp.y < y0 || rp.y > y1) continue;
      R.add(rp.x, rp.y, 0.5, (ctx, c) => def.sprite.draw(ctx, c, rp.x, rp.y, game.time * 2, { z: 0.4 + Math.sin(game.time * 3) * 0.2, scale: 1.4 }));
    }
  }
}
