// Full-screen map: pre-rendered tile pyramid + live vector roads when zoomed in, blips, waypoint.
import { RC, F } from '../world/shared.js';
import { input } from '../engine/input.js';
import { settings } from '../engine/settings.js';
import { MapFinder } from './map-finder.js';
import { drawMapLabels } from './map-labels.js';

const panKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

export class MapView {
  constructor(game, ui) {
    this.g = game;
    this.ui = ui;
    this.el = document.createElement('div');
    this.el.className = 'mapview';
    this.el.tabIndex = 0;
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.el._coversScene = true;
    this.el._initialFocus = this.el;
    this.finder = new MapFinder(this);
    this.tools = document.createElement('div');
    this.tools.className = 'map-tools';
    this.tools.innerHTML = `<button data-close aria-label="Close map" title="Close map">×</button>
      <button data-player aria-label="Center on player" title="Center on player (Home)">◎</button>
      <button data-zoom-in aria-label="Zoom in" title="Zoom in">+</button>
      <button data-zoom-out aria-label="Zoom out" title="Zoom out">−</button>`;
    this.el.append(this.tools);
    this.tools.querySelector('[data-close]').onclick = () => ui.pop();
    this.tools.querySelector('[data-player]').onclick = () => this.centerPlayer();
    this.tools.querySelector('[data-zoom-in]').onclick = () =>
      this.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.5);
    this.tools.querySelector('[data-zoom-out]').onclick = () =>
      this.zoomAt(innerWidth / 2, innerHeight / 2, 1.5);
    this.legend = document.createElement('div');
    this.legend.className = 'maplegend';
    this.legend.innerHTML = `<div class="map-symbols"><span><b>H</b> Safehouse</span><span><b>G</b> Gun shop</span><span><b>S</b> Respray</span></div>
      <div data-gkb="Drag to pan · click to drop a pin · {back} back" data-gpad="{pan} pan · {waypoint} pin · {findPlace} places · {centerMap} center"></div>`;
    this.el.append(this.legend);
    this.cx = game.player.x;
    this.cy = game.player.y;
    this.mpp = 12; // metres per screen px
    this.tiles = new Map();
    this.detailTiles = new Map();
    this.detailWanted = new Set();
    this.index = null;
    this.dirty = true;
    fetch('assets/map/tiles/index.json')
      .then((r) => r.json())
      .then((j) => {
        this.dirty = true;
        this.index = j;
        this.tileSet = {};
        for (const [z, list] of Object.entries(j.tiles))
          this.tileSet[z] = new Set(list.map((t) => t.join('_')));
      })
      .catch(() => {});
    this.pointers = new Map();
    this.keys = new Set();
    this.el._pad = (nav) => {
      if (nav.has('select') || nav.has('start')) {
        ui.pop();
        return true;
      }
      if (nav.has('b')) {
        if (this.finder.expanded) this.finder.close();
        else ui.pop();
        return true;
      }
      if (nav.has('x')) {
        if (this.finder.expanded) this.finder.close();
        else this.finder.focusSearch();
        return true;
      }
      if (this.finder.expanded) {
        if (nav.has('up')) this.finder.move(-1);
        if (nav.has('down')) this.finder.move(1);
        if (nav.has('left')) this.finder.filter(this.finder.category - 1);
        if (nav.has('right')) this.finder.filter(this.finder.category + 1);
        if (nav.has('rb')) this.finder.move(this.finder.pageSize);
        if (nav.has('lb')) this.finder.move(-this.finder.pageSize);
        if (nav.has('a')) this.finder.choose(this.finder.selected);
      } else {
        if (nav.has('a')) {
          this.toggleWaypoint(this.cx, this.cy);
          ui.click();
        }
        if (nav.has('y')) this.centerPlayer();
        if (nav.has('rs')) this.toggleRouteView();
        if (nav.has('rb')) this.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.5);
        if (nav.has('lb')) this.zoomAt(innerWidth / 2, innerHeight / 2, 1.5);
      }
      return true;
    };
    import('../game/factions.js').then((m) => {
      this.facMod = m;
      this.dirty = true;
    });
  }
  start() {
    const c = this.canvas;
    this._resize = () => {
      const dpr = window.devicePixelRatio || 1;
      // The map sits above the game and keeps its own raster. Cap the extra
      // buffer on high-density touchscreens while keeping labels in CSS pixels.
      this.dpr = navigator.maxTouchPoints > 0
        ? Math.min(dpr, 1.5, Math.sqrt(1600000 / (innerWidth * innerHeight)))
        : dpr;
      c.width = Math.round(innerWidth * this.dpr);
      c.height = Math.round(innerHeight * this.dpr);
      this.dirty = true;
    };
    this._resize();
    window.addEventListener('resize', this._resize);
    this._keyboardResize = () => {
      this.el.style.setProperty('--map-window-h', (window.visualViewport?.height || innerHeight) + 'px');
    };
    this._keyboardResize();
    window.visualViewport?.addEventListener('resize', this._keyboardResize);
    this._blur = () => {
      this.keys.clear();
      this.pointers.clear();
    };
    window.addEventListener('blur', this._blur);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.isTrusted) input.lastDevice = e.pointerType === 'touch' ? 'touch' : 'kb';
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (e.isTrusted) input.lastDevice = 'kb';
        e.preventDefault();
        this.zoomAt(e.offsetX, e.offsetY, e.deltaY > 0 ? 1.2 : 1 / 1.2);
      },
      { passive: false }
    );
    const midpoint = () => {
      const [a, b] = this.pointers.values();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) };
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.pointers.size >= 2) return;
      this.pendingFit = null;
      const dismissing = this.finder.expanded && e.pointerType === 'touch';
      this.finder.close();
      const p = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, dragged: dismissing };
      this.pointers.set(e.pointerId, p);
      c.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        for (const point of this.pointers.values()) point.dragged = true;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2) {
        const before = midpoint();
        p.x = e.clientX; p.y = e.clientY;
        const after = midpoint();
        this.zoomAt(before.x, before.y, before.distance / after.distance);
        this.cx -= (after.x - before.x) * this.mpp;
        this.cy -= (after.y - before.y) * this.mpp;
        return;
      }
      if (!p.dragged && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= (e.pointerType === 'touch' ? 8 : 4)) return;
      p.dragged = true;
      this.framing = '';
      this.cx -= (e.clientX - p.x) * this.mpp;
      this.cy -= (e.clientY - p.y) * this.mpp;
      p.x = e.clientX; p.y = e.clientY;
    });
    c.addEventListener('pointerup', (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || p.dragged) return;
      this.toggleWaypoint(
        this.cx + (e.clientX - innerWidth / 2) * this.mpp,
        this.cy + (e.clientY - innerHeight / 2) * this.mpp
      );
      this.ui.click();
    });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      c.addEventListener(type, e => this.pointers.delete(e.pointerId));
    }
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.pointerType !== 'touch') this.g.setWaypoint(null);
    });
    this.el.addEventListener('keydown', (e) => {
      // Software keyboards type into the search field without replacing touch controls.
      if (e.isTrusted && e.target !== this.finder.input) input.lastDevice = 'kb';
      if (
        (e.key === '/' || e.code === 'Slash') &&
        e.target !== this.finder.input &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.keys.clear();
        this.finder.focusSearch();
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.finder.expanded) this.finder.close();
        else this.ui.pop();
        return;
      }
      if (this.finder.expanded) {
        e.stopPropagation();
        if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
          e.preventDefault();
          this.finder.move(e.code === 'ArrowDown' ? 1 : -1);
        }
        if (e.code === 'Enter' && e.target.tagName !== 'BUTTON') {
          e.preventDefault();
          this.finder.choose(this.finder.selected);
        }
        return;
      }
      if (e.code === 'KeyM' || (e.code === 'Tab' && e.target === this.el)) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.pop();
        return;
      }
      if (e.code === 'Home') {
        e.preventDefault();
        this.centerPlayer();
        return;
      }
      if (e.code === 'KeyR') this.toggleRouteView();
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        this.g.setWaypoint(null);
      }
      if (panKeys.has(e.code)) this.keys.add(e.code);
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.3);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract')
        this.zoomAt(innerWidth / 2, innerHeight / 2, 1.3);
    });
    this.el.addEventListener('keyup', (e) => this.keys.delete(e.code));
    let last = performance.now();
    const loop = (now) => {
      if (this.dead) return;
      this.update(Math.min((now - last) / 1000, 0.05));
      last = now;
      const gps = this.g.gps;
      if (this.pendingFit && this.pendingFit === gps?.source && !gps.pending) this.fitRoute();
      if (
        this.dirty ||
        this.cx !== this.lastX ||
        this.cy !== this.lastY ||
        this.mpp !== this.lastMpp ||
        gps?.route !== this.lastRoute ||
        this.g.waypoint !== this.lastPin ||
        input.usingPad !== this.lastPad ||
        this.finder.expanded !== this.lastExpanded ||
        (this.mpp <= 5 && this.detailRetry && now >= this.detailRetry)
      ) {
        this.dirty = false;
        this.draw();
        this.lastX = this.cx;
        this.lastY = this.cy;
        this.lastMpp = this.mpp;
        this.lastRoute = gps?.route;
        this.lastPin = this.g.waypoint;
        this.lastPad = input.usingPad;
        this.lastExpanded = this.finder.expanded;
      }
      if (
        this.routeStatus !== gps?.status ||
        this.routeRemaining !== gps?.remaining ||
        this.routeSource !== gps?.source ||
        this.routePanelOpen !== this.finder.expanded ||
        this.routeFraming !== this.framing
      ) {
        this.finder.refreshRoute();
        this.routeStatus = gps?.status;
        this.routeRemaining = gps?.remaining;
        this.routeSource = gps?.source;
        this.routeFraming = this.framing;
        this.routePanelOpen = this.finder.expanded;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  destroy() {
    this.dead = true;
    this.detailWorker?.terminate();
    for (const t of this.detailTiles.values()) t.bitmap?.close();
    this.detailTiles.clear();
    window.removeEventListener('resize', this._resize);
    window.visualViewport?.removeEventListener('resize', this._keyboardResize);
    window.removeEventListener('blur', this._blur);
  }
  centerPlayer() {
    this.framing = 'player';
    this.pendingFit = null;
    this.cx = this.g.player.x;
    this.cy = this.g.player.y;
    this.mpp = 2;
    this.finder.close();
  }
  toggleRouteView() {
    const target = this.g.gps?.target;
    if (!target) return;
    if (this.framing !== 'route') {
      this.fitRoute(true);
      return;
    }
    this.pendingFit = null;
    this.framing = 'destination';
    this.cx = target[0];
    this.cy = target[1];
    this.mpp = 1;
  }
  fitRoute(waitForRoads = false) {
    const gps = this.g.gps;
    this.pendingFit = waitForRoads && gps?.pending ? gps.source : null;
    if (!gps?.target) return;
    this.framing = 'route';
    this.finder.refreshRoute();
    const pl = this.g.player;
    let left = Math.min(pl.x, gps.target[0]),
      right = Math.max(pl.x, gps.target[0]);
    let top = Math.min(pl.y, gps.target[1]),
      bottom = Math.max(pl.y, gps.target[1]);
    if (gps.route)
      for (let i = (gps.segment || 0) * 2; i < gps.route.length; i += 2) {
        left = Math.min(left, gps.route[i]);
        right = Math.max(right, gps.route[i]);
        top = Math.min(top, gps.route[i + 1]);
        bottom = Math.max(bottom, gps.route[i + 1]);
      }
    const panelWidth = innerWidth > 720 ? this.finder.panel.offsetWidth + 20 : 0;
    const topInset = panelWidth ? 0 : Math.min(220, this.finder.panel.offsetHeight + 24);
    this.mpp = Math.min(
      400,
      Math.max(
        0.9,
        (right - left) / Math.max(120, innerWidth - panelWidth - 110),
        (bottom - top) / Math.max(120, innerHeight - topInset - 130)
      )
    );
    this.cx = (left + right - panelWidth * this.mpp) / 2;
    this.cy = (top + bottom - topInset * this.mpp) / 2;
  }
  zoomAt(sx, sy, f) {
    this.framing = '';
    this.pendingFit = null;
    const wx = this.cx + (sx - innerWidth / 2) * this.mpp,
      wy = this.cy + (sy - innerHeight / 2) * this.mpp;
    this.mpp = Math.max(0.6, Math.min(400, this.mpp * f));
    this.cx = wx - (sx - innerWidth / 2) * this.mpp;
    this.cy = wy - (sy - innerHeight / 2) * this.mpp;
  }
  toggleWaypoint(wx, wy) {
    this.framing = '';
    const current = this.g.waypoint;
    if (current && Math.hypot(current[0] - wx, current[1] - wy) < this.mpp * 12) this.g.setWaypoint(null);
    else if (this.g.world.inWorld(wx, wy)) this.g.setWaypoint([wx, wy]);
    else this.ui.toast('Choose a destination inside the map boundary');
  }
  update(dt) {
    if (this.finder.expanded) {
      this.keys.clear();
      return;
    }
    const k = this.mpp * 720 * dt;
    const gp = input.usingPad ? input.gamepad : null;
    if (gp) {
      // left (or right) stick pans, triggers zoom
      let ax = gp.axes[0] || 0,
        ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) < 0.18) {
        ax = gp.axes[2] || 0;
        ay = gp.axes[3] || 0;
      }
      if (Math.hypot(ax, ay) > 0.18) {
        this.framing = '';
        this.pendingFit = null;
        this.cx += ax * k * 1.4;
        this.cy += ay * k * 1.4;
        input.lastDevice = 'gp';
      }
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0,
        lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (rt > 0.08) this.zoomAt(innerWidth / 2, innerHeight / 2, Math.exp(-2.15 * rt * dt));
      if (lt > 0.08) this.zoomAt(innerWidth / 2, innerHeight / 2, Math.exp(2.15 * lt * dt));
    }
    if (this.keys.size) {
      this.framing = '';
      this.pendingFit = null;
    }
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.cy -= k;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.cy += k;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.cx -= k;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.cx += k;
  }
  tile(z, x, y) {
    const key = `${z}/${x}_${y}`;
    let t = this.tiles.get(key);
    if (t) {
      this.tiles.delete(key);
      this.tiles.set(key, t);
      return t.ok ? t.img : null;
    }
    if (!this.tileSet?.[z]?.has(`${x}_${y}`)) return null;
    t = { ok: false, img: new Image() };
    t.img.onload = () => {
      t.ok = true;
      this.dirty = true;
    };
    t.img.onerror = () => {
      this.tiles.delete(key);
    };
    t.img.src = `assets/map/tiles/${key}.webp`;
    this.tiles.set(key, t);
    if (this.tiles.size > 128) this.tiles.delete(this.tiles.keys().next().value);
    return null;
  }
  drawDetail(ctx, W, H, mpp) {
    if (this.mpp > 5 || this.detailUnavailable) {
      if (this.detailView) {
        this.detailWorker?.postMessage({ tiles: [] });
        this.detailView = null;
        this.detailWanted.clear();
      }
      return;
    }
    if (!this.detailWorker) {
      if (typeof OffscreenCanvas === 'undefined') {
        this.detailUnavailable = true;
        return;
      }
      this.detailWorker = new Worker(new URL('./map-detail.js', import.meta.url), { type: 'module' });
      this.detailWorker.onerror = () => {
        this.detailUnavailable = true;
        this.dirty = true;
        this.detailWorker.terminate();
        this.detailWorker = null;
      };
      this.detailWorker.onmessage = ({ data }) => {
        if (!this.detailWanted.has(data.key)) {
          data.bitmap?.close();
          return;
        }
        this.detailTiles.get(data.key)?.bitmap?.close();
        this.detailTiles.delete(data.key);
        this.detailTiles.set(data.key, data);
        this.dirty = true;
        if (data.failed) this.detailRetry = performance.now() + 5000;
        while (this.detailTiles.size > 64) {
          const oldest = this.detailTiles.keys().next().value;
          this.detailTiles.get(oldest).bitmap?.close();
          this.detailTiles.delete(oldest);
        }
      };
      this.detailWorker.postMessage({
        base: new URL(this.g.world.base, location.href).href,
        regions: [...this.g.world.exists],
        streetRegions: [...this.g.world.streetRegions],
        streetChunk: this.g.world.streetChunk
      });
    }
    // Use finer vector tiles than displayed screen pixels, subject to a viewport budget
    // on very large high-DPI displays. Adjacent tiles share exactly the same world grid.
    let level = Math.max(0.125, 2 ** Math.floor(Math.log2(mpp)));
    while (((W * mpp) / (384 * level) + 2) * ((H * mpp) / (384 * level) + 2) > 46) level *= 2;
    const span = 384 * level;
    const left = this.cx - (W * mpp) / 2,
      top = this.cy - (H * mpp) / 2;
    const x0 = Math.floor(left / span),
      y0 = Math.floor(top / span);
    const x1 = Math.floor((left + W * mpp) / span),
      y1 = Math.floor((top + H * mpp) / span);
    const view = [level, x0, y0, x1, y1].join('/');
    if (this.detailRetry && performance.now() >= this.detailRetry) {
      for (const [key, t] of this.detailTiles) if (t.failed) this.detailTiles.delete(key);
      this.detailView = null;
      this.detailRetry = 0;
    }
    if (view !== this.detailView) {
      this.detailView = view;
      this.detailWanted.clear();
      const requests = [];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const key = level + '/' + x + '_' + y;
          this.detailWanted.add(key);
          const t = this.detailTiles.get(key);
          if (t) {
            this.detailTiles.delete(key);
            this.detailTiles.set(key, t);
          } else requests.push({ key, x, y, mpp: level });
        }
      const dx = this.cx / span - 0.5,
        dy = this.cy / span - 0.5;
      requests.sort((a, b) => (a.x - dx) ** 2 + (a.y - dy) ** 2 - ((b.x - dx) ** 2 + (b.y - dy) ** 2));
      this.detailWorker.postMessage({ tiles: requests });
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const bitmap = this.detailTiles.get(level + '/' + x + '_' + y)?.bitmap;
        if (!bitmap) continue;
        const sx = Math.round((x * span - left) / mpp),
          sy = Math.round((y * span - top) / mpp);
        const ex = Math.round(((x + 1) * span - left) / mpp),
          ey = Math.round(((y + 1) * span - top) / mpp);
        ctx.drawImage(bitmap, sx, sy, ex - sx, ey - sy);
      }
  }

  draw() {
    const c = this.canvas,
      x = c.getContext('2d'),
      d = this.dpr;
    const W = c.width,
      H = c.height;
    const mpp = this.mpp / d; // metres per canvas px
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#20241c';
    x.fillRect(0, 0, W, H);
    const toS = (wx, wy) => [W / 2 + (wx - this.cx) / mpp, H / 2 + (wy - this.cy) / mpp];
    const g = this.g;
    if (this.index) {
      const base = this.index.baseMpp,
        T = this.index.tile;
      let z = 0;
      while (z < this.index.levels - 1 && base * Math.pow(2, z) * 0.75 < mpp) z++;
      const tm = base * Math.pow(2, z) * T;
      const x0 = this.cx - (W / 2) * mpp,
        y0 = this.cy - (H / 2) * mpp,
        x1 = this.cx + (W / 2) * mpp,
        y1 = this.cy + (H / 2) * mpp;
      x.imageSmoothingEnabled = true;
      for (let ty = Math.floor(y0 / tm); ty <= Math.floor(y1 / tm); ty++)
        for (let tx = Math.floor(x0 / tm); tx <= Math.floor(x1 / tm); tx++) {
          let img = this.tile(z, tx, ty);
          const [sx, sy] = toS(tx * tm, ty * tm);
          if (img) x.drawImage(img, sx, sy, tm / mpp + 0.5, tm / mpp + 0.5);
          else {
            // fallback to a coarser level
            for (let zz = z + 1; zz < this.index.levels; zz++) {
              const f = Math.pow(2, zz - z);
              const px = Math.floor(tx / f),
                py = Math.floor(ty / f);
              const im2 = this.tile(zz, px, py);
              if (im2) {
                const sub = T / f;
                x.drawImage(
                  im2,
                  (tx - px * f) * sub,
                  (ty - py * f) * sub,
                  sub,
                  sub,
                  sx,
                  sy,
                  tm / mpp + 0.5,
                  tm / mpp + 0.5
                );
                break;
              }
            }
          }
        }
      // live roads when zoomed in
      if (mpp < 6 && (this.mpp > 5 || this.detailUnavailable)) {
        x.lineCap = 'round';
        x.lineJoin = 'round';
        g.world.forEachInRect('roads', x0, y0, x1, y1, (r) => {
          if (r.cls === RC.PATH || r.flags & (F.AISLE | F.DRIVEWAY)) return;
          x.strokeStyle =
            r.cls <= 1 || r.cls === 10 || r.cls === 11 ? '#f08c3c' : r.cls <= 4 ? '#fbe6a0' : '#ffffff';
          x.lineWidth = Math.max(1, r.w / mpp);
          x.beginPath();
          const p = r.pts;
          let s = toS(p[0], p[1]);
          x.moveTo(s[0], s[1]);
          for (let i = 2; i < p.length; i += 2) {
            s = toS(p[i], p[i + 1]);
            x.lineTo(s[0], s[1]);
          }
          x.stroke();
        });
      }
    }
    this.drawDetail(x, W, H, mpp);
    // world outline
    x.strokeStyle = 'rgba(242,178,51,0.7)';
    x.lineWidth = 2 * d;
    for (const poly of g.world.worldPolys) {
      x.beginPath();
      for (let i = 0; i < poly.length; i += 2) {
        const s = toS(poly[i], poly[i + 1]);
        if (i === 0) x.moveTo(s[0], s[1]);
        else x.lineTo(s[0], s[1]);
      }
      x.closePath();
      x.stroke();
    }
    // faction territories (change as the story advances)
    if (g.factions) {
      const { TERRITORIES, FACTIONS } = this.facMod || {};
      if (TERRITORIES) {
        const c = g.missions ? g.missions.chapter : 1;
        for (const T of TERRITORIES) {
          const rel = g.factions.relationOf(T.f, T.rel(c));
          if (T.rel(c) === 'none') continue;
          const p = g.missions.place(T.place);
          const [sx, sy] = toS(p.x, p.y);
          const rr = T.r / mpp;
          x.fillStyle = FACTIONS[T.f].color + (rel === 'hostile' ? '30' : '1c');
          x.strokeStyle = FACTIONS[T.f].color + (rel === 'hostile' ? 'cc' : '77');
          x.lineWidth = 2 * d;
          x.setLineDash(rel === 'hostile' ? [] : [6 * d, 5 * d]);
          x.beginPath();
          x.arc(sx, sy, rr, 0, 6.283);
          x.fill();
          x.stroke();
          x.setLineDash([]);
          if (rr > 30) {
            x.font = `bold ${Math.round(12 * d)}px "Trebuchet MS", sans-serif`;
            x.textAlign = 'center';
            x.fillStyle = FACTIONS[T.f].color;
            x.fillText(
              `${FACTIONS[T.f].name}${rel === 'hostile' ? ' (hostile)' : rel === 'ally' ? ' (allies)' : ''}`,
              sx,
              sy - rr - 6 * d
            );
          }
        }
      }
    }
    // GPS route
    if (g.gps && g.gps.route)
      g.gps.drawOn(
        x,
        (wx) => W / 2 + (wx - this.cx) / mpp,
        (wy) => H / 2 + (wy - this.cy) / mpp,
        3 * d,
        '#d64ad6'
      );
    const blips = g.collectBlips();
    drawMapLabels(this, x, W, H, mpp, toS, blips);
    // blips
    x.textAlign = 'center';
    for (const b of blips) {
      const [sx, sy] = toS(b.x, b.y);
      const r = (b.size || 5) * 1.6 * d;
      x.lineWidth = 2 * d;
      x.strokeStyle = '#000';
      x.fillStyle = b.col;
      if (b.shape === 'letter') {
        x.beginPath();
        x.arc(sx, sy, r * 1.3, 0, 6.28);
        x.fill();
        x.stroke();
        x.fillStyle = '#111';
        x.font = `bold ${Math.round(r * 1.6)}px Impact, sans-serif`;
        x.fillText(b.letter, sx, sy + r * 0.55);
      } else if (b.shape === 'triangle') {
        x.beginPath();
        x.moveTo(sx, sy - r);
        x.lineTo(sx + r, sy + r);
        x.lineTo(sx - r, sy + r);
        x.closePath();
        x.fill();
        x.stroke();
      } else {
        x.beginPath();
        x.arc(sx, sy, r * 0.8, 0, 6.28);
        x.fill();
        x.stroke();
      }
    }
    // player
    const [px, py] = toS(g.player.x, g.player.y);
    const h = g.player.vehicle ? g.player.vehicle.h : g.player.ped.h;
    x.save();
    x.translate(px, py);
    x.rotate(h);
    x.fillStyle = '#fff';
    x.strokeStyle = '#000';
    x.lineWidth = 2 * d;
    x.beginPath();
    x.moveTo(12 * d, 0);
    x.lineTo(-8 * d, -8 * d);
    x.lineTo(-4 * d, 0);
    x.lineTo(-8 * d, 8 * d);
    x.closePath();
    x.fill();
    x.stroke();
    x.restore();
    // controller crosshair (A sets the waypoint here)
    if (input.usingPad && !this.finder.expanded) {
      x.strokeStyle = '#f2b233';
      x.lineWidth = 2 * d;
      x.beginPath();
      x.arc(W / 2, H / 2, 10 * d, 0, 6.283);
      x.moveTo(W / 2 - 18 * d, H / 2);
      x.lineTo(W / 2 - 6 * d, H / 2);
      x.moveTo(W / 2 + 6 * d, H / 2);
      x.lineTo(W / 2 + 18 * d, H / 2);
      x.moveTo(W / 2, H / 2 - 18 * d);
      x.lineTo(W / 2, H / 2 - 6 * d);
      x.moveTo(W / 2, H / 2 + 6 * d);
      x.lineTo(W / 2, H / 2 + 18 * d);
      x.stroke();
    }
    // Pick a round ground distance and draw a calibrated bar at every pixel density.
    const metric = settings.get('speedUnits') === 'kmh';
    const nearby = 110 * this.mpp;
    const unit = metric ? (nearby >= 1000 ? 1000 : 1) : nearby >= 402 ? 1609.344 : 0.3048;
    const label = metric ? (unit === 1 ? 'm' : 'km') : unit > 1 ? 'mi' : 'ft';
    const order = 10 ** Math.floor(Math.log10(nearby / unit));
    const step = [1, 2, 5, 10].filter((n) => n * order <= nearby / unit).at(-1) || 1;
    const value = step * order;
    const end = W - 18 * d,
      y = H - 16 * d,
      start = end - (value * unit) / mpp;
    x.strokeStyle = '#171c20';
    x.lineWidth = 4 * d;
    x.lineCap = 'butt';
    x.setLineDash([]);
    x.beginPath();
    x.moveTo(start, y - 5 * d);
    x.lineTo(start, y);
    x.lineTo(end, y);
    x.lineTo(end, y - 5 * d);
    x.stroke();
    x.lineWidth = 1.5 * d;
    x.strokeStyle = '#fff9e9';
    x.stroke();
    x.textAlign = 'right';
    x.font = `bold ${Math.round(12 * d)}px "Trebuchet MS",sans-serif`;
    x.lineWidth = 3 * d;
    x.strokeStyle = '#292720';
    x.fillStyle = '#fff9e9';
    const text = Number(value.toPrecision(3)) + ' ' + label;
    x.strokeText(text, end, y - 8 * d);
    x.fillText(text, end, y - 8 * d);
  }
}
