// Story-driven territory system: faction turf across the metro changes hands as chapters complete.
// Hostile crews attack on sight (incl. drive-bys), allies hang out and defend Polly.
import { Ped } from '../entities/ped.js';
import { Vehicle } from '../entities/vehicle.js';
import { DriverAI } from './traffic.js';
import { WEAPONS } from '../data/weapons.js';
import { rng } from '../engine/math.js';
import { cum, pointAt } from './roads.js';
import { RC, S } from '../world/shared.js';

export const FACTIONS = {
  syndicate: { name: 'Gusher Syndicate', color: '#d8b04a', model: 'gusher', weapons: ['pistol', 'smg', 'shotgun'], car: (m) => /suv|luxury|limo|sedan/i.test(m.class || '') && m.kind !== 'bike' },
  wrenches: { name: 'Rose District Wrenches', color: '#3fb6a8', model: 'wrenches', weapons: ['bat', 'pistol'], car: (m) => /pickup|muscle|truck|lowrider/i.test((m.class || '') + m.id) },
  port_rats: { name: 'Port Rats', color: '#f0a030', model: 'portrats', weapons: ['pistol', 'shotgun'], car: (m) => /van|truck|pickup/i.test((m.class || '') + m.id) },
  riders: { name: 'Red Dirt Riders', color: '#c0502a', model: 'riders', weapons: ['bat', 'pistol', 'shotgun'], car: (m) => m.kind === 'motorbike' },
};

// relation by chapter: functions of the current chapter number (1..9; 9 = story complete)
export const TERRITORIES = [
  { id: 'rose', f: 'wrenches', name: 'Rose District', place: 'rose_district', r: 1000, rel: () => 'ally' },
  { id: 'downtown', f: 'syndicate', name: 'Downtown Tulsa', place: 'bok_tower', r: 1100, rel: (c) => (c >= 2 && c <= 8 ? 'hostile' : 'none') },
  { id: 'southern_hills', f: 'syndicate', name: 'Southern Hills', place: 'southern_hills', r: 1300, rel: (c) => (c >= 2 && c <= 8 ? 'hostile' : 'none') },
  { id: 'jenks', f: 'syndicate', name: 'Jenks Riverfront', place: 'jenks_main', r: 900, rel: (c) => (c === 2 ? 'hostile' : 'none') },
  { id: 'glennpool', f: 'syndicate', name: 'Glenn Pool Oil Field', place: 'glenn_pool_field', r: 2000, rel: (c) => (c >= 3 && c <= 6 ? 'hostile' : 'none') },
  { id: 'port', f: 'port_rats', name: 'Port of Catoosa', place: 'port_catoosa', r: 1500, rel: (c) => (c < 5 ? 'neutral' : 'ally') },
  { id: 'sapulpa', f: 'riders', name: 'Creek County Backroads', place: 'sapulpa_main', r: 3500, rel: (c) => (c < 3 ? 'hostile' : 'ally') },
  { id: 'osage', f: 'riders', name: 'Osage Hills', place: 'skiatook_lake', r: 5000, rel: (c) => (c < 7 ? 'hostile' : 'ally') },
  { id: 'expo', f: 'syndicate', name: 'Expo Square', place: 'expo_square', r: 900, rel: (c) => (c === 8 ? 'hostile' : 'none') },
];

