// Particles, decals (skids, blood, scorch), explosions, tracers and floating text.
import { rng } from '../engine/math.js';
import { settings } from '../engine/settings.js';

const MAX_P = 1400;

export class Effects {
  constructor(game) {
    this.game = game;
    this.p = [];
    this.skids = new Float32Array(1600 * 5); // x0,y0,x1,y1,alpha
    this.skidN = 0; this.skidHead = 0;
    this.decals = []; // {x,y,r,type,rot,t}
    this.tracers = [];
    this.texts = [];
    this.flashes = [];
  }
  get mult() { return settings.get('particles') ?? 1; }
  add(o) { if (this.p.length < MAX_P * this.mult) this.p.push(o); }

  smoke(x, y, col = '#777', z = 1.5) {
    if (rng() > this.mult) return;
    this.add({ t: 'smoke', x, y, z, vx: (rng() - 0.5) * 0.8, vy: (rng() - 0.5) * 0.8, vz: 1.2 + rng(), life: 0, max: 1.6 + rng(), size: 0.6 + rng() * 0.5, grow: 1.6, col });
  }
  flame(x, y, z = 1) {
    if (rng() > this.mult * 1.2) return;
    this.add({ t: 'fire', x, y, z: z * (0.3 + rng() * 0.7), vx: (rng() - 0.5) * 0.6, vy: (rng() - 0.5) * 0.6, vz: 1.5 + rng() * 2, life: 0, max: 0.4 + rng() * 0.4, size: 0.5 + rng() * 0.5, grow: -0.6 });
    if (rng() < 0.15) this.smoke(x, y, '#3a3a3a', z + 1);
  }
  sparks(x, y, n = 6, z = 0.8) {
    for (let i = 0; i < n * this.mult; i++) {
      const a = rng() * Math.PI * 2, s = 4 + rng() * 8;
      this.add({ t: 'spark', x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 2 + rng() * 4, life: 0, max: 0.25 + rng() * 0.3, size: 0.12 });
    }
  }
  blood(x, y, dx = 0, dy = 0, n = 6) {
    for (let i = 0; i < n * this.mult; i++) {
      this.add({ t: 'blood', x, y, z: 1.1, vx: dx * 0.3 + (rng() - 0.5) * 3, vy: dy * 0.3 + (rng() - 0.5) * 3, vz: rng() * 2, life: 0, max: 0.5 + rng() * 0.3, size: 0.14 });
    }
    if (rng() < 0.5) this.decal(x + dx * 0.1 + (rng() - 0.5), y + dy * 0.1 + (rng() - 0.5), 0.25 + rng() * 0.25, 'blood');
  }
  bloodPool(x, y, r) { this.decal(x, y, r, 'blood'); }
  dust(x, y, col) { this.add({ t: 'smoke', x, y, z: 0.3, vx: (rng() - 0.5) * 2, vy: (rng() - 0.5) * 2, vz: 0.4, life: 0, max: 0.9, size: 0.5, grow: 1.4, col, a0: 0.5 }); }
  splash(x, y, s = 1) {
    for (let i = 0; i < 14 * s * this.mult; i++) {
      const a = rng() * Math.PI * 2, v = 1 + rng() * 3 * s;
      this.add({ t: 'water', x, y, z: 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + rng() * 3 * s, life: 0, max: 0.6 + rng() * 0.4, size: 0.18 });
    }
  }
  debris(x, y, col, n = 8) {
    for (let i = 0; i < n * this.mult; i++) {
      const a = rng() * Math.PI * 2, v = 3 + rng() * 10;
      this.add({ t: 'debris', x, y, z: 1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 3 + rng() * 8, life: 0, max: 1.2 + rng(), size: 0.18 + rng() * 0.2, col });
    }
  }
  explosion(x, y, r = 6) {
    this.flashes.push({ x, y, r: r * 1.6, life: 0, max: 0.35 });
    for (let i = 0; i < 28 * this.mult; i++) {
      const a = rng() * Math.PI * 2, v = rng() * r * 1.4;
      this.add({ t: 'fire', x: x + Math.cos(a) * v * 0.2, y: y + Math.sin(a) * v * 0.2, z: 0.5 + rng() * 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + rng() * 6, life: 0, max: 0.5 + rng() * 0.6, size: 0.9 + rng() * 1.2, grow: 0.5 });
    }
    for (let i = 0; i < 16 * this.mult; i++) {
      const a = rng() * Math.PI * 2, v = rng() * r * 0.6;
      this.add({ t: 'smoke', x, y, z: 1 + rng() * 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + rng() * 3, life: 0, max: 2 + rng() * 2, size: 1.2 + rng(), grow: 1.8, col: '#2c2c2c' });
    }
    this.sparks(x, y, 18, 1);
    this.decal(x, y, r * 0.55, 'scorch');
  }
  muzzle(x, y, h, z = 1.25) {
    this.flashes.push({ x: x + Math.cos(h) * 0.9, y: y + Math.sin(h) * 0.9, z, r: 0.6, life: 0, max: 0.05, muzzle: true });
  }
  tracer(x0, y0, x1, y1, col = '#ffe9a8', z = 1.2) { this.tracers.push({ x0, y0, x1, y1, z, col, life: 0, max: 0.07 }); }
  text(x, y, str, col = '#7ed36b') { this.texts.push({ x, y, str, col, life: 0, max: 1.6 }); }
  decal(x, y, r, type) {
    this.decals.push({ x, y, r, type, rot: rng() * 6.28, t: 0 });
    if (this.decals.length > 220) this.decals.shift();
  }
  skid(v) {
    const fx = Math.cos(v.h), fy = Math.sin(v.h), rx = -fy, ry = fx;
    const back = v.len * 0.36, side = v.wid * 0.38;
    const pts = v.isTwoWheel ? [[v.x - fx * back, v.y - fy * back]] : [[v.x - fx * back + rx * side, v.y - fy * back + ry * side], [v.x - fx * back - rx * side, v.y - fy * back - ry * side]];
    const now = this.game.frame;
    if (!v._skid || v._skidF !== now - 1) v._skid = pts;
    else {
      for (let i = 0; i < pts.length; i++) {
        const a = v._skid[i], b = pts[i];
        if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 0.05) continue;
        const k = this.skidHead * 5;
        this.skids[k] = a[0]; this.skids[k + 1] = a[1]; this.skids[k + 2] = b[0]; this.skids[k + 3] = b[1]; this.skids[k + 4] = Math.min(0.55, 0.2 + v.skid * 0.4);
        this.skidHead = (this.skidHead + 1) % 1600; this.skidN = Math.min(1600, this.skidN + 1);
      }
      v._skid = pts;
    }
    v._skidF = now;
  }

  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const o = P[i];
      o.life += dt;
      if (o.life >= o.max) continue;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (o.t === 'spark' || o.t === 'blood' || o.t === 'water' || o.t === 'debris') { o.vz -= 15 * dt; if (o.z < 0) { o.z = 0; o.vz *= -0.3; o.vx *= 0.6; o.vy *= 0.6; } }
      else { o.vx *= Math.exp(-1.5 * dt); o.vy *= Math.exp(-1.5 * dt); }
      if (o.grow) o.size = Math.max(0.05, o.size + o.grow * dt);
      P[w++] = o;
    }
    P.length = w;
    for (const arr of [this.tracers, this.texts, this.flashes]) {
      let k = 0;
      for (const o of arr) { o.life += dt; if (o.life < o.max) arr[k++] = o; }
      arr.length = k;
    }
    for (const d of this.decals) d.t += dt;
  }

  drawDecals(ctx, cam) {
    const [x0, y0, x1, y1] = cam.viewRect(4);
    const z = cam.zoom, cx = cam.W / 2 - (cam.x + cam.shakeX) * z, cy = cam.H / 2 - (cam.y + cam.shakeY) * z;
    // skids
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 0.28 * z);
    const S = this.skids;
    ctx.strokeStyle = 'rgba(16,16,18,0.42)';
    ctx.beginPath();
    for (let i = 0; i < this.skidN; i++) {
      const k = i * 5;
      const ax = S[k], ay = S[k + 1];
      if (ax < x0 || ax > x1 || ay < y0 || ay > y1) continue;
      ctx.moveTo(cx + ax * z, cy + ay * z); ctx.lineTo(cx + S[k + 2] * z, cy + S[k + 3] * z);
    }
    ctx.stroke();
    for (const d of this.decals) {
      if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      const sx = cx + d.x * z, sy = cy + d.y * z;
      const r = d.r * z * (d.type === 'blood' ? Math.min(1, 0.3 + d.t * 0.6) : 1);
      if (d.type === 'blood') {
        ctx.fillStyle = 'rgba(110,8,8,0.82)';
        ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.78, d.rot, 0, Math.PI * 2); ctx.fill();
      } else if (d.type === 'scorch') {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, 'rgba(10,8,6,0.85)'); g.addColorStop(1, 'rgba(10,8,6,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      } else if (d.type === 'oil') {
        ctx.fillStyle = 'rgba(12,12,20,0.6)'; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.7, d.rot, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawTop(ctx, cam) {
    const tmp = [0, 0];
    const z = cam.zoom;
    // flashes
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      cam.toScreen(f.x, f.y, f.z || 1, tmp);
      const k = 1 - f.life / f.max;
      const r = f.r * z * (f.muzzle ? 1 : (0.6 + (1 - k) * 0.8));
      const g = ctx.createRadialGradient(tmp[0], tmp[1], 0, tmp[0], tmp[1], r);
      g.addColorStop(0, `rgba(255,240,190,${0.95 * k})`); g.addColorStop(0.4, `rgba(255,160,60,${0.6 * k})`); g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g; ctx.fillRect(tmp[0] - r, tmp[1] - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // tracers
    ctx.lineWidth = Math.max(1, z * 0.08);
    for (const t of this.tracers) {
      const a = cam.toScreen(t.x0, t.y0, t.z, [0, 0]), b = cam.toScreen(t.x1, t.y1, t.z, [0, 0]);
      ctx.strokeStyle = t.col; ctx.globalAlpha = 1 - t.life / t.max;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // particles
    for (const o of this.p) {
      cam.toScreen(o.x, o.y, o.z, tmp);
      const k = o.life / o.max;
      const s = Math.max(1, o.size * z);
      switch (o.t) {
        case 'smoke': ctx.globalAlpha = (o.a0 ?? 0.55) * (1 - k); ctx.fillStyle = o.col; ctx.beginPath(); ctx.arc(tmp[0], tmp[1], s, 0, 6.283); ctx.fill(); break;
        case 'fire': {
          ctx.globalAlpha = 1 - k * 0.6;
          ctx.fillStyle = k < 0.3 ? '#fff3a0' : k < 0.6 ? '#ffb030' : '#e04a10';
          ctx.fillRect(tmp[0] - s / 2, tmp[1] - s / 2, s, s); break;
        }
        case 'spark': ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffe28a'; ctx.fillRect(tmp[0], tmp[1], Math.max(1, s), Math.max(1, s)); break;
        case 'blood': ctx.globalAlpha = 1; ctx.fillStyle = '#8a0c0c'; ctx.fillRect(tmp[0], tmp[1], Math.max(1, s), Math.max(1, s)); break;
        case 'water': ctx.globalAlpha = 0.8 * (1 - k); ctx.fillStyle = '#cfe8ff'; ctx.fillRect(tmp[0], tmp[1], Math.max(1, s), Math.max(1, s)); break;
        case 'debris': ctx.globalAlpha = 1; ctx.fillStyle = o.col || '#444'; ctx.fillRect(tmp[0], tmp[1], Math.max(1, s), Math.max(1, s)); break;
      }
    }
    ctx.globalAlpha = 1;
    // floating text
    const fs = Math.max(8, Math.round(cam.H / 34));
    ctx.font = `bold ${fs}px Impact, Arial Black, sans-serif`;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      cam.toScreen(t.x, t.y, 2 + t.life * 2, tmp);
      ctx.globalAlpha = 1 - Math.max(0, (t.life - 1) / 0.6);
      ctx.fillStyle = '#000'; ctx.fillText(t.str, tmp[0] + 1, tmp[1] + 1);
      ctx.fillStyle = t.col; ctx.fillText(t.str, tmp[0], tmp[1]);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}
