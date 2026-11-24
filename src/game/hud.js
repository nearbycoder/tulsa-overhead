// Keep the HUD legible on retro settings without allocating a full Retina overlay on Low.
import { input } from '../engine/input.js';
import { settings } from '../engine/settings.js';
import { WEAPONS } from '../data/weapons.js';
import { fmtMoney, clamp } from '../engine/math.js';
import { RC, F } from '../world/shared.js';
import { device, hasTokens, drawRich, measure as measureRich } from '../engine/glyphs.js';

const DISPLAY = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';
const BODY = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export class Hud {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.msgs = [];          // small top-left help messages
    this.big = null;         // {text, sub, col, t, max}
    this.area = null;        // {text, t}
    this.vehName = null;
    this.radioName = null;
    this.objective = null;   // {text, t}
    this.timer = null;       // {label, value (sec)}
    this.counter = null;     // {label, value, max}
    this.starPulse = 0;
    this.radar = document.createElement('canvas');
    this.radarCtx = this.radar.getContext('2d');
    this.radarCenter = [0, 0];
    this.radarPaths = new WeakMap();
    this.restoreSurfaces = () => { this.radarScale = 0; this.lastFrame = null; };
    this.canvas.addEventListener('contextrestored', this.restoreSurfaces);
    this.radar.addEventListener('contextrestored', this.restoreSurfaces);
    this.fps = 60;
    this.hidden = false;
    this.resize();
  }
  destroy() {
    this.canvas.removeEventListener('contextrestored', this.restoreSurfaces);
    this.radar.removeEventListener('contextrestored', this.restoreSurfaces);
    this.radar.width = this.radar.height = 0;
    this.lastFrame = null;
  }
  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const readable = Math.min(1280 / Math.max(w, h), 720 / Math.min(w, h));
    const touch = input.lastDevice === 'touch';
    const scale = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : Infinity, Math.max(readable, this.game.cam.W / w));
    const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
    if (this.touch === touch && this.cssW === w && this.cssH === h &&
        this.canvas.width === width && this.canvas.height === height) return;
    this.touch = touch;
    this.cssW = w; this.cssH = h; this.pixelRatio = width / w;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    this.s = touch ? this.pixelRatio * clamp(Math.min(w, h) / 560, 0.72, 1)
      : Math.min(width / 1280, height / 720);
    const style = getComputedStyle(this.canvas);
    this.insets = ['left', 'top', 'right', 'bottom'].map(side =>
      touch ? (parseFloat(style.getPropertyValue('--safe-' + side)) || 0) * this.pixelRatio : 0);
    this.wrapCache = new Map();
    this.widthCache = new Map();
    this.lastFrame = null;
    const R = Math.max(1, Math.round(touch ? clamp(Math.min(w, h) * 0.095, 31, 62) * this.pixelRatio : 110 * this.s));
    this.radarHalf = Math.ceil(R * 1.25);
    this.radar.width = this.radar.height = this.radarHalf * 2;
    this.radarScale = 0;
    this.radarR = R;
  }
  message(text, t = 4) { this.msgs.push({ text, t }); if (this.msgs.length > 3) this.msgs.shift(); }
  bigMessage(text, sub = '', col = '#f2b233', t = 3.5) { this.big = { text, sub, col, t, max: t }; }
  showArea(text) { if (!this.area || this.area.text !== text) this.area = { text, t: 4 }; }
  showVehicle(text) { this.vehName = { text, t: 3 }; }
  showRadio(text) { this.radioName = { text, t: 2.5 }; }
  setObjective(text, t = 8) { this.objective = text ? { text, t } : null; this.objText = text || null; }
  pulseStars() { this.starPulse = 1.5; }

  update(dt) {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      this.msgs[i].t -= dt;
      if (this.msgs[i].t <= 0) this.msgs.splice(i, 1);
    }
    for (const k of ['big', 'area', 'vehName', 'radioName', 'objective']) { if (this[k]) { this[k].t -= dt; if (this[k].t <= 0) this[k] = null; } }
    if (this.starPulse > 0) this.starPulse -= dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  }

  text(str, x, y, size, col = '#f4ead2', align = 'left', font = DISPLAY, outline = 0.09) {
    const c = this.ctx;
    c.font = `${Math.round(size)}px ${font}`;
    c.lineJoin = 'round';
    c.lineWidth = Math.max(2, size * outline * 2);
    c.strokeStyle = '#000';
    c.fillStyle = col;
    if (hasTokens(str)) {
      // button prompts: {enter} → keycap or controller button badge for the active device
      drawRich(c, str, x, y, size, font, align, (s, px, py) => {
        c.textAlign = 'left'; c.lineJoin = 'round'; c.lineWidth = Math.max(2, size * outline * 2); c.strokeStyle = '#000'; c.fillStyle = col;
        c.strokeText(s, px, py); c.fillText(s, px, py);
      });
      return;
    }
    c.textAlign = align;
    c.strokeText(str, x, y);
    c.fillText(str, x, y);
  }
  textWidth(str, size, font = BODY) {
    const rich = hasTokens(str);
    const key = rich ? [str, size, font, device(), input.context].join('|') : str + '|' + Math.round(size) + '|' + font;
    const cached = this.widthCache.get(key);
    if (cached !== undefined) return cached;
    const c = this.ctx;
    c.font = `${Math.round(size)}px ${font}`;
    const width = rich ? measureRich(c, str, size, font) : c.measureText(str).width;
    if (this.widthCache.size >= 256) this.widthCache.clear();
    this.widthCache.set(key, width);
    return width;
  }

  wrapped(str, width, size, font = BODY) {
    const key = [str, width, size, font, device(), input.context].join('|');
    let lines = this.wrapCache.get(key);
    if (lines) return lines;
    lines = [''];
    for (const word of str.split(/\s+/)) {
      const i = lines.length - 1;
      const next = lines[i] ? lines[i] + ' ' + word : word;
      if (lines[i] && this.textWidth(next, size, font) > width) lines.push(word);
      else lines[i] = next;
    }
    if (this.wrapCache.size >= 32) this.wrapCache.clear();
    this.wrapCache.set(key, lines);
    return lines;
  }

  caption(str, x, y, width, size, color, outline) {
    if (!this.touch) return this.text(str, x, y, size, color, 'center', BODY, outline);
    const lines = this.wrapped(str, width, size);
    for (let i = 0; i < lines.length; i++) {
      this.text(lines[i], x, y - (lines.length - 1 - i) * size * 1.25, size, color, 'center', BODY, outline);
    }
  }

  draw() {
    this.resize();
    const g = this.game, c = this.ctx, s = this.s;
    const [left, top, right, bottom] = this.insets;
    const W = this.canvas.width - left - right, H = this.canvas.height - top - bottom;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.hidden || !g.player) {
      if (!this.wasBlank) c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.wasBlank = true;
      this.lastFrame = null;
      return;
    }
    this.wasBlank = false;
    const pl = g.player, p = pl.ped;
    const touch = this.touch, ratio = this.pixelRatio;
    const portrait = touch && this.cssW < this.cssH;
    const pad = touch ? 8 * ratio : 22 * s;
    const statusY = touch && this.cssW < 560 ? 43 * ratio : 0;
    const statusRight = W - pad;
    const statusBottom = pad + statusY + (p.drown > 0 ? 180 : 164) * s;
    pl.displayMoney += (pl.money - pl.displayMoney) * 0.15;
    if (Math.abs(pl.money - pl.displayMoney) < 1) pl.displayMoney = pl.money;
    const blips = g.collectBlips(), flash = Math.floor(performance.now() / 250) % 2;
    const range = 260 + (pl.vehicle ? Math.min(250, pl.vehicle.speed * 6) : 0);
    // Only the instruments change during ordinary driving. Keep the already painted
    // status panel, and the entire canvas when the map and visible blips also match.
    // Animated overlays and debug data always take the full paint path.
    const reminder = !g.dialogActive && g.missions?.active && !g.controlsLocked ? this.objText : null;
    const retry = g.missions?.quickRetry ? g.missions.retryOffer.def.title : null;
    const captions = Boolean(g.prompt || reminder || retry);
    const simple = !(this.area || this.vehName || this.radioName || this.msgs.length ||
      this.big || this.timer || this.counter || this.bar2 || this.objective && !g.dialogActive || settings.get('showFps'));
    const prev = this.lastFrame;
    let retainStatus = false;
    if (simple) {
      const v = pl.vehicle, gps = g.gps;
      const status = [Math.floor(pl.displayMoney), p.health, p.maxHealth, p.armor, p.drown, p.dead,
        p.weapon, p.clip[p.weapon], p.ammo[p.weapon], p.reloadT > 0, g.police.level,
        g.police.level && this.starPulse > 0 ? this.starPulse : 0,
        g.police.level && g.police.searching && Math.floor(g.time * 3) % 2 === 0,
        p.health < 25 && Math.floor(g.time * 4) % 2];
      const instruments = [pl.x, pl.y, v ? v.h : p.h, range, g.world.regionRevision,
        g.police.level > 0 && Math.floor(g.time * 4) % 2, v,
        v?.isHeli ? v.alt : v?.vf, v?.health, v?.maxHealth, settings.get('speedUnits'),
        gps?.target, gps?.route, gps?.mode, gps?.access, gps?.segment, gps?.progress,
        gps?.status, gps?.remaining, gps?.partial, gps?.lengths, gps?.nextTurn,
        g.prompt, reminder, retry, captions && device(), captions && input.context];
      this.lastFrame = { status, instruments, blips, flash, captions };
      if (prev && equalValues(status, prev.status)) {
        if (equalValues(instruments, prev.instruments) &&
            sameVisibleBlips(blips, prev.blips, pl.x, pl.y, range * (1 - 8 * s / this.radarR), flash !== prev.flash)) return;
        if (!touch) {
          // The desktop radar, vehicle readout and route card fit in the lower half.
          const y = Math.floor(top + H / 2);
          c.clearRect(0, y, this.canvas.width, this.canvas.height - y);
          retainStatus = true;
        } else if (!captions && !prev.captions) {
          // On a narrow phone, fall back if the instruments could touch the status panel.
          const edge = Math.ceil(left + pad + Math.max(2 * this.radarR, Math.min(320 * s, W * 0.49), 150 * s) + 5 * s + 2);
          const moneyWidth = this.textWidth(fmtMoney(pl.displayMoney).replace('$', '$ '), 42 * s, DISPLAY) + 10 * s;
          const statusWidth = Math.max((p.drown > 0 ? 270 : 205) * s + 3, moneyWidth);
          if (edge < left + statusRight - statusWidth) {
            c.clearRect(0, 0, edge, this.canvas.height);
            retainStatus = true;
          }
        }
      }
    } else this.lastFrame = null;
    if (!retainStatus) c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.translate(left, top);
    if (!retainStatus) this.drawStatus(W, pad, statusY);
    this.drawRadar(pad, touch ? pad + this.radarR : H - pad - this.radarR, blips, range, flash);
    // ---- area / vehicle / radio names
    if (this.area) {
      const a = clamp(this.area.t, 0, 1);
      c.globalAlpha = a;
      this.text(this.area.text, statusRight, touch ? statusBottom + 22 * s : H - pad - 10 * s, (touch ? 21 : 34) * s, '#f2b233', 'right');
      c.globalAlpha = 1;
    }
    if (this.vehName) {
      c.globalAlpha = clamp(this.vehName.t, 0, 1);
      this.text(this.vehName.text, statusRight, touch ? statusBottom + 45 * s : H - pad - 52 * s, (touch ? 18 : 26) * s, '#b9e3ff', 'right');
      c.globalAlpha = 1;
    }
    if (this.radioName) {
      c.globalAlpha = clamp(this.radioName.t, 0, 1);
      this.text(this.radioName.text, W / 2, touch ? H * 0.40 : pad + 30 * s, (touch ? 20 : 26) * s, '#f2b233', 'center');
      c.globalAlpha = 1;
    }
    // speedometer
    const speedX = touch ? pad : pad + 2 * this.radarR + 30 * s;
    const speedBase = touch ? pad + 2 * this.radarR + 53 * s : H - pad;
    if (pl.vehicle && !pl.vehicle.isHeli) {
      const v = pl.vehicle;
      const sp = Math.abs(v.vf);
      const units = settings.get('speedUnits') === 'kmh' ? [3.6, 'KM/H'] : [2.237, 'MPH'];
      this.text(`${Math.round(sp * units[0])}`, speedX, speedBase - (touch ? 22 : 34) * s, 34 * s, '#f4ead2', 'left');
      this.text(units[1], speedX, speedBase - (touch ? 3 : 12) * s, 14 * s, '#b8ad94', 'left', BODY);
      const hp = v.health / v.maxHealth;
      bar(c, touch ? speedX + 42 * s : speedX, touch ? speedBase - 22 * s : speedBase - 76 * s, (touch ? 50 : 90) * s, 6 * s, hp, hp < 0.3 ? '#ff5a4a' : '#e8c060');
    } else if (pl.vehicle && pl.vehicle.isHeli) {
      this.text(`ALT ${Math.round(pl.vehicle.alt * 3.28)} FT`, speedX, speedBase - (touch ? 3 : 12) * s, 20 * s, '#f4ead2');
    }
    if (g.gps?.target) this.drawGuidance(pad, touch
      ? pad + 2 * this.radarR + (pl.vehicle ? 107 : 54) * s : H - pad - 2 * this.radarR - 9 * s,
      touch ? Math.min(320 * s, W * 0.49) : 320 * s);
    // Leave both thumb controls free. Wide phones have room for help between the corner instruments.
    const helpLeft = touch && !portrait ? pad + this.radarR * 2 + 12 * ratio : pad;
    const helpWidth = touch ? (portrait ? W - 2 * pad : W - helpLeft - 225 * s - pad) : W * 0.45;
    let my = touch ? (portrait ? Math.max(statusBottom + 66 * s, pad + this.radarR * 2 + 124 * s) : 68 * ratio) : pad + 20 * s;
    for (const m of this.msgs) {
      const size = 17 * s;
      const lines = touch ? this.wrapped(m.text, helpWidth - 24 * s, size) : [m.text];
      const tw = Math.min(helpWidth, Math.max(...lines.map(line => this.textWidth(line, size, BODY))) + 24 * s);
      c.fillStyle = 'rgba(0,0,0,0.65)';
      c.globalAlpha = clamp(m.t, 0, 1);
      const lineHeight = 22 * s;
      c.fillRect(helpLeft, my - 18 * s, tw, 28 * s + (lines.length - 1) * lineHeight);
      for (let i = 0; i < lines.length; i++) this.text(lines[i], helpLeft + 12 * s, my + (2 * s) + i * lineHeight, size, '#f4ead2', 'left', BODY, 0.05);
      c.globalAlpha = 1;
      my += 34 * s + (lines.length - 1) * lineHeight;
    }
    const captionBase = portrait ? H - 144 * ratio : H - pad;
    const captionWidth = portrait ? W - 2 * pad : Math.max(W * 0.35, W - 372 * ratio);
    let promptY = captionBase, objectiveY = captionBase;
    if (touch) {
      if (retry) promptY -= this.wrapped(`{phone} Retry ${retry}`, captionWidth, 20*s).length * 25*s + 8*s;
      objectiveY = promptY;
      if (g.prompt) objectiveY -= this.wrapped(g.prompt, captionWidth, 20*s).length * 25*s + 8*s;
    }
    // ---- objective
    if (this.objective && !g.dialogActive) {
      c.globalAlpha = clamp(this.objective.t, 0, 1);
      this.caption(this.objective.text, W / 2, touch ? objectiveY : H - 150 * s, captionWidth, (touch ? 19 : 24) * s, '#f4ead2', 0.07);
      c.globalAlpha = 1;
    } else if (reminder) {
      // after the big line fades, keep a quiet reminder of the current objective on screen
      c.globalAlpha = 0.8;
      this.caption(reminder, W / 2, touch ? objectiveY : H - 36 * s, captionWidth, 16 * s, '#e9dcbc', 0.08);
      c.globalAlpha = 1;
    }
    // ---- timer / counter
    let ty = touch ? statusBottom + (this.vehName || this.area ? 72 : 27) * s : pad + 190 * s;
    if (this.timer) {
      const t = Math.max(0, this.timer.value);
      const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      this.text(`${this.timer.label}  ${mm}:${ss.toString().padStart(2, '0')}`, W - pad, ty, 24 * s, t < 10 && Math.floor(g.time * 4) % 2 ? '#ff5a4a' : '#f4ead2', 'right'); ty += 30 * s;
    }
    if (this.counter) { this.text(`${this.counter.label}  ${this.counter.value}${this.counter.max ? ' / ' + this.counter.max : ''}`, W - pad, ty, 24 * s, '#f4ead2', 'right'); ty += 30 * s; }
    if (this.bar2) { this.text(this.bar2.label, W - pad - 150 * s, ty, 16 * s, '#f4ead2', 'right', BODY); bar(c, W - pad - 140 * s, ty - 10 * s, 140 * s, 10 * s, this.bar2.value, this.bar2.col || '#7ed36b'); }
    // ---- big centre message
    if (this.big) {
      const b = this.big;
      const k = clamp((b.max - b.t) * 3, 0, 1) * clamp(b.t * 2, 0, 1);
      c.globalAlpha = k;
      const titleSize = touch ? Math.min(86 * s, 86 * s * (W - 2 * pad) / Math.max(1, this.textWidth(b.text, 86 * s, DISPLAY))) : 86 * s;
      this.text(b.text, W / 2, H * 0.42, titleSize, b.col, 'center', DISPLAY, 0.06);
      if (b.sub) {
        const subSize = touch ? Math.min(34 * s, 34 * s * (W - 2 * pad) / Math.max(1, this.textWidth(b.sub, 34 * s, DISPLAY))) : 34 * s;
        this.text(b.sub, W / 2, H * 0.42 + 54 * s, subSize, '#f4ead2', 'center');
      }
      c.globalAlpha = 1;
    }
    // ---- context prompt
    if (g.prompt) this.caption(g.prompt, W / 2, touch ? promptY : H - 100 * s, captionWidth, 20 * s, '#f2b233', 0.07);
    if (retry) {
      this.caption(`{phone} Retry ${retry}`, W / 2, touch ? captionBase : H - 64 * s, captionWidth, 20 * s, '#f4ead2', 0.07);
    }
    if (settings.get('showFps')) {
      const r = g.renderer;
      this.text(`${Math.round(this.fps)} fps  ${r.cam.W}x${r.cam.H}  bld ${r.stats.blds} obj ${r.stats.objs}  veh ${g.vehicles.length} ped ${g.peds.length}  ${r.stats.ms.toFixed(1)}ms`, pad, H - 8 * s, 13 * s, '#cfe', 'left', 'monospace');
    }
  }

  drawStatus(W, pad, statusY) {
    const g = this.game, pl = g.player, p = pl.ped, c = this.ctx, s = this.s;
    c.save(); c.translate(0, statusY);
    this.text(fmtMoney(pl.displayMoney).replace('$', '$ '), W - pad, pad + 40 * s, 42 * s, '#7ed36b', 'right');
    // ---- wanted stars
    const lvl = g.police.level;
    const maxS = 6;
    for (let i = 0; i < maxS; i++) {
      const on = i < lvl;
      const flash = on && g.police.searching && Math.floor(g.time * 3) % 2 === 0;
      const x = W - pad - (maxS - 1 - i) * 34 * s - 14 * s, y = pad + 72 * s;
      const sc = on && this.starPulse > 0 ? 1 + Math.sin(this.starPulse * 12) * 0.15 : 1;
      star(c, x, y, 13 * s * sc, on ? (flash ? '#6a5a20' : '#f2c233') : 'rgba(0,0,0,0.35)', on ? '#000' : 'rgba(255,255,255,0.25)');
    }
    // ---- health / armour
    const bw = 190 * s, bh = 10 * s, bx = W - pad - bw, by = pad + 96 * s;
    bar(c, bx, by, bw, bh, p.health / p.maxHealth, p.health < 25 && Math.floor(g.time * 4) % 2 ? '#ff4a3a' : '#d9452b');
    if (p.armor > 0) bar(c, bx, by + bh + 5 * s, bw, bh * 0.8, p.armor / 100, '#5aa0e8');
    if (p.drown > 0 && !p.dead) { bar(c, bx, pad + 166 * s, bw, bh * 0.7, 1 - p.drown / 8, '#9fd4ff'); this.text('BREATH', bx - 8 * s, pad + 170 * s, 13 * s, '#9fd4ff', 'right', BODY); }
    // ---- weapon
    const w = WEAPONS[p.weapon] || WEAPONS.fists;
    const wy = pad + 140 * s;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(W - pad - 190 * s, wy - 26 * s, 190 * s, 44 * s);
    drawWeaponIcon(c, w.id, W - pad - 168 * s, wy - 4 * s, 26 * s);
    this.text(w.name.toUpperCase(), W - pad - 10 * s, wy - 6 * s, 17 * s, '#f4ead2', 'right');
    if (w.type !== 'melee') {
      const clip = p.clip[w.id] ?? 0, ammo = p.ammo[w.id] ?? 0;
      this.text(p.reloadT > 0 ? 'RELOADING' : w.clip > 1 ? `${clip} / ${Math.max(0, ammo - clip)}` : `${ammo}`, W - pad - 10 * s, wy + 13 * s, 15 * s, p.reloadT > 0 ? '#f2b233' : '#cfc6ae', 'right', BODY);
    }
    c.restore();
  }

  drawGuidance(left, bottom, maxWidth) {
    const gps = this.game.gps, c = this.ctx, s = this.s;
    const metric = settings.get('speedUnits') === 'kmh';
    const format = metres => metric
      ? (metres < 1000 ? Math.round(metres / 5) * 5 + ' m' : (metres / 1000).toFixed(1) + ' km')
      : (metres < 161 ? Math.round(metres * 3.28084 / 5) * 5 + ' ft' : (metres / 1609.344).toFixed(1) + ' mi');
    const turn = gps.nextTurn;
    let title = gps.status, detail = '';
    if (!title) {
      if (turn) title = turn.action + ' in ' + format(gps.lengths[turn.i] - gps.progress);
      else if (gps.access >= 0) title = gps.segment >= gps.access ? 'Follow the marker' : 'Approach destination';
      else title = 'Continue to destination';
      detail = turn ? this.game.world.names[turn.name] || '' : '';
    }
    const remaining = gps.remaining != null && gps.status !== 'Arrived'
      ? format(gps.remaining) + (gps.partial ? ' mapped' : ' left') : '';
    const space = detail && remaining ? this.textWidth(remaining, 12 * s, BODY) + 10 * s : 0;
    const preferred = Math.max(this.textWidth(detail, 12 * s, BODY) + space, this.textWidth(title, 16 * s, BODY)) + 22 * s;
    const width = Math.max(2 * this.radarR, Math.min(preferred, maxWidth)), inner = width - 22 * s;
    if (this.textWidth(detail, 12 * s, BODY) > inner - space) {
      while (detail && this.textWidth(detail + '…', 12 * s, BODY) > inner - space) detail = detail.slice(0, -1);
      detail = detail.trimEnd() + '…';
    }
    const titleSize = 16 * s;
    const titles = this.touch ? this.wrapped(title, inner, titleSize) : [title];
    const twoLines = Boolean(detail || remaining);
    const height = (twoLines ? 48 : 30) * s + (titles.length - 1) * 19 * s;
    c.fillStyle = 'rgba(20,23,22,0.91)';
    c.fillRect(left, bottom - height, width, height);
    c.fillStyle = '#da77cf';
    c.fillRect(left, bottom - height, 3 * s, height);
    for (let i = 0; i < titles.length; i++) this.text(titles[i], left + 10 * s, bottom - height + (20 + 19 * i) * s, titleSize, '#fff3e2', 'left', BODY, 0.04);
    if (detail) this.text(detail, left + 10 * s, bottom - 8 * s, 12 * s, '#ddd5c7', 'left', BODY, 0.04);
    if (remaining) this.text(remaining, left + width - 10 * s, bottom - 8 * s, 12 * s, '#eccce6', 'right', BODY, 0.04);
  }

  // Geometry is immutable after decoding. Weak keys release the paths as regions unload.
  radarPath(shape) {
    let path = this.radarPaths.get(shape);
    if (path) return path;
    path = new Path2D();
    const addLine = points => {
      path.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
    };
    if (shape.rings) {
      for (const ring of shape.rings) { addLine(ring); path.closePath(); }
    } else addLine(shape.pts);
    this.radarPaths.set(shape, path);
    return path;
  }

  drawRadar(pad, cy, blips, range, flash) {
    const g = this.game, c = this.ctx, s = this.s;
    const R = this.radarR;
    const cx = pad + R;
    const pl = g.player;
    const scale = R / range;
    const px = pl.x, py = pl.y;
    // Keep roads stationary in world coordinates as the player moves or the radar zooms.
    // The margin lets the map slide under the live player, route and blips.
    const half = this.radarHalf;
    const travel = Math.max(Math.abs(px - this.radarCenter[0]), Math.abs(py - this.radarCenter[1]));
    if (!this.radarScale || this.radarRevision !== g.world.regionRevision ||
        (travel + range) * this.radarScale > half - 1 || scale > this.radarScale * 1.2) {
      this.radarScale = scale;
      this.radarRevision = g.world.regionRevision;
      const rc = this.radarCtx;
      const D = half * 2;
      rc.setTransform(1, 0, 0, 1, 0, 0);
      rc.fillStyle = '#2b3423'; rc.fillRect(0, 0, D, D);
      this.radarCenter = [px, py];
      const extent = half / scale;
      const x0 = px - extent, y0 = py - extent, x1 = px + extent, y1 = py + extent;
      rc.setTransform(scale, 0, 0, scale, half - px * scale, half - py * scale);
      // water & parks
      g.world.forEachInRect('areas', x0, y0, x1, y1, (a) => {
        let col = null;
        if (a.k === 13 || a.k === 18) col = '#2f5d88';
        else if (a.k === 8 || a.k === 7 || a.k === 9 || a.k === 3 || a.k === 17) col = '#34502a';
        if (!col) return;
        rc.fillStyle = col;
        rc.fill(this.radarPath(a), 'evenodd');
      });
      g.world.forEachInRect('lines', x0, y0, x1, y1, (l) => {
        if (l.k !== 2 && l.k !== 4) return;
        rc.strokeStyle = '#2f5d88'; rc.lineWidth = l.w; rc.stroke(this.radarPath(l));
      });
      rc.lineCap = 'round'; rc.lineJoin = 'round';
      const roads = [];
      g.world.forEachInRect('roads', x0, y0, x1, y1, (r) => { if (r.cls !== RC.PATH && !(r.flags & F.AISLE) && !(r.flags & F.DRIVEWAY)) roads.push(r); });
      roads.sort((a, b) => b.cls - a.cls);
      for (const r of roads) {
        const major = r.cls <= 1 || r.cls === 10 || r.cls === 11;
        rc.strokeStyle = major ? '#e0a050' : r.cls <= 4 ? '#d8d2c0' : r.cls === RC.SERVICE || r.cls === RC.TRACK ? '#6b705c' : '#a8a594';
        rc.lineWidth = Math.max(r.w, (major ? 3.2 : r.cls <= 4 ? 2.4 : 1.5) / scale);
        rc.stroke(this.radarPath(r));
      }
    }
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.closePath();
    c.fillStyle = '#000'; c.fill();
    c.clip();
    const offx = (this.radarCenter[0] - px) * scale, offy = (this.radarCenter[1] - py) * scale;
    c.globalAlpha = 0.92;
    const size = half * scale / this.radarScale;
    c.drawImage(this.radar, cx + offx - size, cy + offy - size, size * 2, size * 2);
    c.globalAlpha = 1;
    // GPS route
    if (g.gps && g.gps.route) {
      c.globalAlpha = 0.9;
      g.gps.drawOn(c, (wx) => cx + (wx - px) * scale, (wy) => cy + (wy - py) * scale, Math.max(2, 3.2 * s), '#d64ad6', range * 3);
      c.globalAlpha = 1;
    }
    // blips
    const edgeRadius = R - 8 * s;
    for (const b of blips) {
      let bx = (b.x - px) * scale, by = (b.y - py) * scale;
      const distance2 = bx * bx + by * by;
      if (distance2 > edgeRadius * edgeRadius) {
        if (!b.edge) continue;
        const k = edgeRadius / Math.sqrt(distance2);
        bx *= k; by *= k;
      }
      blip(c, cx + bx, cy + by, b, s, flash);
    }
    // player arrow
    const h = pl.vehicle ? pl.vehicle.h : pl.ped.h;
    c.translate(cx, cy); c.rotate(h);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2 * s;
    c.beginPath(); c.moveTo(9 * s, 0); c.lineTo(-6 * s, -6 * s); c.lineTo(-3 * s, 0); c.lineTo(-6 * s, 6 * s); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.lineWidth = 3 * s; c.strokeStyle = g.police.level > 0 ? (Math.floor(g.time * 4) % 2 ? '#d33' : '#36f') : '#111';
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    // north marker
    this.text('N', cx, cy - R + 16 * s, 14 * s, '#f4ead2', 'center', BODY);
  }
}



