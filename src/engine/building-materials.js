// Transparent material tiles preserve the mapped roof color and the lighting of each slope.
// One pattern per material is shared by every building on a canvas.
const patterns = new WeakMap();
const SIZE = 96;
export const ROOF_MATERIAL_PERIOD = { shingle: 3.6, metal: 4.8, membrane: 8 };

const tiles = new Map();

export function materialTile(kind) {
  if (tiles.has(kind)) return tiles.get(kind);
  const tile = document.createElement('canvas');
  tile.width = tile.height = SIZE;
  const g = tile.getContext('2d');
  let seed = 807;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  if (kind === 'shingle') {
    for (let row = 0; row < 8; row++) {
      const y = row * 12, offset = (row % 2) * 8;
      for (let x = -offset; x < SIZE; x += 16) {
        g.fillStyle = 'rgba(255,246,225,' + (random() * 0.10) + ')';
        g.fillRect(x, y, 16, 12);
        g.fillStyle = 'rgba(10,14,20,0.24)';
        g.fillRect(x, y + 4, 1.5, 8);
      }
      g.fillStyle = 'rgba(12,16,21,0.26)'; g.fillRect(0, y + 10, SIZE, 2);
      g.fillStyle = 'rgba(250,240,221,0.08)'; g.fillRect(0, y, SIZE, 1.5);
    }
  } else if (kind === 'metal') {
    for (let x = 0; x < SIZE; x += 12) {
      g.fillStyle = 'rgba(18,27,36,0.22)'; g.fillRect(x, 0, 2.2, SIZE);
      g.fillStyle = 'rgba(255,255,248,0.23)'; g.fillRect(x + 2.2, 0, 1.6, SIZE);
    }
  } else if (kind === 'brick') {
    for (let row = 0; row < 12; row++) {
      const y = row * 8;
      g.fillStyle = 'rgba(235,222,195,0.29)'; g.fillRect(0, y, SIZE, 1.5);
      for (let x = (row % 2) * -12; x < SIZE; x += 24) {
        g.fillStyle = 'rgba(15,10,12,' + random() * 0.14 + ')'; g.fillRect(x, y + 1.5, 24, 6.5);
        g.fillStyle = 'rgba(235,222,195,0.26)'; g.fillRect(x, y + 1.5, 1.6, 6.5);
      }
    }
  } else if (kind === 'siding') {
    for (let y = 0; y < SIZE; y += 12) {
      g.fillStyle = 'rgba(12,15,20,0.22)'; g.fillRect(0, y, SIZE, 2);
      g.fillStyle = 'rgba(250,246,230,0.15)'; g.fillRect(0, y + 2, SIZE, 2);
    }
  } else {
    for (let y = 0; y < SIZE; y += 24) {
      g.fillStyle = 'rgba(32,35,32,0.10)'; g.fillRect(0, y, SIZE, 1.3);
      g.fillRect((y * 3) % SIZE, y, 1, 24);
      g.fillStyle = 'rgba(255,255,248,0.11)'; g.fillRect(0, y + 1.3, SIZE, 1.2);
    }
  }
  for (let i = 0; i < 640; i++) {
    g.fillStyle = i % 2 ? 'rgba(8,12,14,0.065)' : 'rgba(255,250,234,0.065)';
    g.fillRect(Math.floor(random() * SIZE), Math.floor(random() * SIZE), 1, 1);
  }
  tiles.set(kind, tile);
  return tile;
}

function materialPattern(ctx, kind) {
  let cache = patterns.get(ctx);
  if (!cache) { cache = {}; patterns.set(ctx, cache); }
  return cache[kind] ||= ctx.createPattern(materialTile(kind), 'repeat');
}

// Paint the current roof path. U follows the eave, V climbs the facet at the given slope.
// The projected surface tangents keep the pattern attached to the building while driving.
export function paintRoofMaterial(ctx, cam, kind, x, y, h, ux, uy, slope = 0) {
  if (cam.zoom < (kind === 'shingle' ? 5 : 3)) return;
  const pat = materialPattern(ctx, kind);
  const pf = cam.pf(cam.ch(h));
  const scale = cam.zoom * pf, ox = x - cam.x - cam.shakeX, oy = y - cam.y - cam.shakeY;
  const dz = pf * Math.exp(-h / cam.Hc) * slope / cam.D;
  const step = scale * ROOF_MATERIAL_PERIOD[kind] / SIZE;
  const tilt = 1 / Math.hypot(1, slope);
  pat.setTransform({
    a: step * ux, b: step * uy,
    c: step * (-uy + ox * dz) * tilt, d: step * (ux + oy * dz) * tilt,
    e: cam.W * 0.5 + ox * scale, f: cam.H * 0.5 + oy * scale,
  });
  ctx.fillStyle = pat;
  ctx.fill();
}

// This path is the visible wall. Its physical height maps to the short screen-space
// extrusion between the footprint and eave, so bricks and lap siding turn with the wall.
export function paintWallMaterial(ctx, kind, ax, ay, bx, by, topX, topY, width, height) {
  const pattern = materialPattern(ctx, kind);
  const metres = kind === 'brick' ? 1.7 : kind === 'metal' ? 4.8 : 2.2;
  const u = metres / (SIZE * width), v = metres / (SIZE * height);
  pattern.setTransform({ a: (bx - ax) * u, b: (by - ay) * u,
    c: (topX - ax) * v, d: (topY - ay) * v, e: ax, f: ay });
  ctx.fillStyle = pattern;
  ctx.fill();
}
