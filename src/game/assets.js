// Asset loading: vehicle + prop catalogs (sprite-stack strips), pedestrian sprites.
import { StackSprite, loadImage, recolourStrip, paintRamp, makeBoxStack } from '../engine/stacks.js';
import { mulberry32, hashStr } from '../engine/math.js';

const PAINTS = [
  [176, 28, 32], [24, 64, 150], [30, 30, 34], [226, 226, 222], [150, 152, 156], [20, 110, 60], [230, 180, 30], [200, 90, 20],
  [90, 30, 110], [40, 140, 170], [120, 80, 50], [240, 240, 240], [60, 70, 90], [150, 20, 60], [210, 210, 160], [90, 120, 60],
  [190, 60, 140], [20, 40, 70], [170, 120, 80], [100, 100, 104], [235, 120, 120], [60, 160, 120], [230, 210, 90], [130, 20, 20],
];

export class Assets {
  constructor() {
    this.vehicles = [];
    this.vehicleById = new Map();
    this.vehSprites = new Map();   // `${id}|${paint}` -> StackSprite
    this.vehicleStripBytes = 0;
    this.props = new Map();
    this.pedLib = null;
    this.pedSprites = new Map();
    this.treeSprites = [];
    this.crowns = new Map();
    this.ready = false;
  }

  // Higher-detail crowns share the original placement, footprint and total height.
  // Load only sprites needed in view. This cache can be released in full on downgrade.
  crownSprite(id, base, distant) {
    const key = distant ? id + '-distant' : id;
    let entry = this.crowns.get(key);
    if (!entry || entry.retryAt && performance.now() > entry.retryAt) {
      const image = new Image();
      entry = { sprite: null };
      this.crowns.set(key, entry);
      image.onload = () => {
        const count = distant ? 4 : 12;
        const w = image.width / count;
        entry.sprite = new StackSprite(image, w, image.height, count, base.px * base.w / w, base.height / count);
      };
      image.onerror = () => { entry.retryAt = performance.now() + 30000; };
      image.src = 'assets/props/crowns/' + key + '.webp';
    }
    return entry.sprite;
  }

