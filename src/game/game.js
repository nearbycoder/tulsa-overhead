// The game: owns entities and systems, runs the simulation, handles events.
import { input } from '../engine/input.js';
import { settings } from '../engine/settings.js';
import { rng, clamp, mulberry32, hash2, wrapAngle } from '../engine/math.js';
import { Vehicle, VSCALE } from '../entities/vehicle.js';
import { Ped } from '../entities/ped.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { Combat, pointInVehicle } from './combat.js';
import { Traffic } from './traffic.js';
import { PedSystem, WalkerAI } from './pedai.js';
import { Police } from './police.js';
import { Hud } from './hud.js';
import { S, RC, F, MASK_M } from '../world/shared.js';
import { cum, pointAt } from './roads.js';
import { PLACES, SERVICES, LANDMARK_PROPS } from '../data/places.js';
import { WEAPONS } from '../data/weapons.js';
import { Decor } from './decor.js';
import { Jobs } from './jobs.js';
import { Factions } from './factions.js';
import { Emergency } from './emergency.js';
import { Trains } from './trains.js';
import { GPS } from './gps.js';
import { Payphones } from './payphones.js';
import { Tornado } from './tornado.js';
import { Cheats } from './cheats.js';
import { addDecks } from '../engine/decks.js';

const CELL = 16;
const tmpC = new Float32Array(30);
const tmpC2 = new Float32Array(30);
const tmp2 = [0, 0];

const landingHazards = new Set([S.WATER, S.POOL, S.CREEK, S.WETLAND, S.BUILDING, S.BRIDGE, S.RAIL]);

function helicopterRadius(model, rotor) {
  const bodyRadius = Math.hypot(model.len, model.wid) / 2;
  const offset = model.rotorPos || [0, 0];
  const rotorReach = rotor ? Math.hypot(...offset) + Math.max(rotor.w, rotor.h) * rotor.px / 2 : 0;
  return Math.max(bodyRadius, rotorReach) * VSCALE;
}

export class Game {
  constructor({ world, assets, audio, renderer, cam, hudCanvas, ui }) {
    this.world = world; this.assets = assets; this.audio = audio; this.renderer = renderer; this.cam = cam; this.ui = ui;
    this.vehicles = []; this.peds = []; this.props = []; this.pickups = [];
    this.effects = new Effects(this);
    this.combat = new Combat(this);
    this.traffic = new Traffic(this);
    this.pedSys = new PedSystem(this);
    this.police = new Police(this);
    this.hud = new Hud(this, hudCanvas);
    this.time = 0;
    this.frame = 0;
    this.clock = 9 * 60;       // minutes since midnight
    this.day = 1;
    this.weather = { rain: 0, target: 0, t: 60 };
    this.grid = new Map();
    this.gridCells = [];
    this.collisionNeighbors = [];
    this.paused = false;
    this.controlsLocked = false;
    this.dialogActive = false;
    this.missions = null;      // set by boot
    this.markers = [];         // mission/world markers {x,y,r,col,label,blip}
    this.prompt = null;
    this.lastArea = '';
    this.radioIdx = -1;
    this.identDue = Infinity;
    this.lastStationLine = new Map();
    this.difficulty = settings.get('difficulty') || 1;
    this.flags = {};
    this.loading = true;
    this.services = SERVICES.map((s) => ({ ...s, x: 0, y: 0 }));
    for (const sv of this.services) { const p = world.project(sv.lat, sv.lon); sv.x = p[0]; sv.y = p[1]; }
    this.places = {};
    for (const [id, p] of Object.entries(PLACES)) { const q = world.project(p.lat, p.lon); this.places[id] = { id, ...p, x: q[0], y: q[1] }; }
    this.hospitals = world.pois.filter((p) => p.k === 'amenity=hospital').map((p) => ({ x: p.x, y: p.y, name: p.n }));
    this.policeStations = world.pois.filter((p) => p.k === 'amenity=police').map((p) => ({ x: p.x, y: p.y, name: p.n }));
    for (const p of Object.values(this.places)) { if (p.service === 'hospital') this.hospitals.push(p); if (p.service === 'police') this.policeStations.push(p); }
    this.placeLandmarks();
    this.placePackages();
    this.decor = new Decor(this);
    this.jobs = new Jobs(this);
    this.factions = new Factions(this);
    this.emergency = new Emergency(this);
    this.trains = new Trains(this);
    this.gps = new GPS(this);
    this.payphones = new Payphones(this);
    this.tornado = new Tornado(this);
    this.cheats = new Cheats(this);
    this.placeWorldPickups();
  }

  // ------------------------------------------------------------ setup
  destroy() {
    this.disposed = true;
    clearTimeout(this.respawnTimer);
    this.decor.waterTowers.unsubscribe?.();
    this.hud.destroy();
    this.cheats.destroy();
    this.gps.destroy();
    for (const v of this.vehicles) v.stopSounds();
    for (const p of this.peds) p._flameSnd?.stop();
    for (const train of this.trains.trains) train.snd?.stop();
    this.tornado.wind?.stop();
    this.rainSnd?.stop();
    this.cricketSnd?.stop();
  }

  spawnPlayer(x, y, h = 0) {
    const ped = new Ped(this, this.assets.special('player'), x, y, h);
    this.player = new Player(this, ped);
    this.peds.push(ped);
    return this.player;
  }

  placeLandmarks() {
    for (const l of LANDMARK_PROPS) {
      const [x, y] = this.world.project(l.lat, l.lon);
      this.props.push({ id: l.prop, x, y, h: Math.PI / 2, landmark: l.name, solid: true });
    }
    // payphones at each safehouse + gun shops/resprays get signage
    for (const sv of this.services) {
      if (sv.type === 'safehouse') this.props.push({ id: 'payphone', x: sv.x + 4, y: sv.y + 3, h: 0 });
      if (sv.type === 'gunshop') this.props.push({ id: 'billboard', x: sv.x + 10, y: sv.y - 10, h: 0.3 });
    }
  }

  placePackages() {
    // 50 hidden packages at deterministic interesting spots (parks, landmarks)
    const r = mulberry32(66);
    const cands = this.world.pois.filter((p) => /leisure=park|tourism=|historic=|leisure=golf|amenity=place_of_worship/.test(p.k));
    this.packages = [];
    const used = new Set();
    for (let i = 0; i < 50 && cands.length; i++) {
      let k = Math.floor(r() * cands.length);
      let tries = 0;
      while (used.has(k) && tries++ < 20) k = Math.floor(r() * cands.length);
      used.add(k);
      const p = cands[k];
      this.packages.push({ id: i, x: p.x + (r() - 0.5) * 20, y: p.y + (r() - 0.5) * 20, name: p.n });
    }
  }

  placeWorldPickups() {
    const r = mulberry32(1997);
    this.worldPickups = [];
    const add = (type, x, y, extra = {}) => this.worldPickups.push({ type, x, y, cd: 0, respawn: 60, ...extra });
    for (const h of this.hospitals) add('health', h.x + 8, h.y + 8);
    for (const p of this.policeStations) add('armor', p.x + 6, p.y - 6);
    for (const p of this.world.pois) { if (p.k === 'amenity=pharmacy' && r() < 0.5) add('health', p.x + 4, p.y + 4); }
    const parks = this.world.pois.filter((p) => /leisure=park|landuse=cemetery|leisure=pitch/.test(p.k));
    const weps = [['bat', 1], ['knife', 1], ['pistol', 36], ['smg', 96], ['shotgun', 24], ['molotov', 5], ['grenade', 5], ['revolver', 18], ['rifle', 90], ['sniper', 10], ['rocket', 3], ['flamer', 300]];
    for (let i = 0; i < 160 && parks.length; i++) {
      const p = parks[Math.floor(r() * parks.length)];
      const w = weps[Math.min(weps.length - 1, Math.floor(Math.pow(r(), 1.8) * weps.length))];
      add('weapon', p.x + (r() - 0.5) * 30, p.y + (r() - 0.5) * 30, { weapon: w[0], amount: w[1], respawn: 120 });
    }
    for (let i = 0; i < 60 && parks.length; i++) { const p = parks[Math.floor(r() * parks.length)]; add(r() < 0.6 ? 'health' : 'armor', p.x + (r() - 0.5) * 40, p.y + (r() - 0.5) * 40, { respawn: 90 }); }
    // police bribe badges in alleys and lots
    const lots = this.world.pois.filter((p) => /amenity=parking|amenity=fuel|shop=/.test(p.k));
    for (let i = 0; i < 40 && lots.length; i++) { const p = lots[Math.floor(r() * lots.length)]; add('bribe', p.x + (r() - 0.5) * 20, p.y + (r() - 0.5) * 20, { respawn: 240 }); }
  }

