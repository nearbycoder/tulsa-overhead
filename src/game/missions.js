// Story mission engine. Missions are async scripts: `async run(m) { await m.talk('c1m1_01'); ... }`
// The `m` object (MissionRun) is the scripting API — see docs/MISSION_API.md.
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/ped.js';
import { WalkerAI } from './pedai.js';
import { DriverAI } from './traffic.js';
import { pointAt, cum, laneOffset } from './roads.js';
import { input } from '../engine/input.js';
import { settings } from '../engine/settings.js';
import { rng, clamp, mulberry32 } from '../engine/math.js';
import { WEAPONS } from '../data/weapons.js';

export class MissionFail extends Error { constructor(msg) { super(msg); this.isFail = true; } }
class Abort extends Error { }

export class MissionManager {
  constructor(game, story) {
    this.game = game;
    this.story = story;            // {CAST, CHAPTERS, MISSIONS, LINES, STORY_PLACES}
    this.chapter = 1;
    this.done = new Set();
    this.active = null;
    this.cooldown = 0;
    this.voice = {};
    this.lastResult = null;
    this.places = {};
    for (const [id, p] of Object.entries(story.STORY_PLACES || {})) {
      const q = game.world.project(p.lat, p.lon);
      this.places[id] = { id, ...p, x: q[0], y: q[1] };
    }
    fetch('assets/voice/manifest.json').then((r) => r.ok ? r.json() : {}).then((j) => { this.voice = j || {}; }).catch(() => { });
  }

  place(id) {
    if (typeof id === 'object' && id) { if ('x' in id) return id; if ('lat' in id) { const q = this.game.world.project(id.lat, id.lon); return { x: q[0], y: q[1] }; } }
    const p = this.places[id] || this.game.places[id];
    if (!p) { console.warn('unknown place', id); return { x: 0, y: 0 }; }
    return p;
  }

  chapterDef(n = this.chapter) { return this.story.CHAPTERS.find((c) => c.n === n); }
  missionsOf(n) { return Object.values(this.story.MISSIONS).filter((m) => m.chapter === n); }
  available() {
    const out = [];
    for (const m of this.missionsOf(this.chapter)) {
      if (this.done.has(m.id)) continue;
      if ((m.requires || []).some((r) => !this.done.has(r))) continue;
      out.push(m);
    }
    return out;
  }
  get finished() { return this.chapter > this.story.CHAPTERS.length; }

  get canRetry() {
    const g = this.game;
    return !!this.retryOffer && !this.active && !this.retrying && !g.respawning &&
      !!g.player && !g.player.ped.dead && !g.controlsLocked && !g.jobs.active;
  }
  get quickRetry() { return this.canRetry && this.retryOffer.t > 0; }

  offerRetry(def, t, entities = []) {
    // A player can fail while still standing on the contact who started the mission.
    const pl = this.game.player;
    const contact = this.available().map(m => this.place(m.start))
      .find(p => Math.hypot(pl.x - p.x, pl.y - p.y) < 4.5);
    this.retryOffer = { def, t, contact, entities };
  }

  // contacts stand at their mission markers while the player is nearby
  updateGivers() {
    const g = this.game, pl = g.player;
    if (!pl) return;
    this.givers = this.givers || new Map();
    const want = new Map();
    const list = this.active ? [] : this.available();
    for (const m of list) {
      const c = this.story.CAST[m.giver];
      if (!c || c.model == null || m.giver === 'polly') continue;
      const p = this.place(m.start);
      if (Math.hypot(p.x - pl.x, p.y - pl.y) < 90) want.set(m.giver, p);
    }
    for (const [id, ped] of this.givers) {
      // a contact stays for the whole of their own mission while the player is around
      const keep = want.has(id) || (this.active && this.active.def.giver === id && Math.hypot(ped.x - pl.x, ped.y - pl.y) < 160);
      if (!keep || ped.dead) { g.removePed(ped); this.givers.delete(id); }
    }
    for (const [id, p] of want) {
      if (this.givers.has(id)) continue;
      const c = this.story.CAST[id];
      const mi = typeof c.model === 'string' ? g.assets.special(c.model) : c.model;
      const ped = new Ped(g, mi, p.x + 2.2, p.y + 0.8, Math.PI);
      ped.persist = true; ped.invuln = true; ped.giver = id;
      ped.ai = new MissionPedAI(g, ped, 'idle', {});
      g.peds.push(ped);
      this.givers.set(id, ped);
    }
  }

  update(dt) {
    const g = this.game;
    if ((this._gT = (this._gT || 0) - dt) <= 0) { this._gT = 0.5; this.updateGivers(); }
    if (this.retrying) return;
    if (this.quickRetry) {
      if (input.wasPressed('phone')) {
        input.consume('phone');
        this.retry();
        return;
      }
      this.retryOffer.t = Math.max(0, this.retryOffer.t - dt);
      if (this.retryOffer.t === 0) g.hud.message('To retry later, open Story in the pause menu.', 5);
    }
    if (this.active) { this.active.tick(dt); return; }
    const blockedContact = this.retryOffer?.contact;
    if (blockedContact && Math.hypot(g.player.x - blockedContact.x, g.player.y - blockedContact.y) >= 4.5) this.retryOffer.contact = null;
    if (this.cooldown > 0) { this.cooldown -= dt; return; }
    if (g.controlsLocked || g.respawning || !g.player || g.player.ped.dead) return;
    const pl = g.player;
    for (const m of this.available()) {
      const p = this.place(m.start);
      const d = Math.hypot(p.x - pl.x, p.y - pl.y);
      if (this.retryOffer?.contact === p) continue;
      if (d < 3.2 && (!pl.vehicle || m.vehicleStart)) { this.start(m); break; }
      if (d < 30) g.prompt = g.prompt || `${this.castName(m.giver)}: "${m.title}" — step into the marker`;
    }
    // mission start markers are drawn as world markers
  }

  castName(id) { const c = this.story.CAST[id]; return c ? c.name : id || ''; }