  async catalog(group) {
    const base = 'assets/' + group + '/';
    try {
      const res = await fetch(base + 'sprites.json');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data[group])) return data;
      }
    } catch { /* A local art rebuild can still use the individual files. */ }
    return (await fetch(base + 'catalog.json')).json();
  }

  async loadVehicles() {
    try {
      const cat = await this.catalog('vehicles');
      const image = file => loadImage('assets/vehicles/' + file, cat.images?.[file], cat.sliceBoundDeltas?.[file]);
      this.artScale = cat.artScale || 0.1;
      this.sliceH = cat.sliceH || 0.1;
      await Promise.all(cat.vehicles.map(async (v) => {
        try {
          v.img = await image(v.file);
          if (v.rotor) v.rotorImg = await image(typeof v.rotor === 'string' ? v.rotor : v.rotor.file);
        } catch (e) { console.warn('vehicle img missing', v.id); v.img = null; }
      }));
      this.vehicles = cat.vehicles.filter((v) => v.img);
    } catch (e) {
      console.warn('No vehicle catalog yet, using placeholders', e);
      this.vehicles = placeholderVehicles();
    }
    for (const v of this.vehicles) this.vehicleById.set(v.id, v);
  }

  async loadProps() {
    try {
      const pc = await this.catalog('props');
      const image = file => loadImage('assets/props/' + file, pc.images?.[file], pc.sliceBoundDeltas?.[file]);
      await Promise.all(pc.props.map(async (p) => {
        try {
          const files = p.frames || [p.file];
          const imgs = await Promise.all(files.map(image));
          p.sprites = imgs.map((im) => new StackSprite(im, p.w, p.h, p.count, p.px, p.sliceH));
          p.sprite = p.sprites[0];
          if (p.emissive) { try { p.emitImg = await image(p.emissive); } catch (e) { /* optional */ } }
          this.props.set(p.id, p);
        } catch (e) { console.warn('prop missing', p.id); }
      }));
    } catch (e) { console.warn('No prop catalog yet'); }
    // tree sprites by worker tree code: 0 oak,1 elm,2 cottonwood,3 redbud,4 cedar,5 post oak,6 pine,7 bush,8 dead
    const treeIds = [['oak_1', 'oak_2', 'oak_3'], ['elm'], ['cottonwood'], ['redbud'], ['eastern_red_cedar_1', 'eastern_red_cedar_2'], ['post_oak'], ['pine'], ['bush_1', 'bush_2', 'bush_3'], ['dead_tree']];
    this.treeSprites = treeIds.map((ids) => ids.map((id) => this.props.get(id)).filter(Boolean).map((p) => {
      if (p.id !== 'dead_tree') p.sprite.crownId = p.id;
      return p.sprite;
    }));
    const fallbackTree = new StackSprite(makeTreeStack(), 24, 24, 14, 0.35, 0.6);
    this.treeSprites = this.treeSprites.map((a) => (a.length ? a : [fallbackTree]));
  }

  async loadPeople() {
    try {
      this.pedLib = await import('../data/peds.js');
      if (!this.pedLib.buildPedSprites) throw new Error('peds.js incomplete');
      this.pedCount = this.pedLib.pedModelCount ? this.pedLib.pedModelCount() : this.pedLib.PED_MODELS.length;
    } catch (e) {
      console.warn('peds.js not ready, using fallback peds', e);
      this.pedLib = null;
      this.pedCount = 64;
    }
  }

  async load(progress = () => {}) {
    progress('Loading the map and artwork…');
    await Promise.all([this.loadVehicles(), this.loadProps(), this.loadPeople()]);
    this.ready = true;
  }

  vehicle(id) { return this.vehicleById.get(id); }

  // weighted random civilian model for a zone
  pickVehicle(rng, zone, filter) {
    const list = this.vehicles.filter((v) => (v.role === 'civilian' || !v.role) && (!filter || filter(v)) && v.kind !== 'heli' && v.kind !== 'boat');
    let tot = 0;
    const ws = list.map((v) => {
      let w = (v.spawn && v.spawn.weight != null) ? v.spawn.weight : 1;
      if (v.spawn && v.spawn.zones && zone && !v.spawn.zones.includes(zone)) w *= 0.15;
      if (v.kind === 'bike' || v.kind === 'tractor') w *= 0.35;
      tot += w; return w;
    });
    let r = rng() * tot;
    for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[0];
  }
  byRole(role, kind) { return this.vehicles.filter((v) => v.role === role && (!kind || v.kind === kind)); }

  cachedStrip(key) {
    const sprite = this.vehSprites.get(key);
    if (sprite) { this.vehSprites.delete(key); this.vehSprites.set(key, sprite); }
    return sprite;
  }
  storeStrip(key, sprite) {
    const image = sprite.img || sprite;
    this.vehicleStripBytes += image.width * image.height * 4;
    this.vehSprites.set(key, sprite);
    // Existing vehicles keep their own reference. Discard old paints from long drives.
    while (this.vehicleStripBytes > 24 * 1024 * 1024) {
      const [id, old] = this.vehSprites.entries().next().value;
      const strip = old.img || old;
      this.vehSprites.delete(id);
      this.vehicleStripBytes -= strip.width * strip.height * 4;
    }
  }
  vehicleSprite(v, paintIdx = -1) {
    const key = `${v.id}|${paintIdx}`;
    let s = this.cachedStrip(key);
    if (s) return s;
    let img = v.img;
    if (paintIdx >= 0 && v.paint && v.paint.length) {
      img = recolourStrip(v.img, v.paint, paintRamp(PAINTS[paintIdx % PAINTS.length], v.paint.length));
    }
    s = new StackSprite(img, v.w, v.h, v.count, this.artScale || 0.1, this.sliceH || 0.1);
    this.storeStrip(key, s);
    return s;
  }
  // charred version of a vehicle's strip for wrecks
  burntStrip(veh) {
    const key = veh.m.id + '|burnt';
    let c = this.cachedStrip(key);
    if (c) return c;
    const src = veh.sprite.img;
    c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = 'rgba(28,24,22,0.82)';
    x.fillRect(0, 0, c.width, c.height);
    // rusty speckle
    x.fillStyle = 'rgba(120,60,30,0.35)';
    for (let i = 0; i < c.width * c.height / 40; i++) x.fillRect(Math.random() * c.width | 0, Math.random() * c.height | 0, 1, 1);
    this.storeStrip(key, c);
    return c;
  }

  rotorSprite(v) {
    if (!v.rotorImg) return null;
    const key = `${v.id}|rotor`;
    let s = this.cachedStrip(key);
    if (!s) {
      const r = typeof v.rotor === 'object' ? v.rotor : { w: v.rotorW || v.rotorImg.height, h: v.rotorH || v.rotorImg.height, count: v.rotorCount || Math.max(1, Math.round(v.rotorImg.width / (v.rotorW || v.rotorImg.height))) };
      s = new StackSprite(v.rotorImg, r.w, r.h, r.count, this.artScale || 0.1, this.sliceH || 0.1);
      this.storeStrip(key, s);
    }
    return s;
  }
  randomPaint(rng) { return Math.floor(rng() * PAINTS.length); }

  // ped sprites: {frames:{idle, walk[], run[], aim, punch[], dead, sit}, sprite: StackSprite}
  ped(i) {
    let s = this.pedSprites.get(i);
    if (s) { this.pedSprites.delete(i); this.pedSprites.set(i, s); return s; }
    let built;
    if (this.pedLib) {
      try { built = this.pedLib.lazyPedSprites(i); } catch (e) { console.warn('ped build failed', i, e); }
    }
    if (!built) built = fallbackPed(i);
    const sprite = new StackSprite(built.frames.idle, built.w, built.h, built.count, 0.1, 0.1);
    s = { ...built, sprite };
    this.pedSprites.set(i, s);
    if (this.pedSprites.size > 64) this.pedSprites.delete(this.pedSprites.keys().next().value);
    return s;
  }
  pedModel(i) { return this.pedLib && this.pedLib.getPedModel ? this.pedLib.getPedModel(i) : { id: i, name: 'Citizen ' + i, archetype: 'citizen' }; }
  pickPed(rng, zone) {
    if (this.pedLib && this.pedLib.pickPedModel) return this.pedLib.pickPedModel(rng, zone);
    return 8 + Math.floor(rng() * (this.pedCount - 8));
  }
  special(name) {
    const alias = { sheriff: 'deputy', syndicate: 'gusher', port_rats: 'portrats', mama_june: 'mamajune', carl: 'catfish' };
    if (this.pedLib && this.pedLib.SPECIAL) { const k = this.pedLib.SPECIAL[name] != null ? name : alias[name]; if (k && this.pedLib.SPECIAL[k] != null) return this.pedLib.SPECIAL[k]; }
    return { player: 0, cop: 1, trooper: 2, swat: 3, deputy: 4, sheriff: 4, paramedic: 5, firefighter: 6 }[name] ?? 7;
  }
}