  addProp(id, x, y, h, opts = {}) { const p = { id, x, y, h, ...opts }; this.props.push(p); return p; }
  // Pause menu → Spawn Helicopter: put one down on clear ground beside the player and climb in
  spawnHelicopter(id) {
    const m = this.assets.vehicle(id);
    const pl = this.player;
    if (m?.kind !== 'heli' || !pl || pl.ped.dead) return null;
    const p = pl.ped, heading = pl.vehicle?.h ?? p.h;
    const spot = this.helicopterLanding(pl.x, pl.y, heading, helicopterRadius(m, this.assets.rotorSprite(m)));
    if (!spot) {
      this.hud.message('No clear landing area nearby. Try open ground.', 5);
      return null;
    }
    const v = new Vehicle(this, m, spot[0], spot[1], heading, m.paint?.length ? this.assets.randomPaint(rng) : -1);
    if (pl.vehicle) this.exitVehicle(p, true);
    v.persist = true;
    this.addVehicle(v);
    p.x = spot[0]; p.y = spot[1];
    this.enterVehicle(p, v);
    this.hud.message('{accel}/{brake} fly forward and back · {steer} turn · {climb} take off or land · {enter} land and get out', 9);
    return v;
  }

  helicopterLanding(px, py, heading, radius) {
    const world = this.world, obstacles = [];
    // Include the current vehicle and freshly spawned entities before the next spatial-grid rebuild.
    for (const v of this.vehicles) {
      obstacles.push([v.x, v.y, v.isHeli ? helicopterRadius(v.m, v.rotor) : v.radius]);
    }
    for (const p of this.peds) if (!p.vehicle && p !== this.player.ped) obstacles.push([p.x, p.y, 0.45]);
    for (const p of this.props) {
      const def = this.assets.props.get(p.id);
      if (def?.solid) obstacles.push([p.x, p.y, def.radius * (p.scale || 1)]);
    }
    const reach = 60 + radius + 24;
    this.decor.forEach(px-reach, py-reach, px+reach, py+reach, item => {
      if (item.solid) obstacles.push([item.x, item.y, item.r]);
    });
    world.forEachTree(px-reach, py-reach, px+reach, py+reach, (x, y, type, scale, rot, region, index) => {
      const sprites = this.assets.treeSprites[type] || this.assets.treeSprites[0];
      const tree = sprites[index % sprites.length];
      obstacles.push([x, y, Math.max(tree.w, tree.h) * tree.px * scale / 2]);
    });
    const dry = (x, y) => {
      const surface = world.surfaceAt(x, y);
      return surface >= 0 && !landingHazards.has(surface);
    };
    const clear = (x, y) => {
      if (!dry(x, y) || !world.inWorld(x, y) || world.collideCircle(x, y, radius)) return false;
      if (obstacles.some(([ox, oy, r]) => Math.hypot(x-ox, y-oy) < radius+r)) return false;
      if (world.deckAt(x, y, 30, 30, radius)) return false;
      // Walk the actual ground-mask cells under the rotor disk, including the shoreline.
      const margin = radius + MASK_M * Math.SQRT1_2;
      for (let cy = Math.floor((y-radius)/MASK_M)*MASK_M + MASK_M/2; cy < y+margin; cy += MASK_M) {
        for (let cx = Math.floor((x-radius)/MASK_M)*MASK_M + MASK_M/2; cx < x+margin; cx += MASK_M) {
          if (Math.hypot(cx-x, cy-y) <= margin && !dry(cx, cy)) return false;
        }
      }
      return true;
    };
    for (const distance of [7, 10, 14, 19, 25, 33, 45, 60]) {
      for (let i = 0; i < 16; i++) {
        const angle = heading + i * Math.PI / 8;
        const x = px + Math.cos(angle) * distance, y = py + Math.sin(angle) * distance;
        if (clear(x, y)) return [x, y];
      }
    }
    return null;
  }