export class Factions {
  constructor(game) {
    this.game = game;
    this.respect = { syndicate: -100, wrenches: 50, port_rats: 0, riders: -20 };
    this.members = new Set();
    this.cars = new Set();
    this.t = 0;
    this.cur = null;
  }
  chapter() { return this.game.missions ? this.game.missions.chapter : 1; }
  territoryAt(x, y) {
    const c = this.chapter();
    for (const T of TERRITORIES) {
      const rel = T.rel(c);
      if (rel === 'none') continue;
      const p = this.game.missions ? this.game.missions.place(T.place) : this.game.places[T.place];
      if (!p) continue;
      if (Math.hypot(p.x - x, p.y - y) < T.r) return { ...T, x: p.x, y: p.y, relation: this.relationOf(T.f, rel) };
    }
    return null;
  }
  relationOf(f, base) {
    // killing allies sours them
    if (base === 'ally' && this.respect[f] < -30) return 'hostile';
    if (base === 'neutral' && this.respect[f] < -30) return 'hostile';
    return base;
  }
  isHostile(f) {
    const c = this.chapter();
    const T = TERRITORIES.find((t) => t.f === f && t.rel(c) !== 'none');
    return T ? this.relationOf(f, T.rel(c)) === 'hostile' : false;
  }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl || g.respawning) return;
    this.t -= dt;
    // cleanup
    for (const p of [...this.members]) if (!g.peds.includes(p)) this.members.delete(p);
    for (const v of [...this.cars]) if (!g.vehicles.includes(v)) this.cars.delete(v);
    if (this.t > 0) return;
    this.t = 0.8;
    const T = this.territoryAt(pl.x, pl.y);
    if ((T && T.id) !== (this.cur && this.cur.id)) {
      if (T) g.hud.message(`${FACTIONS[T.f].name} turf${T.relation === 'hostile' ? ' — hostile!' : T.relation === 'ally' ? ' — friendly' : ''}`, 4);
      this.cur = T;
    }
    if (!T || (g.missions && g.missions.active && T.relation !== 'ally')) return;
    // despawn far members
    for (const p of this.members) if (!p.mission && Math.hypot(p.x - pl.x, p.y - pl.y) > 160 && !g.onScreen(p.x, p.y, 5)) g.removePed(p);
    const want = T.relation === 'hostile' ? 7 : 5;
    let n = 0; for (const p of this.members) if (!p.dead && p.faction === T.f) n++;
    if (n < want) this.spawnGroup(T, 2 + Math.floor(rng() * 2));
    let nc = 0; for (const v of this.cars) if (!v.dead) nc++;
    if (nc < (T.relation === 'hostile' ? 2 : 1) && rng() < 0.4) this.spawnCar(T);
  }

  makeMember(f, x, y) {
    const g = this.game, F = FACTIONS[f];
    const ped = new Ped(g, g.assets.special(F.model), x, y, rng() * 6.28);
    ped.faction = f;
    const w = F.weapons[Math.floor(rng() * F.weapons.length)];
    ped.give(w, WEAPONS[w].clip ? WEAPONS[w].clip * 6 : 0); ped.weapon = w; ped.armed = w;
    ped.health = ped.maxHealth = 90;
    ped.accuracy = 2.0; ped.dmgMul = 0.4;
    ped.ai = new GangAI(g, ped, this);
    this.members.add(ped);
    g.peds.push(ped);
    return ped;
  }

  spawnGroup(T, count) {
    const g = this.game, pl = g.player;
    for (let t = 0; t < 4; t++) {
      const a = rng() * Math.PI * 2, d = 50 + rng() * 60;
      const x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d;
      if (Math.hypot(x - T.x, y - T.y) > T.r) continue;
      const near = g.world.nearestRoad(x, y, 40, (r) => r.cls >= 2 && r.cls <= 8);
      if (!near) continue;
      cum(near.road);
      const tmp = [0, 0, 0, 0];
      pointAt(near.road, 1, near.s, near.road.w / 2 + 2.5, tmp);
      if (g.onScreen(tmp[0], tmp[1], 2)) continue;
      const surf = g.world.surfaceAt(tmp[0], tmp[1]);
      if (surf === S.BUILDING || surf === S.WATER) continue;
      for (let i = 0; i < count; i++) this.makeMember(T.f, tmp[0] + (rng() - 0.5) * 3, tmp[1] + (rng() - 0.5) * 3);
      return;
    }
  }

  spawnCar(T) {
    const g = this.game, F = FACTIONS[T.f];
    const near = g.traffic.findSpot(g.player, 110, 200, (r) => r.cls <= 7);
    if (!near || Math.hypot(near.x - T.x, near.y - T.y) > T.r) return;
    const list = g.assets.vehicles.filter((m) => F.car(m) && m.role !== 'police');
    if (!list.length) return;
    const m = list[Math.floor(rng() * list.length)];
    const road = near.road; cum(road);
    const tmp = [0, 0, 0, 0];
    pointAt(road, 1, near.s, 1.6, tmp);
    const v = new Vehicle(g, m, tmp[0], tmp[1], Math.atan2(tmp[3], tmp[2]), m.paint && m.paint.length ? (T.f === 'syndicate' ? 2 : g.assets.randomPaint(rng)) : -1);
    const d = this.makeMember(T.f, v.x, v.y);
    d.vehicle = v; v.driver = d;
    v.ai = new DriverAI(g, v, road, 1, 0, near.s);
    v.faction = T.f;
    g.addVehicle(v);
    this.cars.add(v);
  }

  // an ally sees Polly get hurt
  onPlayerAttacked(by) {
    if (!by || by.isPlayer) return;
    for (const p of this.members) {
      if (p.dead || p.vehicle || !p.ai) continue;
      if (this.isHostile(p.faction)) continue;
      if (Math.hypot(p.x - by.x, p.y - by.y) < 40) { p.ai.target = by; p.ai.mode = 'attack'; }
    }
  }
  onMemberKilled(p, by) {
    if (by && by.isPlayer && p.faction && this.respect[p.faction] != null) this.respect[p.faction] -= this.isHostile(p.faction) ? 1 : 12;
  }
  blips(out) {
    for (const p of this.members) if (!p.dead && this.isHostile(p.faction) && Math.hypot(p.x - this.game.player.x, p.y - this.game.player.y) < 120) out.push({ x: p.vehicle ? p.vehicle.x : p.x, y: p.vehicle ? p.vehicle.y : p.y, col: FACTIONS[p.faction].color, size: 2.5 });
  }
}