function equalValues(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Compare in painter's order. Distant trains or police moving outside radar range
// don't invalidate a parked player's display. Edge markers still update immediately.
function sameVisibleBlips(current, previous, x, y, range, flashChanged) {
  const limit = range * range;
  const visible = b => b.edge || (b.x - x) ** 2 + (b.y - y) ** 2 <= limit;
  let i = 0, j = 0;
  for (;;) {
    while (i < current.length && !visible(current[i])) i++;
    while (j < previous.length && !visible(previous[j])) j++;
    if (i === current.length || j === previous.length) return i === current.length && j === previous.length;
    const a = current[i++], b = previous[j++];
    if (a.x !== b.x || a.y !== b.y || a.shape !== b.shape || a.size !== b.size ||
        a.col !== b.col || a.letter !== b.letter || a.flash !== b.flash || a.flash && flashChanged) return false;
  }
}

function star(c, x, y, r, fill, stroke) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill; c.fill();
  c.lineWidth = 2; c.strokeStyle = stroke; c.stroke();
}
function bar(c, x, y, w, h, v, col) {
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x - 2, y - 2, w + 4, h + 4);
  c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x, y, w, h);
  c.fillStyle = col; c.fillRect(x, y, w * clamp(v, 0, 1), h);
}
function blip(c, x, y, b, s, flash) {
  const r = (b.size || 5) * s;
  c.lineWidth = 2 * s; c.strokeStyle = '#000';
  if (b.shape === 'letter') {
    c.fillStyle = b.col; c.beginPath(); c.arc(x, y, r * 1.6, 0, Math.PI * 2); c.fill(); c.stroke();
    c.font = `bold ${Math.round(r * 2)}px Impact, sans-serif`; c.textAlign = 'center'; c.fillStyle = '#111'; c.fillText(b.letter, x, y + r * 0.7);
  } else if (b.shape === 'square') {
    c.fillStyle = b.col; c.fillRect(x - r, y - r, r * 2, r * 2); c.strokeRect(x - r, y - r, r * 2, r * 2);
  } else if (b.shape === 'triangle') {
    c.fillStyle = b.col; c.beginPath(); c.moveTo(x, y - r * 1.3); c.lineTo(x + r * 1.2, y + r); c.lineTo(x - r * 1.2, y + r); c.closePath(); c.fill(); c.stroke();
  } else {
    c.fillStyle = b.col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  if (b.flash && flash) { c.strokeStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 2, 0, Math.PI * 2); c.stroke(); }
}

