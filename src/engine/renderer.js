import { prepareSurveyRoofs } from './survey-roofs.js';
// Frame renderer: internal-resolution canvas scaled to the window, ground cache,
// shadow layer, painter-sorted buildings + sprite stacks, lighting and weather.
import { settings, frameDimensions } from './settings.js';
import { Ground } from './ground.js';
import { drawBuilding, drawBuildingShadow, setNightSelf, styleFor } from './buildings.js';
import { S } from '../world/shared.js';
import { hash2 } from './math.js';

export class Renderer {
  constructor(canvas, world, cam) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.cam = cam;
    this.ground = new Ground(world);
    this.shadow = document.createElement('canvas');
    this.sctx = this.shadow.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.drawables = [];
    this.sun = { x: 0.45, y: 0.32 };
    this.night = 0;
    this.ambient = [255, 255, 255];
    this.rain = 0;
    this.rainDrops = [];
    this.stats = { blds: 0, objs: 0, ms: 0 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
    settings.onChange(() => this.resize());
  }

  resize() {
    const cssW = window.innerWidth, cssH = window.innerHeight;
    this.displayDpr = window.devicePixelRatio || 1;
    const [W, H] = frameDimensions(cssW, cssH, this.displayDpr, settings.v);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    const sw = settings.get('shadows') ? W : 1, sh = settings.get('shadows') ? H : 1;
    if (this.shadow.width !== sw || this.shadow.height !== sh) {
      this.shadow.width = sw; this.shadow.height = sh;
    }
    const lw = settings.get('lighting') ? Math.ceil(W / 2) : 1, lh = settings.get('lighting') ? Math.ceil(H / 2) : 1;
    if (this.light.width !== lw || this.light.height !== lh) {
      this.light.width = lw; this.light.height = lh;
    }
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.style.imageRendering = settings.get('pixelPerfect') ? 'pixelated' : 'auto';
    this.cam.resize(W, H);
  }

  // add an object to this frame's painter list. d = distance from camera centre (ground metres)
  add(x, y, r, draw, shadow, bias = 0) {
    this.drawables.push({ x, y, r, draw, shadow, d: 0, bias });
  }
  addTree(x, y, sprite, shadowSprite, heading, scale, step, smooth) {
    this.drawables.push({ x, y, r: 1.5, sprite, shadowSprite, heading, scale, step, smooth, d: 0 });
  }
  // drawn after the painter list (vehicles and people up on overpasses, above their deck)
  addLate(draw, shadow) { (this.late || (this.late = [])).push({ draw, shadow }); }