  blips(out) {
    if (this.active) return;
    for (const m of this.available()) {
      const p = this.place(m.start);
      const c = this.story.CAST[m.giver] || {};
      out.push({ x: p.x, y: p.y, col: c.color || '#f2b233', shape: 'letter', letter: (c.name || '?')[0], size: 5, edge: true });
    }
  }
  startMarkers() {
    if (this.active) return [];
    return this.available().map((m) => { const p = this.place(m.start); return { x: p.x, y: p.y, r: 2.6, col: (this.story.CAST[m.giver] || {}).color || '#f2b233' }; });
  }

  start(def) {
    const g = this.game;
    if (this.active || this.retrying) return;
    if (this.retryOffer?.def === def) {
      // Mission extras can still be at their starting positions after a failed attempt.
      for (const e of this.retryOffer.entities) {
        if (e.keep || e === g.player.vehicle) continue;
        if (e instanceof Vehicle && g.vehicles.includes(e)) g.removeVehicle(e);
        else if (e instanceof Ped && g.peds.includes(e)) {
          if (e.vehicle) g.exitVehicle(e, true);
          g.removePed(e);
        }
      }
    }
    this.retryOffer = null;
    this.active = new MissionRun(this, def);
    g.audio.play('mission_start');
    this.active.go();
  }

  finish(run, ok, msg, reward) {
    const g = this.game;
    this.active = null;
    this.cooldown = 3;
    run.cleanup(ok);
    if (ok && run.def.odd) {
      g.player.addMoney(reward || 0); g.player.stats.missions++;
      g.audio.play('mission_pass');
      g.hud.bigMessage('JOB DONE', reward ? `$${reward.toLocaleString()}` : '', '#f2b233', 4);
      this.lastResult = { id: run.def.id, ok, msg };
      return;
    }
    if (ok) {
      this.done.add(run.def.id);
      g.player.stats.missions++;
      g.player.addMoney(reward || 0);
      g.audio.play('mission_pass');
      g.hud.bigMessage('MISSION PASSED', reward ? `$${reward.toLocaleString()}` : (msg || ''), '#f2b233', 4.5);
      // chapter complete?
      const remaining = this.missionsOf(this.chapter).filter((m) => !this.done.has(m.id));
      if (!remaining.length) {
        const ch = this.chapterDef();
        this.chapter++;
        const next = this.chapterDef();
        setTimeout(() => {
          if (g.ui.game !== g) return;
          if (next) {
            g.hud.bigMessage(`CHAPTER ${next.n}`, next.title.toUpperCase(), '#f4ead2', 5.5);
            g.hud.message(next.blurb || '', 8);
            const first = this.available()[0];
            if (first) {
              const p = this.place(first.start);
              if (!g.waypointIsManual) g.setWaypoint([p.x, p.y], first.title, false);
              setTimeout(() => { if (g.ui.game === g && !this.active && !this.done.has(first.id)) g.hud.message(`${this.castName(first.giver)} has work for you in ${next.area}. Press {map} to find the contact.`, 9); }, 4000);
              const km = Math.hypot(p.x - g.player.x, p.y - g.player.y) / 1000;
              if (km > 6) setTimeout(() => { if (g.ui.game === g && !this.active && !this.done.has(first.id)) g.hud.message(`That's ${km.toFixed(0)} km away. Long drive? Press {phone} at any safehouse (H) to catch a ride.`, 9); }, 13500);
            }
          }
          else { g.hud.bigMessage('THE END', 'Thanks for playing Tulsa Overhead', '#f2b233', 8); g.ui.showCredits && g.ui.showCredits(); }
        }, 5000);
        if (ch && ch.reward) g.player.addMoney(ch.reward);
      }
      g.save('auto');
    } else {
      g.audio.play('mission_fail');
      g.hud.bigMessage('MISSION FAILED', msg || '', '#d9452b', 4.5);
      if (!run.def.odd && !/^test|timeout/.test(msg || '')) {
        this.offerRetry(run.def, 16, run.entities);
      }
    }
    this.lastResult = { id: run.def.id, ok, msg };
  }

  // quick retry: back to the contact, heat cleared, mission restarted
  async retry() {
    const g = this.game, pl = g.player;
    if (!this.canRetry) return;
    const { def } = this.retryOffer;
    this.retrying = true;
    g.controlsLocked = true;
    try {
      await g.ui.fade(true);
      if (g.ui.game !== g || g.respawning || pl.ped.dead) return;
      if (pl.vehicle) g.exitVehicle(pl.ped, true);
      const p = this.place(def.start);
      this.retryOffer.contact = p;
      pl.ped.x = p.x + 1.5; pl.ped.y = p.y + 1.5; pl.ped.vx = pl.ped.vy = 0;
      g.cam.x = p.x; g.cam.y = p.y;
      await g.world.update(p.x, p.y);
      if (g.ui.game !== g || g.respawning || pl.ped.dead) return;
      if (!g.world.regionAt(p.x, p.y)) {
        g.hud.message('The contact’s area is still loading. Try again in a moment.', 5);
        return;
      }
      pl.ped.health = Math.max(pl.ped.health, pl.ped.maxHealth * 0.5);
      g.police.setLevel(0); g.police.clearUnits(true);
    } finally {
      this.retrying = false;
      if (g.ui.game === g) {
        if (!g.respawning && !pl.ped.dead) g.controlsLocked = false;
        g.ui.fade(false);
      }
    }
    this.cooldown = 0;
    this.start(def);
  }

  onPedKilled(p, by) { if (this.active) this.active.emit('pedKilled', p, by); }
  onVehicleDestroyed(v, by) { if (this.active) this.active.emit('vehicleDestroyed', v, by); }
  onEnterVehicle(v) { if (this.active) this.active.emit('enter', v); }
  onExitVehicle(v) { if (this.active) this.active.emit('exit', v); }
  onPlayerDown(why) { if (this.active) this.active.abort(why === 'wasted' ? 'You were wasted.' : 'You were busted.'); }

