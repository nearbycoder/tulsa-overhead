// Raised roads drawn in perspective: overpass decks on piers, bridge fascias, earth embankments
// under on-ramps, guard rails, lane markings and the deck's shadow on the ground below.
// Heights come from tools/road_levels.py (road.z, metres per vertex).
import { F } from '../world/shared.js';
import { makeTexture, COL } from './ground.js';
import { laneStripes } from '../game/roads.js';

const A = [0, 0], B = [0, 0], C = [0, 0], D = [0, 0];
const CHUNK = 3; // segments per drawable (keeps painter sorting fine-grained)
const LIGHT = (() => { const x = -0.55, y = -0.83, n = Math.hypot(x, y); return [x / n, y / n]; })();

// the same asphalt texture as the ground roads, so a ramp has no seam where it leaves the ground
let PAT = null;
function deckPattern(ctx) {
  if (PAT) return PAT;
  const fine = { size: 256, oct: [[16, 0.35], [128, 0.65]], amp: 0.07, speck: 0.08, speckAmp: 0.2, speckLight: 0.6 };
  const smooth = { oct: [[16, 1]], amp: 0.04 };
  const mk = (col, o, seed) => ctx.createPattern(makeTexture(col, o, seed), 'repeat');
  PAT = { hi: { fine: mk(COL.asphaltHi, fine, 19), smooth: mk(COL.asphaltHi, smooth, 19) }, lo: { fine: mk(COL.asphalt, fine, 18), smooth: mk(COL.asphalt, smooth, 18) } };
  for (const [material, seed] of [['concrete', 33], ['brick', 34], ['pavers', 35]]) {
    PAT[material] = { fine: mk(COL[material], fine, seed), smooth: mk(COL[material], smooth, seed) };
  }
  return PAT;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.min(255, ((n >> 16) & 255) * f) | 0},${Math.min(255, ((n >> 8) & 255) * f) | 0},${Math.min(255, (n & 255) * f) | 0})`;
}

// per-road geometry, cached: left/right edge points for every vertex
function edgesOf(road) {
  if (road._deck) return road._deck;
  const p = road.pts, n = p.length >> 1, hw = road.w / 2;
  const L = new Float32Array(n * 2), R = new Float32Array(n * 2), acc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let tx = p[i1 * 2] - p[i0 * 2], ty = p[i1 * 2 + 1] - p[i0 * 2 + 1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    L[i * 2] = p[i * 2] + nx * hw; L[i * 2 + 1] = p[i * 2 + 1] + ny * hw;
    R[i * 2] = p[i * 2] - nx * hw; R[i * 2 + 1] = p[i * 2 + 1] - ny * hw;
    if (i) acc[i] = acc[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
  }
  road._deck = { L, R, acc, bridge: !!(road.flags & F.BRIDGE) };
  return road._deck;
}

// add every raised chunk in view to the painter list
export function addDecks(renderer, world, cam, game, x0, y0, x1, y1) {
  const focus = game.player ? { x: game.player.x, y: game.player.y, z: game.player.vehicle ? (game.player.vehicle.z || 0) : (game.player.ped.z || 0) } : null;
  world.forEachInRect('decks', x0 - 20, y0 - 20, x1 + 20, y1 + 20, (road) => {
    if (road.zmax < 0.3 || road.dead) return;
    const z = road.z, n = road.pts.length >> 1;
    for (let a = 0; a < n - 1; a += CHUNK) {
      const b = Math.min(n - 1, a + CHUNK);
      let zmax = 0, zsum = 0;
      for (let i = a; i <= b; i++) { zmax = Math.max(zmax, z[i]); zsum += z[i]; }
      if (zmax < 0.3) continue;
      const p = road.pts;
      const mx = (p[a * 2] + p[b * 2]) / 2, my = (p[a * 2 + 1] + p[b * 2 + 1]) / 2;
      if (mx < x0 - 30 || mx > x1 + 30 || my < y0 - 30 || my > y1 + 30) continue;
      const zavg = zsum / (b - a + 1);
      const r = Math.hypot(p[b * 2] - p[a * 2], p[b * 2 + 1] - p[a * 2 + 1]) / 2 + road.w / 2;
      renderer.add(mx, my, r, (ctx, c) => drawChunk(ctx, c, road, a, b, game, focus), (s, c, sx, sy) => shadowChunk(s, c, road, a, b, sx, sy), zavg * 2.5 + 0.5);
    }
  });
}

function drawChunk(ctx, cam, road, a, b, game, focus) {
  const g = edgesOf(road), z = road.z, L = g.L, R = g.R;
  const night = game.renderer ? game.renderer.night : 0;
  const nf = 1 - night * 0.25;
  const ox = cam.x, oy = cam.y, zoom = cam.zoom;
  // fade a deck that hides the player underneath it
  let faded = false;
  if (focus) {
    let zmin = Infinity;
    for (let i = a; i <= b; i++) zmin = Math.min(zmin, z[i]);
    if (focus.z < zmin - 2) {
      const f = cam.toScreen(focus.x, focus.y, 1, [0, 0]);
      let inside = false;
      const poly = [];
      for (let i = a; i <= b; i++) { cam.toScreen(L[i * 2], L[i * 2 + 1], z[i], A); poly.push(A[0], A[1]); }
      for (let i = b; i >= a; i--) { cam.toScreen(R[i * 2], R[i * 2 + 1], z[i], A); poly.push(A[0], A[1]); }
      const k = poly.length >> 1;
      for (let i = 0, j = k - 1; i < k; j = i++) {
        const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
        if ((yi > f[1]) !== (yj > f[1]) && f[0] < ((xj - xi) * (f[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) { faded = true; ctx.globalAlpha = 0.6; }
    }
  }
  const bridge = g.bridge || road.zmax > 4.5 && isSpan(road, a, b);
  // 1) piers under bridge spans
  if (bridge) {
    const spacing = 24;
    ctx.lineCap = 'butt';
    for (let i = a; i < b; i++) {
      const s0 = g.acc[i], s1 = g.acc[i + 1];
      for (let s = Math.ceil(s0 / spacing) * spacing; s < s1; s += spacing) {
        const t = (s - s0) / (s1 - s0 || 1);
        const zt = z[i] + (z[i + 1] - z[i]) * t;
        if (zt < 3) continue;
        for (const E of [L, R]) {
          const x = E[i * 2] + (E[i * 2 + 2] - E[i * 2]) * t, y = E[i * 2 + 1] + (E[i * 2 + 3] - E[i * 2 + 1]) * t;
          const cx = road.pts[i * 2] + (road.pts[i * 2 + 2] - road.pts[i * 2]) * t, cy = road.pts[i * 2 + 1] + (road.pts[i * 2 + 3] - road.pts[i * 2 + 1]) * t;
          const px = cx + (x - cx) * 0.6, py = cy + (y - cy) * 0.6;
          cam.toScreen(px, py, 0, A); cam.toScreen(px, py, zt - 1.0, B);
          ctx.strokeStyle = shade('#8d8a84', 0.78 * nf); ctx.lineWidth = Math.max(2, zoom * 1.1);
          ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
        }
      }
    }
  }
  // 2) side faces that face away from the screen centre (like building walls)
  for (const side of [1, -1]) {
    const E = side > 0 ? L : R;
    for (let i = a; i < b; i++) {
      const ex = E[i * 2 + 2] - E[i * 2], ey = E[i * 2 + 3] - E[i * 2 + 1];
      const nx = side > 0 ? -ey : ey, ny = side > 0 ? ex : -ex; // outward
      const mx = (E[i * 2] + E[i * 2 + 2]) / 2 - ox, my = (E[i * 2 + 1] + E[i * 2 + 3]) / 2 - oy;
      if (nx * mx + ny * my <= 0) continue;
      const lit = (nx * LIGHT[0] + ny * LIGHT[1]) / (Math.hypot(nx, ny) || 1);
      const z0 = z[i], z1 = z[i + 1];
      if (z0 < 0.05 && z1 < 0.05) continue;
      // bridges: a concrete fascia band; embankments: an earth slope down to the ground
      const bot0 = bridge ? Math.max(0, z0 - 1.1) : 0, bot1 = bridge ? Math.max(0, z1 - 1.1) : 0;
      cam.toScreen(E[i * 2], E[i * 2 + 1], bot0, A); cam.toScreen(E[i * 2 + 2], E[i * 2 + 3], bot1, B);
      cam.toScreen(E[i * 2 + 2], E[i * 2 + 3], z1 + 0.8, C); cam.toScreen(E[i * 2], E[i * 2 + 1], z0 + 0.8, D);
      ctx.fillStyle = shade(bridge ? '#a9a59c' : '#6f7a4a', (0.66 + 0.3 * Math.max(-0.3, lit)) * nf);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill();
      if (!bridge) {
        // concrete barrier strip on top of the embankment
        cam.toScreen(E[i * 2], E[i * 2 + 1], z0, A); cam.toScreen(E[i * 2 + 2], E[i * 2 + 3], z1, B);
        ctx.fillStyle = shade('#b9b5ab', (0.7 + 0.25 * Math.max(-0.3, lit)) * nf);
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill();
      }
    }
  }
  // 3) deck surface: textured asphalt, scaled for the deck's height so it lines up with the ground roads
  {
    let zs = 0; for (let i = a; i <= b; i++) zs += z[i];
    const sc = cam.D / (cam.D - cam.ch(zs / (b - a + 1))), k = zoom * sc, close = zoom >= 12, tex = close ? 0.05 : 0.3;
    const pavement = road.material || (road.cls <= 1 || road.cls === 10 || road.cls === 11 ? 'hi' : 'lo');
    const pat = deckPattern(ctx)[pavement][close ? 'fine' : 'smooth'];
    pat.setTransform(new DOMMatrix([tex * k, 0, 0, tex * k, cam.W * 0.5 - (cam.x + cam.shakeX) * k, cam.H * 0.5 - (cam.y + cam.shakeY) * k]));
    ctx.fillStyle = pat;
  }
  ctx.beginPath();
  for (let i = a; i <= b; i++) { cam.toScreen(L[i * 2], L[i * 2 + 1], z[i], A); if (i === a) ctx.moveTo(A[0], A[1]); else ctx.lineTo(A[0], A[1]); }
  for (let i = b; i >= a; i--) { cam.toScreen(R[i * 2], R[i * 2 + 1], z[i], A); ctx.lineTo(A[0], A[1]); }
  ctx.closePath(); ctx.fill();
  // 4) markings: white edge lines, dashed lane lines, yellow centre on two-way roads
  if (zoom > 2.2) {
    const p = road.pts, hw = road.w / 2;
    const line = (off, col, w, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, zoom * w);
      ctx.setLineDash(dash ? [zoom * 3, zoom * 9] : []);
      if (dash) ctx.lineDashOffset = -g.acc[a] * zoom;
      ctx.beginPath();
      for (let i = a; i <= b; i++) {
        const fx = (L[i * 2] - p[i * 2]) / hw, fy = (L[i * 2 + 1] - p[i * 2 + 1]) / hw;
        cam.toScreen(p[i * 2] + fx * off, p[i * 2 + 1] + fy * off, z[i] + 0.02, A);
        if (i === a) ctx.moveTo(A[0], A[1]); else ctx.lineTo(A[0], A[1]);
      }
      ctx.stroke();
    };
    const white = `rgba(232,230,220,${0.85 * nf})`;
    for (const stripe of laneStripes(road)) {
      line(stripe.offset, stripe.yellow ? `rgba(226,185,59,${0.9 * nf})` : white, 0.14, stripe.dash);
    }
    ctx.setLineDash([]);
  }
  // 5) guard rails / parapets along both edges
  ctx.strokeStyle = shade(bridge ? '#d2cec4' : '#c4c0b6', nf); ctx.lineWidth = Math.max(1, zoom * 0.3);
  for (const E of [L, R]) {
    ctx.beginPath();
    for (let i = a; i <= b; i++) { cam.toScreen(E[i * 2], E[i * 2 + 1], z[i] + 0.85, A); if (i === a) ctx.moveTo(A[0], A[1]); else ctx.lineTo(A[0], A[1]); }
    ctx.stroke();
  }
  if (faded) ctx.globalAlpha = 1;
}

// a stretch counts as a bridge span when it is well clear of the ground on both ends
function isSpan(road, a, b) {
  for (let i = a; i <= b; i++) if (road.z[i] < 4.5) return false;
  return true;
}

function shadowChunk(sctx, cam, road, a, b, sx, sy) {
  const g = edgesOf(road), z = road.z, L = g.L, R = g.R;
  sctx.beginPath();
  for (let i = a; i <= b; i++) { cam.toScreen(L[i * 2] + sx * z[i], L[i * 2 + 1] + sy * z[i], 0, A); if (i === a) sctx.moveTo(A[0], A[1]); else sctx.lineTo(A[0], A[1]); }
  for (let i = b; i >= a; i--) { cam.toScreen(R[i * 2] + sx * z[i], R[i * 2 + 1] + sy * z[i], 0, A); sctx.lineTo(A[0], A[1]); }
  sctx.closePath(); sctx.fill();
}
