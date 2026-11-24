// Sprite-stack rendering (github.com/danielwh2/sprite-stacking technique) adapted to
// a GTA-1 style perspective camera: every slice sits at its real height, so it is
// pushed outward from the screen centre and scaled by D / (D - h).
const imgCache = new Map();

// Each slice has four source-pixel coordinates: left, top, width, height.
// Retain a transparent fringe for raster coverage at rotated edges. Keep nearly
// full slices intact and only crop when enough transparent area can be removed.
export function setSliceBounds(img, bounds) {
  const count = bounds.length / 4, w = img.width / count, h = img.height;
  if (!(count > 0 && Number.isInteger(count) && Number.isInteger(w) && w <= 255 && h <= 255)) return;
  for (let i = 0; i < bounds.length; i += 4) {
    if (bounds[i] + bounds[i + 2] > w || bounds[i + 1] + bounds[i + 3] > h) return;
    if (bounds[i + 2] === 0) continue;
    const left = Math.max(0, bounds[i] - 2), top = Math.max(0, bounds[i + 1] - 2);
    const right = Math.min(w, bounds[i] + bounds[i + 2] + 2);
    const bottom = Math.min(h, bounds[i + 1] + bounds[i + 3] + 2);
    if ((right - left) * (bottom - top) < w * h * 0.7) {
      bounds[i] = left; bounds[i + 1] = top;
      bounds[i + 2] = right - left; bounds[i + 3] = bottom - top;
    } else {
      bounds[i] = bounds[i + 1] = 0;
      bounds[i + 2] = w; bounds[i + 3] = h;
    }
  }
  img.stackSliceBounds = bounds;
}

export function loadImage(url, embedded, sliceBoundDeltas) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      if (embedded && sliceBoundDeltas) {
        try {
          const bounds = Uint8Array.from(atob(sliceBoundDeltas), c => c.charCodeAt(0));
          for (let i = 4; i < bounds.length; i++) bounds[i] += bounds[i - 4];
          setSliceBounds(im, bounds);
        }
        catch { /* Older or locally edited bounds can fall back to full slices. */ }
      }
      im.onload = im.onerror = null;
      resolve(im);
    };
    im.onerror = () => {
      if (embedded) { embedded = null; im.src = url; return; }
      imgCache.delete(url);
      reject(new Error('failed to load ' + url));
    };
    im.src = embedded ? 'data:image/png;base64,' + embedded : url;
  });
  imgCache.set(url, p);
  return p;
}