  serialize() { return { chapter: this.chapter, done: [...this.done], retry: this.retryOffer?.def.id }; }
  deserialize(d) {
    this.chapter = d.chapter || 1;
    this.done = new Set(d.done || []);
    this.retryOffer = null;
    const failed = d.retry && this.available().find(m => m.id === d.retry);
    if (failed) this.offerRetry(failed, 0);
  }
}

// ---------------------------------------------------------------------------- MissionRun (script API)
export class MissionRun {
  constructor(mgr, def) {
    this.mgr = mgr; this.def = def; this.game = mgr.game;
    this.waiters = [];
    this.failConds = [];
    this.entities = new Set();
    this.markers = new Set();
    this.listeners = {};
    this.over = false;
    this.t = 0;
    this.timerFail = null;
    this.rng = mulberry32((Date.now() & 0xffff) ^ 0x9e37);
    this.maxWantedCap = null;
  }
  // ---- core
  get player() { return this.game.player; }
  get ped() { return this.game.player.ped; }
  get vehicle() { return this.game.player.vehicle; }
  get x() { return this.game.player.x; }
  get y() { return this.game.player.y; }
  place(id) { return this.mgr.place(id); }
  at(lat, lon) { const q = this.game.world.project(lat, lon); return { x: q[0], y: q[1] }; }
  offset(pos, dx, dy) { const p = this.place(pos); return { x: p.x + dx, y: p.y + dy }; }
  rand(a, b) { return a + (b - a) * this.rng(); }
  dist(a, b) { const p = this.place(a), q = b ? this.place(b) : { x: this.x, y: this.y }; return Math.hypot(p.x - q.x, p.y - q.y); }

