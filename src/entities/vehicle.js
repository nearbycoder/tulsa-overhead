// Vehicles: arcade top-down physics (grip + drift), damage, fire, lights, sirens.
import { S } from '../world/shared.js';
import { clamp, wrapAngle, rng } from '../engine/math.js';

const DECK = {};
let NEXT_ID = 1;
export const VSCALE = 1.2; // vehicles are drawn/simulated slightly larger than life for readability
const SURF_GRIP = new Float32Array(32).fill(0.72);
const SURF_DRAG = new Float32Array(32).fill(2.2);
for (const s of [S.ROAD, S.BRIDGE, S.PARKING, S.RUNWAY, S.WALK, S.LOT]) { SURF_GRIP[s] = 1; SURF_DRAG[s] = 1; }
SURF_GRIP[S.DIRTROAD] = 0.82; SURF_DRAG[S.DIRTROAD] = 1.5;
SURF_GRIP[S.DIRT] = 0.75; SURF_DRAG[S.DIRT] = 2.0;
SURF_GRIP[S.WETLAND] = 0.5; SURF_DRAG[S.WETLAND] = 5;
SURF_GRIP[S.CREEK] = 0.55; SURF_DRAG[S.CREEK] = 6;
SURF_GRIP[S.FOREST] = 0.6; SURF_DRAG[S.FOREST] = 3.5;
SURF_GRIP[S.FARM] = 0.68; SURF_DRAG[S.FARM] = 3;

export class Vehicle {
  constructor(game, model, x, y, heading, paint = -1) {
    this.id = NEXT_ID++;
    this.game = game;
    this.m = model;
    this.paint = paint;
    this._sprite = null;
    this.rotor = model.kind === 'heli' ? game.assets.rotorSprite(model) : null;
    this.x = x; this.y = y; this.h = heading;
    this.vx = 0; this.vy = 0; this.av = 0;
    this.vf = 0; this.vr = 0;
    this.len = (model.len || this.sprite.h * 0.1) * VSCALE;
    this.wid = (model.wid || this.sprite.w * 0.1) * VSCALE;
    this.hgt = (model.hgt || this.sprite.count * 0.1) * VSCALE;
    this.mass = model.mass || 1400;
    this.maxHealth = model.health || 1000;
    this.health = this.maxHealth;
    this.kind = model.kind || 'car';
    this.ctrl = { throttle: 0, brake: 0, allowReverse: false, steer: 0, handbrake: false };
    this.driver = null;
    this.passengers = [];
    this.ai = null;
    this.parked = false;
    this.mission = false;
    this.persist = false;
    this.fire = 0;           // >0 burning seconds left until explode
    this.dead = false;       // exploded wreck
    this.deadTime = 0;
    this.sinking = 0;
    this.sirenOn = false;
    this.lightT = rng() * 10;
    this.rpm = 0;
    this.gear = 1;
    this.skid = 0;
    this.braking = false;
    this.alt = 0;            // helicopter altitude
    this.z = 0;              // height of the road surface under the wheels (overpasses, ramps)
    this.vz = 0;
    this.rotorAngle = 0;
    this.lastHitBy = null;
    this.damageT = 0;
    this.circles = Math.max(2, Math.round(this.len / Math.max(1.2, this.wid)));
    this.radius = Math.hypot(this.len, this.wid) * 0.5;
    this.stuckT = 0;
    this.alarm = 0;
    this.horn = 0;
    this.locked = false;
  }