export class GangAI {
  constructor(game, p, fs) { this.game = game; this.p = p; this.fs = fs; this.kind = 'gang'; this.mode = 'hang'; this.t = rng() * 5; this.home = [p.x, p.y]; this.target = null; }
  onDamage(by) {
    if (!by) return;
    this.target = by; this.mode = 'attack';
    // nearby crew joins in
    for (const q of this.fs.members) if (q !== this.p && q.faction === this.p.faction && !q.dead && q.ai && Math.hypot(q.x - this.p.x, q.y - this.p.y) < 30) { q.ai.target = by; q.ai.mode = 'attack'; }
  }
  panic() { }
  update(dt) {
    const g = this.game, p = this.p, pl = g.player;
    if (p.dead) return;
    p.aiming = false;
    const hostile = this.fs.isHostile(p.faction);
    const T = pl.vehicle || pl.ped;
    const dPl = Math.hypot(T.x - p.x, T.y - p.y);
    if (hostile && this.mode !== 'attack' && dPl < 24 && !pl.ped.dead && g.world.lineOfSight(p.x, p.y, T.x, T.y)) { this.mode = 'attack'; this.target = pl.ped; }
    if (p.vehicle) {
      // drive-by: shoot at the player from the car
      if (this.mode === 'attack' && hostile && dPl < 28 && !pl.ped.dead) {
        const a = Math.atan2(T.y - p.y, T.x - p.x);
        if (rng() < 0.5) g.combat.tryFire(p, a, { vehicle: p.vehicle });
        if (p.vehicle.ai) { p.vehicle.ai.mode = 'pursue'; p.vehicle.ai.target = [T.x, T.y]; }
      }
      return;
    }
    if (this.mode === 'attack') {
      const tg = this.target && !this.target.dead ? this.target : null;
      if (!tg || (tg.isPlayer && pl.ped.dead)) { this.mode = 'hang'; return; }
      const tx = tg.vehicle ? tg.vehicle.x : tg.x, ty = tg.vehicle ? tg.vehicle.y : tg.y;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d > 70) { this.mode = 'hang'; return; }
      const w = WEAPONS[p.weapon] || WEAPONS.fists;
      const range = w.type === 'melee' ? 1.2 : Math.min(w.range * 0.6, 22);
      p.face = Math.atan2(dy, dx);
      if (d > range || (w.type !== 'melee' && !g.world.lineOfSight(p.x, p.y, tx, ty))) { p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = 4.4; }
      else { p.move.x = p.move.y = 0; p.aiming = w.type !== 'melee'; if (rng() < 0.6) g.combat.tryFire(p, p.face); }
      return;
    }
    // hang out: shuffle around home, face the street
    this.t -= dt;
    if (this.t <= 0) { this.t = 2 + rng() * 5; const a = rng() * 6.28; this.wd = rng() < 0.5 ? [0, 0] : [Math.cos(a), Math.sin(a)]; }
    const hx = this.home[0] - p.x, hy = this.home[1] - p.y;
    if (Math.hypot(hx, hy) > 6) { const L = Math.hypot(hx, hy); p.move.x = hx / L; p.move.y = hy / L; }
    else { p.move.x = this.wd ? this.wd[0] * 0.5 : 0; p.move.y = this.wd ? this.wd[1] * 0.5 : 0; }
    p.moveSpeed = 1.1;
  }
}