export class StackSprite {
  // img: strip (image/canvas) of `count` slices each w x h; front faces +y; px = metres per art px; sliceH = metres per slice
  constructor(img, w, h, count, px = 0.1, sliceH = 0.1) {
    if (img.width % count !== 0 && img.width !== w * count) console.warn('stack strip width mismatch', img.width, w, count);
    this.img = img; this.w = w; this.h = h; this.count = count; this.px = px; this.sliceH = sliceH;
    this.height = count * sliceH;
  }
  get shadow() {
    if (!this._shadow) {
      const c = document.createElement('canvas');
      c.width = this.img.width; c.height = this.img.height;
      const x = c.getContext('2d');
      x.drawImage(this.img, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = '#000';
      x.fillRect(0, 0, c.width, c.height);
      this._shadow = c;
    }
    return this._shadow;
  }
  // footprint (union of all slices) as black silhouette, w x h
  get footprint() {
    if (!this._fp) {
      const c = document.createElement('canvas');
      c.width = this.w; c.height = this.h;
      const x = c.getContext('2d');
      for (let i = 0; i < this.count; i += Math.max(1, Math.floor(this.count / 6))) x.drawImage(this.img, i * this.w, 0, this.w, this.h, 0, 0, this.w, this.h);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = '#000';
      x.fillRect(0, 0, c.width, c.height);
      this._fp = c;
    }
    return this._fp;
  }
  /**
   * Draw with perspective.
   * opts: scale (size multiplier), z (base height m), img (alternate strip, e.g. animation frame), alpha,
   *       slices: [from, to) range, flat: true -> ignore perspective (UI), lean: extra per-slice offset fn
   */
  draw(ctx, cam, x, y, heading, opts = {}) {
    const img = opts.img || this.img;
    const scale = opts.scale || 1;
    const z0 = opts.z || 0;
    const w = this.w, h = this.h;
    const rot = heading - Math.PI / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const zoom = cam.zoom;
    const dxw = (x - cam.x - cam.shakeX) * zoom, dyw = (y - cam.y - cam.shakeY) * zoom;
    const cx = cam.W * 0.5, cy = cam.H * 0.5;
    const D = cam.D;
    const sh = this.sliceH * (opts.vscale ?? scale);
    const kBase = this.px * scale * zoom;
    const from = opts.from || 0, to = opts.to || this.count;
    // Filtered tree crowns use the full slice so mipmapping and texture edges
    // sample exactly the same source neighbourhood at every zoom.
    const metadata = img.stackSliceBounds;
    const bounds = metadata && metadata.length === this.count * 4 && !ctx.imageSmoothingEnabled ? metadata : null;
    // Perspective expands the entire base rectangle out from the screen centre.
    // A rectangle wholly beyond an edge at ground level stays outside at every height.
    const halfW = (Math.abs(cos) * w + Math.abs(sin) * h) * kBase / 2;
    const halfH = (Math.abs(sin) * w + Math.abs(cos) * h) * kBase / 2;
    if (Math.abs(dxw) - halfW > cx + 1 || Math.abs(dyw) - halfH > cy + 1) return;
    // All slices share a heading. Work in that rotated coordinate system so the
    // canvas only changes its transform once for the whole stack.
    const localX = cos * dxw + sin * dyw, localY = cos * dyw - sin * dxw;
    ctx.setTransform(cos, sin, -sin, cos, cx + dxw, cy + dyw);
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    const rDist = Math.hypot(dxw, dyw);
    let prevS = -1;
    const step = opts.step || 1; // level of detail: skip slices when tiny on screen (top slice always drawn)
    for (let j = from; j < to + step - 1; j += step) {
      const i = Math.min(j, to - 1);
      if (j > from && i === to - 1 && j - step === to - 1) break;
      const hh = z0 + (i + 0.5) * sh;
      const s = D / (D - cam.ch(hh));
      // fill gaps if consecutive slices separate by more than ~1 px
      let sub = 1;
      if (prevS > 0) {
        const gap = rDist * (s - prevS);
        if (gap > 1.1) sub = Math.min(4, Math.ceil(gap));
      }
      const box = i * 4;
      const sw = bounds ? bounds[box + 2] : w;
      if (!sw) { prevS = s; continue; }
      const srcLeft = bounds ? bounds[box] : 0, srcTop = bounds ? bounds[box + 1] : 0;
      const srcHeight = bounds ? bounds[box + 3] : h;
      const xOffset = (srcLeft - w * 0.5) * kBase, yOffset = (srcTop - h * 0.5) * kBase;
      const baseW = sw * kBase, baseH = srcHeight * kBase;
      for (let k = sub - 1; k >= 0; k--) {
        const ss = k === 0 ? s : prevS + (s - prevS) * (1 - k / sub);
        ctx.drawImage(img, i * w + srcLeft, srcTop, sw, srcHeight,
          localX * (ss - 1) + xOffset * ss, localY * (ss - 1) + yOffset * ss, baseW * ss, baseH * ss);
      }
      prevS = s;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (opts.alpha != null) ctx.globalAlpha = 1;
  }
  // ground shadow projected along (sx, sy) per metre of height, drawn opaque into a shadow layer
  drawShadow(sctx, cam, x, y, heading, sunX, sunY, opts = {}) {
    const scale = opts.scale || 1;
    const rot = heading - Math.PI / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const zoom = cam.zoom;
    const k = this.px * scale * zoom;
    const steps = Math.min(5, Math.max(1, Math.round(this.height * scale / 1.5)));
    const z0 = opts.z || 0;
    const ox = cam.W * 0.5 + (x + sunX * z0 - cam.x - cam.shakeX) * zoom;
    const oy = cam.H * 0.5 + (y + sunY * z0 - cam.y - cam.shakeY) * zoom;
    const endX = sunX * this.height * scale * 0.9 * zoom, endY = sunY * this.height * scale * 0.9 * zoom;
    const halfW = (Math.abs(cos) * this.w + Math.abs(sin) * this.h) * k / 2 + 1;
    const halfH = (Math.abs(sin) * this.w + Math.abs(cos) * this.h) * k / 2 + 1;
    if (ox + Math.max(0, endX) < -halfW || ox + Math.min(0, endX) > cam.W + halfW ||
        oy + Math.max(0, endY) < -halfH || oy + Math.min(0, endY) > cam.H + halfH) return;
    const fp = this.footprint;
    sctx.setTransform(cos * k, sin * k, -sin * k, cos * k, ox, oy);
    const reach = this.height * scale * 0.9 * zoom / (k * steps);
    const dx = (cos * sunX + sin * sunY) * reach;
    const dy = (cos * sunY - sin * sunX) * reach;
    for (let i = 0; i <= steps; i++) {
      sctx.drawImage(fp, dx * i - this.w / 2, dy * i - this.h / 2);
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // flat preview draw (for menus/UI): classic sprite stack with squash
  drawPreview(ctx, sx, sy, heading, k, squash = 0.75, spacing = 1) {
    const rot = heading - Math.PI / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    for (let i = 0; i < this.count; i++) {
      ctx.setTransform(cos * k, sin * k * squash, -sin * k, cos * k * squash, sx, sy - i * spacing * k * (this.sliceH / this.px));
      ctx.drawImage(this.img, i * this.w, 0, this.w, this.h, -this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// Recolour a strip by exact colour replacement (vehicle paint variants)
export function recolourStrip(img, fromCols, toCols) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.stackSliceBounds = img.stackSliceBounds; // Repainting preserves the source alpha channel.
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  if (!fromCols || !fromCols.length) return c;
  const d = x.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  const map = new Map();
  fromCols.forEach((f, i) => map.set((f[0] << 16) | (f[1] << 8) | f[2], toCols[Math.min(i, toCols.length - 1)]));
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0) continue;
    const t = map.get((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
    if (t) { a[i] = t[0]; a[i + 1] = t[1]; a[i + 2] = t[2]; }
  }
  x.putImageData(d, 0, 0);
  return c;
}

// Make a paint ramp (dark->light) of n shades around a base colour
export function paintRamp(base, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const f = 0.55 + t * 0.75;
    out.push([Math.min(255, base[0] * f + t * 18), Math.min(255, base[1] * f + t * 14), Math.min(255, base[2] * f + t * 10)].map(Math.round));
  }
  return out;
}

// Procedural placeholder stack (box with roof) — used until assets load / for fallbacks
export function makeBoxStack(wPx, hPx, count, body, roof) {
  const c = document.createElement('canvas');
  c.width = wPx * count; c.height = hPx;
  const x = c.getContext('2d');
  for (let i = 0; i < count; i++) {
    const t = i / count;
    x.fillStyle = t > 0.55 ? roof : body;
    const inset = t > 0.55 ? 2 : 0;
    x.fillRect(i * wPx + inset, inset + (t > 0.55 ? 4 : 0), wPx - inset * 2, hPx - inset * 2 - (t > 0.55 ? 8 : 0));
    if (i < 3) { x.fillStyle = '#111'; x.fillRect(i * wPx, 3, wPx, 4); x.fillRect(i * wPx, hPx - 7, wPx, 4); }
  }
  return c;
}