  get sprite() { return this._sprite ??= this.game.assets.vehicleSprite(this.m, this.paint); }
  set sprite(value) { this._sprite = value; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get isTwoWheel() { return this.kind === 'bike' || this.kind === 'motorbike'; }
  get isBoat() { return this.kind === 'boat'; }
  get isHeli() { return this.kind === 'heli'; }

  // body circles in world space
  circlePositions(out) {
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    const n = this.circles;
    const r = this.wid * 0.5;
    const span = Math.max(0, this.len - this.wid);
    for (let i = 0; i < n; i++) {
      const o = n === 1 ? 0 : -span / 2 + span * i / (n - 1);
      out[i * 3] = this.x + fx * o; out[i * 3 + 1] = this.y + fy * o; out[i * 3 + 2] = o;
    }
    return r;
  }

  update(dt) {
    const g = this.game, m = this.m;
    if (this.dead) {
      this.deadTime += dt;
      this.vx *= Math.exp(-2 * dt); this.vy *= Math.exp(-2 * dt); this.av *= Math.exp(-3 * dt);
      this.x += this.vx * dt; this.y += this.vy * dt; this.h += this.av * dt;
      this.stopSounds();
      return;
    }
    if (this.isHeli) return this.updateHeli(dt);
    const c = this.ctrl;
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    const rx = -fy, ry = fx;
    let vf = this.vx * fx + this.vy * fy;
    let vr = this.vx * rx + this.vy * ry;
    let surf = g.world.surfaceAt(this.x, this.y);
    if (this.z > 0.6 && !this.isBoat) surf = S.ROAD; // up on a deck: the ground below doesn't matter
    let grip = 1, drag = 1;
    if (surf >= 0) { grip = SURF_GRIP[surf]; drag = SURF_DRAG[surf]; }
    if (this.isBoat) {
      const onWater = surf === S.WATER || surf === S.POOL || surf === S.CREEK || surf === S.BRIDGE;
      this.onWater = onWater;
      grip = onWater ? 0.35 : 0.2; drag = onWater ? 0.6 : 18;
    } else if ((surf === S.WATER || surf === S.POOL) && !this.sinking) {
      this.sinking = 0.001;
      g.effects.splash(this.x, this.y, 2.5);
      g.audio.play('splash', { x: this.x, y: this.y });
    }
    if (this.sinking) {
      this.sinking += dt;
      vf *= Math.exp(-3 * dt); vr *= Math.exp(-3 * dt);
      if (this.sinking > 2.5 && !this.dead) {
        this.health = 0;
        g.onVehicleSunk(this);
        return;
      }
    }
    const top = (m.topSpeed || 45) * (this.health < this.maxHealth * 0.25 ? 0.75 : 1);
    const accel = m.accel || 8;
    const brakeA = m.brake || 14;
    const hasDriver = !!this.driver && !this.sinking;
    const throttle = hasDriver ? c.throttle : 0;
    const brake = hasDriver ? c.brake : 0;
    this.braking = false;
    if (throttle > 0) {
      if (vf < 0) { vf = Math.min(0, vf + brakeA * throttle * dt); this.braking = true; }
      else {
        const f = 1 - Math.pow(Math.max(0, vf) / top, 2);
        vf += accel * throttle * Math.max(0.05, f) * (0.55 + 0.45 * grip) * dt;
      }
    }
    if (brake > 0) {
      if (vf > 0 || !c.allowReverse) {
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), brakeA * brake * dt);
        this.braking = true;
      } else if (throttle === 0 && vf > -top * 0.3) {
        vf = Math.max(-top * 0.3, vf - accel * 0.55 * brake * dt);
      }
    }
    if (c.handbrake && hasDriver) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 6 * dt); this.braking = true; }
    // rolling + air drag
    const roll = (0.25 + 0.6 * (drag - 1)) * (throttle > 0 ? 0.3 : 1);
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), (roll + Math.abs(vf) * 0.006 * drag) * dt * 2);
    if (vf > top) vf = top;
    // lateral grip
    const driftK = m.drift ?? 0.5;
    let lat = (c.handbrake && hasDriver ? 1.3 : 8.5 - driftK * 3) * (m.grip || 1) * grip;
    if (this.isTwoWheel) lat *= 1.25;
    vr *= Math.exp(-lat * dt);
    // steering
    const sp = Math.abs(vf);
    const dir = vf >= -0.1 ? 1 : -1;
    const steerAuth = Math.min(1, sp / 3.5) / (1 + sp / 42);
    const steer = hasDriver ? c.steer : 0;
    const targetAv = steer * (m.steer || 2.4) * steerAuth * dir * (c.handbrake ? 1.45 : 1);
    this.av += (targetAv - this.av) * Math.min(1, 9 * dt);
    if (!hasDriver) this.av *= Math.exp(-4 * dt);
    this.h = wrapAngle(this.h + this.av * dt);
    this.vx = fx * vf + rx * vr;
    this.vy = fy * vf + ry * vr;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vf = vf; this.vr = vr;
    if (!this.isBoat) this.updateLevel(dt);
    // skids
    this.skid = Math.abs(vr) > 3.2 || (this.braking && sp > 9 && !this.isTwoWheel) ? Math.min(1, (Math.abs(vr) - 2) / 8 + (this.braking ? 0.4 : 0)) : 0;
    if (this.skid > 0 && surf !== S.WATER && g.effects) g.effects.skid(this);
    if (this.skid > 0 && grip < 0.9 && Math.random() < dt * 20) g.effects.dust(this.x - fx * this.len * 0.4, this.y - fy * this.len * 0.4, surf === S.DIRTROAD || surf === S.DIRT ? '#a8724a' : '#7a7a52');
    // rpm (fake gearbox)
    const ratio = clamp(sp / top, 0, 1);
    const gears = 5;
    this.gear = Math.min(gears, 1 + Math.floor(ratio * gears * 0.999));
    const gr = ratio * gears - (this.gear - 1);
    const targetRpm = hasDriver ? clamp(0.18 + gr * 0.72 + throttle * 0.1, 0.12, 1) : 0;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, 6 * dt);
    // damage effects
    const hp = this.health / this.maxHealth;
    if (hp < 0.4 && g.effects && Math.random() < dt * (hp < 0.2 ? 14 : 6)) g.effects.smoke(this.x + fx * this.len * 0.35, this.y + fy * this.len * 0.35, hp < 0.2 ? '#222' : '#777', this.hgt);
    if (hp < 0.15 && !this.fire) this.fire = 4 + rng() * 2;
    if (this.fire > 0) {
      this.fire -= dt;
      if (g.effects && Math.random() < dt * 30) g.effects.flame(this.x + fx * this.len * 0.3 + (rng() - 0.5) * this.wid, this.y + fy * this.len * 0.3 + (rng() - 0.5) * this.wid, this.hgt);
      if (this.fire <= 0) g.combat.explodeVehicle(this);
    }
    if (this.horn > 0) this.horn -= dt;
    this.lightT += dt;
    this.updateSounds(dt);
  }

  updateHeli(dt) {
    const g = this.game, c = this.ctrl, m = this.m;
    const hasDriver = !!this.driver;
    const targetAlt = hasDriver ? (this.heliAltTarget ?? 38) : 0;
    this.alt += clamp(targetAlt - this.alt, -6 * dt, 8 * dt);
    this.rotorAngle += dt * (hasDriver || this.alt > 0.5 ? 28 : 4);
    const airborne = this.alt > 3;
    const top = m.topSpeed || 55;
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    if (airborne) {
      const accel = (m.accel || 7) * 1.6;
      const acc = accel * (c.throttle - c.brake * 0.7);
      this.vx += fx * acc * dt; this.vy += fy * acc * dt;
      if (c.strafe) { this.vx += -fy * c.strafe * 6 * dt; this.vy += fx * c.strafe * 6 * dt; }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > top) { this.vx *= top / sp; this.vy *= top / sp; }
      // drag tuned so full throttle settles at the catalog top speed
      const k = c.throttle > 0.05 ? accel / top : 0.9;
      this.vx *= Math.exp(-k * dt); this.vy *= Math.exp(-k * dt);
      this.av += ((c.steer || 0) * (m.steer || 1.8) - this.av) * Math.min(1, 5 * dt);
    } else {
      this.vx *= Math.exp(-6 * dt); this.vy *= Math.exp(-6 * dt); this.av *= Math.exp(-6 * dt);
    }
    this.h = wrapAngle(this.h + this.av * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rpm = hasDriver ? 0.5 + 0.5 * clamp(Math.hypot(this.vx, this.vy) / top, 0, 1) : this.alt > 0.5 ? 0.3 : 0;
    const hp = this.health / this.maxHealth;
    if (hp < 0.3 && Math.random() < dt * 10) g.effects.smoke(this.x, this.y, '#333', this.alt + 1);
    if (hp <= 0 && !this.dead) g.combat.explodeVehicle(this);
    this.updateSounds(dt);
  }

  // follow overpass decks and ramps; guard rails keep cars on a raised deck; fall when there's nothing below
  updateLevel(dt) {
    const W = this.game.world, z0 = this.z;
    const d = W.deckAt(this.x, this.y, z0, 2.2, 0.6, DECK);
    if (d) {
      this.z = d.z; this.vz = 0;
      if (d.z > 1.2) this.railCheck(d);
      return;
    }
    if (z0 <= 0.05) { this.z = 0; return; }
    // just past the edge of a raised deck: that's the guard rail
    const e = W.deckAt(this.x, this.y, z0, 2.2, 3.5, DECK);
    if (e && e.z > 1.2) { this.z = e.z; this.railCheck(e); return; }
    // nothing underneath: fall
    this.vz -= 9.8 * dt;
    this.z = Math.max(0, z0 + this.vz * dt);
    if (this.z === 0) {
      const impact = -this.vz;
      this.vz = 0;
      if (impact > 5) { this.damage(impact * impact * 6, null); this.game.cam && this.driver && this.driver.isPlayer && this.game.cam.addShake(Math.min(1.5, impact / 8)); this.game.audio.play('crash_heavy', { x: this.x, y: this.y }); }
    }
  }
  railCheck(d) {
    const lim = Math.max(0.3, d.hw - this.wid * 0.5 - 0.15);
    if (Math.abs(d.lat) <= lim) return;
    const nx = -d.dy, ny = d.dx, sg = Math.sign(d.lat);
    const push = (Math.abs(d.lat) - lim) * sg;
    this.x -= nx * push; this.y -= ny * push;
    const vn = (this.vx * nx + this.vy * ny) * sg; // outward speed
    if (vn > 0) {
      this.vx -= nx * vn * sg * 1.3; this.vy -= ny * vn * sg * 1.3;
      if (vn > 4) this.game.impact(this, vn, null);
    }
  }

  damage(amount, by, x, y) {
    if (this.dead || this.invuln) return;
    this.health -= amount;
    this.damageT = 0.15;
    if (by) this.lastHitBy = by;
    // a huge hit blows an NPC car at once; the player's car always burns for a moment so they can bail out
    if (this.health <= 0 && !this.fire) this.fire = 0.01 + (amount > 300 && !(this.driver && this.driver.isPlayer) ? 0 : 2.5);
    if (this.parked && !this.alarm && rng() < 0.5) this.alarm = 8;
  }

  updateSounds(dt) {
    const g = this.game;
    const near = (this.x - g.cam.x) ** 2 + (this.y - g.cam.y) ** 2 < 160 * 160;
    const isPlayer = g.player && g.player.vehicle === this;
    const running = (this.driver || (this.isHeli && this.alt > 0.5)) && !this.sinking;
    if (running && near && g.audio.ready) {
      if (!this.engineSnd) this.engineSnd = g.audio.createEngine(this.m.engine || 'v6');
      if (this.engineSnd) {
        this.engineSnd.setState({ rpm: this.rpm, throttle: this.ctrl.throttle, speed: this.speed });
        this.engineSnd.setPos(this.x, this.y);
        this.engineSnd.setPlayer && this.engineSnd.setPlayer(isPlayer);
      }
    } else if (this.engineSnd) { this.engineSnd.stop(); this.engineSnd = null; }
    const sirenWanted = this.sirenOn && this.m.siren && near && !this.dead;
    if (sirenWanted && g.audio.ready) {
      if (!this.sirenSnd) this.sirenSnd = g.audio.createSiren(this.m.siren);
      if (this.sirenSnd) { this.sirenSnd.setPos(this.x, this.y); this.sirenSnd.setVelocity && this.sirenSnd.setVelocity(this.vx, this.vy); }
    } else if (this.sirenSnd) { this.sirenSnd.stop(); this.sirenSnd = null; }
    if (this.skid > 0.15 && near && !this.isBoat && !this.isHeli) {
      if (!this.skidSnd && g.audio.ready) this.skidSnd = g.audio.createLoop('tyre_squeal');
      if (this.skidSnd) { this.skidSnd.setIntensity(Math.min(1, this.skid)); this.skidSnd.setPos(this.x, this.y); }
    } else if (this.skidSnd) { this.skidSnd.stop(); this.skidSnd = null; }
  }

  stopSounds() {
    if (this.engineSnd) { this.engineSnd.stop(); this.engineSnd = null; }
    if (this.sirenSnd) { this.sirenSnd.stop(); this.sirenSnd = null; }
    if (this.skidSnd) { this.skidSnd.stop(); this.skidSnd = null; }
  }

  // headlight/taillight/siren light sources for the lighting pass
  lights(out, night) {
    if (this.dead || !night) return;
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    const active = this.driver || this.isHeli;
    if (active) {
      const L = this.m.lights;
      const hx = this.x + fx * this.len * 0.5, hy = this.y + fy * this.len * 0.5;
      out.push({ x: hx, y: hy, r: this.isHeli ? 30 : 26, cone: 0.42, dir: this.h, col: 'rgba(255,240,200,A)' });
      out.push({ x: hx, y: hy, r: 4, col: 'rgba(255,245,215,A)', a: 0.9 });
      out.push({ x: this.x - fx * this.len * 0.5, y: this.y - fy * this.len * 0.5, r: this.braking ? 5 : 3, col: 'rgba(255,40,30,A)', a: 0.8 });
      if (this.isHeli && this.m.role === 'police') {
        const t = this.game.time;
        out.push({ x: this.spotX ?? this.x, y: this.spotY ?? this.y, r: 14, col: 'rgba(255,255,235,A)', a: 0.85 });
      }
    }
    if (this.sirenOn) {
      const ph = Math.floor(this.lightT * 6) % 2;
      out.push({ x: this.x, y: this.y, h: this.hgt, r: 12, col: ph ? 'rgba(255,40,40,A)' : 'rgba(50,90,255,A)', a: 0.9 });
    }
  }

  draw(ctx, cam) {
    const g = this.game;
    const z = this.isHeli ? this.alt : (this.z || 0);
    const sinkScale = this.sinking ? Math.max(0.2, 1 - this.sinking * 0.3) : 1;
    let img = null;
    if (this.dead) img = g.assets.burntStrip ? g.assets.burntStrip(this) : null;
    const from = this.isBoat && this.m.waterline && this.onWater ? this.m.waterline : 0;
    this.sprite.draw(ctx, cam, this.x, this.y, this.h, { z, img, scale: VSCALE, from, to: this.sinking ? Math.max(1, Math.floor(this.sprite.count * sinkScale)) : this.sprite.count });
    if (this.rotor) {
      const m = this.m;
      const rz = (m.rotorZ != null ? m.rotorZ * 0.1 : this.hgt / VSCALE * 0.85) * VSCALE;
      const rp = m.rotorPos || [0, 0];
      const fx = Math.cos(this.h), fy = Math.sin(this.h);
      // local +y = forward, +x = right
      const ox = fx * rp[1] * VSCALE - fy * rp[0] * VSCALE, oy = fy * rp[1] * VSCALE + fx * rp[0] * VSCALE;
      this.rotor.draw(ctx, cam, this.x + ox, this.y + oy, this.rotorAngle, { z: z + rz, scale: VSCALE });
    }
    if (this.dead) return;
    // brake lights / siren bar overlay (screen-space small quads)
    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    if (this.sirenOn || this.braking) {
      const p = cam.toScreen(this.x, this.y, this.hgt + 0.05 + z);
      const s = Math.max(1, cam.zoom * 0.35);
      if (this.sirenOn) {
        const ph = Math.floor(this.lightT * 6) % 2;
        const rx = -fy * this.wid * 0.25 * cam.zoom, ry = fx * this.wid * 0.25 * cam.zoom;
        ctx.fillStyle = ph ? '#ff3030' : '#3060ff';
        ctx.fillRect(p[0] + rx - s, p[1] + ry - s, s * 2, s * 2);
        ctx.fillStyle = ph ? '#3060ff' : '#ff3030';
        ctx.fillRect(p[0] - rx - s, p[1] - ry - s, s * 2, s * 2);
      }
      if (this.braking && !this.isTwoWheel) {
        const q = cam.toScreen(this.x - fx * this.len * 0.48, this.y - fy * this.len * 0.48, 0.8 + z);
        const rx = -fy * this.wid * 0.38 * cam.zoom, ry = fx * this.wid * 0.38 * cam.zoom;
        ctx.fillStyle = '#ff2a1a';
        ctx.fillRect(q[0] + rx - s * 0.6, q[1] + ry - s * 0.6, s * 1.2, s * 1.2);
        ctx.fillRect(q[0] - rx - s * 0.6, q[1] - ry - s * 0.6, s * 1.2, s * 1.2);
      }
    }
  }
  drawShadow(sctx, cam, sx, sy) {
    const z = this.isHeli ? this.alt : (this.z || 0);
    if (z > 1) {
      // detached shadow on ground
      this.sprite.drawShadow(sctx, cam, this.x + sx * z, this.y + sy * z, this.h, sx, sy, { scale: VSCALE });
    } else this.sprite.drawShadow(sctx, cam, this.x, this.y, this.h, sx, sy, { scale: VSCALE });
  }
}