  render(game, dt) {
    if (this.displayDpr !== (window.devicePixelRatio || 1)) this.resize();
    const t0 = performance.now();
    const ctx = this.ctx, cam = this.cam;
    const W = cam.W, H = cam.H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // ground
    this.ground.draw(ctx, cam, settings.get('smoothGround'), game.loading ? 8 : 3);
    ctx.imageSmoothingEnabled = false;
    // decals (skids, blood, scorch)
    if (game.effects) game.effects.drawDecals(ctx, cam);
    if (settings.get('buildingDetail') > 0) this.drawWaterGlints(ctx, cam, game.time || 0);
    const view = cam.viewRect(4);
    // buildings in view
    const blds = [];
    this.world.forEachInRect('blds', view[0], view[1], view[2], view[3], (b) => { blds.push(b); });
    // shadows
    const detail = settings.get('buildingDetail');
    const shadows = settings.get('shadows') && this.night < 0.85;
    if (shadows) {
      const s = this.sctx;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.clearRect(0, 0, W, H);
      s.fillStyle = '#000';
      // buildings slightly outside the view still cast shadows into it
      const pad = 40;
      this.world.forEachInRect('blds', view[0] - pad, view[1] - pad, view[2] + 4, view[3] + 4, (b) => { drawBuildingShadow(s, cam, b, this.sun.x, this.sun.y, detail); });
      for (const d of this.drawables) {
        if (d.shadowSprite) d.shadowSprite.drawShadow(s, cam, d.x, d.y, d.heading, this.sun.x, this.sun.y, d);
        else if (d.shadow) d.shadow(s, cam, this.sun.x, this.sun.y);
      }
      if (this.late) for (const d of this.late) if (d.shadow) d.shadow(s, cam, this.sun.x, this.sun.y);
      ctx.globalAlpha = 0.28 * (1 - this.night);
      ctx.drawImage(this.shadow, 0, 0);
      ctx.globalAlpha = 1;
    }
    // painter sort: buildings by nearest footprint point, objects by position
    const cx = cam.x, cy = cam.y;
    const list = this.drawables;
    for (const d of list) d.d = Math.max(0, Math.hypot(d.x - cx, d.y - cy) - (d.r || 0) * 0.5) - (d.bias || 0);
    for (const b of blds) {
      const bb = b.bb;
      const dx = Math.max(bb[0] - cx, 0, cx - bb[2]), dy = Math.max(bb[1] - cy, 0, cy - bb[3]);
      list.push({ b, d: Math.hypot(dx, dy) });
    }
    list.sort((a, b) => b.d - a.d);
    this.focus = game.player ? cam.toScreen(game.player.x, game.player.y, 1) : null;
    const night = this.night;
    const self = settings.get('lighting') ? 0.22 : 0.6;
    setNightSelf(self);
    const roofs = prepareSurveyRoofs(ctx, cam, blds, detail, 1 - night * self, styleFor);
    this.stats.surveyRoofs = roofs.size;
    let smoothTrees = false;
    for (const d of list) {
      if (smoothTrees !== !!d.smooth) {
        smoothTrees = !!d.smooth;
        ctx.imageSmoothingEnabled = smoothTrees;
      }
      if (d.sprite) d.sprite.draw(ctx, cam, d.x, d.y, d.heading, d);
      else if (d.b) drawBuilding(ctx, cam, d.b, detail, night, this.focus, roofs.get(d.b));
      else d.draw(ctx, cam);
    }
    if (smoothTrees) ctx.imageSmoothingEnabled = false;
    if (this.late) { for (const d of this.late) d.draw(ctx, cam); this.late = null; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stats.blds = blds.length;
    this.stats.objs = list.length - blds.length;
    list.length = 0;
    // top effects
    if (game.effects) game.effects.drawTop(ctx, cam);
    // lighting
    if (settings.get('lighting') && this.night > 0.02) this.drawLighting(game);
    // weather
    if (settings.get('weather') && this.rain > 0.01) this.drawRain(dt);
    this.stats.ms = performance.now() - t0;
  }

  // little moving glints on open water (lakes, the Arkansas, the port)
  drawWaterGlints(ctx, cam, t) {
    const W = this.world;
    const [x0, y0, x1, y1] = cam.viewRect(2);
    const step = cam.viewH > 120 ? 9 : 5;
    const gx0 = Math.floor(x0 / step), gx1 = Math.floor(x1 / step), gy0 = Math.floor(y0 / step), gy1 = Math.floor(y1 / step);
    if ((gx1 - gx0) * (gy1 - gy0) > 9000) return;
    // The glints animate, but their positions and the underlying water mask are
    // static. Keep just the current view plus a short margin for camera motion.
    let field = this.glintField;
    if (!field || field.step !== step || field.revision !== W.regionRevision ||
        gx0 < field.x0 || gx1 > field.x1 || gy0 < field.y0 || gy1 > field.y1) {
      field = { x0: gx0 - 4, y0: gy0 - 4, x1: gx1 + 4, y1: gy1 + 4,
        revision: W.regionRevision, step, points: [] };
      for (let gy = field.y0; gy <= field.y1; gy++) for (let gx = field.x0; gx <= field.x1; gx++) {
        const h = hash2(gx, gy, 91);
        if (h > 0.55) continue;
        const wx = (gx + hash2(gx, gy, 93)) * step, wy = (gy + hash2(gx, gy, 94)) * step;
        if (W.surfaceAt(wx, wy) === S.WATER) field.points.push({ gx, gy, wx, wy, h, phase: hash2(gx, gy, 92) });
      }
      this.glintField = field;
    }
    if (!field.points.length) return;
    const z = cam.zoom, cx = cam.W * 0.5 - (cam.x + cam.shakeX) * z, cy = cam.H * 0.5 - (cam.y + cam.shakeY) * z;
    const night = this.night;
    ctx.strokeStyle = night > 0.5 ? 'rgba(170,190,230,0.35)' : 'rgba(225,240,255,0.55)';
    ctx.lineWidth = Math.max(1, z * 0.18);
    ctx.beginPath();
    let n = 0;
    for (const { gx, gy, wx, wy, h, phase } of field.points) {
      if (gx < gx0 || gx > gx1 || gy < gy0 || gy > gy1) continue;
      const ph = (t * (0.35 + h * 0.5) + phase) % 1;
      if (ph > 0.42) continue;
      const len = (0.6 + h * 1.4) * Math.sin(ph / 0.42 * Math.PI) * z;
      const sx = cx + wx * z, sy = cy + wy * z + Math.sin(t * 0.7 + h * 9) * z * 0.3;
      ctx.moveTo(sx - len, sy); ctx.lineTo(sx + len, sy);
      n++;
    }
    if (n) ctx.stroke();
  }

  drawLighting(game) {
    const l = this.lctx, cam = this.cam;
    const lw = this.light.width, lh = this.light.height;
    const n = this.night;
    // ambient: deep blue night
    const ar = Math.round(255 - n * 150), ag = Math.round(255 - n * 138), ab = Math.round(255 - n * 84);
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = `rgb(${ar},${ag},${ab})`;
    l.fillRect(0, 0, lw, lh);
    l.globalCompositeOperation = 'lighter';
    const sc = lw / cam.W;
    const lights = game.collectLights ? game.collectLights() : [];
    for (const L of lights) {
      const p = cam.toScreen(L.x, L.y, L.h || 0);
      const r = L.r * cam.zoom * sc;
      const x = p[0] * sc, y = p[1] * sc;
      if (x < -r || y < -r || x > lw + r || y > lh + r) continue;
      if (L.cone) {
        // headlight cone
        l.save();
        l.translate(x, y); l.rotate(L.dir);
        const g = l.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, L.col.replace('A', String(0.55 * n)));
        g.addColorStop(1, L.col.replace('A', '0'));
        l.fillStyle = g;
        l.beginPath(); l.moveTo(0, 0); l.arc(0, 0, r, -L.cone, L.cone); l.closePath(); l.fill();
        l.restore();
      } else {
        const g = l.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, L.col.replace('A', String((L.a ?? 0.6) * n)));
        g.addColorStop(1, L.col.replace('A', '0'));
        l.fillStyle = g;
        l.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, cam.W, cam.H);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawRain(dt) {
    const ctx = this.ctx, cam = this.cam;
    const want = Math.floor(this.rain * (cam.W * cam.H) / 900);
    const R = this.rainDrops;
    while (R.length < want) R.push({ x: Math.random() * cam.W, y: Math.random() * cam.H, z: Math.random() });
    if (R.length > want) R.length = want;
    ctx.strokeStyle = 'rgba(190,205,230,0.45)';
    ctx.lineWidth = Math.max(1, cam.H / 480);
    ctx.beginPath();
    const vx = -cam.H * 0.25, vy = cam.H * 1.6;
    for (const d of R) {
      const sp = 0.6 + d.z * 0.8;
      d.x += vx * sp * dt; d.y += vy * sp * dt;
      if (d.y > cam.H) { d.y -= cam.H + 20; d.x = Math.random() * cam.W; }
      if (d.x < 0) d.x += cam.W;
      const L = (6 + d.z * 8) * cam.H / 480;
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - vx * 0.012 * L / 8, d.y - L);
    }
    ctx.stroke();
    // splash ripples where drops land
    const RP = this.ripples || (this.ripples = []);
    const wantR = Math.floor(this.rain * (cam.W * cam.H) / 9000);
    while (RP.length < wantR) RP.push({ x: Math.random() * cam.W, y: Math.random() * cam.H, t: Math.random() * 0.45 });
    if (RP.length > wantR) RP.length = wantR;
    ctx.strokeStyle = 'rgba(200,215,240,0.5)';
    ctx.lineWidth = Math.max(1, cam.H / 720);
    ctx.beginPath();
    const rs = cam.H / 480;
    for (const r of RP) {
      r.t += dt;
      if (r.t > 0.45) { r.t = 0; r.x = Math.random() * cam.W; r.y = Math.random() * cam.H; }
      const k = r.t / 0.45, rad = (1 + k * 4) * rs;
      ctx.moveTo(r.x + rad, r.y);
      ctx.ellipse(r.x, r.y, rad, rad * 0.55, 0, 0, Math.PI * 2);
    }
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(40,50,70,${0.12 * this.rain})`;
    ctx.fillRect(0, 0, cam.W, cam.H);
    // lightning flash
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${Math.min(0.55, this.flash)})`;
      ctx.fillRect(0, 0, cam.W, cam.H);
      this.flash -= dt * 2.5;
    }
  }
}
