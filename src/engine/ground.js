// Ground layer: renders 64 m tiles of terrain/roads/markings into cached canvases.
import { REGION, MASK_M, MASK_N, S, RC, F, curbWalk } from '../world/shared.js';
import { settings } from './settings.js';
import { SurfaceMaterials } from './surface-materials.js';
import { hash2, mulberry32 } from './math.js';
import { cum, laneOffset, laneStripes, lanesPerDir, pointAt } from '../game/roads.js';

export const TILE_M = 64;
const LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const CACHE_MIB = [16, 48, 104, 176];
const MAX_DENSITY = [8, 16, 32, 64];
const DETAIL_IMAGES = [0, 5, 9, 12];
const COMPACT_FEATHER_M = 24;
const GRASS_SURFACES = new Set([S.LAWN, S.PARK, S.PITCH, S.GOLF, S.CEMETERY, S.FARM]);
// Small cells at street scale avoid baking a 4096² surface just to draw one corner.
const tileSpan = gpm => gpm >= 24 ? TILE_M / 2 : TILE_M;

export const COL = {
  ground: '#7d8f4e', groundOut: '#59603f', farmA: '#8f9b55', farmB: '#7f8b4a', farmRedA: '#9a5c3d', farmRedB: '#87503a',
  lawn: '#6c9447', park: '#5e9744', forest: '#3d6631', golf: '#72b04e', pitch: '#5aa246', cemetery: '#6a9050',
  wetland: '#56744a', dirt: '#a9744d', lot: '#a19c92', parking: '#4b4b50', water: '#2e5d88', waterEdge: '#24496b',
  pool: '#4fb7dc', runway: '#56565b', walk: '#b3aea3', curb: '#8f8a80', asphalt: '#515256', asphaltHi: '#595b5c',
  concrete: '#93918a', brick: '#936858', pavers: '#928777',
  dirtRoad: '#a3683f', rail: '#6c5a4c', railSteel: '#9a9aa2', creek: '#3d6c8f', lineWhite: '#e8e6dc', lineYellow: '#e2b93b',
  bridge: '#8d8a84', plaza: '#c2bcae', apron: '#77777c', sand: '#d2b98a', brownfield: '#8f7d5c',
};

// build_map AREA_KIND -> style
const AREA_STYLE = {
  1: 'farm', 2: 'ground', 3: 'park', 4: 'lawn', 5: 'lot', 6: 'lot', 7: 'forest', 8: 'park', 9: 'golf', 10: 'cemetery',
  11: 'pitch', 12: 'parking', 13: 'water', 14: 'sand', 15: 'wetland', 16: 'lot', 17: 'park', 18: 'pool', 19: 'apron',
  20: 'ground', 21: 'brownfield', 22: 'dirt', 23: 'dirt', 24: 'lawn', 25: 'lawn', 26: 'ground', 27: 'pitch', 28: 'dirt',
  29: 'farm', 30: 'lawn', 31: 'plaza',
};
const AREA_ORDER = [1, 2, 29, 23, 4, 26, 24, 25, 30, 5, 6, 16, 21, 22, 7, 20, 8, 17, 9, 10, 27, 11, 28, 31, 12, 19, 14, 15, 13, 18];
const AREA_RANK = new Map(AREA_ORDER.map((k, i) => [k, i]));
const ROAD_ORDER = [9, 8, 7, 6, 5, 14, 4, 13, 3, 12, 2, 11, 10, 1, 0, 16];
const ROAD_RANK = new Map(ROAD_ORDER.map((k, i) => [k, i]));

// the parts of a road that sit at ground level (height <= 0.3 m), as lightweight road-like objects
const RUNS = new WeakMap();
function groundRuns(r) {
  let runs = RUNS.get(r);
  if (runs) return runs;
  runs = [];
  const p = r.pts, z = r.z, n = p.length >> 1;
  let cur = null;
  for (let i = 0; i < n; i++) {
    const low = z[i] <= 0.3;
    if (low) { if (!cur) { cur = []; if (i > 0) cur.push(p[i * 2 - 2], p[i * 2 - 1]); } cur.push(p[i * 2], p[i * 2 + 1]); }
    else if (cur) { cur.push(p[i * 2], p[i * 2 + 1]); if (cur.length >= 4) runs.push(cur); cur = null; }
  }
  if (cur && cur.length >= 4) runs.push(cur);
  runs = runs.map(pts => {
    const starts = pts[0] === p[0] && pts[1] === p[1];
    const ends = pts.at(-2) === p.at(-2) && pts.at(-1) === p.at(-1);
    return { cls: r.cls, flags: r.flags, lanes: r.lanes, layer: r.layer, name: r.name, w: r.w, pts, bb: r.bb,
      walkSide: r.walkSide, sides: r.sides, split: r.split, material: r.material, back: starts && r.back, ahead: ends && r.ahead,
      node0: starts && r.node0, node1: ends && r.node1 };
  });
  RUNS.set(r, runs);
  return runs;
}

// Tileable multi-octave value noise texture with optional speckle (aggregate) and grass-blade strokes.
export function makeTexture(base, o, seed) {
  const size = o.size || 128;
  const r = mulberry32(seed);
  const n = parseInt(base.slice(1), 16);
  const br = (n >> 16) & 255, bg = (n >> 8) & 255, bb = n & 255;
  const v = new Float32Array(size * size);
  for (const [cells, w] of o.oct || [[8, 1]]) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = r() * 2 - 1;
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = iy % cells, y1 = (iy + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % cells, x1 = (ix + 1) % cells;
        const a = lat[y0 * cells + x0] + (lat[y0 * cells + x1] - lat[y0 * cells + x0]) * sx;
        const b = lat[y1 * cells + x0] + (lat[y1 * cells + x1] - lat[y1 * cells + x0]) * sx;
        v[y * size + x] += (a + (b - a) * sy) * w;
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const amp = o.amp ?? 0.08, warm = o.warm || 0;
  for (let i = 0; i < size * size; i++) {
    let f = 1 + v[i] * amp;
    if (o.speck && r() < o.speck) f += (r() < (o.speckLight ?? 0.5) ? 1 : -1) * (o.speckAmp ?? 0.18) * (0.5 + r());
    img.data[i * 4] = Math.max(0, Math.min(255, br * f + warm * v[i] * 12));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, bg * f));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, bb * f - warm * v[i] * 8));
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  if (o.blades) {
    // short grass blades, a few pixels long, lighter and darker than the turf
    for (let i = 0; i < o.blades; i++) {
      const px = r() * size, py = r() * size, a = -Math.PI / 2 + (r() - 0.5) * 1.2, L = 1.5 + r() * 2.5;
      const lt = r() < 0.55;
      x.strokeStyle = `rgba(${lt ? '200,230,150' : '20,45,10'},${0.12 + r() * 0.16})`;
      x.lineWidth = 0.7;
      for (const dx of [0, size, -size]) for (const dy of [0, size, -size]) {
        x.beginPath(); x.moveTo(px + dx, py + dy); x.lineTo(px + dx + Math.cos(a) * L, py + dy + Math.sin(a) * L); x.stroke();
      }
    }
  }
  return c;
}