function placeholderVehicles() {
  const defs = [
    ['sedan', 'Sedan', 19, 46, 15, 'car', 52], ['pickup', 'Pickup', 20, 54, 18, 'truck', 46], ['police', 'Police Cruiser', 19, 49, 15, 'car', 60],
    ['coupe', 'Coupe', 18, 44, 13, 'car', 60], ['van', 'Van', 20, 52, 21, 'truck', 40],
  ];
  return defs.map(([id, name, w, h, count, kind, top], i) => {
    const img = makeBoxStack(w, h, count, ['#a33', '#36a', '#eee', '#3a6', '#cc3'][i], '#222');
    return { id, name, make: 'Placeholder', kind, class: kind, img, w, h, count, len: h * 0.1, wid: w * 0.1, hgt: count * 0.1, mass: 1500, topSpeed: top, accel: 8, brake: 14, grip: 1, steer: 2.4, drift: 0.5, health: 1000, seats: 2, engine: 'v6', horn: 'mid', paint: [], role: id === 'police' ? 'police' : 'civilian', siren: id === 'police' ? 'police' : null, lights: { head: [[-0.6, h * 0.05], [0.6, h * 0.05]], tail: [[-0.6, -h * 0.05], [0.6, -h * 0.05]] }, spawn: { weight: 1, zones: [] }, price: 10000 };
  });
}