  async go() {
    const g = this.game;
    const def = this.def;
    try {
      // An unfinished script cannot be serialized. Keep the world as it stood before it ran.
      this.startSave = structuredClone(g.serialize());
      if (!def.odd) this.startSave.restartMission = def.id;
      g.hud.bigMessage(def.title.toUpperCase(), this.mgr.chapterDef(def.chapter)?.title || '', '#f4ead2', 3);
      const res = await def.run(this);
      if (!this.over) this.pass(res && res.reward != null ? res.reward : def.reward);
    } catch (e) {
      if (e instanceof Abort) return;
      if (e && e.isFail) { if (!this.over) this.endFail(e.message); return; }
      console.error('Mission script error', def.id, e);
      if (!this.over) this.endFail('(script error) ' + e.message);
    }
  }
  tick(dt) {
    if (this.over) return;
    this.t += dt;
    const g = this.game;
    if (this.maxWantedCap != null && g.police.level > this.maxWantedCap) g.police.setLevel(this.maxWantedCap);
    if (this.timerVal != null && !g.dialogActive) {
      this.timerVal -= dt;
      g.hud.timer = { label: this.timerLabel, value: this.timerVal };
      if (this.timerVal <= 0) { this.timerVal = null; if (this.timerFail) return this.endFail(this.timerFail); }
    }
    for (const f of this.failConds) {
      let hit = false;
      try { hit = f.pred(); } catch (e) { if (e instanceof Abort || (e && e.isFail)) return; console.error("Mission failIf error", this.def.id, e); hit = false; }
      if (hit) return this.endFail(f.msg);
    }
    for (const w of [...this.waiters]) {
      let ok = false;
      if (this.over) return;
      const wi = () => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); };
      try { ok = w.pred(dt); } catch (e) { wi(); w.reject(e); continue; }
      if (w.deadline != null && this.t > w.deadline) { wi(); if (w.failMsg) { this.endFail(w.failMsg); return; } w.resolve(false); continue; }
      if (ok) { wi(); w.resolve(ok); }
    }
    if (this.skip && !this.over && !g.controlsLocked && !g.dialogActive) {
      this._skipHintT = (this._skipHintT || 0) - dt;
      const why = this.skipBlocked();
      if (!why && this._skipHintT <= 0 && (this._skipHints = (this._skipHints || 0) + 1) <= 2) { this._skipHintT = 45; g.hud.message('Long drive ahead. Press {phone} to skip it.', 5); } else if (this._skipHintT <= 0) this._skipHintT = 45;
      if (input.wasPressed('phone')) {
        input.consume('phone');
        if (why) g.hud.message(why, 3); else this.doSkip();
      }
    }
    if (this.onTick) {
      try { this.onTick(dt); }
      catch (e) { if (e instanceof Abort || (e && e.isFail)) return; console.error("Mission tick error", this.def.id, e); this.endFail("(script error) " + e.message); }
    }
  }
  emit(ev, ...args) {
    for (const fn of this.listeners[ev] || []) {
      try { fn(...args); } catch (e) { if (!(e instanceof Abort || (e && e.isFail))) console.error("Mission event error", this.def.id, ev, e); }
    }
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }

  waitFor(pred, opts = {}) {
    if (this.over) return Promise.reject(new Abort());
    return new Promise((resolve, reject) => {
      this.waiters.push({ pred, resolve, reject, deadline: opts.timeout != null ? this.t + opts.timeout : null, failMsg: opts.failMsg });
    });
  }
  wait(sec) { const until = this.t + sec; return this.waitFor(() => this.t >= until); }
  failIf(pred, msg) { const f = { pred, msg }; this.failConds.push(f); return () => { const i = this.failConds.indexOf(f); if (i >= 0) this.failConds.splice(i, 1); }; }
  fail(msg) { if (this.over) return; this.endFail(msg); throw new MissionFail(msg); }
  stop() {
    if (this.over) return false;
    this.over = true;
    for (const w of this.waiters) w.reject(new Abort());
    this.waiters = [];
    return true;
  }
  endFail(msg) { if (this.stop()) this.mgr.finish(this, false, msg); }
  abort(msg) { this.endFail(msg); }
  pass(reward) { if (this.stop()) this.mgr.finish(this, true, '', reward ?? this.def.reward); }
  cleanup(ok) {
    const g = this.game;
    this.followTarget = null;
    for (const mk of this.markers) { const i = g.markers.indexOf(mk); if (i >= 0) g.markers.splice(i, 1); }
    for (const e of this.entities) {
      e.mission = false; e.blip = null;
      if (e.keep) continue;
      e.persist = false;
      if (e instanceof Ped && !e.dead && e.ai && e.ai.kind === 'mission') { e.ai = new WalkerAI(g, e, null, 1, 1, 0); e.ai.state = 'wander'; }
    }
    g.hud.timer = null; g.hud.counter = null; g.hud.bar2 = null; g.hud.setObjective(null);
    g.controlsLocked = false;
    g.cam.zoomBias = null;
    this.game.ui.dialog && this.game.ui.dialog.hide();
    g.police.frozen = false;
    if (this.camFocusSet) g.camFocus = null;
    if (this._track) { g.audio.stopMusic(1.5); this._track = null; }
  }

  // ---- dialogue
  queueSpeech(speak) {
    // Event-triggered lines can arrive while an entire scripted exchange is in progress.
    const result = (this.speech || Promise.resolve()).then(async () => {
      if (this.over) throw new Abort();
      await speak();
      if (this.over) throw new Abort();
    });
    this.speech = result.catch(() => {});
    return result;
  }
  talk(ids, opts = {}) {
    const list = Array.isArray(ids) ? ids : [ids];
    return this.queueSpeech(async () => {
      for (const id of list) {
        if (this.over) throw new Abort();
        const line = this.mgr.story.LINES[id];
        if (!line) { console.warn('missing line', id); continue; }
        const [who, text] = line;
        const cast = this.mgr.story.CAST[who] || {name: who};
        const filename = this.mgr.voice[id];
        await this.game.ui.dialog.say(cast.name, text, {
          voice: filename ? 'assets/voice/' + filename : null,
          color: cast.color, cutscene: opts.cutscene
        });
      }
    });
  }
  async cutscene(ids, opts = {}) {
    const g = this.game;
    g.controlsLocked = true;
    g.ui.cine(true);
    if (opts.focus) { const p = this.place(opts.focus); g.camFocus = [p.x, p.y]; this.camFocusSet = true; }
    try { await this.talk(ids, { cutscene: true }); }
    finally { g.controlsLocked = false; g.ui.cine(false); if (opts.focus) { g.camFocus = null; } }
  }
  say(who, text) {
    const cast = this.mgr.story.CAST[who] || {name: who};
    return this.queueSpeech(() => this.game.ui.dialog.say(cast.name, text, {color: cast.color}));
  }
  objective(text, t = 9) { this.game.hud.setObjective(text, t); this.game.hud.message(text, Math.min(6, t)); }
  message(text, t = 4) { this.game.hud.message(text, t); }

  // ---- markers & navigation
  marker(pos, opts = {}) {
    const p = this.place(pos);
    const mk = { x: p.x, y: p.y, r: opts.r || 3, col: opts.col || '#f2c233', label: opts.label, blip: opts.blip !== false, flash: opts.flash };
    this.game.markers.push(mk);
    this.markers.add(mk);
    return mk;
  }
  unmark(mk) { const g = this.game; const i = g.markers.indexOf(mk); if (i >= 0) g.markers.splice(i, 1); this.markers.delete(mk); }
  async goto(pos, opts = {}) {
    const p = this.place(pos);
    const r = opts.r || 4;
    const mk = this.marker(p, { r: Math.min(r, 6), col: opts.col, label: opts.label });
    const veh = opts.vehicle;
    mk.req = { r, onFoot: !!opts.onFoot, inVehicle: !!opts.inVehicle || !!veh, vehicle: veh || null, stopped: !!opts.stopped };
    if (opts.label) this.objective(opts.label);
    // long hauls across the metro can be skipped (T) when nothing else is going on
    const skippable = !opts.noSkip && !opts.onFoot && Math.hypot(this.x - p.x, this.y - p.y) > 3000;
    if (skippable) { this.skip = { p, mk }; this._skipHintT = 0; }
    await this.waitFor(() => {
      const pl = this.player;
      if (Math.hypot(pl.x - p.x, pl.y - p.y) > r) return false;
      if (opts.onFoot && pl.vehicle) return false;
      if (opts.inVehicle && !pl.vehicle) return false;
      if (veh && pl.vehicle !== veh) return false;
      if (opts.stopped && pl.vehicle && pl.vehicle.speed > 2) return false;
      return true;
    }, { timeout: opts.timeout, failMsg: opts.failMsg });
    if (this.skip && this.skip.mk === mk) this.skip = null;
    this.unmark(mk);
    return true;
  }
  // can the current long drive be skipped right now? returns a reason string when not
  skipBlocked() {
    const g = this.game, pl = this.player, v = pl.vehicle;
    if (!this.skip) return 'none';
    if (!v || v.isBoat || v.isHeli) return 'Get in a car to skip the drive.';
    if (this.timerVal != null) return 'No time to waste: the clock is running.';
    if (g.police.level > 0) return 'Lose the cops first.';
    for (const e of this.entities) {
      if (e.dead || !e.ai) continue;
      if (e.ai.mode === 'follow' && e.vehicle !== v) return 'Pick up your passenger first.';
      if (e.ai.mode === 'attack' && Math.hypot(e.x - pl.x, e.y - pl.y) < 120) return 'Not while you are under fire.';
    }
    if (Math.hypot(this.skip.p.x - pl.x, this.skip.p.y - pl.y) < 1200) return 'Almost there.';
    return null;
  }
  async doSkip() {
    const g = this.game, pl = this.player, sk = this.skip;
    this.skip = null;
    const p = sk.p, dx = pl.x - p.x, dy = pl.y - p.y, d = Math.hypot(dx, dy) || 1;
    const km = d / 1000;
    g.controlsLocked = true;
    await g.ui.fade(true);
    if (this.over) { g.controlsLocked = false; g.ui.fade(false); return; }
    await this.teleport({ x: p.x + dx / d * 260, y: p.y + dy / d * 260 });
    const v = pl.vehicle;
    if (v) { v.h = Math.atan2(p.y - v.y, p.x - v.x); v.vx = v.vy = 0; const r = this.roadAt(v, { lane: true, maxD: 600 }); const bad = [1, 4].includes(g.world.surfaceAt(v.x, v.y)); if (r.road && (bad || Math.hypot(r.x - v.x, r.y - v.y) < 40)) { v.x = r.x; v.y = r.y; v.h = Math.cos(r.h - Math.atan2(p.y - r.y, p.x - r.x)) >= 0 ? r.h : r.h + Math.PI; } }
    g.clock = (g.clock + Math.round(km * 1.2)) % 1440;
    g.controlsLocked = false;
    g.ui.fade(false);
    g.hud.message(`Skipped ${km.toFixed(1)} km of driving.`, 3);
  }
  timer(sec, label = 'TIME', opts = {}) { this.timerVal = sec; this.timerLabel = label; this.timerFail = opts.fail === undefined ? 'Out of time.' : opts.fail; }
  stopTimer() { this.timerVal = null; this.game.hud.timer = null; }
  get timeLeft() { return this.timerVal ?? 0; }
  counter(label, value, max) { this.game.hud.counter = { label, value, max }; }
  clearCounter() { this.game.hud.counter = null; }
  bar(label, value, col) { this.game.hud.bar2 = { label, value, col }; }
  clearBar() { this.game.hud.bar2 = null; }

  // ---- spawning
  model(spec) {
    const A = this.game.assets;
    if (!spec) return A.pickVehicle(this.rng, 'urban');
    if (typeof spec === 'string') {
      const m = A.vehicle(spec);
      if (m) return m;
      // fallback: match by class/kind/role keyword
      const s = spec.toLowerCase();
      // most specific first: class, kind, role (road vehicles only unless asking for heli/boat), then id/name substrings
      const special = (v) => (v.kind === 'heli' && s !== 'heli' && !/heli/.test(s)) || (v.kind === 'boat' && s !== 'boat' && !/boat/.test(s));
      const tiers = [
        (v) => (v.class || '').toLowerCase() === s,
        (v) => v.kind === s,
        (v) => v.role === s && !special(v),
        (v) => ((v.id || '').includes(s) || (v.name || '').toLowerCase().includes(s) || (v.class || '').toLowerCase().includes(s)) && !special(v) && !(s === 'boat' && v.kind !== 'boat'),
      ];
      for (const t of tiers) { const list = A.vehicles.filter(t); if (list.length) return list[Math.floor(this.rng() * list.length)]; }
      console.warn('unknown vehicle model', spec);
      return A.pickVehicle(this.rng, 'urban');
    }
    if (typeof spec === 'function') { const list = A.vehicles.filter(spec); return list[Math.floor(this.rng() * list.length)] || A.vehicles[0]; }
    return spec;
  }
  // nearest road point to pos: {x, y, h}
  roadAt(pos, opts = {}) {
    const p = this.place(pos);
    const near = this.game.world.nearestRoad(p.x, p.y, opts.maxD || 120, (r) => r.cls !== 15 && (opts.any || r.cls !== 8));
    if (!near) return { x: p.x, y: p.y, h: 0 };
    const t = [0, 0, 0, 0];
    cum(near.road);
    pointAt(near.road, 1, near.s, opts.lane ? laneOffset(near.road, 0) : 0, t);
    return { x: t[0], y: t[1], h: Math.atan2(t[3], t[2]), road: near.road, s: near.s };
  }
  spawnCar(spec, pos, heading, opts = {}) {
    const g = this.game;
    const m = this.model(spec);
    let p = this.place(pos);
    if (opts.onRoad) { const r = this.roadAt(p, { lane: true }); p = r; if (heading == null) heading = r.h; }
    const v = new Vehicle(g, m, p.x, p.y, heading ?? 0, opts.paint ?? (m.paint && m.paint.length ? g.assets.randomPaint(this.rng) : -1));
    v.mission = true; v.persist = true;
    if (opts.blip) v.blip = opts.blip === true ? '#4af' : opts.blip;
    if (opts.locked) v.locked = true;
    if (opts.health) { v.health = v.maxHealth = opts.health; }
    g.addVehicle(v);
    this.entities.add(v);
    if (opts.driver) {
      const d = this.spawnPed(opts.driver.model ?? opts.driver, p, opts.driver);
      g.enterVehicle(d, v);
      const near = g.world.nearestRoad(v.x, v.y, 40);
      if (near) {
        cum(near.road);
        const t = [0, 0, 0, 0]; pointAt(near.road, 1, near.s, 0, t);
        let dir = Math.cos(v.h) * t[2] + Math.sin(v.h) * t[3] >= 0 ? 1 : -1;
        if (near.road.flags & 1) dir = 1;
        v.ai = new DriverAI(g, v, near.road, dir, 0, dir > 0 ? near.s : near.road.len - near.s);
        v.ai.mode = opts.ai || 'cruise';
        if (opts.speed) v.ai.maxSpeed = opts.speed;
        if (opts.target) v.ai.target = opts.target;
      }
    } else v.parked = !opts.unparked;
    return v;
  }
  spawnPed(model, pos, opts = {}) {
    const g = this.game;
    let mi = model;
    if (typeof model === 'string') {
      const cast = this.mgr.story.CAST[model];
      if (cast && cast.model != null) mi = typeof cast.model === 'string' ? g.assets.special(cast.model) : cast.model;
      else mi = g.assets.special(model);
    }
    const isCast = typeof model === 'string' && !!this.mgr.story.CAST[model];
    if (mi == null || typeof mi !== 'number') mi = g.assets.pickPed(this.rng, 'urban');
    const p0 = this.place(pos);
    const p = new Ped(g, mi, p0.x + (opts.dx || 0), p0.y + (opts.dy || 0), opts.h || 0);
    p.mission = true; p.persist = true;
    if (isCast) {
      p.cast = model; // story characters hold their nerve (no panic-fleeing)
      // the mission's own copy replaces the contact standing at the marker
      const gv = this.mgr.givers && this.mgr.givers.get(model);
      if (gv) { g.removePed(gv); this.mgr.givers.delete(model); }
    }
    if (opts.health) p.health = p.maxHealth = opts.health;
    if (opts.armor) p.armor = opts.armor;
    if (opts.faction) p.faction = opts.faction;
    if (opts.weapon) { p.give(opts.weapon, opts.ammo || 200); p.weapon = opts.weapon; p.armed = opts.weapon; }
    if (opts.blip) p.blip = opts.blip === true ? '#e33' : opts.blip;
    p.accuracy = opts.accuracy ?? 1.8; p.dmgMul = opts.dmgMul ?? 0.45;
    p.ai = new MissionPedAI(g, p, opts.ai || (opts.hostile ? 'attack' : 'idle'), opts);
    if (opts.cop) { p.isCop = true; }
    g.peds.push(p);
    this.entities.add(p);
    return p;
  }
  gang(n, pos, opts = {}) {
    const out = [];
    const c = this.place(pos);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + this.rng();
      const r = (opts.spread || 4) * (0.4 + this.rng() * 0.6);
      const model = opts.models ? opts.models[i % opts.models.length] : (opts.model ?? this.game.assets.pickPed(this.rng, 'urban'));
      out.push(this.spawnPed(model, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, { weapon: opts.weapon || 'pistol', ammo: 300, hostile: opts.hostile !== false, ai: opts.ai, faction: opts.faction || 'enemy', blip: opts.blip === null ? false : (opts.blip ?? '#e33'), health: opts.health, armor: opts.armor, accuracy: opts.accuracy, dmgMul: opts.dmgMul, range: opts.range, target: opts.target, speed: opts.speed }));
    }
    return out;
  }
  keep(e) { e.keep = true; return e; }
  // make an NPC get out of whatever vehicle it is in
  exitVehicle(ped) { if (ped && ped.vehicle) this.game.exitVehicle(ped, true); return ped; }
  // put an NPC into a vehicle as driver (AI keeps driving if the vehicle has a DriverAI)
  putInVehicle(ped, v) { if (ped && v && !v.dead) { if (ped.vehicle) this.game.exitVehicle(ped, true); v.driver = ped; ped.vehicle = v; v.parked = false; } return ped; }
  // toggle damage immunity for a ped or vehicle (story set pieces)
  invincible(e, on = true) { if (e) e.invuln = on; return e; }
  remove(e) {
    if (e instanceof Vehicle) { for (const p of [e.driver, ...e.passengers]) if (p && !p.isPlayer) this.entities.delete(p); this.game.removeVehicle(e); }
    else this.game.removePed(e);
    this.entities.delete(e);
  }

  // ---- player helpers
  giveWeapon(id, ammo = 60) { this.ped.give(id, ammo); this.ped.weapon = id; this.game.audio.play('pickup_weapon'); this.message(`${WEAPONS[id].name} acquired`, 2); }
  giveMoney(v) { this.player.addMoney(v); if (v) this.game.audio.play('cash'); }
  wanted(level) { this.game.police.setLevel(level); }
  maxWanted(level) { this.maxWantedCap = level; if (level != null && this.game.police.level > level) this.game.police.setLevel(level); }
  clearWanted() { this.game.police.setLevel(0); this.game.police.clearUnits(true); }
  freezeCops(on = true) { this.game.police.frozen = on; }
  setTime(hour) { this.game.clock = hour * 60; }
  weather(kind) { const W = this.game.weather; W.target = kind === 'rain' ? 0.85 : kind === 'storm' ? 1 : 0; if (kind === 'clear') W.rain = 0; W.t = 240; }
  music(level) {
    const A = this.game.audio;
    if (level > 0) {
      const track = level > 0.6 ? 'chase' : 'mission';
      if (this._track !== track) { A.playMusic(track); this._track = track; }
      A.setMusicIntensity(level);
    } else if (this._track) { A.stopMusic(1.5); this._track = null; }
  }
  flag(name, v = true) { this.game.flags[name] = v; }
  // move the player (and their vehicle); streams the destination in and, with {road:true}, snaps onto the nearest road
  async teleport(pos, h = 0, opts = {}) {
    let p = this.place(pos);
    const pl = this.player, g = this.game;
    const put = (q, hh) => { if (pl.vehicle) { pl.vehicle.x = q.x; pl.vehicle.y = q.y; pl.vehicle.h = hh; pl.vehicle.vx = pl.vehicle.vy = 0; } else { pl.ped.x = q.x; pl.ped.y = q.y; pl.ped.h = hh; } g.cam.x = q.x; g.cam.y = q.y; };
    put(p, h);
    await g.world.update(p.x, p.y);
    if (opts.road || (pl.vehicle && !pl.vehicle.isBoat && !pl.vehicle.isHeli)) {
      const r = this.roadAt(p, { lane: true });
      if (r && Math.hypot(r.x - p.x, r.y - p.y) < 60) put(r, opts.keepHeading ? h : r.h);
    }
  }
  lockControls(on) { this.game.controlsLocked = on; }

  // ---- composite objectives
  async enterVehicle(v, label) {
    if (label) this.objective(label);
    const stop = this.failIfDestroyed(v, 'The vehicle was destroyed.');
    v.blip = v.blip || '#4af';
    await this.waitFor(() => this.player.vehicle === v);
    v.blip = null;
    stop(); // once aboard, later objectives decide what destruction means
    return v;
  }
  async getAnyVehicle(label = 'Steal a car.', filter) {
    if (label) this.objective(label);
    this.wantVehicle = filter || (() => true);
    const v = await this.waitFor(() => { const v = this.player.vehicle; return v && (!filter || filter(v)) ? v : false; });
    this.wantVehicle = null;
    return v;
  }
  failIfDestroyed(e, msg) {
    return this.failIf(() => (e.dead || (e.sunk)) && !e._okDead, msg || 'It was destroyed.');
  }
  async deliver(v, pos, opts = {}) {
    const stopFail = this.failIfDestroyed(v, opts.failMsg || 'The vehicle was destroyed.');
    const p = this.place(pos);
    const mk = this.marker(p, { r: opts.r || 5, col: opts.col || '#f2c233' });
    mk.req = { r: opts.r || 5, inVehicle: true, vehicle: v, stopped: true };
    if (opts.label) this.objective(opts.label);
    await this.waitFor(() => {
      if (this.player.vehicle !== v) { v.blip = '#4af'; return false; }
      v.blip = null;
      if (opts.maxDamage != null && v.health < v.maxHealth * (1 - opts.maxDamage)) this.fail(opts.damageMsg || 'The car is too damaged.');
      return Math.hypot(v.x - p.x, v.y - p.y) < (opts.r || 5) && v.speed < (opts.maxSpeed ?? 4);
    }, { timeout: opts.timeout, failMsg: opts.timeoutMsg });
    this.unmark(mk);
    stopFail();
    if (opts.exit !== false) { this.game.exitVehicle(this.ped, true); v.locked = true; v.parked = true; }
  }
  async destroy(targets, opts = {}) {
    const list = Array.isArray(targets) ? targets : [targets];
    for (const t of list) { t._okDead = true; if (!t.blip) t.blip = opts.blip || '#e33'; }
    if (opts.label) this.objective(opts.label);
    const total = list.length;
    await this.waitFor(() => {
      const alive = list.filter((t) => !(t.dead || t.sunk || (t.health <= 0)));
      if (opts.counter) this.counter(opts.counter, total - alive.length, total);
      return alive.length === 0;
    }, { timeout: opts.timeout, failMsg: opts.failMsg });
    if (opts.counter) this.clearCounter();
  }
  kill(peds, opts) { return this.destroy(peds, opts); }
  // tail a vehicle without being spotted or losing it
  async follow(v, opts = {}) {
    const maxD = opts.maxDist || 140, minD = opts.minDist || 0;
    v.blip = v.blip || '#4af';
    if (opts.label) this.objective(opts.label);
    let close = 0, ft = 0;
    this.followTarget = { vehicle: v, minDist: minD, maxDist: maxD };
    this.failIfDestroyed(v, opts.destroyMsg || 'The target was destroyed.');
    await this.waitFor((dt) => {
      const d = Math.hypot(v.x - this.x, v.y - this.y);
      if (d > maxD) this.fail(opts.lostMsg || 'You lost the target.');
      if (opts.rangeLabel) this.counter(opts.rangeLabel, `${Math.round(d)} m`);
      ft += dt;
      // a short grace period while the target pulls away from the start
      if (minD && d < minD && ft > 8) { close += dt; if (close > (opts.spotTime || 3)) this.fail(opts.spottedMsg || 'You were spotted!'); } else close = Math.max(0, close - dt);
      if (minD) this.bar('SUSPICION', close / (opts.spotTime || 3), '#e8b030');
      if (opts.until) { const p = this.place(opts.until); return Math.hypot(v.x - p.x, v.y - p.y) < (opts.untilR || 12); }
      if (opts.duration) return this.t > (this._followStart ??= this.t) + opts.duration;
      return false;
    });
    this.followTarget = null;
    if (opts.rangeLabel) this.clearCounter();
    this.clearBar();
  }
  // send an AI vehicle driving to a destination
  driveTo(v, pos, opts = {}) {
    if (!v.ai) return;
    const p = this.place(pos);
    v.ai.mode = opts.flee ? 'flee' : 'goto';
    v.ai.target = [p.x, p.y];
    if (opts.speed) v.ai.maxSpeed = opts.speed;
  }
  pursue(v, target) { if (v.ai) { v.ai.mode = 'pursue'; v.ai.target = [target.x, target.y]; v._pursueTarget = target; } }
  // races: checkpoints = [pos...]; opponents get AI racing between checkpoints
  async race(checkpoints, opts = {}) {
    const g = this.game;
    const pts = checkpoints.map((c) => this.place(c));
    const opp = opts.opponents || [];
    for (const o of opp) { o.ai && (o.ai.mode = 'goto'); o.raceIdx = 0; o.ai && (o.ai.target = [pts[0].x, pts[0].y]); o.ai && (o.ai.maxSpeed = opts.oppSpeed || 34); }
    this.onTick = () => {
      for (const o of opp) {
        if (!o.ai || o.raceIdx >= pts.length) continue;
        const p = pts[o.raceIdx];
        if (Math.hypot(o.x - p.x, o.y - p.y) < 14) { o.raceIdx++; if (o.raceIdx < pts.length) o.ai.target = [pts[o.raceIdx].x, pts[o.raceIdx].y]; else if (opts.mustWin !== false) this.fail(opts.loseMsg || 'You lost the race.'); }
      }
    };
    for (let i = 0; i < pts.length; i++) {
      this.counter('CHECKPOINT', i, pts.length);
      await this.goto(pts[i], { r: opts.r || 9, inVehicle: true, noSkip: true, col: i === pts.length - 1 ? '#7ed36b' : '#f2c233' });
      g.audio.play('checkpoint');
    }
    this.onTick = null;
    this.clearCounter();
  }
  async collect(positions, opts = {}) {
    const pts = positions.map((c) => ({ ...this.place(c), got: false }));
    const mks = pts.map((p) => this.marker(p, { r: 1.6, col: opts.col || '#7ed36b' }));
    if (opts.label) this.objective(opts.label);
    await this.waitFor(() => {
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].got) continue;
        if (Math.hypot(pts[i].x - this.x, pts[i].y - this.y) < (opts.r || 2.5)) { pts[i].got = true; this.unmark(mks[i]); this.game.audio.play('pickup'); }
      }
      const n = pts.filter((p) => p.got).length;
      this.counter(opts.counter || 'COLLECTED', n, pts.length);
      return n === pts.length;
    }, { timeout: opts.timeout, failMsg: opts.failMsg });
    this.clearCounter();
  }
  async loseCops(label = 'Lose the cops.') {
    if (this.game.police.level === 0) return;
    this.objective(label);
    await this.waitFor(() => this.game.police.level === 0);
  }
  async survive(sec, label) { this.timer(sec, label || 'SURVIVE', { fail: null }); await this.waitFor(() => this.timerVal == null || this.timerVal <= 0); this.stopTimer(); }
  async escort(ped, pos, opts = {}) {
    // NPC follows the player (gets into the player's vehicle when close)
    ped.ai = new MissionPedAI(this.game, ped, 'follow', {});
    this.failIf(() => ped.dead, opts.deadMsg || `${opts.name || 'They'} died.`);
    await this.goto(pos, { r: opts.r || 6, label: opts.label, inVehicle: opts.inVehicle });
    await this.waitFor(() => ped.dead || Math.hypot(ped.x - this.x, ped.y - this.y) < 12 || ped.vehicle === this.player.vehicle);
  }
}

