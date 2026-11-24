// Overhead camera with GTA-1-style perspective: points at height h are pushed
// away from the screen centre by D / (D - h). Heights are softly compressed so
// skyscrapers stay on screen.
import { smooth, clamp } from './math.js';
import { settings } from './settings.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;          // world centre (m)
    this.viewH = 55;                  // metres visible vertically
    this.targetViewH = 55;
    this.W = 854; this.H = 480;       // internal resolution
    this.zoom = this.H / this.viewH;  // px per metre
    this.D = 70;                      // camera height (m)
    this.Hc = 38;                     // height compression scale
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.leadX = 0; this.leadY = 0;
    this.persp = 1;
  }
  resize(W, H) { this.W = W; this.H = H; this.updateDerived(); }
  updateDerived() {
    this.zoom = this.H / this.viewH;
    const p = settings.get('perspective') ?? 1;
    this.persp = p;
    this.D = this.viewH * 1.3 / p;
    this.Hc = this.D * 0.44;
  }
  follow(tx, ty, vx, vy, speed, dt, mode = 'foot') {
    const lead = settings.get('cameraLead') ? 1 : 0;
    const k = mode === 'foot' ? 0.0 : 0.85;
    const lx = vx * k * lead, ly = vy * k * lead;
    this.leadX = smooth(this.leadX, clamp(lx, -40, 40), 2.2, dt);
    this.leadY = smooth(this.leadY, clamp(ly, -40, 40), 2.2, dt);
    const dd = settings.get('drawDistance') ?? 1;
    let want;
    if (mode === 'foot') want = 46;
    else if (mode === 'heli') want = 140 + dd * 20;
    else want = 54 + clamp(speed, 0, 60) * (0.9 + dd * 0.2);
    const aspect = this.W / this.H;
    if (aspect < 1) want *= Math.min(1.8, Math.max(1, 0.8 / aspect));
    if (this.zoomBias) want *= this.zoomBias;
    this.targetViewH = want;
    this.viewH = smooth(this.viewH, this.targetViewH, want > this.viewH ? 1.4 : 0.9, dt);
    const horizontalLead = this.viewH * aspect * 0.32;
    this.x = tx + (aspect < 1 ? clamp(this.leadX, -horizontalLead, horizontalLead) : this.leadX);
    this.y = ty + this.leadY;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = settings.get('screenShake') ? this.shake : 0;
      this.shakeX = (Math.random() - 0.5) * s * 1.6;
      this.shakeY = (Math.random() - 0.5) * s * 1.6;
    } else { this.shakeX = this.shakeY = 0; }
    this.updateDerived();
  }
  addShake(v) { this.shake = Math.min(2.5, this.shake + v); }
  // compressed visual height
  ch(h) { return h <= 0 ? 0 : this.Hc * (1 - Math.exp(-h / this.Hc)); }
  // perspective factor for a visual height (already compressed)
  pf(he) { return this.D / (this.D - he); }
  // world -> screen (h in real metres)
  toScreen(x, y, h = 0, out = [0, 0]) {
    const s = h > 0 ? this.D / (this.D - this.ch(h)) : 1;
    out[0] = this.W * 0.5 + ((x - this.x - this.shakeX) * this.zoom) * s;
    out[1] = this.H * 0.5 + ((y - this.y - this.shakeY) * this.zoom) * s;
    return out;
  }
  toWorld(sx, sy, out = [0, 0]) {
    out[0] = (sx - this.W * 0.5) / this.zoom + this.x + this.shakeX;
    out[1] = (sy - this.H * 0.5) / this.zoom + this.y + this.shakeY;
    return out;
  }
  // world-space view rect (ground), padded
  viewRect(pad = 0) {
    const hw = this.W * 0.5 / this.zoom + pad, hh = this.H * 0.5 / this.zoom + pad;
    return [this.x - hw, this.y - hh, this.x + hw, this.y + hh];
  }
}