function makeTreeStack() {
  const w = 24, h = 24, count = 14;
  const c = document.createElement('canvas'); c.width = w * count; c.height = h;
  const x = c.getContext('2d');
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    if (t < 0.35) { x.fillStyle = '#5a3d25'; x.fillRect(i * w + 10, 10, 4, 4); continue; }
    const r = Math.sin((t - 0.35) / 0.65 * Math.PI) * 11 + 1;
    x.fillStyle = t > 0.8 ? '#5f9a3a' : t > 0.55 ? '#4a8030' : '#3a6626';
    x.beginPath(); x.arc(i * w + 12, 12, r, 0, Math.PI * 2); x.fill();
  }
  return c;
}

const SKIN = ['#f3d2b8', '#e8b994', '#d9a27a', '#c68a5e', '#a86f48', '#8a5636', '#6b3f25', '#4e2c1a'];
function fallbackPed(i) {
  const r = mulberry32(hashStr('ped' + i));
  const w = 20, h = 20, count = 18;
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const shirt = `hsl(${Math.floor(r() * 360)},${40 + r() * 40}%,${30 + r() * 35}%)`;
  const pants = `hsl(${Math.floor(r() * 360)},${20 + r() * 30}%,${15 + r() * 25}%)`;
  const hair = ['#1b1410', '#3a2414', '#6b4423', '#b8893c', '#9a9a9a', '#7a2a12'][Math.floor(r() * 6)];
  const mk = (phase) => {
    const c = document.createElement('canvas'); c.width = w * count; c.height = h;
    const x = c.getContext('2d');
    const step = Math.sin(phase * Math.PI * 2) * 2;
    for (let z = 0; z < count; z++) {
      const ox = z * w;
      if (z < 2) { x.fillStyle = '#222'; x.fillRect(ox + 7, 9 + step, 2, 2); x.fillRect(ox + 11, 9 - step, 2, 2); }
      else if (z < 8) { x.fillStyle = pants; x.fillRect(ox + 7, 9 + step * (8 - z) / 8, 2, 2); x.fillRect(ox + 11, 9 - step * (8 - z) / 8, 2, 2); }
      else if (z < 14) { x.fillStyle = shirt; x.fillRect(ox + 6, 8, 8, 4); x.fillStyle = skin; if (z < 12) { x.fillRect(ox + 4, 9 - step, 2, 2); x.fillRect(ox + 14, 9 + step, 2, 2); } }
      else if (z < 17) { x.fillStyle = skin; x.fillRect(ox + 8, 8, 4, 4); }
      else { x.fillStyle = hair; x.fillRect(ox + 8, 8, 4, 4); }
    }
    return c;
  };
  const dead = (() => {
    const c = document.createElement('canvas'); c.width = w * count; c.height = h;
    const x = c.getContext('2d');
    for (let z = 0; z < 3; z++) { const ox = z * w; x.fillStyle = pants; x.fillRect(ox + 8, 12, 4, 6); x.fillStyle = shirt; x.fillRect(ox + 7, 6, 6, 6); x.fillStyle = skin; x.fillRect(ox + 8, 3, 4, 3); x.fillRect(ox + 3, 7, 4, 2); x.fillRect(ox + 13, 7, 4, 2); }
    return c;
  })();
  const walk = [0, 1, 2, 3, 4, 5].map((k) => mk(k / 6));
  return { w, h, count, frames: { idle: mk(0), walk, run: walk, aim: mk(0), punch: [mk(0.25), mk(0.25), mk(0)], dead, sit: mk(0) }, colors: { shirt, skin } };
}
