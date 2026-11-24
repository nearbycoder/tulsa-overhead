// Weapons fire, hit detection, projectiles, fire patches and explosions.
import { WEAPONS } from '../data/weapons.js';
import { rng, clamp } from '../engine/math.js';
import { S } from '../world/shared.js';

// a named story character who isn't currently trying to kill the player
import { input } from '../engine/input.js';
export function isFriendly(p) { return !!p && (!!p.cast || !!p.giver) && !p.isPlayer && !p._okDead && p.blip !== '#e33' && !(p.ai && p.ai.mode === 'attack') && !p.hostile; }

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.fires = []; // ground fire patches {x,y,r,t,by}
  }

  // returns true if a shot happened
  tryFire(ped, aim, opts = {}) {
    const g = this.game;
    const w = WEAPONS[ped.weapon] || WEAPONS.fists;
    if (ped.fireCd > 0 || ped.reloadT > 0 || ped.stun > 0 || ped.knock > 0) return false;
    if (w.type !== 'melee') {
      const clip = ped.clip[w.id] ?? 0;
      if (clip <= 0) {
        if ((ped.ammo[w.id] || 0) > 0) ped.startReload();
        else if (ped.isPlayer) { g.audio.play('empty_click', { x: ped.x, y: ped.y, vol: 0.6 }); ped.fireCd = 0.35; }
        return false;
      }
    }
    // NPCs pull the trigger slower than the player (aiming, nerves) so firefights stay survivable
    ped.fireCd = 1 / w.rate * (ped.isPlayer || w.type === 'melee' ? 1 : (ped.rateMul ?? 2.2));
    const veh = opts.vehicle;
    const ox = veh ? veh.x + Math.cos(aim) * (veh.len * 0.55) : ped.x;
    const oy = veh ? veh.y + Math.sin(aim) * (veh.len * 0.55) : ped.y;
    if (w.type === 'melee') {
      ped.punchT = 0.35;
      g.audio.play(w.sound, { x: ped.x, y: ped.y, vol: 0.7 });
      this.melee(ped, w, aim);
      return true;
    }
    if (ped.isPlayer) input.rumble(Math.min(0.9, 0.12 + (w.dmg || 10) * (w.pellets || 1) / 160), 0.35, w.type === 'gun' ? 55 : 120);
    ped.clip[w.id] -= 1;
    if (w.type === 'gun') ped.ammo[w.id] -= 1;
    else ped.ammo[w.id] = Math.max(0, ped.ammo[w.id] - 1);
    ped.fireFlash = 0.08;
    if (w.sound) g.audio.play(w.sound, { x: ox, y: oy, vol: ped.isPlayer ? 1 : 0.85 });
    let acc = ped.isPlayer ? 1 : (ped.accuracy ?? 1.6);
    // a moving target is harder to hit: keep moving and the bullets miss more
    if (!ped.isPlayer && g.player) {
      const T = g.player.vehicle || g.player.ped;
      if (Math.abs(T.x - ox) < 90 && Math.abs(T.y - oy) < 90) acc *= 1 + Math.min(1.4, Math.hypot(T.vx || 0, T.vy || 0) / 5);
    }
    if (w.type === 'gun') {
      const n = w.pellets || 1;
      g.effects.muzzle(ox, oy, aim);
      for (let i = 0; i < n; i++) {
        const a = aim + (rng() - 0.5) * 2 * (w.spread || 0) * acc;
        this.hitscan(ped, ox, oy, a, w.range, w.dmg * (ped.isPlayer ? 1 : (ped.dmgMul ?? 0.55) * (g.difficulty || 1)), w, veh);
      }
      if (rng() < 0.6) g.audio.play('shell_drop', { x: ped.x, y: ped.y, vol: 0.25 });
      g.police.noise(ox, oy, ped, w.id === 'taser' ? 0 : 1);
    } else if (w.type === 'projectile' || w.type === 'throw') {
      const sp = w.speed + (veh ? Math.max(0, veh.vf) : 0);
      let range = 18;
      if (w.type === 'throw' && opts.target) range = clamp(Math.hypot(opts.target[0] - ox, opts.target[1] - oy), 5, 26);
      this.projectiles.push({ kind: w.proj, x: ox + Math.cos(aim) * 0.6, y: oy + Math.sin(aim) * 0.6, z: 1.3, vx: Math.cos(aim) * sp, vy: Math.sin(aim) * sp, vz: w.type === 'throw' ? range * 0.55 : 0, h: aim, life: 0, fuse: w.fuse || 99, by: ped, w, range });
      if (w.proj === 'rocket') g.effects.muzzle(ox, oy, aim);
    } else if (w.type === 'flame') {
      for (let i = 0; i < 2; i++) {
        const a = aim + (rng() - 0.5) * w.spread;
        const s = 10 + rng() * 6;
        g.effects.add({ t: 'fire', x: ox + Math.cos(aim) * 0.8, y: oy + Math.sin(aim) * 0.8, z: 1.1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 0.6, life: 0, max: 0.6, size: 0.4, grow: 1.6 });
      }
      this.flameCone(ped, ox, oy, aim, w);
      if (!ped._flameSnd && g.audio.ready) ped._flameSnd = g.audio.createLoop('flamethrower');
      if (ped._flameSnd) { ped._flameSnd.setIntensity(1); ped._flameSnd.setPos(ox, oy); ped._flameT = 0.15; }
      g.police.noise(ox, oy, ped, 1);
    }
    return true;
  }

  // segment hit test
  hitscan(shooter, x0, y0, ang, range, dmg, w, ownVeh) {
    const g = this.game;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let x1 = x0 + dx * range, y1 = y0 + dy * range;
    let bestT = 1, hit = null, hitType = null;
    // shooting from an airborne helicopter clears rooftops; on the ground, walls stop rounds
    const airborne = ownVeh && ownVeh.isHeli && ownVeh.alt > 12;
    const wall = airborne ? null : g.world.raycastBuildings(x0, y0, x1, y1);
    if (wall) { bestT = wall.t; hit = wall; hitType = 'wall'; }
    const L = range;
    for (const p of g.nearbyPeds(x0 + dx * range / 2, y0 + dy * range / 2, range / 2 + 2)) {
      if (p === shooter || p.dead || p.vehicle) continue;
      // the player's bullets pass through friendly story characters (escorts, contacts)
      if (shooter && shooter.isPlayer && isFriendly(p)) continue;
      // ray-circle
      const fx = p.x - x0, fy = p.y - y0;
      const t = (fx * dx + fy * dy) / L;
      if (t < 0 || t > bestT) continue;
      const cx = x0 + dx * t * L - p.x, cy = y0 + dy * t * L - p.y;
      if (cx * cx + cy * cy < (p.r + 0.1) ** 2) { bestT = t; hit = p; hitType = 'ped'; }
    }
    for (const v of g.nearbyVehicles(x0 + dx * range / 2, y0 + dy * range / 2, range / 2 + 6)) {
      if (v === ownVeh) continue;
      // ground-level shooters only hit an airborne helicopter if they were aiming at it (it's the shooter's target or the player's chopper)
      if (v.isHeli && v.alt > 3 && !airborne && !(shooter && (shooter.isPlayer || (v.driver && v.driver.isPlayer) || shooter.target === v || (shooter.ai && shooter.ai.target === v.driver)))) continue;
      const t = rayOBB(x0, y0, dx, dy, L, v);
      if (t >= 0 && t < bestT) { bestT = t; hit = v; hitType = 'veh'; }
    }
    const hx = x0 + dx * bestT * L, hy = y0 + dy * bestT * L;
    g.effects.tracer(x0 + dx * 0.9, y0 + dy * 0.9, hx, hy, w.tracer);
    if (hitType === 'ped') {
      const p = hit;
      if (w.stun) { p.stun = w.stun; p.damage(dmg, shooter, 'taser'); }
      else { p.damage(dmg, shooter, 'bullet', dx * (w.knock || 1.5), dy * (w.knock || 1.5)); }
      g.effects.blood(p.x, p.y, dx * 4, dy * 4, 4);
      g.audio.play('bullet_hit_flesh', { x: hx, y: hy, vol: 0.6 });
      g.onPedAttacked(p, shooter);
    } else if (hitType === 'veh') {
      // the player's ride shrugs off NPC small-arms fire better (a car chase shouldn't end in eight seconds)
      hit.damage(dmg * (hit.driver && hit.driver.isPlayer && !(shooter && shooter.isPlayer) ? 0.4 : 0.9), shooter, hx, hy);
      g.effects.sparks(hx, hy, 3, 0.8);
      g.audio.play('bullet_hit_metal', { x: hx, y: hy, vol: 0.5 });
      if (hit.driver && !hit.driver.isPlayer && hit.driver.ai && hit.driver.ai.onDamage) hit.driver.ai.onDamage(shooter, 'bullet');
      if (hit.driver && hit.driver.isPlayer === false) g.onPedAttacked(hit.driver, shooter);
      if (hit.isHeli) hit.damage(dmg * 0.4, shooter);
    } else if (hitType === 'wall') {
      g.effects.sparks(hx, hy, 2, 1);
      if (rng() < 0.4) g.audio.play(rng() < 0.3 ? 'ricochet' : 'bullet_hit_wall', { x: hx, y: hy, vol: 0.4 });
    }
    return hit;
  }

  melee(ped, w, aim) {
    const g = this.game;
    const fx = Math.cos(aim), fy = Math.sin(aim);
    let hitAny = false;
    for (const p of g.nearbyPeds(ped.x, ped.y, w.range + 1)) {
      if (p === ped || p.dead || p.vehicle) continue;
      const dx = p.x - ped.x, dy = p.y - ped.y;
      const d = Math.hypot(dx, dy);
      if (d > w.range + p.r) continue;
      const dot = (dx * fx + dy * fy) / (d || 1);
      if (dot < Math.cos(w.arc / 2)) continue;
      p.damage(w.dmg * (ped.isPlayer ? 1 : 0.6), ped, 'melee', fx * 2.5, fy * 2.5);
      if (w.id !== 'fists' || rng() < 0.3) g.effects.blood(p.x, p.y, fx * 3, fy * 3, 3);
      if (w.id === 'bat' || (w.id === 'fists' && rng() < 0.25)) p.knockDown(fx * 4, fy * 4, 0.9);
      g.audio.play(w.hitSound, { x: p.x, y: p.y });
      g.onPedAttacked(p, ped);
      hitAny = true;
    }
    if (!hitAny) {
      for (const v of g.nearbyVehicles(ped.x, ped.y, 4)) {
        const t = rayOBB(ped.x, ped.y, fx, fy, w.range + 0.3, v);
        if (t >= 0) { v.damage(w.dmg * 0.4, ped); g.audio.play('crash_light', { x: v.x, y: v.y, vol: 0.5 }); break; }
      }
    }
  }

  flameCone(ped, x0, y0, aim, w) {
    const g = this.game;
    const dt = 1 / w.rate;
    for (const p of g.nearbyPeds(x0, y0, w.range)) {
      if (p === ped || p.dead || p.vehicle) continue;
      const dx = p.x - x0, dy = p.y - y0, d = Math.hypot(dx, dy);
      if (d > w.range) continue;
      const a = Math.atan2(dy, dx) - aim;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > w.spread) continue;
      p.onFire = Math.max(p.onFire, 3);
      p.damage(w.dmg * dt, ped, 'fire');
      g.onPedAttacked(p, ped);
    }
    for (const v of g.nearbyVehicles(x0, y0, w.range + 3)) {
      const dx = v.x - x0, dy = v.y - y0, d = Math.hypot(dx, dy);
      if (d > w.range + v.len / 2) continue;
      const a = Math.atan2(dy, dx) - aim;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > w.spread + 0.2) continue;
      v.damage(w.dmg * dt * 1.4, ped);
    }
  }

  update(dt) {
    const g = this.game;
    // projectiles
    let k = 0;
    for (const pr of this.projectiles) {
      pr.life += dt;
      const px = pr.x, py = pr.y;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      let boom = false;
      if (pr.kind === 'rocket') {
        if (rng() < dt * 60) g.effects.smoke(px, py, '#bbb', 1.2);
        const wall = g.world.raycastBuildings(px, py, pr.x, pr.y);
        if (wall) { pr.x = wall.x - wall.nx * -0.3; pr.y = wall.y; boom = true; }
        if (!boom) for (const v of g.nearbyVehicles(pr.x, pr.y, 6)) { if (v.driver === pr.by && v === pr.by.vehicle) continue; if (pointInVehicle(pr.x, pr.y, v, 0.3)) { boom = true; break; } }
        if (!boom) for (const p of g.nearbyPeds(pr.x, pr.y, 2)) { if (p !== pr.by && !p.dead && !p.vehicle && (p.x - pr.x) ** 2 + (p.y - pr.y) ** 2 < 0.6) { boom = true; break; } }
        if (pr.life * 55 > pr.range) boom = true;
        if (boom) this.explode(pr.x, pr.y, pr.w.radius, pr.w.dmg, pr.by);
      } else {
        // thrown: arc with bounce
        pr.vz -= 20 * dt; pr.z += pr.vz * dt;
        const wall = g.world.raycastBuildings(px, py, pr.x, pr.y);
        if (wall) { pr.x = px; pr.y = py; const vn = pr.vx * wall.nx + pr.vy * wall.ny; pr.vx -= 1.6 * vn * wall.nx; pr.vy -= 1.6 * vn * wall.ny; }
        if (pr.z <= 0) {
          pr.z = 0;
          if (pr.kind === 'molotov') {
            boom = true;
            g.audio.play('glass', { x: pr.x, y: pr.y });
            this.fires.push({ x: pr.x, y: pr.y, r: pr.w.radius, t: 7, by: pr.by });
            g.effects.explosion(pr.x, pr.y, 2);
            g.police.noise(pr.x, pr.y, pr.by, 2);
          } else { pr.vz = Math.abs(pr.vz) * 0.35; pr.vx *= 0.6; pr.vy *= 0.6; if (Math.abs(pr.vz) < 1) pr.vz = 0; }
        }
        if (pr.kind === 'grenade' && pr.life > pr.fuse) { boom = true; this.explode(pr.x, pr.y, pr.w.radius, pr.w.dmg, pr.by); }
      }
      if (!boom && pr.life < 12) this.projectiles[k++] = pr;
    }
    this.projectiles.length = k;
    // ground fires
    let f = 0;
    for (const fi of this.fires) {
      fi.t -= dt;
      if (rng() < dt * 40 * fi.r / 4) { const a = rng() * 6.28, r = Math.sqrt(rng()) * fi.r; g.effects.flame(fi.x + Math.cos(a) * r, fi.y + Math.sin(a) * r, 0.8); }
      for (const p of g.nearbyPeds(fi.x, fi.y, fi.r)) if (!p.dead && !p.vehicle && (p.x - fi.x) ** 2 + (p.y - fi.y) ** 2 < fi.r * fi.r) { p.onFire = Math.max(p.onFire, 2.5); p.lastHitBy = fi.by; }
      for (const v of g.nearbyVehicles(fi.x, fi.y, fi.r + 2)) if ((v.x - fi.x) ** 2 + (v.y - fi.y) ** 2 < (fi.r + 1) ** 2) v.damage(60 * dt, fi.by);
      if (fi.t > 0) this.fires[f++] = fi;
    }
    this.fires.length = f;
  }

  explode(x, y, radius, dmg, by, big = false) {
    const g = this.game;
    g.effects.explosion(x, y, radius);
    g.audio.play(big ? 'explosion_big' : 'explosion', { x, y });
    const dc = Math.hypot(x - g.cam.x, y - g.cam.y);
    g.cam.addShake(Math.max(0, 1.6 - dc / 60));
    if (g.player && dc < 70) input.rumble(1 - dc / 70, 1 - dc / 90, 260 + radius * 20);
    for (const p of g.nearbyPeds(x, y, radius * 1.5)) {
      if (p.dead && p.vehicle) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > radius * 1.5 || p.vehicle) continue;
      const f = 1 - d / (radius * 1.5);
      const nx = (p.x - x) / (d || 1), ny = (p.y - y) / (d || 1);
      // friendly story characters mostly shrug off the player's own explosions
      p.damage(dmg * f * f * 1.4 * (by && by.isPlayer && isFriendly(p) ? 0.25 : 1), by, 'blast');
      p.knockDown(nx * 14 * f, ny * 14 * f, 1.5);
      if (f > 0.5) p.onFire = Math.max(p.onFire, 2);
      g.onPedAttacked(p, by);
    }
    for (const v of g.nearbyVehicles(x, y, radius * 1.6 + 4)) {
      const d = Math.max(0, Math.hypot(v.x - x, v.y - y) - v.radius * 0.5);
      if (d > radius * 1.6) continue;
      const f = 1 - d / (radius * 1.6);
      const nx = (v.x - x) / (d || 1), ny = (v.y - y) / (d || 1);
      v.damage(dmg * f * 3.5, by);
      v.vx += nx * 12 * f * (1500 / v.mass); v.vy += ny * 12 * f * (1500 / v.mass);
      v.av += (rng() - 0.5) * 4 * f;
    }
    g.police.noise(x, y, by, 3);
    if (by && by.isPlayer) g.police.crime('explosion', x, y);
  }

  explodeVehicle(v) {
    if (v.dead) return;
    const g = this.game;
    v.dead = true; v.fire = 0; v.health = 0; v.sirenOn = false;
    v.stopSounds();
    const by = v.lastHitBy;
    // occupants
    const occ = [v.driver, ...v.passengers].filter(Boolean);
    v.driver = null; v.passengers = [];
    for (const p of occ) {
      p.vehicle = null;
      p.x = v.x + (rng() - 0.5) * 2; p.y = v.y + (rng() - 0.5) * 2;
      p.damage(400, by, 'blast');
    }
    if (v.isHeli) v.alt = 0;
    this.explode(v.x, v.y, 7 + v.len * 0.2, 180, by, v.len > 6);
    g.effects.debris(v.x, v.y, '#333', 12);
    v.vx += (rng() - 0.5) * 4; v.vy += (rng() - 0.5) * 4; v.av += (rng() - 0.5) * 3;
    g.onVehicleDestroyed(v, by);
  }

  draw(ctx, cam) {
    const tmp = [0, 0];
    for (const pr of this.projectiles) {
      cam.toScreen(pr.x, pr.y, pr.z, tmp);
      const s = Math.max(2, cam.zoom * 0.35);
      ctx.fillStyle = pr.kind === 'rocket' ? '#d8d0b0' : pr.kind === 'grenade' ? '#3d4a2c' : '#a6d16a';
      ctx.fillRect(tmp[0] - s / 2, tmp[1] - s / 2, s, s);
      if (pr.kind === 'rocket') { ctx.fillStyle = '#ffb040'; const b = cam.toScreen(pr.x - Math.cos(pr.h) * 0.8, pr.y - Math.sin(pr.h) * 0.8, pr.z); ctx.fillRect(b[0] - s / 2, b[1] - s / 2, s, s); }
    }
  }
}

export function pointInVehicle(x, y, v, pad = 0) {
  const fx = Math.cos(v.h), fy = Math.sin(v.h);
  const dx = x - v.x, dy = y - v.y;
  const lx = dx * fx + dy * fy, ly = -dx * fy + dy * fx;
  return Math.abs(lx) < v.len / 2 + pad && Math.abs(ly) < v.wid / 2 + pad;
}

// ray (origin, unit dir, length L) vs vehicle OBB -> t in [0,1] or -1
export function rayOBB(x0, y0, dx, dy, L, v) {
  const fx = Math.cos(v.h), fy = Math.sin(v.h);
  const ox = x0 - v.x, oy = y0 - v.y;
  const lox = ox * fx + oy * fy, loy = -ox * fy + oy * fx;
  const ldx = dx * fx + dy * fy, ldy = -dx * fy + dy * fx;
  const hx = v.len / 2, hy = v.wid / 2;
  let tmin = 0, tmax = L;
  for (const [o, d, h] of [[lox, ldx, hx], [loy, ldy, hy]]) {
    if (Math.abs(d) < 1e-9) { if (o < -h || o > h) return -1; }
    else {
      let t1 = (-h - o) / d, t2 = (h - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin / L;
}