// ---------------------------------------------------------------------------- mission NPC AI
export class MissionPedAI {
  constructor(game, p, mode, opts = {}) { this.game = game; this.p = p; this.mode = mode; this.kind = 'mission'; this.opts = opts; this.t = 0; this.home = [p.x, p.y]; }
  onDamage(by) { if (by && by.isPlayer && (this.mode === 'idle' || this.mode === 'guard')) this.mode = this.p.armed ? 'attack' : 'flee'; }
  panic(x, y) {
    if (this.mode === 'guard') { this.mode = 'attack'; return; }
    if (this.p.cast || this.opts.stay) return;
    if (this.mode === 'idle' && !this.p.armed) { this.mode = 'flee'; this.threat = [x, y]; }
  }
  update(dt) {
    const g = this.game, p = this.p, pl = g.player;
    if (p.dead) return;
    p.aiming = false;
    if (p.vehicle) {
      // nobody rides a burning car into the fireball
      if ((p.vehicle.fire > 0 && !p.vehicle.isHeli) || (p.vehicle.sinking && !p.vehicle.isBoat)) { g.exitVehicle(p, true); return; }
      if (this.mode === 'follow' && !pl.vehicle) g.exitVehicle(p, true);
      // armed hostiles shoot out of the window (drive-by)
      if (this.mode === 'attack' && p.armed && !pl.ped.dead && WEAPONS[p.weapon] && WEAPONS[p.weapon].type === 'gun') {
        const T = pl.vehicle || pl.ped;
        const d = Math.hypot(T.x - p.vehicle.x, T.y - p.vehicle.y);
        if (d < 30 && Math.random() < 0.5 && g.world.lineOfSight(p.vehicle.x, p.vehicle.y, T.x, T.y)) g.combat.tryFire(p, Math.atan2(T.y - p.vehicle.y, T.x - p.vehicle.x), { vehicle: p.vehicle });
      }
      return;
    }
    const T = pl.vehicle || pl.ped;
    const dx = T.x - p.x, dy = T.y - p.y, d = Math.hypot(dx, dy);
    switch (this.mode) {
      case 'idle': p.move.x = p.move.y = 0; if (d < 12) p.face = Math.atan2(dy, dx); p.h = p.face; break;
      case 'guard': {
        p.move.x = p.move.y = 0;
        if (d < (this.opts.range || 22) && g.world.lineOfSight(p.x, p.y, T.x, T.y)) this.mode = 'attack';
        break;
      }
      case 'flee': {
        const tx = this.threat ? p.x - this.threat[0] : -dx, ty = this.threat ? p.y - this.threat[1] : -dy;
        const L = Math.hypot(tx, ty) || 1;
        p.move.x = tx / L; p.move.y = ty / L; p.moveSpeed = 5;
        break;
      }
      case 'attack': {
        const w = WEAPONS[p.weapon] || WEAPONS.fists;
        const range = w.type === 'melee' ? 1.2 : Math.min(w.range * 0.7, 26);
        p.face = Math.atan2(dy, dx);
        if (d > range || !g.world.lineOfSight(p.x, p.y, T.x, T.y)) { p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = 4.4; this.aimT = 0.5 + Math.random() * 0.4; }
        else if (this.aimT > 0) { this.aimT -= dt; p.move.x = p.move.y = 0; p.aiming = w.type !== 'melee'; }
        else {
          p.move.x = (this.strafe ??= (Math.random() < 0.5 ? -1 : 1)) * -dy / d * 0.4; p.move.y = this.strafe * dx / d * 0.4; p.moveSpeed = 2;
          p.aiming = w.type !== 'melee';
          if (Math.random() < 0.7) g.combat.tryFire(p, p.face);
          if (Math.random() < dt * 0.3) this.strafe = -this.strafe;
        }
        break;
      }
      case 'follow': {
        if (pl.vehicle && d < 7 && !p.vehicle) {
          const v = pl.vehicle;
          if (!v.isTwoWheel && v.passengers.length < 3) { p.vehicle = v; v.passengers.push(p); }
          break;
        }
        if (d > 2.5) { p.move.x = dx / d; p.move.y = dy / d; p.moveSpeed = d > 8 ? 5.5 : 3.5; } else { p.move.x = p.move.y = 0; }
        break;
      }
      case 'goto': {
        const t = this.opts.target;
        if (!t) break;
        const ex = t.x - p.x, ey = t.y - p.y, ed = Math.hypot(ex, ey);
        if (ed > 1) { p.move.x = ex / ed; p.move.y = ey / ed; p.moveSpeed = this.opts.speed || 1.6; } else { p.move.x = p.move.y = 0; }
        break;
      }
    }
  }
}