// Both the offline atlas baker and the fallback use the same sizes, colours and noise.
export function groundPatternRecipes(hi) {
  const P = (base, texel, seed, options) => ({ base, texel, seed, options, size: options.size || 128 });
  const g = hi ? { size: 256, oct: [[16, 0.45], [64, 0.35]], amp: 0.09, blades: 2600, warm: 0.4 } : { size: 128, oct: [[8, 0.6], [32, 0.4]], amp: 0.06, warm: 0.4 };
  const turf = hi ? { size: 256, oct: [[32, 0.5], [128, 0.3]], amp: 0.05, blades: 1400 } : { oct: [[16, 1]], amp: 0.04 };
  const asph = hi ? { size: 256, oct: [[16, 0.35], [128, 0.65]], amp: 0.07, speck: 0.08, speckAmp: 0.2, speckLight: 0.6 } : { oct: [[16, 1]], amp: 0.04 };
  const conc = hi ? { size: 256, oct: [[8, 0.5], [64, 0.5]], amp: 0.04, speck: 0.03, speckAmp: 0.1 } : { oct: [[8, 1]], amp: 0.03 };
  const dirt = hi ? { size: 256, oct: [[16, 0.5], [64, 0.3], [256, 0.2]], amp: 0.12, speck: 0.05, speckAmp: 0.18, warm: 0.6 } : { oct: [[8, 0.6], [32, 0.4]], amp: 0.08, warm: 0.6 };
  const t = (fine, coarse) => (hi ? fine : coarse);
  return {
    surveyGrain: P('#808080', 0.065, 32, { oct: [[4, 0.3], [32, 0.4], [64, 0.5]], amp: 0.22, speck: 0.13, speckAmp: 0.22 }),
    ground: P(COL.ground, t(0.08, 0.4), 1, g), lawn: P(COL.lawn, t(0.07, 0.35), 2, g), park: P(COL.park, t(0.075, 0.38), 3, g),
    forest: P(COL.forest, t(0.12, 0.5), 4, hi ? { size: 256, oct: [[16, 0.5], [64, 0.4]], amp: 0.18, blades: 1200 } : { oct: [[8, 0.6], [32, 0.4]], amp: 0.14 }),
    golf: P(COL.golf, t(0.05, 0.3), 5, turf), pitch: P(COL.pitch, t(0.05, 0.3), 6, turf), cemetery: P(COL.cemetery, t(0.07, 0.35), 7, g),
    wetland: P(COL.wetland, t(0.09, 0.4), 8, hi ? { size: 256, oct: [[16, 0.6], [64, 0.4]], amp: 0.13, blades: 2000 } : { oct: [[8, 1]], amp: 0.1 }),
    dirt: P(COL.dirt, t(0.06, 0.3), 9, dirt), lot: P(COL.lot, t(0.05, 0.3), 10, conc), parking: P(COL.parking, t(0.05, 0.3), 11, asph),
    water: P(COL.water, 0.3, 12, { oct: [[4, 1], [16, 0.4]], amp: 0.05 }), pool: P(COL.pool, 0.1, 13, { oct: [[8, 1]], amp: 0.03 }),
    apron: P(COL.apron, t(0.06, 0.3), 14, conc), sand: P(COL.sand, t(0.05, 0.3), 15, { ...dirt, amp: 0.06 }), brownfield: P(COL.brownfield, t(0.07, 0.35), 16, dirt),
    plaza: P(COL.plaza, t(0.045, 0.3), 17, conc), asphalt: P(COL.asphalt, t(0.05, 0.3), 18, asph), asphaltHi: P(COL.asphaltHi, t(0.05, 0.3), 19, asph),
    concrete: P(COL.concrete, t(0.06, 0.3), 33, conc), brick: P(COL.brick, t(0.06, 0.3), 34, conc), pavers: P(COL.pavers, t(0.06, 0.3), 35, conc),
    walk: P(COL.walk, t(0.04, 0.3), 20, conc), dirtRoad: P(COL.dirtRoad, t(0.06, 0.3), 21, dirt),
    farm: P(COL.farmA, t(0.12, 0.5), 22, hi ? { size: 256, oct: [[8, 0.5], [32, 0.5]], amp: 0.07, blades: 900 } : { oct: [[8, 1]], amp: 0.05 }),
    farmRed: P(COL.farmRedA, t(0.1, 0.45), 23, dirt), groundOut: P(COL.groundOut, t(0.1, 0.45), 24, g),
  };
}

