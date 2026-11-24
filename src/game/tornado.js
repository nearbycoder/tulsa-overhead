// Oklahoma storms: during heavy thunderstorms a tornado can touch down near the player.
// Civil-defence sirens, a perspective-correct funnel, and it throws cars and people around.
import { rng } from '../engine/math.js';

export class Tornado {
  constructor(game) { this.game = game; this.active = null; this.cd = 240; }

  spawn(force = false) {
    const g = this.game, pl = g.player;
    if (!pl || this.active) return;
    const a = rng() * Math.PI * 2;
    const x = pl.x + Math.cos(a) * 380, y = pl.y + Math.sin(a) * 380;
    // track across the player's area, typically SW -> NE
    const dir = Math.atan2(pl.y - y, pl.x - x) + (rng() - 0.5) * 0.6;
    this.active = { x, y, vx: Math.cos(dir) * 9, vy: Math.sin(dir) * 9, t: 0, life: 85, r: 22, phase: 0 };
    g.weather.target = 1; g.weather.rain = Math.max(g.weather.rain, 0.8); g.weather.t = 140;
    g.hud.bigMessage('TORNADO WARNING', 'Take shelter!', '#e8b030', 4);
    g.audio.play('tornado_siren', { vol: 0.9 });
    g.audio.play('thunder', { vol: 0.9 });
  }

  update(dt) {
    const g = this.game, pl = g.player;
    if (!pl) return;
    if (!this.active) {
      this.cd -= dt;
      if (this.cd <= 0 && g.weather.rain > 0.75 && !(g.missions && g.missions.active)) { this.cd = 900 + rng() * 900; if (rng() < 0.5) this.spawn(); }
      return;
    }
    const T = this.active;
    T.t += dt; T.phase += dt * 4;
    // wander a little
    const turn = Math.sin(T.t * 0.3) * 0.15 * dt;
    const c = Math.cos(turn), s = Math.sin(turn);
    [T.vx, T.vy] = [T.vx * c - T.vy * s, T.vx * s + T.vy * c];
    T.x += T.vx * dt; T.y += T.vy * dt;
    const fade = Math.min(1, T.t / 6, (T.life - T.t) / 8);
    const R = T.r * Math.max(0.2, fade);
    if (!this.wind && g.audio.ready) this.wind = g.audio.createLoop('wind');
    const dpl = Math.hypot(T.x - pl.x, T.y - pl.y);
    if (this.wind) this.wind.setIntensity(Math.max(0, Math.min(1, 1.2 - dpl / 250)));
    if ((this.sirenT = (this.sirenT || 0) - dt) <= 0) { this.sirenT = 14; g.audio.play('tornado_siren', { vol: 0.6 }); }
    if (rng() < dt * 0.4) g.audio.play('thunder', { vol: 0.7 });
    // forces
    const reach = R * 2.4;
    for (const v of g.nearbyVehicles(T.x, T.y, reach + 6)) {
      const dx = v.x - T.x, dy = v.y - T.y, d = Math.hypot(dx, dy) || 0.1;
      if (d > reach) continue;
      const k = (1 - d / reach) * fade * (1500 / Math.max(600, v.mass));
      const tx = -dy / d, ty = dx / d; // counter-clockwise swirl
      v.vx += (tx * 26 - dx / d * 10) * k * dt; v.vy += (ty * 26 - dy / d * 10) * k * dt;
      v.av += 5 * k * dt;
      if (d < R) { v.damage(160 * dt, null); if (v.driver && v.driver.isPlayer) g.cam.addShake(0.08); }
    }
    for (const p of g.nearbyPeds(T.x, T.y, reach)) {
      if (p.vehicle || p.dead) continue;
      const dx = p.x - T.x, dy = p.y - T.y, d = Math.hypot(dx, dy) || 0.1;
      if (d > reach) continue;
      const k = (1 - d / reach) * fade;
      if (k > 0.25 && p.knock <= 0) { p.knockDown(-dy / d * 14 * k - dx / d * 4, dx / d * 14 * k - dy / d * 4, 1.2); p.damage(25 * k, null, 'impact'); }
      if (p.ai && p.ai.panic && !p.isPlayer) p.ai.panic(T.x, T.y, 8);
    }
    // debris kicked up
    for (let i = 0; i < 3; i++) {
      const a = rng() * 6.28, r = R * (0.6 + rng() * 0.8);
      g.effects.add({ t: 'debris', x: T.x + Math.cos(a) * r, y: T.y + Math.sin(a) * r, z: rng() * 8, vx: -Math.sin(a) * 20, vy: Math.cos(a) * 20, vz: 6 + rng() * 10, life: 0, max: 1.4, size: 0.2 + rng() * 0.4, col: rng() < 0.5 ? '#6b5a44' : '#4a4038' });
    }
    if (T.t > T.life) { this.active = null; if (this.wind) { this.wind.stop(); this.wind = null; } g.hud.message('The tornado has lifted. All clear.', 5); }
  }

  draw(ctx, cam) {
    const T = this.active;
    if (!T) return;
    const fade = Math.min(1, T.t / 6, (T.life - T.t) / 8);
    const tmp = [0, 0];
    // ground swirl
    const base = cam.toScreen(T.x, T.y, 0, tmp);
    ctx.fillStyle = 'rgba(60,50,40,0.22)';
    ctx.beginPath(); ctx.ellipse(base[0], base[1], T.r * 0.9 * cam.zoom * fade, T.r * 0.9 * cam.zoom * fade, 0, 0, Math.PI * 2); ctx.fill();
    // funnel: stacked rotating rings of dust, widening with height
    const rings = 28;
    const pl = this.game.player;
    const near = pl && Math.hypot(pl.x - T.x, pl.y - T.y) < T.r * 1.6 ? 0.45 : 1;
    for (let k = 0; k < rings; k++) {
      const h = k * 1.1;
      const r = (2.5 + h * 0.3) * fade;
      const alpha = 0.42 * (1 - (k / rings) * 0.55) * fade * near;
      for (let j = 0; j < 5; j++) {
        const a = T.phase * (1.6 - k * 0.015) + j * 1.2566 + k * 0.35;
        const x = T.x + Math.cos(a) * r, y = T.y + Math.sin(a) * r;
        const p = cam.toScreen(x, y, h, tmp);
        const sz = Math.max(2, (1.1 + h * 0.05) * cam.zoom * 0.85);
        const shade = 70 + ((k * 7 + j * 13) % 40);
        ctx.fillStyle = `rgba(${shade},${shade - 6},${shade - 14},${alpha})`;
        ctx.beginPath(); ctx.arc(p[0], p[1], sz, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  blips(out) { if (this.active) out.push({ x: this.active.x, y: this.active.y, col: '#e8b030', shape: 'triangle', size: 7, flash: true, edge: true }); }
}
