// Pedestrians (and the player on foot): movement, animation, health, ragdoll knockback.
import { S } from '../world/shared.js';
import { wrapAngle, approachAngle, rng } from '../engine/math.js';
import { WEAPONS } from '../data/weapons.js';
import { input } from '../engine/input.js';

let NEXT_ID = 1;
const PED_SCALE = 1.75;
const tmp2 = [0, 0];
const PDECK = {};

export class Ped {
  constructor(game, model, x, y, heading = 0) {
    this.id = NEXT_ID++;
    this.game = game;
    this.model = model;
    this._sprite = null;
    this.x = x; this.y = y; this.h = heading;
    this.vx = 0; this.vy = 0;
    this.r = 0.42;
    this.health = 100; this.maxHealth = 100; this.armor = 0;
    this.dead = false; this.deadT = 0;
    this.move = { x: 0, y: 0 };
    this.moveSpeed = 0;
    this.face = heading;
    this.animT = rng() * 10;
    this.weapon = 'fists';
    this.ammo = { fists: Infinity };
    this.clip = {};
    this.fireCd = 0;
    this.reloadT = 0;
    this.punchT = 0;
    this.aiming = false;
    this.tankSteering = false;
    this.vehicle = null;
    this.ai = null;
    this.isPlayer = false;
    this.isCop = false;
    this.faction = null;
    this.knock = 0;       // ragdoll time
    this.stun = 0;
    this.onFire = 0;
    this.drown = 0;
    this.mission = false;
    this.persist = false;
    this.lastHitBy = null;
    this.blood = 0;
    this.speech = 0;
    this.z = 0;
    this.vz = 0;
  }

  get spr() { return this._sprite ??= this.game.assets.ped(this.model); }
  setModel(m) { this.model = m; this._sprite = null; }

  give(weaponId, ammo = 0) {
    const w = WEAPONS[weaponId];
    if (!w) return;
    if (!(weaponId in this.ammo) || this.ammo[weaponId] === 0) {
      this.ammo[weaponId] = 0;
      this.clip[weaponId] = 0;
    }
    if (w.type === 'melee') this.ammo[weaponId] = Infinity;
    else this.ammo[weaponId] = Math.min(w.maxAmmo || 999, (this.ammo[weaponId] || 0) + ammo);
    if (!this.clip[weaponId] && w.clip) this.clip[weaponId] = Math.min(w.clip, this.ammo[weaponId]);
  }
  hasWeapon(id) { return id === 'fists' || (this.ammo[id] > 0); }