function makeNoise(base, amp, size = 32, seed = 1, speck = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const r = mulberry32(seed);
  const n = parseInt(base.slice(1), 16);
  const br = (n >> 16) & 255, bg = (n >> 8) & 255, bb = n & 255;
  for (let i = 0; i < size * size; i++) {
    let v = (r() - 0.5) * 2 * amp;
    if (speck && r() < speck) v += (r() - 0.5) * amp * 5;
    img.data[i * 4] = Math.max(0, Math.min(255, br * (1 + v)));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, bg * (1 + v)));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, bb * (1 + v)));
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export class Ground {
  constructor(world) {
    this.world = world;
    this.cache = new Map();
    this.reliefImages = new Map();
    this.photoMaterials = new SurfaceMaterials(world.base, () => {
      for (const tile of this.cache.values()) tile.stale = true;
    });
    this.frame = 0;
    this.cacheBytes = 0;
    this.quality = settings.get('terrainDetail') ?? 1;
    this.cacheBudget = CACHE_MIB[this.quality] * 1024 ** 2;
    this.level = 4;
    this.dirty = new Set();
    this.lawnCache = new Map();
    this.crossingsByTile = new Map();
    fetch(`${world.base}/crossings.json`).then(response => response.ok ? response.json() : []).then(rows => {
      for (const row of rows) {
        const [ax, ay, bx, by, width, style] = row;
        const crossing = [ax / 10, ay / 10, bx / 10, by / 10, width / 10, style];
        const pad = width / 20 + 1;
        const tx0 = Math.floor((Math.min(ax, bx) / 10 - pad) / TILE_M);
        const tx1 = Math.floor((Math.max(ax, bx) / 10 + pad) / TILE_M);
        const ty0 = Math.floor((Math.min(ay, by) / 10 - pad) / TILE_M);
        const ty1 = Math.floor((Math.max(ay, by) / 10 + pad) / TILE_M);
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const key = `${tx},${ty}`;
          if (!this.crossingsByTile.has(key)) this.crossingsByTile.set(key, []);
          this.crossingsByTile.get(key).push(crossing);
        }
      }
      for (const tile of this.cache.values()) tile.stale = true;
    }).catch(() => {});
    this.surveyTiles = new Map();
    this.surveyRegions = new Set();
    this.detailImages = new Map();
    this.detailRegions = new Map();
    this.fullRegions = new Map();
    this.fullIndexPending = true;
    this.loadCountyIndex();
    fetch(`${world.base}/ground/index.json`).then(response => response.json()).then(index => {
      this.surveyRegions = new Set(index.regions.map(([rx, ry]) => `${rx},${ry}`));
      for (const tile of this.cache.values()) tile.stale = true;
    }).catch(() => {}); // Older maps can use the vector terrain alone.
    fetch(`${world.base}/ground/detail/index.json`).then(response => response.json()).then(index => {
      this.detailSpan = index.span;
      this.detailRegions = new Map(index.regions.map(([rx, ry, mask]) => [`${rx},${ry}`, mask]));
      for (const tile of this.cache.values()) tile.stale = true;
    }).catch(() => {}); // The overview also works on its own.
    world.on('load', (r) => { this.lawnCache.clear(); this.invalidateAround(r); });
    world.on('unload', r => {
      for (const cache of [this.surveyTiles, this.detailImages]) {
        for (const [key, entry] of cache) if (entry.region === r.key) this.dropSurvey(cache, key);
      }
    });
  }

  async loadCountyIndex(retryDelay = 5000) {
    try {
      const response = await fetch(this.world.base + '/ground/full/index.json');
      if (response.status === 404) return; // Older installations may only have the metro survey.
      if (!response.ok) throw Error('County terrain index unavailable');
      const index = await response.json();
      this.fullSpan = index.span;
      this.nativeArea = index.nativeArea || 'all';
      this.fullOpaqueFormat = index.opaqueFormat || 'jpg';
      this.fullRegions = new Map(index.regions.map(row => [`${row[0]},${row[1]}`, row]));
    } catch {
      setTimeout(() => this.loadCountyIndex(Math.min(60000, retryDelay * 2)), retryDelay);
    } finally {
      this.fullIndexPending = false;
      for (const tile of this.cache.values()) tile.stale = true;
    }
  }

  initPatterns(ctx, fine) {
    const recipes = groundPatternRecipes(fine);
    const patterns = Object.fromEntries(Object.entries(recipes).map(([name, recipe]) => [name, recipe.base]));
    this.surveyGrain ??= patterns.surveyGrain;
    this.loadPatterns(ctx, fine, patterns, recipes);
    return patterns;
  }

  async loadPatterns(ctx, fine, patterns, recipes) {
    const tier = fine ? 'patsHi' : 'patsLo';
    const entries = Object.entries(recipes);
    const repeat = (source, texel) => {
      const pattern = ctx.createPattern(source, 'repeat');
      pattern.setTransform(new DOMMatrix().scale(texel));
      return pattern;
    };
    try {
      const response = await fetch(this.world.base + '/ground/patterns/' + (fine ? 'fine' : 'coarse') + '.bin');
      if (!response.ok) throw Error('No material pack');
      const pack = await response.blob();
      if (this[tier] !== patterns) return;
      const headerSize = 4 + entries.length * 4;
      const header = new DataView(await pack.slice(0, headerSize).arrayBuffer());
      if (header.getUint32(0) !== 0x47545031) throw Error('Invalid material pack');
      const ready = await Promise.all(entries.map(async ([name, recipe], i) => {
        const start = i ? header.getUint32(i*4, true) : headerSize;
        const end = header.getUint32(4 + i*4, true);
        if (end <= start || end > pack.size) throw Error('Invalid material range');
        const url = URL.createObjectURL(pack.slice(start, end, 'image/webp'));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (image.width !== recipe.size || image.height !== recipe.size) throw Error('Invalid material dimensions');
          return [name, repeat(image, recipe.texel)];
        } finally {
          URL.revokeObjectURL(url);
        }
      }));
      if (this[tier] !== patterns) return;
      Object.assign(patterns, Object.fromEntries(ready));
    } catch {
      // Legacy installs and a failed fetch keep their procedural materials.
      // Yield between textures so recovery still leaves time for input.
      for (const [name, recipe] of entries) {
        if (this[tier] !== patterns) return;
        patterns[name] = repeat(makeTexture(recipe.base, recipe.options, recipe.seed), recipe.texel);
        await new Promise(done => setTimeout(done, 0));
      }
    }
    if (this[tier] !== patterns) return;
    this.surveyGrain = patterns.surveyGrain;
    for (const tile of this.cache.values()) tile.stale = true;
  }

  invalidateAround(r) {
    // tiles near this region's border may have been drawn with missing neighbour data
    for (const [k, t] of this.cache) {
      const x0 = t.tx * t.span, y0 = t.ty * t.span;
      if (x0 + t.span >= r.ox - 120 && x0 <= r.ox + REGION + 120 && y0 + t.span >= r.oy - 120 && y0 <= r.oy + REGION + 120) t.stale = true;
    }
  }

  pickLevel(zoom) {
    zoom = Math.min(zoom, MAX_DENSITY[this.quality]);
    // Pick a close raster density while allowing a little hysteresis during acceleration.
    const cur = LEVELS[this.level];
    if (cur <= MAX_DENSITY[this.quality] && zoom * 0.98 <= cur && zoom * 1.55 > cur) return this.level;
    let i = LEVELS.findIndex((l) => l >= zoom * 0.98);
    if (i < 0) i = LEVELS.length - 1;
    this.level = i;
    return i;
  }

  releaseTile(key, keepCanvas = false) {
    const tile = this.cache.get(key);
    this.cacheBytes -= tile.canvas.width * tile.canvas.height * 4;
    this.cache.delete(key);
    if (typeof tile.canvas.close === 'function') {
      tile.canvas.close();
      return null;
    }
    if (!keepCanvas) tile.canvas.width = tile.canvas.height = 0;
    return tile;
  }

  // Reserve before allocation so switching from street to helicopter does not retain two large tile sets.
  reserve(bytes, visible) {
    while (this.cacheBytes + bytes > this.cacheBudget || this.cache.size >= 240) {
      let oldest, oldestKey;
      for (const [key, tile] of this.cache) {
        if (!visible.has(key) && (!oldest || tile.used < oldest.used)) {
          oldest = tile;
          oldestKey = key;
        }
      }
      if (!oldest) return false;
      // The new bake covers the entire surface with imagery or a vector base.
      // Reuse a matching eviction immediately without keeping a second pool.
      if (oldest.canvas.width * oldest.canvas.height * 4 === bytes) return this.releaseTile(oldestKey, true);
      this.releaseTile(oldestKey);
    }
    return null;
  }

  draw(ctx, cam, smoothing, budget = 3) {
    const quality = settings.get('terrainDetail') ?? 1;
    if (this.quality !== quality) {
      this.quality = quality;
      if (quality === 0) {
        this.patsHi = null;
        this.featherBuffers = null;
      }
      if (quality < 2) {
        for (const key of this.reliefImages.keys()) this.dropSurvey(this.reliefImages, key);
        this.photoMaterials.release();
      }
      this.cacheBudget = CACHE_MIB[quality] * 1024 ** 2;
      for (const key of this.cache.keys()) this.releaseTile(key);
      this.view = null;
      for (const cache of [this.detailImages, this.surveyTiles]) {
        for (const key of cache.keys()) this.dropSurvey(cache, key);
      }
    }
    this.frame++;
    let lvl = this.pickLevel(cam.zoom);
    const z = cam.zoom, width = cam.W/z, height = cam.H/z;
    const x0 = cam.x + cam.shakeX - width/2, y0 = cam.y + cam.shakeY - height/2;
    let gpm, span, bytes;
    do {
      gpm = LEVELS[lvl]; span = tileSpan(gpm); bytes = 4 * (gpm * span) ** 2;
      // Budget the largest number of cells this viewport can touch at any grid
      // alignment. Crossing a cell border at constant zoom must not change LOD.
      const cols = Math.ceil(width/span) + 1, rows = Math.ceil(height/span) + 1;
      if (cols * rows * bytes <= this.cacheBudget || lvl === 0) break;
      lvl--;
    } while (true);
    this.level = lvl;
    const tx0 = Math.floor(x0/span), tx1 = Math.ceil((x0+width)/span)-1;
    const ty0 = Math.floor(y0/span), ty1 = Math.ceil((y0+height)/span)-1;
    let view = this.view;
    if (!view || view.lvl !== lvl || view.tx0 !== tx0 || view.tx1 !== tx1 || view.ty0 !== ty0 || view.ty1 !== ty1) {
      view = this.view = { tx0, tx1, ty0, ty1, lvl, visible: new Set(), cells: [], pending: [] };
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${tx},${ty},${lvl}`;
        view.visible.add(key);
        view.cells.push({ tx, ty, key, tile: this.cache.get(key), distanceSquared: 0 });
      }
    }
    const { pending, visible } = view;
    pending.length = 0;
    for (const cell of view.cells) {
      if (cell.tile && !cell.tile.stale) continue;
      const dx = (cell.tx+0.5)*span-cam.x, dy = (cell.ty+0.5)*span-cam.y;
      cell.distanceSquared = dx*dx + dy*dy;
      pending.push(cell);
    }
    pending.sort((a, b) => a.distanceSquared - b.distanceSquared);
    let made = 0;
    const deadline = performance.now() + (this.quality >= 2 ? 7 : 4);
    for (const cell of pending) {
      if (made >= budget || (made > 0 && performance.now() > deadline)) break;
      if (!this.world.isLoadedAt((cell.tx+0.5)*span, (cell.ty+0.5)*span)) continue;
      const reuse = cell.tile || this.reserve(bytes, visible);
      if (reuse === false) break;
      const tile = this.renderTile(cell.tx, cell.ty, lvl, gpm, reuse, span);
      this.cache.set(cell.key, tile);
      if (!cell.tile) this.cacheBytes += bytes;
      cell.tile = tile;
      made++;
    }

    const ox = cam.W * 0.5 - (cam.x + cam.shakeX) * z, oy = cam.H * 0.5 - (cam.y + cam.shakeY) * z;
    // Compose in 32 m or 64 m cells. A lower-resolution parent or four higher-resolution
    // children can cover a missing cell while the new zoom level is being baked.
    const paint = (tile, x, y, side) => {
      const scale = tile.canvas.width / tile.span;
      const sx = Math.round(ox+x*z), sy = Math.round(oy+y*z);
      ctx.drawImage(tile.canvas, (x-tile.tx*tile.span)*scale, (y-tile.ty*tile.span)*scale,
        side*scale, side*scale, sx, sy, Math.round(ox+(x+side)*z)-sx, Math.round(oy+(y+side)*z)-sy);
      tile.used = this.frame;
    };
    ctx.imageSmoothingEnabled = smoothing;
    for (const { tx, ty, tile } of view.cells) {
      const x = tx*span, y = ty*span;
      if (tile) { paint(tile, x, y, span); continue; }
      for (let dy = 0; dy < span; dy += 32) for (let dx = 0; dx < span; dx += 32) {
        const wx = x+dx, wy = y+dy;
        let fallback;
        for (let l = LEVELS.length-1; l >= 0 && !fallback; l--) {
          const s = tileSpan(LEVELS[l]);
          fallback = this.cache.get(`${Math.floor(wx/s)},${Math.floor(wy/s)},${l}`);
        }
        if (fallback) { paint(fallback, wx, wy, 32); continue; }
        // The overview also covers newly exposed ground during fast flight or a quality change.
        ctx.save();
        ctx.setTransform(z, 0, 0, z, ox, oy);
        ctx.fillStyle = COL.ground;
        ctx.fillRect(wx, wy, 32, 32);
        this.drawSurvey(ctx, wx, wy, 0, 32);
        ctx.restore();
      }
    }
  }

  renderTile(tx, ty, lvl, gpm, reuse, span = TILE_M) {
    const px = Math.round(span * gpm);
    if (this.quality >= 2 && this.tileBaker === undefined) {
      this.tileBaker = null;
      if (typeof OffscreenCanvas === 'function' && OffscreenCanvas.prototype.transferToImageBitmap) {
        try {
          const baker = new OffscreenCanvas(1, 1);
          if (baker.getContext('2d')) this.tileBaker = baker;
        } catch { /* Canvas elements can still bake and display tiles. */ }
      }
    }
    let canvas = this.quality >= 2 && this.tileBaker;
    if (!canvas && reuse?.canvas.width === px && typeof reuse.canvas.close !== 'function') canvas = reuse.canvas;
    if (!canvas) canvas = document.createElement('canvas');
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    const c = canvas.getContext('2d');
    const x0 = tx * span, y0 = ty * span, x1 = x0 + span, y1 = y0 + span;
    c.setTransform(gpm, 0, 0, gpm, -x0 * gpm, -y0 * gpm);
    const W = this.world;
    const P = gpm >= 12 ? (this.patsHi ??= this.initPatterns(c, true)) : (this.patsLo ??= this.initPatterns(c, false));
    const materials = this.quality >= 2 && gpm >= 8 ? this.photoMaterials : null;
    materials?.prepare();
    const finish = (name, road, fallback = P[name]) => materials?.road(c, name, road, fallback) || fallback;
    const photo = this.surveyAt(x0, y0, gpm);
    const areas = [];
    W.forEachInRect('areas', x0, y0, x1, y1, area => {
      if (!photo?.opaque || area.k === 12) areas.push(area);
    });
    if (!photo?.opaque) this.drawVectorGround(c, x0, y0, span, gpm, areas, P);
    // Surveyed yard boundaries, driveways and paving under the vector roads and buildings.
    const surveyed = this.drawSurvey(c, x0, y0, gpm, span, photo);
    if (this.quality >= 2) this.drawRelief(c, x0, y0, span);
    const opaqueSurvey = this.quality >= 2 && photo?.opaque;
    const nativeSurface = opaqueSurvey && photo.span < REGION;
    if (surveyed) {
      // Parked vehicles in an aerial photograph would sit underneath playable
      // cars. Keep broad pavement tones inside mapped surface lots and leave
      // the modelled aisles, stalls and vehicles to the foreground.
      c.globalAlpha = 0.84;
      c.fillStyle = surveyed;
      for (const area of areas) {
        if (area.k !== 12) continue;
        c.beginPath();
        for (const ring of area.rings) addRing(c, ring);
        c.fill('evenodd');
      }
      c.globalAlpha = 1;
    }
    // ---- waterways
    const lines = [];
    W.forEachInRect('lines', x0, y0, x1, y1, (l) => { lines.push(l); });
    c.lineCap = 'round'; c.lineJoin = 'round';
    // Compact carries the photographed bank across the native-to-overview
    // boundary. Keep its mapped stream tint continuous through that transition.
    if (opaqueSurvey && (photo.span < REGION || this.nativeArea === 'towns')) c.globalAlpha = 0.22;
    for (const l of lines) {
      if (l.k === 2 || l.k === 4) { c.strokeStyle = P.water; c.lineWidth = l.w; strokePts(c, l.pts); }
      else if (l.k === 3 || l.k === 5) {
        c.strokeStyle = 'rgba(60,70,40,0.5)'; c.lineWidth = Math.max(l.w, 2.5) + 1.6; strokePts(c, l.pts);
        c.strokeStyle = COL.creek; c.lineWidth = Math.max(l.w, 2.5); strokePts(c, l.pts);
      }
    }
    c.globalAlpha = 1;
    // ---- runways
    for (const l of lines) {
      if (l.k === 6 || l.k === 7) {
        c.lineCap = 'butt';
        c.strokeStyle = P.apron; c.lineWidth = l.w; strokePts(c, l.pts);
        if (l.k === 6) {
          c.strokeStyle = COL.lineWhite; c.lineWidth = 0.9; c.setLineDash([30, 20]); strokePts(c, l.pts); c.setLineDash([]);
          c.lineWidth = 0.6; strokeOffset(c, l.pts, l.w / 2 - 1.5); strokeOffset(c, l.pts, -(l.w / 2 - 1.5));
        } else { c.strokeStyle = COL.lineYellow; c.lineWidth = 0.3; strokePts(c, l.pts); }
        c.lineCap = 'round';
      }
    }
    // ---- roads
    const roads = [];
    W.forEachInRect('roads', x0, y0, x1, y1, (r) => {
      if (r.flags & F.TUNNEL) return;
      if (!r.z) { roads.push(r); return; }
      // raised stretches are drawn as 3D decks each frame; only the at-grade parts go into the ground
      for (const run of groundRuns(r)) roads.push(run);
    });
    roads.sort((a, b) => ((a.flags & F.BRIDGE ? 100 : 0) + (ROAD_RANK.get(a.cls) ?? 0)) - ((b.flags & F.BRIDGE ? 100 : 0) + (ROAD_RANK.get(b.cls) ?? 0))
      || a.pts[0] - b.pts[0] || a.pts[1] - b.pts[1]);
    // Leave driveway cuts and actual verge widths legible in the imagery.
    // Unsurveyed streets use the full vector sidewalk and parkway treatment.
    c.globalAlpha = surveyed ? 0.35 : 1;
    // sidewalks
    c.lineCap = 'round';
    for (const r of roads) {
      if (!r.walkSide) r.walkSide = this.sidewalkFor(r);
      if (r.walkSide !== 1 || (r.flags & F.BRIDGE)) continue;
      if (r.sides) continue;
      c.strokeStyle = COL.curb; c.lineWidth = r.w + 7; strokePts(c, r.pts);
      c.strokeStyle = finish('walk', r); c.lineWidth = r.w + 6.4; strokePts(c, r.pts);
    }
    // parkway strips (residential)
    c.globalAlpha = surveyed ? 0.22 : 1;
    for (const r of roads) {
      if (r.walkSide !== 1 || (r.flags & F.BRIDGE)) continue;
      if (r.sides) continue;
      if (r.cls !== RC.RESIDENTIAL && r.cls !== RC.LIVING && r.cls !== RC.UNCLASSIFIED) continue;
      c.strokeStyle = P.lawn; c.lineWidth = r.w + 3.2; strokePts(c, r.pts);
    }
    c.globalAlpha = 1;
    // Roads tagged with a sidewalk on one side retain their actual verge. A
    // separately mapped sidewalk draws its own alignment, including corner returns.
    for (const r of roads) {
      if (r.sides && !(r.flags & F.BRIDGE)) for (let side = 0; side < 2; side++) {
        if (r.sides[side] !== 1 && !(r.sides[side] === null && r.walkSide === 1)) continue;
        const line = curbWalk(r, side ? 1 : -1);
        c.strokeStyle = finish('walk', r); c.lineWidth = 1.8; strokePts(c, line);
        if (gpm >= 5) pavementJoints(c, line, 0.9, 1.8, x0, y0);
      }
      if (r.cls !== RC.PATH) continue;
      if (r.sidewalk) {
        c.strokeStyle = 'rgba(92,89,77,0.48)'; c.lineWidth = r.w + 0.25; strokePts(c, r.pts);
        c.strokeStyle = finish(r.material || 'walk', r, P[r.material] || P.walk);
        c.lineWidth = r.w;
      } else {
        c.strokeStyle = finish(r.material || (r.flags & F.UNPAVED ? 'dirtRoad' : 'walk'), r,
          P[r.material] || (r.flags & F.UNPAVED ? '#a68a64' : '#bdb6a6'));
        c.lineWidth = 1.8;
      }
      strokePts(c, r.pts);
      if (r.sidewalk && gpm >= 5 && (!r.material || r.material === 'concrete')) {
        pavementJoints(c, r.pts, r.w / 2, 1.8, x0, y0);
      }
    }
    // bridge decks underlay
    for (const r of roads) {
      if (!(r.flags & F.BRIDGE) || r.cls === RC.PATH) continue;
      c.lineCap = 'butt';
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = r.w + 3.5; strokePts(c, r.pts, 0.8, 1.2);
      c.strokeStyle = COL.bridge; c.lineWidth = r.w + 2.0; strokePts(c, r.pts);
      c.lineCap = 'round';
    }
    // asphalt: all edges/casings first, then surfaces (bridges after ground roads)
    // Service lanes and dirt tracks have estimated widths. Keep their surveyed
    // verges visible where detailed photography covers the playable alignment.
    const softVerge = r => nativeSurface && !(r.flags & (F.BRIDGE | F.AISLE)) &&
      (r.cls === RC.SERVICE || r.cls === RC.TRACK);
    for (const pass of [0, 1]) {
      for (const r of roads) {
        if (r.cls === RC.PATH || (!!(r.flags & F.BRIDGE)) !== (pass === 1)) continue;
        if (pass === 0) {
          c.globalAlpha = softVerge(r) ? 0.14 : 1;
          c.strokeStyle = r.flags & F.UNPAVED ? 'rgba(90,50,30,0.5)' : 'rgba(30,30,32,0.9)';
          c.lineWidth = r.w + 0.5; strokePts(c, r.pts);
        }
      }
      for (const r of roads) {
        if (r.cls === RC.PATH || (!!(r.flags & F.BRIDGE)) !== (pass === 1)) continue;
        const unpaved = r.flags & F.UNPAVED;
        const blend = softVerge(r);
        c.globalAlpha = blend ? 0.38 : 1;
        const surface = unpaved ? 'dirtRoad' : r.material || (r.cls <= 1 || r.cls === 10 || r.cls === 11 ? 'asphaltHi' : 'asphalt');
        c.strokeStyle = finish(surface, r, P[surface] || P.asphalt);
        c.lineWidth = r.w;
        strokePts(c, r.pts);
        // Untagged asphalt gets local differences in pavement colour while
        // lane markings and vehicles remain independent of the photograph.
        if (surveyed && !unpaved && !r.material) {
          c.strokeStyle = surveyed; c.globalAlpha = blend ? 0.16 : 0.36;
          strokePts(c, r.pts); c.globalAlpha = 1;
        }
        c.globalAlpha = 1;
        if (r.material === 'concrete' && gpm >= 5) pavementJoints(c, r.pts, r.w / 2, 4.6, x0, y0);
      }
    }
    // markings
    for (const r of roads) this.drawMarkings(c, r);
    const crossings = this.crossingsByTile.get(`${Math.floor(x0/TILE_M)},${Math.floor(y0/TILE_M)}`);
    if (crossings) for (const crossing of crossings) paintCrossing(c, crossing);
    // rail
    for (const l of lines) {
      if (l.k !== 0 && l.k !== 1) continue;
      c.lineCap = 'butt';
      c.strokeStyle = l.k === 0 ? COL.rail : '#7a6a5a'; c.lineWidth = 3.2; strokePts(c, l.pts);
      c.strokeStyle = '#4a3a2c'; c.lineWidth = 2.4; c.setLineDash([0.35, 0.55]); strokePts(c, l.pts); c.setLineDash([]);
      c.strokeStyle = COL.railSteel; c.lineWidth = 0.18; strokeOffset(c, l.pts, 0.72); strokeOffset(c, l.pts, -0.72);
      c.lineCap = 'round';
    }
    // building bases (dark footprint so walls look grounded)
    c.fillStyle = 'rgba(30,28,26,0.55)';
    W.forEachInRect('blds', x0, y0, x1, y1, (b) => { c.beginPath(); addRing(c, b.pts); c.fill(); });
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (canvas === this.tileBaker) {
      try {
        // A mutable canvas source can force the browser to synchronize with the
        // tile painter on every blit. Snapshot once, then share just the image.
        canvas = this.tileBaker.transferToImageBitmap();
        this.tileBaker.width = 1; // release the empty working surface between bakes
      } catch {
        // Keep this completed canvas as the tile and use normal canvases from now on.
        this.tileBaker = null;
      }
    }
    if (typeof reuse?.canvas.close === 'function') reuse.canvas.close();
    return { canvas, tx, ty, lvl, span, stale: false, used: 0 };
  }

  // Only render the vector base where photography is missing or has transparent edge pixels.
  drawVectorGround(c, x0, y0, span, gpm, areas, P) {
    const W = this.world, x1 = x0 + span, y1 = y0 + span;
    const inWorld = W.surfaceAt(x0 + span/2, y0 + span/2) !== -2;
    c.fillStyle = inWorld ? P.ground : P.groundOut;
    c.fillRect(x0, y0, span, span);
    // urban base: lawn wherever development is nearby; paved aprons around buildings in dense blocks
    if (inWorld) {
      let maxD = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) maxD = Math.max(maxD, W.densityAt(x0 + span/2 + dx*TILE_M, y0 + span/2 + dy*TILE_M));
      // lawn where development is nearby, blended bilinearly between tile corners (no hard tile seams)
      const corner = (cx, cy) => (this.lawnT(cx - 1, cy - 1) + this.lawnT(cx, cy - 1) + this.lawnT(cx - 1, cy) + this.lawnT(cx, cy)) / 4;
      const bx = Math.floor(x0/TILE_M), by = Math.floor(y0/TILE_M);
      const c00 = corner(bx, by), c10 = corner(bx + 1, by), c01 = corner(bx, by + 1), c11 = corner(bx + 1, by + 1);
      if (c00 + c10 + c01 + c11 >= 3.999) { c.fillStyle = P.lawn; c.fillRect(x0, y0, span, span); }
      else if (c00 + c10 + c01 + c11 > 0) {
        c.fillStyle = P.lawn;
        const N = span / 8, sz = span / N;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const u = (x0 - bx*TILE_M + (i+0.5)*sz)/TILE_M, v = (y0 - by*TILE_M + (j+0.5)*sz)/TILE_M;
          const a = (c00 * (1 - u) + c10 * u) * (1 - v) + (c01 * (1 - u) + c11 * u) * v;
          if (a <= 0.01) continue;
          c.globalAlpha = Math.min(1, a * 1.15);
          c.fillRect(x0 + i * sz, y0 + j * sz, sz + 0.05, sz + 0.05);
        }
        c.globalAlpha = 1;
      }
      if (maxD >= 2) {
        c.lineJoin = 'round';
        W.forEachInRect('blds', x0 - 12, y0 - 12, x1 + 12, y1 + 12, (b) => {
          const bx = (b.bb[0] + b.bb[2]) / 2, by = (b.bb[1] + b.bb[3]) / 2;
          const d = W.densityAt(bx, by);
          // paved aprons only around shops, offices, industry and towers; homes, garages and sheds sit on lawns
          if (d < 2 || b.t === 1 || b.t === 2 || b.t === 11 || b.t === 12 || b.t === 13 || b.t === 16 || (b.t === 0 && b.h < 9) || (b.t === 3 && d < 3)) return;
          c.beginPath(); addRing(c, b.pts);
          c.strokeStyle = P.lot; c.lineWidth = d >= 3 ? 16 : 9; c.stroke(); c.fillStyle = P.lot; c.fill();
        });
      }
    }
    // macro variation: soft patches of darker/greener/drier grass so open ground isn't one flat sheet
    if (inWorld && gpm <= 8) this.drawPatches(c, x0, y0);
    // ---- areas
    areas.sort((a, b) => (AREA_RANK.get(a.k) ?? 0) - (AREA_RANK.get(b.k) ?? 0));
    for (const a of areas) {
      const st = AREA_STYLE[a.k] || 'ground';
      if (st === 'ground') continue;
      c.beginPath();
      for (const ring of a.rings) addRing(c, ring);
      if (st === 'farm') {
        const red = hash2(Math.floor(a.bb[0]), Math.floor(a.bb[1]), 7) < 0.35;
        c.fillStyle = red ? P.farmRed : P.farm;
        c.fill('evenodd');
        // crop rows
        c.save(); c.clip('evenodd');
        c.strokeStyle = red ? 'rgba(70,30,15,0.18)' : 'rgba(40,60,20,0.16)';
        c.lineWidth = 1.2;
        const ang = hash2(Math.floor(a.bb[0]), 3, 9) < 0.5;
        c.beginPath();
        if (ang) for (let x = Math.floor(x0 / 3) * 3; x < x1; x += 3) { c.moveTo(x, y0); c.lineTo(x, y1); }
        else for (let y = Math.floor(y0 / 3) * 3; y < y1; y += 3) { c.moveTo(x0, y); c.lineTo(x1, y); }
        c.stroke(); c.restore();
      } else if (st === 'water' || st === 'pool') {
        c.fillStyle = P[st];
        c.fill('evenodd');
        c.strokeStyle = st === 'water' ? COL.waterEdge : '#e8e8e8';
        c.lineWidth = st === 'water' ? 1.6 : 0.6;
        c.stroke();
      } else if (st === 'pitch') {
        c.fillStyle = P.pitch; c.fill('evenodd');
        c.strokeStyle = 'rgba(240,240,230,0.7)'; c.lineWidth = 0.25; c.stroke();
      } else if (st === 'golf') {
        c.fillStyle = P.golf; c.fill('evenodd');
      } else {
        c.fillStyle = P[st] || P.ground;
        c.fill('evenodd');
        if (st === 'parking' || st === 'lot' || st === 'plaza') { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.4; c.stroke(); }
      }
    }
  }

  dropSurvey(cache, key) {
    const entry = cache.get(key);
    clearTimeout(entry.retry);
    cache.delete(key);
    if (!entry.ready) entry.image.removeAttribute('src');
  }

  drawRelief(ctx, x, y, side) {
    if (!this.reliefRegions) {
      if (!this.reliefLoading && performance.now() >= (this.reliefRetry || 0)) {
        this.reliefLoading = true;
        fetch(this.world.base + '/ground/relief/index.json').then(response => {
          if (!response.ok) throw Error('Relief unavailable');
          return response.json();
        }).then(index => {
          this.reliefRegions = new Set(index.regions);
          this.reliefSpan = index.span;
          if (this.quality >= 2) for (const tile of this.cache.values()) tile.stale = true;
        }).catch(() => { this.reliefRetry = performance.now() + 30000; })
          .finally(() => { this.reliefLoading = false; });
      }
      return;
    }
    const span = this.reliefSpan;
    const rx = Math.floor(x / span), ry = Math.floor(y / span), key = rx + ',' + ry;
    if (!this.reliefRegions.has(key)) return;
    const left = rx * span, top = ry * span;
    const url = this.world.base + '/ground/relief/' + rx + '_' + ry + '.webp';
    const entry = this.surveyImage(this.reliefImages, key, key, url, left, top, span, 1, 4);
    if (!entry.ready) return;
    const scale = (entry.image.width - 2) / span;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.72;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(entry.image, 1+(x-left)*scale, 1+(y-top)*scale, side*scale, side*scale, x, y, side, side);
    ctx.restore();
  }

  surveyImage(cache, key, region, url, left, top, span, gutter, limit, opaque = false) {
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      cache.set(key, entry);
      return entry;
    }
    if (cache.size >= limit) this.dropSurvey(cache, cache.keys().next().value);
    const image = new Image();
    image.decoding = 'async';
    entry = { image, region, left, top, span, gutter, opaque, ready: false, failed: false };
    cache.set(key, entry);
    const invalidate = () => {
      for (const tile of this.cache.values()) {
        const tx = tile.tx * tile.span, ty = tile.ty * tile.span;
        if (tx >= left && tx < left+span && ty >= top && ty < top+span) tile.stale = true;
      }
    };
    image.src = url;
    image.decode().then(() => {
      if (cache.get(key) !== entry) return;
      // An older overview can be 2048². Retain just the cheaper mip on lower tiers,
      // even when all four adjoining county cells are visible above an intersection.
      if (cache === this.surveyTiles && !gutter && this.quality < 2) {
        const cap = this.quality === 0 ? 512 : 1024;
        if (image.naturalWidth > cap) {
          const mip = document.createElement('canvas');
          mip.width = mip.height = cap;
          const ctx = mip.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, cap, cap);
          entry.image = mip;
        }
      }
      entry.ready = true;
      invalidate();
    }).catch(() => {
      if (cache.get(key) !== entry) return;
      entry.failed = true;
      invalidate();
      entry.retry = setTimeout(() => {
        if (cache.get(key) === entry) { this.dropSurvey(cache, key); invalidate(); }
      }, 30000);
    });
    return entry;
  }

  surveyAt(x, y, gpm) {
    if (this.fullIndexPending) return null;
    const rx = Math.floor(x/REGION), ry = Math.floor(y/REGION), region = `${rx},${ry}`;
    const left = rx*REGION, top = ry*REGION;
    const base = this.world.base + '/ground/';
    const full = this.fullRegions.get(region);
    const wantNative = this.quality > 0 && gpm >= 2;
    let fine;
    if (wantNative) {
      const span = this.fullSpan || this.detailSpan;
      if (span) {
        const cx = Math.floor((x-left)/span), cy = Math.floor((y-top)/span);
        const bit = cy*(REGION/span)+cx, flag = 1 << bit;
        const id = `${rx}_${ry}/${bit}`, dx = left+cx*span, dy = top+cy*span;
        const limit = DETAIL_IMAGES[this.quality];
        if (full && (full[2] & flag)) {
          const opaque = !(full[3] & flag);
          const ext = opaque ? this.fullOpaqueFormat : 'webp';
          fine = this.surveyImage(this.detailImages, 'full/'+id, region, base+'full/'+id+'.'+ext, dx, dy, span, 1, limit, opaque);
        }
        if ((!fine || fine.failed) && (this.detailRegions.get(region) & flag)) {
          fine = this.surveyImage(this.detailImages, id, region, base+'detail/'+id+'.webp', dx, dy, span, 1, limit);
        }
        if (fine?.ready) return fine;
      }
    }
    if (full) {
      const url = base+'full/'+rx+'_'+ry+'/overview.'+(full[4] ? 'webp' : this.fullOpaqueFormat);
      const overview = this.surveyImage(this.surveyTiles, 'full/'+region, region, url, left, top, REGION, 1, 4, !full[4]);
      if (!overview.failed) return overview.ready ? overview : null;
    }
    if (!this.surveyRegions.has(region)) return null;
    const legacy = this.surveyImage(this.surveyTiles, region, region, base+rx+'_'+ry+'.webp', left, top, REGION, 0, 4);
    return legacy.ready ? legacy : null;
  }

  drawSurvey(ctx, x, y, gpm, side = TILE_M, photo = this.surveyAt(x, y, gpm)) {
    if (!photo) return false;
    this.drawPhotoLayer(ctx, x, y, gpm, side, photo);
    if (this.nativeArea === 'towns' && this.quality > 0 && photo.span < REGION && gpm) {
      this.featherCompactEdge(ctx, x, y, side, gpm, photo);
    }
    if (!gpm) return true;
    if (!photo.paving) photo.paving = pavementField(photo.image, photo.span, photo.left, photo.top, photo.gutter);
    return photo.paving;
  }

  drawPhotoLayer(ctx, x, y, gpm, side, photo) {
    const { image, left, top, span, gutter } = photo;
    const scale = (image.width - 2*gutter) / span;
    const detailed = span < REGION;
    ctx.save();
    ctx.globalAlpha = photo.opaque ? 1 : detailed ? 0.98 : 0.88;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = gpm && gpm < scale ? 'high' : 'low';
    ctx.drawImage(image, gutter+(x-left)*scale, gutter+(y-top)*scale,
      side*scale, side*scale, x, y, side, side);
    if (detailed && this.quality >= 2 && gpm >= 8 && this.photoMaterials) {
      this.drawCoverGrain(ctx, photo, x, y, side);
    } else if (gpm >= 4) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = detailed ? 0.46 : 0.65;
      ctx.fillStyle = this.surveyGrain;
      ctx.fillRect(x, y, side, side);
    }
    ctx.restore();
  }

  // Find adjacent patches supplied only by their region overview. A missing
  // diagonal matters where two native edges meet at a concave town boundary.
  overviewNeighbors(photo) {
    const neighbors = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const left = photo.left + dx*photo.span, top = photo.top + dy*photo.span;
      const rx = Math.floor(left/REGION), ry = Math.floor(top/REGION);
      const region = this.fullRegions.get(`${rx},${ry}`);
      const col = (left-rx*REGION)/photo.span, row = (top-ry*REGION)/photo.span;
      if (region && !(region[2] & (1 << (row*REGION/photo.span + col)))) {
        neighbors.push({ left, top, right: left+photo.span, bottom: top+photo.span });
      }
    }
    return neighbors;
  }

  featherCompactEdge(ctx, x, y, side, gpm, photo) {
    const neighbors = photo.overviewNeighbors ??= this.overviewNeighbors(photo);
    if (!neighbors.some(n => nearCompactEdge(n, x, y, side, side))) return;
    const overview = this.surveyAt(x, y, 0);
    if (!overview) return; // Its decode/retry invalidates this bake.
    if (!this.featherBuffers) {
      const mask = document.createElement('canvas'), layer = document.createElement('canvas');
      mask.width = mask.height = TILE_M+2;
      layer.width = layer.height = 512;
      const maskCtx = mask.getContext('2d');
      this.featherBuffers = { maskCtx, weights: maskCtx.createImageData(mask.width, mask.height),
        layer: layer.getContext('2d') };
    }
    const { maskCtx, weights, layer } = this.featherBuffers;
    // A metre-spaced mask, including a gutter, has the same weights on both
    // sides of a raster-cell boundary and across all street camera densities.
    for (let row = 0; row < side+2; row++) for (let col = 0; col < side+2; col++) {
      const wx = x+col-0.5, wy = y+row-0.5;
      let distance2 = COMPACT_FEATHER_M**2;
      for (const n of neighbors) {
        const dx = Math.max(n.left-wx, wx-n.right, 0), dy = Math.max(n.top-wy, wy-n.bottom, 0);
        distance2 = Math.min(distance2, dx*dx + dy*dy);
      }
      const t = Math.sqrt(distance2)/COMPACT_FEATHER_M;
      weights.data[(row*weights.width+col)*4+3] = 255*(1 - t*t*(3-2*t));
    }
    maskCtx.putImageData(weights, 0, 0, 0, 0, side+2, side+2);
    // A single 1 MiB scratch surface suffices even for a 2048² Ultra tile.
    // Composite only blocks inside the feather, at the real raster density so
    // that the overview's world-aligned grain meets its neighbour exactly.
    const pixels = side*gpm, block = layer.canvas.width;
    for (let py = 0; py < pixels; py += block) for (let px = 0; px < pixels; px += block) {
      const bx = x+px/gpm, by = y+py/gpm;
      const w = Math.min(block, pixels-px), h = Math.min(block, pixels-py);
      if (!neighbors.some(n => nearCompactEdge(n, bx, by, w/gpm, h/gpm))) continue;
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.setTransform(gpm, 0, 0, gpm, -x*gpm-px, -y*gpm-py);
      this.drawPhotoLayer(layer, x, y, gpm, side, overview);
      layer.globalCompositeOperation = 'destination-in';
      if (!overview.opaque) {
        // The soft-light grain of a transparent county-edge photograph must
        // not introduce grey pixels where the survey itself has no coverage.
        const scale = (overview.image.width-2*overview.gutter)/overview.span;
        layer.drawImage(overview.image, overview.gutter+(x-overview.left)*scale, overview.gutter+(y-overview.top)*scale,
          side*scale, side*scale, x, y, side, side);
      }
      layer.drawImage(maskCtx.canvas, 1, 1, side, side, x, y, side, side);
      layer.globalCompositeOperation = 'source-over';
      ctx.drawImage(layer.canvas, 0, 0, w, h, bx, by, w/gpm, h/gpm);
    }
  }

  drawCoverGrain(ctx, photo, x, y, side) {
    const region = this.world.regionAt(x, y);
    if (!region?.mask) return;
    const grasses = this.photoMaterials.pattern(ctx, 'grassGrain');
    const soil = this.photoMaterials.pattern(ctx, 'soilGrain');
    if (!grasses && !soil) return;
    const n = photo.span / MASK_M;
    if (!photo.cover) {
      const field = document.createElement('canvas');
      field.width = field.height = n;
      const c = field.getContext('2d', { willReadFrequently: true });
      const g = photo.gutter, size = photo.image.width - 2*g;
      c.drawImage(photo.image, g, g, size, size, 0, 0, n, n);
      const pixels = c.getImageData(0, 0, n, n).data;
      // Only saturated, lit green/yellow vegetation or exposed warm soil. This
      // excludes actual driveways and paving that fall inside a mapped lawn.
      photo.cover = new Int8Array(n*n);
      for (let i = 0; i < n*n; i++) {
        const r = pixels[i*4], green = pixels[i*4+1], b = pixels[i*4+2];
        if (pixels[i*4+3] < 245 || green < 40) continue;
        const veg = Math.min((green-b-6)/32, (green-r+2)/12);
        const earth = Math.min((r-green-6)/24, (green-b-4)/18);
        if (veg > 0) photo.cover[i] = Math.min(3, Math.round(veg*3));
        else if (earth > 0) photo.cover[i] = -Math.min(3, Math.round(earth*3));
      }
    }
    // Batch adjacent mask cells into runs. The mask has the same grid alignment
    // as the survey samples and already excludes buildings, roads, lots and water.
    const cells = side / MASK_M;
    const paths = new Map();
    for (let row = 0; row < cells; row++) {
      const wy = y+row*MASK_M;
      const ci = ((wy-photo.top)/MASK_M)*n + (x-photo.left)/MASK_M;
      const mi = ((wy-region.oy)/MASK_M)*MASK_N + (x-region.ox)/MASK_M;
      let start = 0, run = 0;
      for (let col = 0; col <= cells; col++) {
        let next = 0;
        if (col < cells) {
          const surface = region.mask[mi+col], band = photo.cover[ci+col];
          if (band > 0 && GRASS_SURFACES.has(surface)) next = band;
          else if (band < 0 && (surface === S.DIRT || surface === S.FARM)) next = band;
        }
        if (next === run) continue;
        if (run) {
          if (!paths.has(run)) paths.set(run, new Path2D());
          paths.get(run).rect(x+start*MASK_M, wy, (col-start)*MASK_M, MASK_M);
        }
        start = col; run = next;
      }
    }
    ctx.globalCompositeOperation = 'soft-light';
    for (const [band, path] of paths) {
      const material = band > 0 ? grasses : soil;
      if (!material) continue;
      ctx.fillStyle = material;
      ctx.globalAlpha = Math.abs(band)*0.12;
      ctx.fill(path);
    }
  }

  // 1 if any tile in the 3x3 around (tx,ty) has development, else 0 (cached; cleared as regions stream in)
  lawnT(tx, ty) {
    const k = tx * 100003 + ty;
    let v = this.lawnCache.get(k);
    if (v === undefined) {
      const W = this.world;
      let m = 0;
      for (let dy = -1; dy <= 1 && m < 1; dy++) for (let dx = -1; dx <= 1; dx++) { const d = W.densityAt((tx + dx) * TILE_M + 32, (ty + dy) * TILE_M + 32); if (d > m) m = d; }
      v = m >= 1 ? 1 : 0;
      if (this.lawnCache.size > 20000) this.lawnCache.clear();
      this.lawnCache.set(k, v);
    }
    return v;
  }

  drawPatches(c, x0, y0) {
    const CELL = 24, R0 = 9, R1 = 26;
    const cx0 = Math.floor((x0 - R1) / CELL), cx1 = Math.floor((x0 + TILE_M + R1) / CELL);
    const cy0 = Math.floor((y0 - R1) / CELL), cy1 = Math.floor((y0 + TILE_M + R1) / CELL);
    const W = this.world;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const h = hash2(cx, cy, 31);
      if (h > 0.62) continue;
      const px = (cx + hash2(cx, cy, 32)) * CELL, py = (cy + hash2(cx, cy, 33)) * CELL;
      const r = R0 + (R1 - R0) * hash2(cx, cy, 34);
      if (px + r < x0 || px - r > x0 + TILE_M || py + r < y0 || py - r > y0 + TILE_M) continue;
      const kind = hash2(cx, cy, 35);
      // dry/brown patches out in the country, greener/darker ones near houses
      const rural = W.densityAt(px, py) < 1;
      const col = kind < 0.4 ? '38,62,24' : kind < 0.7 ? (rural ? '150,135,80' : '120,150,70') : (rural ? '120,100,60' : '60,90,40');
      const a = 0.1 + 0.1 * hash2(cx, cy, 36);
      const grd = c.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, `rgba(${col},${a})`); grd.addColorStop(0.6, `rgba(${col},${a * 0.6})`); grd.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = grd;
      c.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }

  // 1 = sidewalks, 2 = none
  sidewalkFor(r) {
    if (r.sides?.some(s => s === 1 || s === 2)) return 1;
    if (r.sides?.every(s => s === 0)) return 2;
    if (r.cls === RC.MOTORWAY || r.cls === RC.TRUNK || r.cls === RC.MOTORWAY_LINK || r.cls === RC.TRUNK_LINK || r.cls === RC.SERVICE || r.cls === RC.TRACK || r.cls === RC.PATH || r.cls === RC.RACEWAY) return 2;
    if (r.flags & F.UNPAVED) return 2;
    // developed land on either side?
    const p = r.pts, n = p.length >> 1;
    const i = Math.max(0, (n >> 1) - 1);
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[Math.min(n - 1, i + 1) * 2], by = p[Math.min(n - 1, i + 1) * 2 + 1];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / L, ny = (bx - ax) / L;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const off = r.w / 2 + 7;
    let dev = 0, loading = false;
    for (const s of [1, -1]) {
      for (const off2 of [off, off + 12]) {
        const v = this.world.surfaceAt(mx + nx * off2 * s, my + ny * off2 * s);
        if (v === -1) loading = true;
        if (v === S.LAWN || v === S.LOT || v === S.PARKING || v === S.BUILDING || v === S.WALK) dev++;
      }
    }
    return dev >= 2 ? 1 : loading ? 0 : 2;
  }

  drawMarkings(c, r) {
    if (r.cls === RC.PATH || r.cls === RC.TRACK || (r.flags & F.UNPAVED)) return;
    const pts = r.pts;
    // parking aisles: stall lines
    if (r.cls === RC.SERVICE) {
      if (r.flags & F.AISLE) {
        c.strokeStyle = 'rgba(230,230,220,0.75)'; c.lineWidth = 0.15; c.lineCap = 'butt';
        stallLines(c, pts, r.w / 2, 5.0, 2.7);
        c.lineCap = 'round';
      }
      return;
    }
    const trim0 = junctionMouth(r, r.node0, 1);
    const trim1 = junctionMouth(r, r.node1, -1);
    const sub = trim0 || trim1 ? trimPts(pts, trim0, trim1) : pts;
    if (!sub) return;
    c.lineCap = 'butt';
    for (const stripe of laneStripes(r)) {
      c.strokeStyle = stripe.yellow ? COL.lineYellow : COL.lineWhite;
      c.lineWidth = 0.14;
      c.setLineDash(stripe.dash ? [3, 9] : []);
      strokeOffset(c, sub, stripe.offset);
    }
    c.setLineDash([]);
    if (r.ahead && trim1) approachArrows(c, r, r.ahead, 1, trim1, trim0);
    if (r.back && trim0) approachArrows(c, r, r.back, -1, trim0, trim1);
    c.lineCap = 'round';
  }
}

// ------------------------------------------------------------ path helpers
function nearCompactEdge(n, x, y, width, height) {
  const dx = Math.max(n.left-x-width, x-n.right, 0), dy = Math.max(n.top-y-height, y-n.bottom, 0);
  return dx*dx + dy*dy < COMPACT_FEATHER_M**2;
}

export function addRing(c, p) {
  c.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  c.closePath();
}
// Low-pass the actual aerial tones once per source image. An 8 m sample
// suppresses individual photographed vehicles and painted lines. Duplicate
// the edge samples to avoid wrapping the opposite side into a tile boundary.
function pavementField(image, span, left, top, gutter) {
  const count = span / 8;
  const field = document.createElement('canvas');
  field.width = field.height = count + 2;
  const c = field.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.filter = 'saturate(0.15) brightness(0.86) contrast(0.76)';
  const size = image.width - 2 * gutter;
  c.drawImage(image, gutter, gutter, size, size, 1, 1, count, count);
  c.filter = 'none';
  c.drawImage(field, 1, 1, 1, count, 0, 1, 1, count);
  c.drawImage(field, count, 1, 1, count, count + 1, 1, 1, count);
  c.drawImage(field, 0, 1, count + 2, 1, 0, 0, count + 2, 1);
  c.drawImage(field, 0, count, count + 2, 1, 0, count + 1, count + 2, 1);
  const pattern = c.createPattern(field, 'no-repeat');
  pattern.setTransform(new DOMMatrix().translate(left - 8, top - 8).scale(8));
  return pattern;
}

function strokePts(c, p, dx = 0, dy = 0) {
  c.beginPath();
  c.moveTo(p[0] + dx, p[1] + dy);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i] + dx, p[i + 1] + dy);
  c.stroke();
}
// Transverse concrete joints follow the alignment and stay in phase across tiles.
function pavementJoints(c, p, halfWidth, spacing, x0, y0) {
  let distance = 0;
  c.strokeStyle = 'rgba(63,59,55,0.32)'; c.lineWidth = 0.055;
  c.beginPath();
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (!len) continue;
    if (Math.max(ax, bx) + halfWidth >= x0 && Math.min(ax, bx) - halfWidth <= x0 + TILE_M &&
        Math.max(ay, by) + halfWidth >= y0 && Math.min(ay, by) - halfWidth <= y0 + TILE_M) {
      const nx = -dy * halfWidth / len, ny = dx * halfWidth / len;
      for (let s = spacing - distance % spacing; s <= len; s += spacing) {
        const x = ax + dx * s / len, y = ay + dy * s / len;
        c.moveTo(x - nx, y - ny); c.lineTo(x + nx, y + ny);
      }
    }
    distance += len;
  }
  c.stroke();
}
// Keep paint out of the cross street according to its width and intersection angle.
function junctionMouth(road, node, dir) {
  if (!node || node.edges.length < 3) return 0;
  const p = road.pts, a = dir > 0 ? 0 : p.length - 2, step = dir * 2;
  const dx = p[a + step] - p[a], dy = p[a + step + 1] - p[a + 1];
  const len = Math.hypot(dx, dy);
  if (!len) return 0;
  let arms = 0, back = 0;
  for (const { road: other, dir: travel } of node.edges) {
    if (other.cls === RC.PATH || other.cls === RC.SERVICE || other.cls === RC.TRACK || other.flags & F.TUNNEL) continue;
    arms++;
    const q = other.pts, i = travel > 0 ? 0 : q.length - 2, j = i + travel * 2;
    const ex = q[j] - q[i], ey = q[j + 1] - q[i + 1];
    const denom = len * Math.hypot(ex, ey);
    if (!denom) continue;
    const sin = Math.abs(dx * ey - dy * ex) / denom;
    if (sin < 0.32) continue;
    const cos = Math.abs(dx * ex + dy * ey) / denom;
    back = Math.max(back, Math.min(24, (other.w + road.w * cos) / (2 * sin)) + 0.5);
  }
  return arms > 2 ? back : 0;
}

const arrowPoint = [0, 0, 0, 0];
function approachArrows(c, road, masks, dir, mouth, otherEnd) {
  if (masks.length !== lanesPerDir(road, dir) || !masks.some(m => m & ~1)) return;
  cum(road);
  const length = road.len;
  const room = length - mouth - otherEnd;
  if (room < 7) return;
  const s = length - mouth - Math.min(12, room / 2);
  for (let lane = 0; lane < masks.length; lane++) {
    const mask = masks[lane];
    if (!mask) continue;
    const [x, y, dx, dy] = pointAt(road, dir, s, laneOffset(road, lane, dir), arrowPoint);
    c.save();
    c.transform(dx, dy, -dy, dx, x, y);
    c.strokeStyle = c.fillStyle = 'rgba(240,239,228,0.91)';
    c.lineWidth = 0.28;
    c.beginPath(); c.moveTo(-1.9, 0); c.lineTo(0.05, 0);
    if (mask & 1) { c.moveTo(0, 0); c.lineTo(1.32, 0); }
    for (const side of [-1, 1]) {
      if (mask & (side < 0 ? 2 : 4)) {
        c.moveTo(-0.48, 0); c.quadraticCurveTo(0.44, 0, 0.44, side * 0.66);
      }
      if (mask & (side < 0 ? 8 : 16)) {
        c.moveTo(-0.5, 0); c.lineTo(0.98, side * 0.61);
      }
    }
    c.stroke();
    const head = (px, py, tx, ty) => {
      c.moveTo(px + tx * 0.73, py + ty * 0.73);
      c.lineTo(px - ty * 0.43, py + tx * 0.43);
      c.lineTo(px + ty * 0.43, py - tx * 0.43); c.closePath();
    };
    c.beginPath();
    if (mask & 1) head(1.2, 0, 1, 0);
    for (const side of [-1, 1]) {
      if (mask & (side < 0 ? 2 : 4)) head(0.44, side * 0.56, 0, side);
      if (mask & (side < 0 ? 8 : 16)) head(0.87, side * 0.56, 0.9, side * 0.435);
    }
    c.fill();
    c.restore();
  }
}

function strokeOffset(c, p, off) {
  const n = p.length >> 1;
  if (n < 2) return;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = p[i1 * 2] - p[i0 * 2], dy = p[i1 * 2 + 1] - p[i0 * 2 + 1];
    const L = Math.hypot(dx, dy) || 1;
    const x = p[i * 2] + (-dy / L) * off, y = p[i * 2 + 1] + (dx / L) * off;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
}
function trimPts(p, a, b) {
  const n = p.length >> 1;
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]);
  if (total <= a + b + 1) return null;
  const out = [];
  let acc = 0;
  const lo = a, hi = total - b;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, by - ay);
    const s0 = acc, s1 = acc + L;
    if (s1 >= lo && s0 <= hi) {
      const t0 = L > 0 ? Math.max(0, (lo - s0) / L) : 0, t1 = L > 0 ? Math.min(1, (hi - s0) / L) : 1;
      if (out.length === 0) out.push(ax + (bx - ax) * t0, ay + (by - ay) * t0);
      out.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    }
    acc = s1;
  }
  return out.length >= 4 ? out : null;
}
function paintCrossing(c, [ax, ay, bx, by, width, style]) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const dx = (bx - ax) / len, dy = (by - ay) / len;
  const nx = -dy * width / 2, ny = dx * width / 2;
  c.strokeStyle = 'rgba(235,235,225,0.85)';
  c.lineCap = 'butt';
  // OSM patterns: paired boundary lines, zebra bars, ladder, skewed ladder, dashes.
  if (style !== 2) {
    if (style === 5) c.setLineDash([0.6, 0.6]);
    c.lineWidth = 0.2;
    c.beginPath();
    c.moveTo(ax - nx, ay - ny); c.lineTo(bx - nx, by - ny);
    c.moveTo(ax + nx, ay + ny); c.lineTo(bx + nx, by + ny);
    c.stroke();
    if (style === 5) c.setLineDash([]);
  }
  if (style >= 2 && style <= 4) {
    c.lineWidth = 0.45;
    const skew = style === 4 ? 0.35 : 0;
    const bars = Math.max(1, Math.floor(len / 1.1));
    c.beginPath();
    for (let j = 0; j < bars; j++) {
      const s = (j + 0.5) * len / bars;
      c.moveTo(ax + dx * (s - skew) - nx, ay + dy * (s - skew) - ny);
      c.lineTo(ax + dx * (s + skew) + nx, ay + dy * (s + skew) + ny);
    }
    c.stroke();
  }
  c.lineCap = 'round';
}
function stallLines(c, p, half, depth, spacing) {
  const n = p.length >> 1;
  c.beginPath();
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 3) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
    for (let s = 1.5; s < L - 1; s += spacing) {
      const x = ax + ux * s, y = ay + uy * s;
      for (const sd of [1, -1]) {
        c.moveTo(x + nx * half * sd, y + ny * half * sd);
        c.lineTo(x + nx * (half + depth) * sd, y + ny * (half + depth) * sd);
      }
    }
  }
  c.stroke();
}
