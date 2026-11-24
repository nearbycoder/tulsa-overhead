// Map-only worker. Its region and tile requests never enter the simulation's streaming cache.
import { fetchJsonGz, streetData } from '../world/street-data.js';
import { REGION, roadWidth, F } from '../world/shared.js';

const TILE = 384;
const REGION_LIMIT = 32;
const regions = new Map();
let exists,
  base,
  streetRegions,
  streetChunk,
  wanted = new Map(),
  active = false;
const canvas = new OffscreenCanvas(TILE, TILE);
const ctx = canvas.getContext('2d', { alpha: false });

const AREA = [
  '',
  '#e2dbba',
  '#d6deb2',
  '#c4daa0',
  '#e5e0d6',
  '#ecdcd6',
  '#ded6de',
  '#96ba80',
  '#acd28c',
  '#a8d68c',
  '#baceaa',
  '#a0ce96',
  '#d6d2ce',
  '#78aad6',
  '#eedeaa',
  '#aac8aa',
  '#d6cec8',
  '#c8deaa',
  '#82c8e6',
  '#d2ced6',
  '#bec896',
  '#d6ccb2',
  '#cec4b4',
  '#e2d6be',
  '#ece2c4',
  '#eed6d6',
  '#d6c8be',
  '#b0d2a0',
  '#d2a082',
  '#bed696',
  '#dcd6c8',
  '#e2deda'
];
const areaOrder = [
  1, 2, 3, 23, 29, 4, 5, 6, 21, 22, 26, 24, 25, 30, 31, 16, 12, 19, 7, 20, 8, 9, 10, 27, 11, 28, 17, 14, 15,
  13, 18
];
const roadOrder = [15, 9, 8, 7, 6, 5, 14, 4, 13, 3, 12, 2, 11, 10, 1, 0, 16];
const roadColors = [
  '#f08c3c',
  '#f8b25a',
  '#fcd678',
  '#fff0aa',
  '#fff',
  '#fff',
  '#fff',
  '#fff',
  '#f6f6f6',
  '#c8966e',
  '#f0a05a',
  '#f8be6e',
  '#fcdc8c',
  '#fff0b4',
  '#fff',
  '#b49678',
  '#e67878'
];

function geometry(rings, closed) {
  const path = new Path2D();
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const ring of rings) {
    let x = 0,
      y = 0;
    for (let i = 0; i < ring.length; i += 2) {
      x += ring[i];
      y += ring[i + 1];
      if (i === 0) path.moveTo(x / 10, y / 10);
      else path.lineTo(x / 10, y / 10);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    if (closed) path.closePath();
  }
  return { path, left: left / 10, top: top / 10, right: right / 10, bottom: bottom / 10 };
}

function footprintColor(h, roof) {
  const color = h < 15 ? [191, 181, 169] : [164, 155, 152];
  if (roof) {
    const n = parseInt(roof.slice(1), 16);
    for (let i = 0; i < 3; i++) color[i] = Math.round((color[i] * 3 + ((n >> (16 - i * 8)) & 255)) / 4);
  }
  return 'rgb(' + color.join(',') + ')';
}

// Keep the label on a reasonably straight stretch. Long country roads get
// multiple possible anchors so a panned-in view can label the visible section.
function streetAnchors(road) {
  const [kind, flags, , , name, , , , shape] = road;
  if (kind > 7 || name < 0 || flags & (F.AISLE | F.DRIVEWAY)) return [];
  const labels = [];
  let x = shape[0] / 10,
    y = shape[1] / 10,
    startX = x,
    startY = y,
    heading = null;
  const finish = () => {
    const dx = x - startX,
      dy = y - startY,
      length = Math.hypot(dx, dy);
    if (length < 36) return;
    const n = Math.max(1, Math.ceil(length / 360));
    let angle = Math.atan2(dy, dx);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      labels.push({ x: startX + dx * t, y: startY + dy * t, angle, length: length / n, name, kind });
    }
  };
  for (let i = 2; i < shape.length; i += 2) {
    const dx = shape[i] / 10,
      dy = shape[i + 1] / 10;
    if (!dx && !dy) continue;
    const direction = Math.atan2(dy, dx);
    if (heading === null || Math.cos(direction - heading) < 0.94) {
      finish();
      startX = x;
      startY = y;
      heading = direction;
    }
    x += dx;
    y += dy;
  }
  finish();
  return labels;
}

async function fetchRegion(key) {
  const [rx, ry] = key.split(',').map(Number);
  const [data, streets] = await Promise.all([
    exists.has(key) ? fetchJsonGz(base + '/r/' + rx + '_' + ry + '.json.gz') : null,
    streetData(base, rx, ry, streetRegions.has(key) ? streetChunk : 0)
  ]);
  if (exists.has(key) && !data) throw Error('Map region unavailable');
  const json = data || { areas: [], lines: [], bld: [], roads: [] };
  const areas = json.areas.map(([k, rings]) => ({ ...geometry(rings, true), k }));
  const lines = json.lines.map(([k, width, , ring]) => ({ ...geometry([ring], false), k, width }));
  const buildings = json.bld.map((b) => ({ ...geometry([b[3]], true), color: footprintColor(b[1], b[7]) }));
  const decodeRoad = (r) => ({
    ...geometry([r[8]], false),
    labels: streetAnchors(r),
    k: r[0],
    flags: r[1],
    layer: r[3],
    width: roadWidth(r[0], r[2], r[1])
  });
  const roads = json.roads.map(decodeRoad);
  if (streets) {
    for (const [sx, sy, index, row] of streets.cross) {
      const owner = sx + ',' + sy;
      if (owner !== key) roads.push({ ...decodeRoad(row), owner, shared: owner + ':' + index });
    }
    for (const [id, width, , flags, shape] of streets.walks || []) {
      roads.push({
        ...geometry([shape], false),
        k: 15,
        layer: 0,
        flags,
        width: width / 10,
        labels: [],
        sidewalk: true,
        shared: 'walk:' + id
      });
    }
  }
  return { areas, lines, buildings, roads };
}