  update(dt) {
    const g = this.game;
    if (this.vehicle) { this.x = this.vehicle.x; this.y = this.vehicle.y; return; }
    if (this.dead) {
      this.deadT += dt;
      this.vx *= Math.exp(-5 * dt); this.vy *= Math.exp(-5 * dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      return;
    }
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.punchT > 0) this.punchT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.finishReload(); }
    if (this.speech > 0) this.speech -= dt;
    if (this.onFire > 0) {
      this.onFire -= dt;
      this.damage(22 * dt, this.lastHitBy, 'fire');
      if (Math.random() < dt * 25) g.effects.flame(this.x + (rng() - 0.5) * 0.5, this.y + (rng() - 0.5) * 0.5, 1.4);
      if (!this.isPlayer && !this.ai?.fleeFire) { this.move.x = Math.cos(this.animT * 3); this.move.y = Math.sin(this.animT * 2.3); this.moveSpeed = 5; }
    }
    if (this.knock > 0) {
      this.knock -= dt;
      this.vx *= Math.exp(-3.5 * dt); this.vy *= Math.exp(-3.5 * dt);
    } else if (this.stun > 0) {
      this.stun -= dt;
      this.vx *= Math.exp(-10 * dt); this.vy *= Math.exp(-10 * dt);
    } else {
      // steer toward desired velocity
      let mx = this.move.x, my = this.move.y;
      const ml = Math.hypot(mx, my);
      const sp = this.moveSpeed;
      // AI sidestep when snagged on a post/tree/wall: slide perpendicular for a moment
      if (!this.isPlayer && ml > 0.1) {
        if ((this.curSpeed || 0) < 0.25 * sp) this.stuckT = (this.stuckT || 0) + dt; else this.stuckT = 0;
        if (this.stuckT > 0.4) { this.sideT = 0.7; this.sideDir = Math.random() < 0.5 ? 1 : -1; this.stuckT = 0; }
      }
      if (this.sideT > 0) { this.sideT -= dt; const sx = -my * this.sideDir, sy = mx * this.sideDir; mx = mx * 0.3 + sx; my = my * 0.3 + sy; }
      const tvx = ml > 0.01 ? mx / ml * sp * Math.min(1, ml) : 0, tvy = ml > 0.01 ? my / ml * sp * Math.min(1, ml) : 0;
      const k = Math.min(1, 12 * dt);
      this.vx += (tvx - this.vx) * k; this.vy += (tvy - this.vy) * k;
      if (this.aiming || this.punchT > 0) this.h = approachAngle(this.h, this.face, 14 * dt);
      else if (!this.tankSteering && ml > 0.05) this.h = approachAngle(this.h, Math.atan2(my, mx), 11 * dt);
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
    // buildings
    const hit = g.world.mayTouchBuilding(this, this.r) && g.world.collideCircle(this.x, this.y, this.r, tmp2);
    if (hit) { this.x = tmp2[0]; this.y = tmp2[1]; if (this.knock > 0) { const vn = this.vx * hit.nx + this.vy * hit.ny; if (vn < -6) this.damage(-vn * 3, this.lastHitBy, 'impact'); this.vx -= 1.4 * vn * hit.nx; this.vy -= 1.4 * vn * hit.ny; } }
    if (this.z > 0.05) this.updateLevel(dt);
    // water: peds can't swim (classic rules)
    const surf = this.z > 0.6 ? -1 : g.world.surfaceAt(this.x, this.y);
    if (surf === S.WATER) {
      this.drown += dt;
      if (this.drown > 0.05 && this.drown - dt <= 0.05) { g.effects.splash(this.x, this.y, 1); g.audio.play('splash', { x: this.x, y: this.y, vol: 0.6 }); }
      this.vx *= Math.exp(-2 * dt); this.vy *= Math.exp(-2 * dt);
      if (this.drown > (this.isPlayer ? 8 : 2.2)) this.damage(999, null, 'drown');
      if (this.isPlayer) { this.vx *= Math.exp(-1.5 * dt); this.vy *= Math.exp(-1.5 * dt); }
    } else this.drown = 0;
    const sp = Math.hypot(this.vx, this.vy);
    this.animT += dt * (sp > 0.2 ? sp : 0.5);
    this.curSpeed = sp;
  }

  // up on an overpass: follow the deck, keep inside its rails, fall if pushed off the end
  updateLevel(dt) {
    const W = this.game.world;
    const d = W.deckAt(this.x, this.y, this.z, 1.6, 0.2, PDECK);
    if (d) { this.z = d.z; this.vz = 0; return; }
    const e = W.deckAt(this.x, this.y, this.z, 1.6, 2.5, PDECK);
    if (e && this.knock <= 0) {
      const nx = -e.dy, ny = e.dx, sg = Math.sign(e.lat), push = (Math.abs(e.lat) - e.hw + 0.2) * sg;
      this.x -= nx * push; this.y -= ny * push; this.z = e.z; return;
    }
    this.vz -= 9.8 * dt;
    this.z = Math.max(0, this.z + this.vz * dt);
    if (this.z === 0) { const impact = -this.vz; this.vz = 0; if (impact > 6) this.damage(impact * impact * 0.9, null, 'impact'); }
  }