// tiny vector weapon icons
export function drawWeaponIcon(c, id, x, y, s) {
  c.save(); c.translate(x, y); c.scale(s / 24, s / 24);
  c.fillStyle = '#e8e0c8'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
  const R = (a, b, w, h) => { c.fillRect(a, b, w, h); c.strokeRect(a, b, w, h); };
  switch (id) {
    case 'fists': c.beginPath(); c.arc(0, 0, 9, 0, 6.28); c.fill(); c.stroke(); break;
    case 'bat': c.rotate(-0.6); R(-14, -2, 28, 4); break;
    case 'knife': c.rotate(-0.6); R(-12, -2, 10, 4); c.fillStyle = '#cfd6dc'; R(-2, -2, 16, 4); break;
    case 'pistol': case 'revolver': case 'taser': R(-10, -6, 20, 6); R(-10, 0, 6, 9); break;
    case 'smg': R(-12, -6, 24, 6); R(-4, 0, 5, 10); R(-12, 0, 4, 6); break;
    case 'shotgun': R(-16, -4, 32, 5); R(-16, 1, 8, 6); break;
    case 'rifle': case 'sniper': R(-16, -4, 32, 5); R(-2, 1, 5, 9); R(-16, 1, 7, 6); break;
    case 'minigun': R(-14, -7, 28, 12); break;
    case 'rocket': R(-16, -4, 32, 8); break;
    case 'grenade': c.fillStyle = '#5a6b3a'; c.beginPath(); c.arc(0, 0, 8, 0, 6.28); c.fill(); c.stroke(); break;
    case 'molotov': c.fillStyle = '#6aa54a'; R(-4, -10, 8, 20); c.fillStyle = '#ff9a30'; R(-2, -14, 4, 5); break;
    case 'flamer': R(-14, -4, 28, 7); c.fillStyle = '#d64'; R(-8, 3, 8, 8); break;
  }
  c.restore();
}