  addVehicle(v) {
    if (!v.z && !v.isBoat && !v.isHeli) {
      const d = this.world.deckAt(v.x, v.y, 60, 80, 0.3);
      if (d && d.z > 0.3 && !this.world.nearestRoad(v.x, v.y, 4, (r) => !r.z || r.zmax < 0.3)) v.z = d.z;
    }
    this.vehicles.push(v); return v;
  }
  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    v.stopSounds();
    for (const p of [v.driver, ...v.passengers]) if (p && !p.isPlayer) this.removePed(p);
    this.police.units.delete(v);
  }
  removePed(p) {
    if (p.isPlayer) return;
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    if (p._flameSnd) { p._flameSnd.stop(); p._flameSnd = null; }
  }

  focus() { return this.player ? { x: this.player.x, y: this.player.y } : { x: this.cam.x, y: this.cam.y }; }

  onScreen(x, y, pad = 0) {
    const [x0, y0, x1, y1] = this.cam.viewRect(pad);
    return x > x0 && x < x1 && y > y0 && y < y1;
  }

  // ------------------------------------------------------------ spatial hash
  rebuildGrid() {
    const G = this.grid;
    G.clear();
    let used = 0;
    const add = (o, kind) => {
      const k = (Math.floor(o.x / CELL) * 73856093) ^ (Math.floor(o.y / CELL) * 19349663);
      let c = G.get(k);
      if (!c) {
        c = this.gridCells[used] || (this.gridCells[used] = { v: [], p: [] });
        used++;
        G.set(k, c);
      }
      c[kind].push(o);
    };
    for (const c of this.gridCells) { c.v.length = 0; c.p.length = 0; }
    for (const v of this.vehicles) add(v, 'v');
    for (const p of this.peds) if (!p.vehicle) add(p, 'p');
  }
  nearby(x, y, r, kind, out = []) {
    out.length = 0;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const c = this.grid.get((cx * 73856093) ^ (cy * 19349663));
      if (c) for (const o of c[kind]) out.push(o);
    }
    return out;
  }
  nearbyPeds(x, y, r, out) { return this.nearby(x, y, r, 'p', out); }
  nearbyVehicles(x, y, r, out) { return this.nearby(x, y, r, 'v', out); }

  // ------------------------------------------------------------ vehicles <-> peds
  enterVehicle(ped, v) {
    if (v.dead) return;
    if (v.driver && v.driver !== ped) {
      const d = v.driver;
      this.exitVehicle(d, true);
      d.knockDown(-Math.sin(v.h) * 3, Math.cos(v.h) * 3, 0.8);
      if (ped.isPlayer) {
        this.police.crime(v.copUnit ? 'steal_cop_car' : 'carjack', v.x, v.y);
        if (d.ai && d.ai.kind !== 'cop') {
          const ai = new WalkerAI(this, d, null, 1, 1, 0);
          d.ai = ai;
          if (d.faction || d.armed || rng() < 0.15) { ai.state = 'attack'; ai.target = ped; ai.t = 15; if (d.armed) d.weapon = d.armed; }
          else ai.panic(v.x, v.y, 8);
        }
        this.audio.play(this.assets.pedModel(d.model).sex === 'f' ? 'scream_f' : 'scream_m', { x: v.x, y: v.y, vol: 0.6 });
      }
    } else if (v.parked && ped.isPlayer) {
      this.police.crime('steal', v.x, v.y);
      if (v.alarm > 0 || rng() < 0.12) { v.alarm = 6; }
    }
    for (const p of v.passengers) { this.exitVehicle(p, true); if (p.ai && p.ai.panic) p.ai.panic(v.x, v.y); }
    v.passengers = [];
    v.parked = false;
    v.ai = ped.isPlayer ? null : v.ai;
    v.driver = ped;
    ped.vehicle = v;
    ped.move.x = ped.move.y = 0;
    this.audio.play('door_open', { x: v.x, y: v.y, vol: 0.6 });
    if (ped.isPlayer) {
      v.persist = true;
      this.player.stats.carsStolen++;
      this.player.stats.vehiclesSeen[v.m.id] = true;
      this.hud.showVehicle(`${v.m.make ? v.m.make + ' ' : ''}${v.m.name}`);
      this.audio.play('car_start', { x: v.x, y: v.y, vol: 0.7 });
      if (settings.get('autoRadio') && !v.isTwoWheel && v.kind !== 'bike') {
        if (this.radioIdx < 0) this.radioIdx = Math.floor(rng() * (this.audio.radio?.stations?.length || 1));
        this.setRadio(v.copUnit ? -1 : this.radioIdx, v.copUnit);
      }
      if (this.missions) this.missions.onEnterVehicle(v);
    }
  }

  exitVehicle(ped, forced) {
    const v = ped.vehicle;
    if (!v) return;
    const fx = Math.cos(v.h), fy = Math.sin(v.h);
    let placed = false;
    for (const side of [-1, 1]) {
      const ox = -fy * side * (v.wid / 2 + 0.7), oy = fx * side * (v.wid / 2 + 0.7);
      const x = v.x + ox, y = v.y + oy;
      if (!this.world.collideCircle(x, y, 0.35) && this.world.surfaceAt(x, y) !== S.WATER) { ped.x = x; ped.y = y; placed = true; break; }
    }
    if (!placed) { ped.x = v.x - fx * (v.len / 2 + 0.8); ped.y = v.y - fy * (v.len / 2 + 0.8); }
    if (v.isBoat && this.world.surfaceAt(ped.x, ped.y) === S.WATER) {
      // step ashore if land is close
      let found = false;
      for (let r = 2; r <= 16 && !found; r += 1.5) for (let a = 0; a < 6.28 && !found; a += 0.4) {
        const x = v.x + Math.cos(a) * r, y = v.y + Math.sin(a) * r, sf = this.world.surfaceAt(x, y);
        if (sf !== S.WATER && sf !== S.BUILDING && sf >= 0) { ped.x = x; ped.y = y; found = true; }
      }
    }
    ped.vehicle = null;
    ped.h = v.h;
    // on an overpass: step out onto the deck (beside the car if there's room, else behind it)
    ped.z = v.isHeli ? 0 : (v.z || 0); ped.vz = 0;
    if (ped.z > 1 && !this.world.deckAt(ped.x, ped.y, ped.z, 1.6, 0.2)) { ped.x = v.x - fx * (v.len / 2 + 0.8); ped.y = v.y - fy * (v.len / 2 + 0.8); }
    if (v.driver === ped) v.driver = null;
    v.passengers = v.passengers.filter((p) => p !== ped);
    if (v.speed > 8 && !forced) { ped.knockDown(v.vx * 0.6, v.vy * 0.6, 1.2); ped.damage(Math.min(40, v.speed * 1.2), null, 'impact'); }
    else { ped.vx = v.vx * 0.3; ped.vy = v.vy * 0.3; }
    v.ctrl.throttle = 0; v.ctrl.brake = 0; v.ctrl.handbrake = false; v.ctrl.steer = 0;
    v.sirenOn = v.sirenOn && !ped.isPlayer;
    this.audio.play('door_close', { x: v.x, y: v.y, vol: 0.6 });
    if (ped.isPlayer) { this.setRadio(-2); if (this.missions) this.missions.onExitVehicle(v); }
    if (v.isHeli) v.heliAltTarget = 0;
  }

  // ------------------------------------------------------------ events
  onPedKilled(p, by, kind) {
    if (p.isPlayer) { this.wasted(); return; }
    if (by && by.isPlayer) {
      const st = this.player.stats;
      st.kills++;
      this.jobs.notifyKill('ped');
      if (p.isCop) { st.copsKilled++; this.police.crime('kill_cop', p.x, p.y); }
      else this.police.crime('kill_ped', p.x, p.y);
      if (rng() < 0.3 && !p.isCop) this.dropCash(p.x, p.y, 5 + Math.floor(rng() * 40));
      if (p.isCop && rng() < 0.7) this.dropWeaponPickup(p.x, p.y, p.weapon || 'pistol');
      if (p.armed && rng() < 0.6) this.dropWeaponPickup(p.x, p.y, p.armed);
    }
    if (this.missions) this.missions.onPedKilled(p, by);
    if (p.faction) this.factions.onMemberKilled(p, by);
    if (!p.mission && kind !== 'drown' && rng() < 0.55) this.emergency.report('medic', p);
    if (p._flameSnd) { p._flameSnd.stop(); p._flameSnd = null; }
  }
  onPedAttacked(p, by) {
    if (!by || !by.isPlayer || p.isPlayer) return;
    if (p.isCop) this.police.crime('attack_cop', p.x, p.y);
    else if (!p._assaulted) { p._assaulted = true; this.police.crime('assault', p.x, p.y); }
  }
  onVehicleDestroyed(v, by) {
    if (by && by.isPlayer) { this.player.stats.carsDestroyed++; this.jobs.notifyKill('car'); this.police.crime(v.copUnit ? 'attack_police_car' : 'destroy_vehicle', v.x, v.y); }
    if (this.missions) this.missions.onVehicleDestroyed(v, by);
    if (!v.mission && rng() < 0.5) this.emergency.report('fire', v);
  }
  onVehicleSunk(v) {
    // NPCs go down with the car; the player bails out and has a few seconds to swim for it
    for (const p of [v.driver, ...v.passengers]) if (p) { p.vehicle = null; p.x = v.x; p.y = v.y; if (p.isPlayer) { p.drown = 0.06; this.hud.message('Swim for the shore!', 4); } else p.damage(999, null, 'drown'); }
    v.driver = null; v.passengers = [];
    v.dead = true; v.sunk = true;
    this.removeVehicle(v);
    if (this.missions) this.missions.onVehicleDestroyed(v, null);
  }
  onPlayerShot() { }
  onPlayerAttacked(by) { this.factions.onPlayerAttacked(by); }
  onHorn(v) {
    for (const p of this.nearbyPeds(v.x + Math.cos(v.h) * 6, v.y + Math.sin(v.h) * 6, 7)) if (p.ai && p.ai.state === 'walk' && rng() < 0.5) p.ai.panic(v.x, v.y, 1.5);
  }

  dropCash(x, y, amount) { this.pickups.push({ type: 'cash', x, y, amount, t: 30 }); }
  dropWeaponPickup(x, y, w) { if (w && w !== 'fists') this.pickups.push({ type: 'weapon', weapon: w, x: x + (rng() - 0.5), y: y + (rng() - 0.5), amount: WEAPONS[w].clip ? WEAPONS[w].clip * 2 : 5, t: 40 }); }

  wasted() {
    if (this.respawning) return;
    this.respawning = true;
    this.player.stats.wasted++;
    this.hud.bigMessage('WASTED', '', '#d9452b', 4);
    this.audio.play('wasted');
    this.slowmo = 1.2;
    if (this.missions) this.missions.onPlayerDown('wasted');
    this.respawnTimer = setTimeout(() => this.respawnAt(this.nearest(this.hospitals), 'hospital'), 4000);
  }
  busted() {
    if (this.respawning || this.player.ped.dead) return;
    this.respawning = true;
    this.player.stats.busted++;
    this.controlsLocked = true;
    this.hud.bigMessage('BUSTED', '', '#3a7bd5', 4);
    this.audio.play('busted');
    if (this.missions) this.missions.onPlayerDown('busted');
    this.respawnTimer = setTimeout(() => this.respawnAt(this.nearest(this.policeStations), 'police'), 4000);
  }
  nearest(list) {
    const P = this.focus();
    let best = null, bd = Infinity;
    for (const s of list) { const d = Math.hypot(s.x - P.x, s.y - P.y); if (d < bd) { bd = d; best = s; } }
    return best || { x: 0, y: 0, name: 'Tulsa' };
  }
  async respawnAt(spot, why) {
    const pl = this.player, p = pl.ped;
    await this.ui.fade(true);
    if (p.vehicle) this.exitVehicle(p, true);
    const bill = why === 'hospital' ? Math.min(pl.money, 100 + Math.floor(pl.money * 0.05)) : Math.min(pl.money, 150 + Math.floor(pl.money * 0.08));
    pl.addMoney(-bill);
    // lose weapons
    p.ammo = { fists: Infinity }; p.clip = {}; p.weapon = 'fists';
    if (why === 'police') p.armor = 0;
    p.dead = false; p.health = p.maxHealth; p.onFire = 0; p.knock = 0; p.stun = 0; p.drown = 0;
    // find a nearby walkable spot
    const near = this.world.nearestRoad(spot.x, spot.y, 120);
    p.x = near ? near.x + 6 : spot.x; p.y = near ? near.y + 6 : spot.y;
    this.police.setLevel(0);
    this.police.clearUnits(false);
    for (const v of [...this.vehicles]) if (!v.mission) this.removeVehicle(v);
    for (const q of [...this.peds]) if (!q.isPlayer && !q.mission) this.removePed(q);
    this.cam.x = p.x; this.cam.y = p.y;
    await this.world.update(p.x, p.y);
    this.controlsLocked = false;
    this.respawning = false;
    this.hud.message(`${why === 'hospital' ? 'Hospital bill' : 'Bail & fines'}: -$${bill}  (${spot.name || ''})`, 5);
    await this.ui.fade(false);
    this.save('auto');
  }

  // ------------------------------------------------------------ radio
  setRadio(i, scanner = false) {
    const radio = this.audio.radio;
    this.resumeStation = null;
    this.identDue = Infinity;
    this.audio.stopVoice('radio');
    if (!radio?.stations) return;
    radio.setInCar(i !== -2);
    if (i < 0) {
      radio.off();
      if (i === -1) this.hud.showRadio(scanner ? 'Police Scanner' : 'Radio Off');
      return;
    }
    radio.play(i);
    this.hud.showRadio(radio.stations[i].name);
    this.identDue = this.time + (Math.random() < 0.45 ? 1.6 : 150);
  }

  updateRadio() {
    if (this.resumeStation != null && this.audio.radio) {
      const station = this.resumeStation;
      this.setRadio(station < this.audio.radio.stations.length ? station : -1, this.player.vehicle?.copUnit);
    }
    if (this.time < this.identDue) return;
    this.identDue = this.time + 150;
    const station = this.audio.radio?.station, voices = this.missions?.voice;
    if (!station || !voices || !this.player.vehicle || this.dialogActive || document.hidden) return;
    const ids = Object.keys(voices).filter(id => id.startsWith('radio_' + station.id + '_'));
    if (!ids.length) return;
    const previous = this.lastStationLine.get(station.id);
    const choices = ids.length > 1 ? ids.filter(id => id !== previous) : ids;
    const id = choices[Math.floor(Math.random() * choices.length)];
    this.audio.playVoice('assets/voice/' + voices[id], {channel: 'radio'}).then(natural => {
      if (natural) this.lastStationLine.set(station.id, id);
    }).catch(() => {});
  }

  radioNext() {
    const radio = this.audio.radio;
    if (!radio?.stations) return;
    this.radioIdx = radio.current + 1 >= radio.stations.length ? -1 : radio.current + 1;
    this.setRadio(this.radioIdx);
  }

  // ------------------------------------------------------------ main update
  update(dtReal) {
    this.frame++;
    let dt = Math.min(dtReal, 1 / 30);
    if (this.slowmo > 0) { this.slowmo -= dtReal; dt *= 0.35; }
    if (this.paused) return;
    this.time += dt;
    // world clock: 1 real second = 1 game minute
    if (settings.get('dayNightCycle') && !this.clockFrozen) this.clock += dt;
    if (this.clock >= 1440) { this.clock -= 1440; this.day++; }
    this.updateSky(dt);
    const P = this.focus();
    this.world.update(P.x, P.y);
    this.rebuildGrid();
    if (this.player) this.player.update(dt);
    // AI
    for (const p of this.peds) if (p.ai && p.ai.update && !p.isPlayer && (!p.vehicle || p.ai.kind === 'cop' || p.ai.kind === 'gang' || p.ai.kind === 'mission')) p.ai.update(dt);
    for (const v of this.vehicles) if (v.ai && v.driver && !v.driver.isPlayer) v.ai.update(dt);
    // physics with substeps
    const sub = dt > 1 / 50 ? 2 : 1;
    for (let i = 0; i < sub; i++) {
      for (const v of this.vehicles) v.update(dt / sub);
      this.collideVehicles(dt / sub);
    }
    for (const p of this.peds) p.update(dt);
    this.collidePeds();
    this.combat.update(dt);
    this.effects.update(dt);
    this.traffic.update(dt);
    this.pedSys.update(dt);
    this.police.update(dt);
    this.updatePickups(dt);
    this.updateServices(dt);
    if (this.missions) this.missions.update(dt);
    this.jobs.update(dt);
    this.factions.update(dt);
    this.emergency.update(dt);
    this.trains.update(dt);
    this.gps.update(dt);
    this.payphones.update(dt);
    this.tornado.update(dt);
    // camera
    if (this.player) {
      const pl = this.player;
      const v = pl.vehicle;
      if (this.camFocus) {
        const k = Math.min(1, dtReal * 2.5);
        this.cam.x += (this.camFocus[0] - this.cam.x) * k; this.cam.y += (this.camFocus[1] - this.cam.y) * k;
        this.cam.viewH += (45 - this.cam.viewH) * k; this.cam.updateDerived();
      } else this.cam.follow(pl.x, pl.y, pl.vx, pl.vy, v ? Math.abs(v.vf) : 0, dtReal, v ? (v.isHeli ? 'heli' : 'car') : 'foot');
      this.audio.setListener && this.audio.setListener(pl.x, pl.y, 40 / this.cam.viewH);
      // area names
      if (this.frame % 30 === 0) {
        const city = this.world.cityAt(pl.x, pl.y) || this.world.countyAt(pl.x, pl.y) || 'Oklahoma';
        const nearPlace = this.nearPlaceName(pl.x, pl.y);
        const area = nearPlace || city;
        if (area !== this.lastArea) { this.lastArea = area; this.hud.showArea(area); }
      }
      pl.stats.distance += Math.hypot(pl.vx, pl.vy) * dt;
      if (this.waypoint) {
        const [tx, ty] = this.waypoint, direct = Math.hypot(tx-pl.x, ty-pl.y);
        const venue = this.waypointIsManual && this.waypointLabel;
        if (direct < 20 || (venue && direct < 650 && this.frame % 6 === 0 &&
            this.world.atDestinationBuilding(pl.x, pl.y, tx, ty, 7))) {
          if (venue) this.hud.message('Arrived at ' + venue, 4);
          this.setWaypoint(null);
          this.audio.play('checkpoint', { vol: 0.5 });
        }
      }
      this.updateRadio();
    }
    this.hud.update(dtReal);
    // quiet autosave every couple of minutes of free roam
    this._autoT = (this._autoT || 0) + dt;
    if (this._autoT > 120 && !(this.missions && this.missions.active) && this.police.level === 0 && !this.respawning && this.player && !this.player.ped.dead) { this._autoT = 0; this.save('auto'); }
    // car alarms
    for (const v of this.vehicles) if (v.alarm > 0) { v.alarm -= dt; if (Math.floor(v.alarm * 2) !== Math.floor((v.alarm + dt) * 2)) this.audio.play('horn_mid', { x: v.x, y: v.y, vol: 0.5 }); }
  }

  nearPlaceName(x, y) {
    let best = null, bd = 600;
    for (const p of Object.values(this.places)) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd && d < (p.radius || 450)) { bd = d; best = p.area; }
    }
    return best;
  }

  updateSky(dt) {
    const m = this.clock;
    // night factor: dark 21:00-05:00, twilight ramps
    const hr = m / 60;
    let n;
    if (hr < 5) n = 1; else if (hr < 7) n = 1 - (hr - 5) / 2; else if (hr < 18.5) n = 0; else if (hr < 20.5) n = (hr - 18.5) / 2; else n = 1;
    this.renderer.night = settings.get('lighting') ? n * 0.92 : 0;
    // sun direction sweeps east->west
    const t = clamp((hr - 6) / 13, 0, 1);
    const ang = Math.PI * (0.15 + t * 0.7);
    const len = 0.55 + Math.abs(t - 0.5) * 1.3;
    this.renderer.sun.x = -Math.cos(ang) * len; this.renderer.sun.y = 0.35 + Math.sin(ang) * 0.1;
    // weather
    const W = this.weather;
    W.t -= dt;
    if (W.t <= 0) { W.t = 90 + rng() * 200; W.target = rng() < 0.25 && settings.get('weather') ? 0.4 + rng() * 0.6 : 0; }
    W.rain += (W.target - W.rain) * Math.min(1, dt * 0.1);
    this.renderer.rain = settings.get('weather') ? W.rain : 0;
    // thunderstorms: lightning + delayed thunder
    if (W.rain > 0.7 && settings.get('weather') && rng() < dt * 0.05 * W.rain) {
      this.renderer.flash = 0.35 + rng() * 0.4;
      const delay = 400 + rng() * 2500;
      setTimeout(() => { if (!this.disposed) this.audio.play('thunder', { vol: 0.6 + rng() * 0.4 }); }, delay);
    }
    if (this.audio.ready) {
      if (W.rain > 0.05) { if (!this.rainSnd) this.rainSnd = this.audio.createLoop('rain'); this.rainSnd && this.rainSnd.setIntensity(W.rain); }
      else if (this.rainSnd) { this.rainSnd.stop(); this.rainSnd = null; }
      const wantCrickets = n > 0.6 && this.player && !this.player.vehicle;
      if (wantCrickets && !this.cricketSnd) this.cricketSnd = this.audio.createLoop('night_crickets');
      if (!wantCrickets && this.cricketSnd) { this.cricketSnd.stop(); this.cricketSnd = null; }
      if (this.cricketSnd) this.cricketSnd.setIntensity(0.5);
    }
  }

  // ------------------------------------------------------------ collisions
  collideVehicles(dt) {
    const W = this.world;
    for (const v of this.vehicles) {
      if (v.isHeli && v.alt > 2) continue;
      if ((v.z || 0) > 2.5) continue; // up on an overpass, clear of the buildings below
      // The collision circles fit within half the longer dimension in all
      // headings. Allow for the Float32 circle positions at map extremities.
      if (!W.mayTouchBuilding(v, Math.max(v.len, v.wid) * 0.5 + 0.02)) continue;
      const r = v.circlePositions(tmpC);
      let maxImpact = 0;
      for (let i = 0; i < v.circles; i++) {
        const hit = W.collideCircle(tmpC[i * 3], tmpC[i * 3 + 1], r, tmp2);
        if (!hit) continue;
        const nx = hit.nx, ny = hit.ny;
        v.x += nx * hit.depth; v.y += ny * hit.depth;
        const vn = v.vx * nx + v.vy * ny;
        if (vn < 0) {
          v.vx -= 1.25 * vn * nx; v.vy -= 1.25 * vn * ny;
          // torque from off-centre hit
          const o = tmpC[i * 3 + 2];
          const cross = Math.cos(v.h) * ny - Math.sin(v.h) * nx;
          v.av += cross * o * vn * 0.08;
          maxImpact = Math.max(maxImpact, -vn);
        }
        for (let k = 0; k < v.circles; k++) { tmpC[k * 3] += nx * hit.depth; tmpC[k * 3 + 1] += ny * hit.depth; }
      }
      if (maxImpact > 2) this.impact(v, maxImpact, null);
    }
    // vehicle-vehicle
    const n = this.vehicles.length;
    for (let a = 0; a < n; a++) {
      const A = this.vehicles[a];
      const airA = A.isHeli && A.alt > 2;
      for (const B of this.nearbyVehicles(A.x, A.y, A.radius + 8, this.collisionNeighbors)) {
        if (B.id <= A.id) continue;
        const airB = B.isHeli && B.alt > 2;
        // ground vs ground, or two helicopters at similar altitude (mid-air collisions)
        if (airA !== airB || (airA && Math.abs(A.alt - B.alt) > 6)) continue;
        if (Math.abs((A.z || 0) - (B.z || 0)) > 2.5) continue; // one on the overpass, one underneath
        if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > (A.radius + B.radius) ** 2) continue;
        const ra = A.circlePositions(tmpC), rb = B.circlePositions(tmpC2);
        let best = null;
        for (let i = 0; i < A.circles; i++) for (let j = 0; j < B.circles; j++) {
          const dx = tmpC2[j * 3] - tmpC[i * 3], dy = tmpC2[j * 3 + 1] - tmpC[i * 3 + 1];
          const d2 = dx * dx + dy * dy, rr = ra + rb;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; const pen = rr - d; if (!best || pen > best.pen) best = { nx: dx / d, ny: dy / d, pen }; }
        }
        if (!best) continue;
        const ma = A.mass, mb = B.mass, inv = 1 / ma + 1 / mb;
        const { nx, ny, pen } = best;
        A.x -= nx * pen * (1 / ma) / inv; A.y -= ny * pen * (1 / ma) / inv;
        B.x += nx * pen * (1 / mb) / inv; B.y += ny * pen * (1 / mb) / inv;
        const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rv < 0) {
          const j = -(1.3) * rv / inv;
          A.vx -= j / ma * nx; A.vy -= j / ma * ny;
          B.vx += j / mb * nx; B.vy += j / mb * ny;
          A.av += (rng() - 0.5) * Math.min(2, -rv * 0.05); B.av += (rng() - 0.5) * Math.min(2, -rv * 0.05);
          if (-rv > 2) {
            const by = A.driver && A.driver.isPlayer ? A.driver : B.driver && B.driver.isPlayer ? B.driver : null;
            // the rammer (the car driving into the other) takes less, the car being hit takes more
            const aIn = A.vx * nx + A.vy * ny, bIn = -(B.vx * nx + B.vy * ny);
            const ka = aIn > bIn + 2 ? 0.75 : bIn > aIn + 2 ? 1.2 : 1, kb = ka === 1 ? 1 : ka < 1 ? 1.2 : 0.75;
            this.impact(A, -rv * mb / (ma + mb) * 1.6 * ka, by === A.driver ? null : by);
            this.impact(B, -rv * ma / (ma + mb) * 1.6 * kb, by === B.driver ? null : by);
            if (by) {
              const other = by === A.driver ? B : A;
              if (other.copUnit && -rv > 6) this.police.crime('attack_police_car', other.x, other.y);
              if (other.ai && other.driver && !other.copUnit && !other.mission && other.ai.mode === 'cruise' && rng() < 0.3) other.ai.mode = 'flee';
            }
          }
        }
      }
    }
    // vehicles vs peds
    for (const v of this.vehicles) {
      if ((v.isHeli && v.alt > 1) || v.dead && v.speed < 0.5) continue;
      for (const p of this.nearbyPeds(v.x, v.y, v.radius + 1, this.collisionNeighbors)) {
        if (p.vehicle || p === v.driver) continue;
        if (Math.abs((v.z || 0) - (p.z || 0)) > 2) continue;
        const fx = Math.cos(v.h), fy = Math.sin(v.h);
        const dx = p.x - v.x, dy = p.y - v.y;
        const lx = dx * fx + dy * fy, ly = -dx * fy + dy * fx;
        const hx = v.len / 2 + p.r, hy = v.wid / 2 + p.r;
        if (Math.abs(lx) > hx || Math.abs(ly) > hy) continue;
        // only the car's own motion toward the person counts (running into a parked car doesn't hurt)
        const vsp = Math.hypot(v.vx, v.vy), toward = vsp > 0.1 ? (v.vx * dx + v.vy * dy) / (vsp * (Math.hypot(dx, dy) || 1)) : 0;
        const rel = toward > 0.2 ? Math.hypot(v.vx - p.vx * 0.3, v.vy - p.vy * 0.3) : 0;
        // one car, one hit: the same car can't hurt the same person again for a moment
        const again = p._carHit === v && this.time - p._carHitT < 0.9;
        if (rel > 3.5 && !p.dead && !again) {
          p._carHit = v; p._carHitT = this.time;
          // the player gets knocked flat but not one-shot by a single car (NPCs aren't so lucky)
          const raw = rel * rel * 0.55 + rel * 2;
          const dmg = p.isPlayer ? Math.min(raw, 35 + rel) : raw;
          const side = ly >= 0 ? 1 : -1;
          // thrown forward and well off to the side, clear of the car's path
          p.knockDown(v.vx * 0.75 - fy * side * (4 + rel * 0.25), v.vy * 0.75 + fx * side * (4 + rel * 0.25), 1.3);
          p.damage(dmg, v.driver, 'impact');
          this.effects.blood(p.x, p.y, v.vx, v.vy, 6);
          this.audio.play(rel > 12 ? 'crash_med' : 'body_fall', { x: p.x, y: p.y, vol: 0.7 });
          if (v.driver && v.driver.isPlayer) { this.police.crime(p.isCop ? 'attack_cop' : 'hit_ped', p.x, p.y); }
          if (p.ai && p.ai.panic && !p.dead) p.ai.panic(v.x, v.y);
          v.vx *= 0.97; v.vy *= 0.97;
        } else {
          // push out along the shallow axis
          const px = hx - Math.abs(lx), py = hy - Math.abs(ly);
          if (px < py) { const s = Math.sign(lx) * px; p.x += fx * s; p.y += fy * s; }
          else { const s = Math.sign(ly) * py; p.x += -fy * s; p.y += fx * s; }
        }
      }
    }
    // decor street furniture (breakables get flattened)
    for (const v of this.vehicles) {
      if (v.isHeli && v.alt > 1) continue;
      if ((v.z || 0) > 1.5) continue;
      this.decor.forEach(v.x - v.radius - 2, v.y - v.radius - 2, v.x + v.radius + 2, v.y + v.radius + 2, (it) => {
        if (!it.solid) return;
        const dx = v.x - it.x, dy = v.y - it.y, d = Math.hypot(dx, dy);
        const rr = it.r + v.wid * 0.5;
        if (d >= rr || d < 0.01) return;
        const nx = dx / d, ny = dy / d;
        const vn = v.vx * nx + v.vy * ny;
        if (it.breakable && v.speed > 4) {
          it.broken = true;
          this.effects.debris(it.x, it.y, it.id === 'fire_hydrant' ? '#c22' : '#777', 6);
          if (it.id === 'fire_hydrant') { this.effects.splash(it.x, it.y, 1.5); }
          this.audio.play('crash_light', { x: it.x, y: it.y, vol: 0.6 });
          v.vx *= 0.92; v.vy *= 0.92;
          return;
        }
        if (it.animal && v.speed > 6) { it.broken = true; this.effects.blood(it.x, it.y, v.vx, v.vy, 10); this.effects.bloodPool(it.x, it.y, 1.4); this.audio.play('cow_moo', { x: it.x, y: it.y }); this.impact(v, v.speed * 0.5, null); return; }
        v.x += nx * (rr - d); v.y += ny * (rr - d);
        if (vn < 0) { v.vx -= 1.2 * vn * nx; v.vy -= 1.2 * vn * ny; if (-vn > 3) this.impact(v, -vn, null); }
      });
    }
    // props
    for (const pr of this.props) {
      const def = this.assets.props.get(pr.id);
      if (!def || !def.solid) continue;
      const rad = (def.radius || 1) * (pr.scale || 1);
      for (const v of this.nearbyVehicles(pr.x, pr.y, rad + 6, this.collisionNeighbors)) {
        if ((v.z || 0) > 1.5) continue;
        const dx = v.x - pr.x, dy = v.y - pr.y, d = Math.hypot(dx, dy);
        const rr = rad + v.wid * 0.5;
        if (d < rr && d > 0.01) {
          const nx = dx / d, ny = dy / d;
          v.x += nx * (rr - d); v.y += ny * (rr - d);
          const vn = v.vx * nx + v.vy * ny;
          if (vn < 0) { v.vx -= 1.2 * vn * nx; v.vy -= 1.2 * vn * ny; if (-vn > 3) this.impact(v, -vn, null); }
          if (def.breakable && -vn > 4) { pr.broken = true; }
        }
      }
    }
  }

  impact(v, speed, by) {
    if (speed < 2) return;
    const dmg = speed * speed * 0.65 * (v.isTwoWheel ? 0.6 : 1);
    v.damage(dmg, by);
    this.audio.play(speed > 16 ? 'crash_heavy' : speed > 7 ? 'crash_med' : 'crash_light', { x: v.x, y: v.y, vol: Math.min(1, 0.3 + speed / 20) });
    if (speed > 9) { this.effects.sparks(v.x + Math.cos(v.h) * v.len * 0.45, v.y + Math.sin(v.h) * v.len * 0.45, 5); if (rng() < 0.4) this.audio.play('glass', { x: v.x, y: v.y, vol: 0.4 }); }
    if (v.driver && v.driver.isPlayer) { this.cam.addShake(Math.min(1.2, speed / 20)); input.rumble(Math.min(1, speed / 16), Math.min(1, speed / 10), 80 + Math.min(220, speed * 8)); }
    // riders fall off two-wheelers
    if (v.isTwoWheel && v.driver && speed > (v.driver.isPlayer ? 13 : 16)) {
      const d = v.driver;
      this.exitVehicle(d, true);
      d.knockDown(v.vx * 0.8 + Math.cos(v.h) * 4, v.vy * 0.8 + Math.sin(v.h) * 4, 1.4);
      d.damage(speed * 1.5, null, 'impact');
    }
  }

  collidePeds() {
    for (const p of this.peds) {
      if (p.vehicle || p.dead) continue;
      for (const q of this.nearbyPeds(p.x, p.y, 1, this.collisionNeighbors)) {
        if (q === p || q.vehicle || q.dead || q.id < p.id) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), rr = p.r + q.r;
        if (d < rr && d > 0.001) { const k = (rr - d) / 2 / d; p.x -= dx * k; p.y -= dy * k; q.x += dx * k; q.y += dy * k; }
      }
      this.decor.forEach(p.x - 3, p.y - 3, p.x + 3, p.y + 3, (it) => {
        if (!it.solid) return;
        const rad = it.r + p.r, dx = p.x - it.x, dy = p.y - it.y, d = Math.hypot(dx, dy);
        if (d < rad && d > 0.001) { p.x = it.x + dx / d * rad; p.y = it.y + dy / d * rad; }
      });
      // props
      for (const pr of this.props) {
        if (Math.abs(pr.x - p.x) > 12 || Math.abs(pr.y - p.y) > 12) continue;
        const def = this.assets.props.get(pr.id);
        if (!def || !def.solid) continue;
        const rad = (def.radius || 0.5) * (pr.scale || 1) + p.r;
        const dx = p.x - pr.x, dy = p.y - pr.y, d = Math.hypot(dx, dy);
        if (d < rad && d > 0.001) { p.x = pr.x + dx / d * rad; p.y = pr.y + dy / d * rad; }
      }
    }
  }

  // ------------------------------------------------------------ pickups & services
  updatePickups(dt) {
    const pl = this.player;
    if (!pl) return;
    const P = pl.ped;
    const px = pl.x, py = pl.y;
    let k = 0;
    for (const u of this.pickups) {
      u.t -= dt;
      if (u.t <= 0) continue;
      const d = Math.hypot(u.x - px, u.y - py);
      if (d < (pl.vehicle ? 2.4 : 1.3) && !P.dead) {
        if (u.type === 'cash') { pl.addMoney(u.amount); this.audio.play('cash', { vol: 0.6 }); this.effects.text(u.x, u.y, '+$' + u.amount); continue; }
        if (u.type === 'weapon') { P.give(u.weapon, u.amount); this.audio.play('pickup_weapon'); this.hud.message(WEAPONS[u.weapon].name, 2); continue; }
        if (u.type === 'health') { if (P.health < P.maxHealth) { P.health = P.maxHealth; this.audio.play('pickup_health'); continue; } }
        if (u.type === 'armor') { if (P.armor < 100) { P.armor = 100; this.audio.play('pickup_armor'); continue; } }
      }
      this.pickups[k++] = u;
    }
    this.pickups.length = k;
    // respawning world pickups
    for (const u of this.worldPickups) {
      if (u.cd > 0) { u.cd -= dt; continue; }
      if (Math.abs(u.x - px) > 3 || Math.abs(u.y - py) > 3 || P.dead) continue;
      if (Math.hypot(u.x - px, u.y - py) > (pl.vehicle ? 2.4 : 1.4)) continue;
      if (u.type === 'health') { if (P.health >= P.maxHealth || pl.vehicle) continue; P.health = P.maxHealth; this.audio.play('pickup_health'); }
      else if (u.type === 'armor') { if (P.armor >= 100 || pl.vehicle) continue; P.armor = 100; this.audio.play('pickup_armor'); }
      else if (u.type === 'weapon') { P.give(u.weapon, u.amount); this.audio.play('pickup_weapon'); this.hud.message(WEAPONS[u.weapon].name, 2); }
      else if (u.type === 'bribe') { if (this.police.level === 0) continue; this.police.setLevel(this.police.level - 1); this.audio.play('pickup'); this.hud.message('Bribe: -1 wanted star', 2); }
      u.cd = u.respawn;
    }
    // hidden packages
    for (const pk of this.packages) {
      if (pk.got || Math.abs(pk.x - px) > 3 || Math.abs(pk.y - py) > 3) continue;
      if (Math.hypot(pk.x - px, pk.y - py) < 1.8) {
        pk.got = true;
        pl.stats.packages++;
        pl.addMoney(1000);
        this.audio.play('pickup');
        this.hud.bigMessage('HIDDEN PACKAGE', `${pl.stats.packages} of ${this.packages.length}  +$1,000`, '#7ed36b', 3);
        if (pl.stats.packages % 10 === 0) this.hud.message('New weapons delivered to your safehouses!', 6);
      }
    }
  }

  updateServices(dt) {
    const pl = this.player;
    this.prompt = null;
    if (!pl || this.respawning || this.missions?.retrying) return;
    const px = pl.x, py = pl.y;
    for (const sv of this.services) {
      const d = Math.hypot(sv.x - px, sv.y - py);
      if (d > 6) continue;
      if (sv.type === 'respray' && pl.vehicle && !pl.vehicle.isHeli) {
        if (d < 5 && !this.sprayCd) {
          const cost = this.police.level > 0 ? 500 : 250;
          if (pl.money >= cost) {
            this.sprayCd = 5;
            pl.addMoney(-cost);
            const v = pl.vehicle;
            v.health = v.maxHealth; v.fire = 0;
            if (v.m.paint && v.m.paint.length) { v.paint = this.assets.randomPaint(rng); v.sprite = this.assets.vehicleSprite(v.m, v.paint); }
            this.police.setLevel(0); this.police.clearUnits(true);
            this.audio.play('cash');
            this.hud.bigMessage('RESPRAYED', `-$${cost}  Heat cleared`, '#7ed36b', 2.5);
          } else this.hud.message(`Respray costs $${cost}. Come back with cash.`, 3);
        }
      } else if (sv.type === 'gunshop' && !pl.vehicle) {
        this.prompt = 'Press {enter} to shop — Okie Arms & Ammo';
        if (input.wasPressed('enter') && this.ui.openShop) this.ui.openShop(sv);
      } else if (sv.type === 'safehouse' && !pl.vehicle && !this.missions?.active && this.isSafehouseUnlocked(sv)) {
        const canRide = !this.missions?.quickRetry && this.police.level === 0;
        this.prompt = canRide ? 'Press {enter} to save game · {phone} to catch a ride' : 'Press {enter} to save game';
        if (input.wasPressed('enter')) {
          const rested = this.serialize(), wakeTime = this.clock + 360;
          rested.clock = wakeTime % 1440;
          rested.day += Math.floor(wakeTime / 1440);
          rested.health = pl.ped.maxHealth;
          if (this.save('slot1', rested)) {
            this.clock = rested.clock; this.day = rested.day; pl.ped.health = rested.health;
            this.hud.bigMessage('GAME SAVED', sv.name, '#7ed36b', 2.5);
          } else this.hud.message('Save failed. Check browser storage and try again.', 5);
        }
        else if (canRide && input.wasPressed('phone') && this.ui.openRides) this.ui.openRides(sv);
      }
    }
    if (this.sprayCd > 0) { this.sprayCd -= dt; if (this.sprayCd <= 0) this.sprayCd = 0; }
  }
  // fade out, move the player, stream the destination in, fade back in
  async fastTravel(x, y, minutes, name) {
    const pl = this.player;
    if (!pl || pl.vehicle) return;
    this.controlsLocked = true;
    await this.ui.fade(true);
    pl.ped.x = x; pl.ped.y = y; pl.ped.vx = pl.ped.vy = 0;
    this.cam.x = x; this.cam.y = y;
    await this.world.update(x, y);
    this.clock = (this.clock + minutes) % 1440;
    // the cousin leaves the pickup at the kerb so you're not stranded out in the country
    try {
      const near = this.world.nearestRoad(x, y, 60, (r) => r.cls !== RC.PATH && !(r.flags & F.DRIVEWAY));
      const m = this.assets.vehicles.find((v) => /pickup/i.test(v.class || '') && v.role !== 'police') || this.assets.pickVehicle(rng, 'urban');
      if (near && m) {
        const t = [0, 0, 0, 0]; cum(near.road); pointAt(near.road, 1, near.s, near.road.w / 2 - 1, t);
        const v = new Vehicle(this, m, t[0], t[1], Math.atan2(t[3], t[2]), m.paint && m.paint.length ? this.assets.randomPaint(rng) : -1);
        v.parked = true; v.persist = true;
        if (!this.world.collideCircle(v.x, v.y, 1)) { this.addVehicle(v); this.hud.message("Your cousin left the pickup at the kerb. Bring it back in one piece. Or don't.", 5); }
      }
    } catch (e) { /* no ride is fine */ }
    this.controlsLocked = false;
    this.ui.fade(false);
    this.hud.showArea(name);
  }
  isSafehouseUnlocked(sv) { return sv.unlocked || (this.missions && this.missions.chapter >= (sv.unlockChapter || 1)); }

  // ------------------------------------------------------------ rendering hooks
  collectLights() {
    const out = [];
    const night = this.renderer.night;
    for (const v of this.vehicles) if (this.onScreen(v.x, v.y, 30)) v.lights(out, night);
    // street lamps from decor
    const [x0, y0, x1, y1] = this.cam.viewRect(20);
    this.decor.forEach(x0, y0, x1, y1, (it) => { if (it.id === 'street_lamp') out.push({ x: it.x, y: it.y, h: 5, r: 15, col: 'rgba(255,200,120,A)', a: 0.6 }); else if (it.id === 'gas_station_canopy') out.push({ x: it.x, y: it.y, r: 22, col: 'rgba(230,240,255,A)', a: 0.7 }); });
    for (const f of this.combat.fires) out.push({ x: f.x, y: f.y, r: f.r * 3, col: 'rgba(255,140,40,A)', a: 0.8 });
    for (const m of this.markers) out.push({ x: m.x, y: m.y, r: 6, col: 'rgba(255,220,80,A)', a: 0.6 });
    return out;
  }

  collectBlips() {
    const out = [];
    const pl = this.player;
    for (const sv of this.services) {
      if (sv.type === 'safehouse' && this.isSafehouseUnlocked(sv)) out.push({ x: sv.x, y: sv.y, col: '#7ed36b', shape: 'letter', letter: 'H', size: 4 });
      else if (sv.type === 'gunshop') out.push({ x: sv.x, y: sv.y, col: '#d9452b', shape: 'letter', letter: 'G', size: 4 });
      else if (sv.type === 'respray') out.push({ x: sv.x, y: sv.y, col: '#5aa0e8', shape: 'letter', letter: 'S', size: 4 });
    }
    if (this.missions) this.missions.blips(out);
    this.jobs.blips(out);
    this.factions.blips(out);
    this.trains.blips(out);
    this.payphones.blips(out);
    this.tornado.blips(out);
    for (const m of this.markers) if (m.blip !== false) out.push({ x: m.x, y: m.y, col: m.col || '#f2c233', shape: 'triangle', size: 5, edge: true, flash: m.flash });
    for (const v of this.police.units) out.push({ x: v.x, y: v.y, col: Math.floor(this.time * 4) % 2 ? '#e33' : '#36f', size: 3.5 });
    if (this.police.heli) out.push({ x: this.police.heli.x, y: this.police.heli.y, col: '#36f', shape: 'square', size: 4 });
    for (const p of this.peds) if (p.blip) out.push({ x: p.vehicle ? p.vehicle.x : p.x, y: p.vehicle ? p.vehicle.y : p.y, col: p.blip, size: 4, edge: true });
    for (const v of this.vehicles) if (v.blip) out.push({ x: v.x, y: v.y, col: v.blip, size: 4.5, shape: 'square', edge: true });
    if (this.waypoint) out.push({ x: this.waypoint[0], y: this.waypoint[1], col: '#e0e', shape: 'triangle', size: 5, edge: true });
    return out;
  }

  render(dt) {
    const R = this.renderer, cam = this.cam;
    const [x0, y0, x1, y1] = cam.viewRect(6);
    // vehicles
    // overpasses, bridge decks and ramps (3D)
    addDecks(R, this.world, cam, this, x0, y0, x1, y1);
    for (const v of this.vehicles) {
      if (v.x < x0 - 10 || v.x > x1 + 10 || v.y < y0 - 10 || v.y > y1 + 10) continue;
      if (v.isHeli && v.alt > 2) continue; // drawn on top later
      if ((v.z || 0) > 1) { R.addLate((ctx, c) => v.draw(ctx, c), (s, c, sx, sy) => v.drawShadow(s, c, sx, sy)); continue; }
      R.add(v.x, v.y, v.radius, (ctx, c) => v.draw(ctx, c), (s, c, sx, sy) => v.drawShadow(s, c, sx, sy), (v.z || 0) * 2.5);
    }
    for (const p of this.peds) {
      if (p.vehicle || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      if ((p.z || 0) > 1) { R.addLate((ctx, c) => p.draw(ctx, c), (s, c, sx, sy) => p.drawShadow(s, c, sx, sy)); continue; }
      R.add(p.x, p.y, 0.4, (ctx, c) => p.draw(ctx, c), (s, c, sx, sy) => p.drawShadow(s, c, sx, sy));
    }
    // trees
    const tds = settings.get('treeDensity') ?? 1;
    const detailedTrees = settings.get('terrainDetail') >= 2;
    if (!detailedTrees && this.assets.crowns.size) this.assets.crowns.clear();
    this.world.forEachTree(x0 - 6, y0 - 6, x1 + 6, y1 + 6, (x, y, type, scale, rot, reg, idx) => {
      if (tds < 1 && hash2(idx, 7, 1) > tds) return;
      const list = this.assets.treeSprites[type | 0] || this.assets.treeSprites[0];
      const base = list[idx % list.length];
      let sprite = base, shadow = base;
      if (detailedTrees && base.crownId) {
        const id = base.crownId === 'redbud' && idx % 7 === 0 ? 'redbud_bloom' : base.crownId;
        const distant = this.assets.crownSprite(id, base, true);
        const width = Math.max(base.w, base.h) * base.px * scale * cam.zoom;
        sprite = (width > 100 && this.assets.crownSprite(id, base, false)) || distant || base;
        shadow = distant || base;
      }
      const filtered = sprite !== base;
      const step = !filtered && cam.zoom < 7 ? 2 : 1;
      R.addTree(x, y, sprite, shadow, rot, scale, step, filtered);
    });
    // procedural decor (street furniture, signals, pumpjacks, cattle…)
    const T = this.time;
    this.decor.forEach(x0 - 12, y0 - 12, x1 + 12, y1 + 12, (it) => {
      let def = it.def, spr = def.sprite, h = it.h;
      if (it.signal) { const st = this.decor.signalState(it.signal); const d2 = this.assets.props.get(st === 'green' ? 'traffic_light_green' : st === 'yellow' ? 'traffic_light_yellow' : 'traffic_light_red'); if (d2) spr = d2.sprite; }
      else if (it.anim && def.sprites && def.sprites.length > 1) {
        const phase = ((it.x % 7) + 7) % 7;
        const frame = Math.floor(T * (it.id === 'pumpjack' ? 3 : 4) + phase);
        spr = def.sprites[frame % def.sprites.length];
      }
      if (it.animal) h = it.h + Math.sin(T * 0.07 + it.phase) * 0.6;
      if (it.overhead) { this.renderer.add(it.x, it.y, 6, (ctx, c) => spr.draw(ctx, c, it.x, it.y, h)); return; }
      const so = it.scale ? { scale: it.scale } : undefined;
      this.renderer.add(it.x, it.y, (def.radius || 0.5) * (it.scale || 1), (ctx, c) => spr.draw(ctx, c, it.x, it.y, h, so), (s2, c, sx, sy) => spr.drawShadow(s2, c, it.x, it.y, h, sx, sy, so));
    });
    // props
    for (const pr of this.props) {
      if (pr.x < x0 - 30 || pr.x > x1 + 30 || pr.y < y0 - 30 || pr.y > y1 + 30) continue;
      const def = this.assets.props.get(pr.id);
      if (!def) continue;
      const spr = def.sprites && def.sprites.length > 1 ? def.sprites[Math.floor(this.time * 4) % def.sprites.length] : def.sprite;
      R.add(pr.x, pr.y, (def.radius || 1), (ctx, c) => spr.draw(ctx, c, pr.x, pr.y, pr.h || 0, { scale: pr.scale || 1 }), (s, c, sx, sy) => spr.drawShadow(s, c, pr.x, pr.y, pr.h || 0, sx, sy, { scale: pr.scale || 1 }));
    }
    // pickups (floating, spinning)
    for (const u of this.pickups) this.addPickupDrawable(u, x0, y0, x1, y1);
    for (const pk of this.packages) if (!pk.got) this.addPickupDrawable({ type: 'package', x: pk.x, y: pk.y }, x0, y0, x1, y1);
    for (const u of this.worldPickups) if (u.cd <= 0) this.addPickupDrawable(u, x0, y0, x1, y1);
    this.jobs.drawTokens(this);
    this.trains.render(R, x0, y0, x1, y1);
    R.render(this, dt);
    this.loading = false;
    // airborne helicopters + projectiles + markers on top
    const ctx = R.ctx;
    for (const v of this.vehicles) if (v.isHeli && v.alt > 2 && this.onScreen(v.x, v.y, 40)) v.draw(ctx, cam);
    this.combat.draw(ctx, cam);
    this.tornado.draw(ctx, cam);
    this.drawMarkers(ctx, cam);
  }

  addPickupDrawable(u, x0, y0, x1, y1) {
    if (u.x < x0 || u.x > x1 || u.y < y0 || u.y > y1) return;
    const id = { cash: 'pickup_cash', weapon: 'pickup_weapon_crate', health: 'pickup_health', armor: 'pickup_armor', package: 'pickup_package', bribe: 'pickup_bribe' }[u.type];
    const def = this.assets.props.get(id);
    const t = this.time;
    if (def) this.renderer.add(u.x, u.y, 0.5, (ctx, c) => def.sprite.draw(ctx, c, u.x, u.y, t * 2, { z: 0.3 + Math.sin(t * 3) * 0.15 }));
    else this.renderer.add(u.x, u.y, 0.5, (ctx, c) => { const p = c.toScreen(u.x, u.y, 0.6); const s = c.zoom * 0.6; ctx.fillStyle = u.type === 'cash' ? '#4c4' : u.type === 'package' ? '#a75' : '#ddd'; ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s); });
  }

  drawMarkers(ctx, cam) {
    const t = this.time;
    let all = this.missions ? this.markers.concat(this.missions.startMarkers()) : this.markers;
    const svc = [];
    for (const sv of this.services) {
      if (!this.onScreen(sv.x, sv.y, 10)) continue;
      if (sv.type === 'safehouse' && !this.isSafehouseUnlocked(sv)) continue;
      svc.push({ x: sv.x, y: sv.y, r: sv.type === 'respray' ? 5 : 2, col: sv.type === 'respray' ? '#5aa0e8' : sv.type === 'gunshop' ? '#d9452b' : '#7ed36b' });
    }
    if (svc.length) all = all.concat(svc);
    for (const m of all) {
      if (!this.onScreen(m.x, m.y, 20)) continue;
      const r = (m.r || 3) * cam.zoom;
      const p = cam.toScreen(m.x, m.y, 0);
      ctx.strokeStyle = m.col || '#f2c233';
      ctx.lineWidth = Math.max(2, cam.zoom * 0.25);
      ctx.globalAlpha = 0.55 + Math.sin(t * 4) * 0.25;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.18; ctx.fillStyle = m.col || '#f2c233'; ctx.fill();
      ctx.globalAlpha = 1;
      // bouncing arrow
      const a = cam.toScreen(m.x, m.y, 4 + Math.sin(t * 3) * 0.6);
      const s = cam.zoom * 0.9;
      ctx.fillStyle = m.col || '#f2c233'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1] + s); ctx.lineTo(a[0] - s, a[1] - s * 0.4); ctx.lineTo(a[0] + s, a[1] - s * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  setWaypoint(point, label = '', manual = true) {
    this.waypoint = point;
    this.waypointLabel = point ? label : '';
    this.waypointIsManual = !!point && manual;
    this.gps?.update(0);
  }

  // ------------------------------------------------------------ save/load
  serialize() {
    const pl = this.player, p = pl.ped, v = pl.vehicle;
    // Melee weapons have infinite ammo in play. Store ownership as a JSON number.
    const ammo = {};
    for (const [id, count] of Object.entries(p.ammo)) {
      if (id !== 'fists') ammo[id] = count === Infinity ? 1 : count;
    }
    return {
      v: 2, t: Date.now(), x: pl.x, y: pl.y, h: p.h, z: p.z, money: pl.money, health: p.health, armor: p.armor,
      ammo, clip: { ...p.clip }, weapon: p.weapon, reloadT: p.reloadT,
      vehicle: v && !v.dead ? {
        model: v.m.id, paint: v.paint, h: v.h, z: v.z, health: v.health, maxHealth: v.maxHealth,
        fire: v.fire, sinking: v.sinking, copUnit: !!v.copUnit, sirenOn: v.sirenOn,
        alt: v.alt, heliAltTarget: v.heliAltTarget,
        station: this.resumeStation ?? (this.audio.radio?.inCar ? this.audio.radio.current : null),
      } : null,
      stats: pl.stats, clock: this.clock, day: this.day,
      packages: this.packages.filter((k) => k.got).map((k) => k.id),
      missions: this.missions ? this.missions.serialize() : null,
      flags: this.flags,
      waypoint: this.waypointIsManual && this.waypoint ? { point: this.waypoint, label: this.waypointLabel } : null,
    };
  }
  save(slot = 'slot1', snapshot) {
    try { localStorage.setItem('gtpolly.save.' + slot, JSON.stringify(snapshot ?? this.serialize())); return true; } catch (e) { console.warn('save failed', e); return false; }
  }
  static loadData(slot = 'slot1') { try { const s = localStorage.getItem('gtpolly.save.' + slot); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  restoreVehicle(saved) {
    const p = this.player.ped, model = this.assets.vehicle(saved?.model);
    if (!model) return;
    const v = new Vehicle(this, model, p.x, p.y, Number.isFinite(saved.h) ? saved.h : p.h,
      Number.isInteger(saved.paint) ? saved.paint : -1);
    if (saved.maxHealth > 0 && Number.isFinite(saved.maxHealth)) v.maxHealth = saved.maxHealth;
    if (Number.isFinite(saved.health)) v.health = Math.min(saved.health, v.maxHealth);
    for (const key of ['alt', 'heliAltTarget', 'fire', 'sinking']) {
      if (Number.isFinite(saved[key])) v[key] = Math.max(0, saved[key]);
    }
    v.copUnit = !!saved.copUnit; v.sirenOn = !!saved.sirenOn;
    // Re-seat the existing driver quietly. Entering as a new driver awards a theft and fires mission events.
    v.driver = p; p.vehicle = v; v.persist = true;
    this.addVehicle(v);
    // The spawn heuristic can choose a deck. Honor the recorded level, even directly underneath it.
    if (Number.isFinite(saved.z)) v.z = Math.max(0, saved.z);
    if (Number.isInteger(saved.station) && saved.station >= -1) this.resumeStation = this.radioIdx = saved.station;
  }

  recoverWaterSave() {
    // Earlier saves only contain coordinates. A pilot or boater must have somewhere to stand.
    const p = this.player.ped;
    const deck = this.world.deckAt(p.x, p.y, 60, 60, 0.1);
    if (deck && deck.z > 0.6) { p.z = deck.z; return; }
    for (let r = 4; r < 3000; r *= 1.5) {
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16, x = p.x + r * Math.cos(a), y = p.y + r * Math.sin(a);
        const surface = this.world.surfaceAt(x, y);
        if (surface < 0 || landingHazards.has(surface) || this.world.collideCircle(x, y, p.r)) continue;
        p.x = this.cam.x = x; p.y = this.cam.y = y; p.z = 0;
        this.hud.message('Resumed on shore.', 6);
        return;
      }
    }
    const home = this.nearest(this.services.filter(s => s.type === 'safehouse' && this.isSafehouseUnlocked(s)));
    p.x = this.cam.x = home.x; p.y = this.cam.y = home.y; p.z = 0;
    this.hud.message('Resumed at your nearest safehouse.', 6);
  }

  applySave(d) {
    const pl = this.player, p = pl.ped;
    pl.money = d.money || 0; pl.displayMoney = pl.money;
    p.health = d.health || 100; p.armor = d.armor || 0;
    for (const [id, count] of Object.entries(d.ammo || {})) {
      if (!Object.hasOwn(WEAPONS, id)) continue;
      const w = WEAPONS[id];
      // Old saves encode owned melee weapons as null (JSON-serialized Infinity).
      p.ammo[id] = w.type === 'melee' ? Infinity : clamp(Number.isFinite(count) ? count : 0, 0, w.maxAmmo);
      const capacity = Math.min(w.clip || 0, p.ammo[id]);
      p.clip[id] = Number.isInteger(d.clip?.[id]) ? clamp(d.clip[id], 0, capacity) : capacity;
    }
    p.weapon = d.weapon && p.hasWeapon(d.weapon) ? d.weapon : 'fists';
    p.reloadT = clamp(d.reloadT || 0, 0, WEAPONS[p.weapon].reload || 0);
    if (Number.isFinite(d.h)) p.h = p.face = d.h;
    if (Number.isFinite(d.z)) p.z = Math.max(0, d.z);
    this.restoreVehicle(d.vehicle);
    Object.assign(pl.stats, d.stats || {});
    this.clock = d.clock ?? this.clock; this.day = d.day || 1;
    for (const id of d.packages || []) { const k = this.packages.find((q) => q.id === id); if (k) k.got = true; }
    this.flags = d.flags || {};
    if (this.missions && d.missions) this.missions.deserialize(d.missions);
    if (!p.vehicle && ((d.v ?? 1) < 2 || d.vehicle) && this.world.surfaceAt(p.x, p.y) === S.WATER) {
      this.recoverWaterSave();
    }
    const point = d.waypoint?.point;
    if (Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && this.world.inWorld(...point)) {
      this.setWaypoint(point, typeof d.waypoint.label === 'string' ? d.waypoint.label : '');
    }
  }
}