  damage(amount, by, kind = 'bullet', dx = 0, dy = 0) {
    if (this.dead || this.invuln) return;
    if (by) this.lastHitBy = by;
    if (this.armor > 0 && kind !== 'drown' && kind !== 'fire') {
      const a = Math.min(this.armor, amount * 0.7);
      this.armor -= a; amount -= a;
    }
    this.health -= amount;
    if (kind === 'bullet' || kind === 'melee' || kind === 'impact' || kind === 'blast') this.blood += amount;
    if (dx || dy) { this.vx += dx; this.vy += dy; }
    if (this.isPlayer && by && by !== this) this.game.onPlayerAttacked(by);
    if (this.isPlayer && amount > 2) input.rumble(Math.min(1, 0.25 + amount / 60), 0.6, 110);
    if (this.health <= 0) this.die(by, kind);
    else if (this.ai && this.ai.onDamage) this.ai.onDamage(by, kind);
  }

  die(by, kind) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.deadT = 0;
    const g = this.game;
    if (kind !== 'drown') g.effects.bloodPool(this.x, this.y, this.blood > 40 ? 1.3 : 0.8);
    g.onPedKilled(this, by, kind);
  }

  knockDown(vx, vy, t = 1.2) {
    this.vx = vx; this.vy = vy; this.knock = t;
  }

  startReload() {
    const w = WEAPONS[this.weapon];
    if (!w || !w.clip || this.reloadT > 0) return;
    const ammo = this.ammo[this.weapon] || 0;
    if (ammo <= (this.clip[this.weapon] || 0)) return;
    this.reloadT = w.reload || 1.5;
    if (this.isPlayer) this.game.audio.play('reload', { x: this.x, y: this.y, vol: 0.7 });
  }
  finishReload() {
    const w = WEAPONS[this.weapon];
    if (!w || !w.clip) return;
    this.clip[this.weapon] = Math.min(w.clip, this.ammo[this.weapon] || 0);
  }

  frameImg() {
    const f = this.spr.frames;
    if (this.dead || this.lying || this.knock > 0.2 && Math.hypot(this.vx, this.vy) > 4) return f.dead;
    if (this.punchT > 0 && f.punch) return f.punch[Math.min(f.punch.length - 1, Math.floor((1 - this.punchT / 0.35) * f.punch.length))] || f.idle;
    const sp = this.curSpeed || 0;
    if (this.aiming && f.aim && sp < 0.6) return f.aim;
    if (sp > 0.3) {
      const run = sp > 3.2 && f.run;
      const arr = run ? f.run : f.walk;
      const cycle = run ? 2.6 : 1.3; // metres per 6-frame cycle
      return arr[Math.floor(this.animT / (cycle / arr.length)) % arr.length];
    }
    return this.aiming && f.aim ? f.aim : f.idle;
  }

  draw(ctx, cam) {
    if (this.vehicle) return;
    const img = this.frameImg();
    let a = null;
    if (this.dead && this.deadT > 25) a = Math.max(0, 1 - (this.deadT - 25) / 5);
    this.spr.sprite.draw(ctx, cam, this.x, this.y, this.h, { img, scale: PED_SCALE, vscale: 1.05, alpha: a, z: this.z || 0 });
    // muzzle / weapon hint: small dark line in hand when aiming a gun
    if ((this.aiming || this.fireFlash > 0) && !this.dead && WEAPONS[this.weapon] && WEAPONS[this.weapon].type !== 'melee') {
      const fx = Math.cos(this.h), fy = Math.sin(this.h);
      const zz = this.z || 0;
      const p0 = cam.toScreen(this.x + fx * 0.25 - fy * 0.18, this.y + fy * 0.25 + fx * 0.18, 1.25 + zz);
      const p1 = cam.toScreen(this.x + fx * 0.85 - fy * 0.18, this.y + fy * 0.85 + fx * 0.18, 1.3 + zz);
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = Math.max(1, cam.zoom * 0.12);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
  }
  drawShadow(sctx, cam, sx, sy) {
    if (this.vehicle) return;
    if (this.dead) return;
    const zz = this.z || 0;
    const p = cam.toScreen(this.x + sx * (0.6 + zz), this.y + sy * (0.6 + zz), 0);
    const r = 0.42 * cam.zoom;
    sctx.beginPath(); sctx.ellipse(p[0], p[1], r * 1.2, r, Math.atan2(sy, sx), 0, Math.PI * 2); sctx.fill();
  }
}