async function region(key) {
  if (!exists.has(key) && !streetRegions.has(key)) return null;
  let value = regions.get(key);
  if (!value) {
    value = await fetchRegion(key);
  } else regions.delete(key);
  regions.set(key, value);
  if (regions.size > REGION_LIMIT) regions.delete(regions.keys().next().value);
  return value;
}

async function render(tile) {
  const { x, y, mpp, key } = tile,
    side = mpp * TILE;
  const left = x * side,
    top = y * side,
    right = left + side,
    bottom = top + side;
  const regs = [],
    keys = [];
  // Lines and areas are clipped in storage. A road midpoint or building centroid can
  // lie in the adjacent region, so include its geometry when painting a boundary tile.
  for (let ry = Math.floor(top / REGION) - 1; ry <= Math.ceil(bottom / REGION); ry++) {
    for (let rx = Math.floor(left / REGION) - 1; rx <= Math.ceil(right / REGION); rx++)
      keys.push(rx + ',' + ry);
  }
  for (let i = 0; i < keys.length; i += 3) {
    if (!wanted.has(key)) return;
    regs.push(...(await Promise.all(keys.slice(i, i + 3).map(region))).filter(Boolean));
  }
  if (!wanted.has(key)) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = regs.length ? '#d6ceb0' : '#20241c';
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.setTransform(1 / mpp, 0, 0, 1 / mpp, -left / mpp, -top / mpp);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const areas = [],
    lines = [],
    buildings = [],
    roads = [];
  const owners = new Set(keys),
    seen = new Set();
  const visible = (shape) =>
    shape.right >= left - 30 &&
    shape.left <= right + 30 &&
    shape.bottom >= top - 30 &&
    shape.top <= bottom + 30;
  for (const r of regs) {
    for (const a of r.areas) if (visible(a)) areas.push(a);
    for (const l of r.lines) if (visible(l)) lines.push(l);
    for (const b of r.buildings) if (visible(b)) buildings.push(b);
    for (const s of r.roads) {
      if (!visible(s) || (s.owner && owners.has(s.owner)) || (s.shared && seen.has(s.shared))) continue;
      if (s.shared) seen.add(s.shared);
      roads.push(s);
    }
  }
  areas.sort((a, b) => areaOrder.indexOf(a.k) - areaOrder.indexOf(b.k));
  for (const a of areas) {
    ctx.fillStyle = AREA[a.k] || '#d6ceb0';
    ctx.fill(a.path, 'evenodd');
  }
  for (const l of lines) {
    ctx.strokeStyle = l.k < 2 ? '#a39790' : l.k < 6 ? '#78aad6' : '#b4b4bf';
    ctx.lineWidth = Math.max(mpp, l.k < 2 ? 2 : l.width);
    ctx.stroke(l.path);
  }
  ctx.lineWidth = Math.min(mpp * 0.9, 0.65);
  ctx.strokeStyle = '#9e9184';
  for (const b of buildings) {
    ctx.fillStyle = b.color;
    ctx.fill(b.path);
    if (mpp <= 2) ctx.stroke(b.path);
  }
  roads.sort((a, b) => a.layer - b.layer || roadOrder.indexOf(a.k) - roadOrder.indexOf(b.k));
  for (let i = 0; i < roads.length; ) {
    let j = i + 1;
    while (j < roads.length && roads[j].layer === roads[i].layer) j++;
    for (const casing of [true, false])
      for (let k = i; k < j; k++) {
        const r = roads[k];
        if (r.sidewalk && (casing || mpp > 2)) continue;
        ctx.lineWidth = Math.max(mpp * 0.9, r.width) + (casing ? mpp * 1.4 : 0);
        ctx.strokeStyle = r.sidewalk
          ? '#b4aa99'
          : casing
            ? '#ada493'
            : r.flags & F.UNPAVED
              ? '#cda078'
              : roadColors[r.k];
        ctx.stroke(r.path);
      }
    i = j;
  }
  const bitmap = canvas.transferToImageBitmap();
  const labels = roads.flatMap((r) =>
    r.labels.filter((p) => p.x >= left && p.x < right && p.y >= top && p.y < bottom)
  );
  postMessage({ key, bitmap, labels }, [bitmap]);
}

async function drain() {
  if (active) return;
  active = true;
  try {
    while (wanted.size) {
      const [key, tile] = wanted.entries().next().value;
      try {
        await render(tile);
      } catch {
        postMessage({ key, failed: true });
      }
      wanted.delete(key);
    }
  } finally {
    active = false;
  }
}

onmessage = (e) => {
  if (e.data.regions) {
    exists = new Set(e.data.regions);
    streetRegions = new Set(e.data.streetRegions);
    streetChunk = e.data.streetChunk;
    base = e.data.base;
  } else {
    wanted = new Map(e.data.tiles.map((t) => [t.key, t]));
    drain();
  }
};
