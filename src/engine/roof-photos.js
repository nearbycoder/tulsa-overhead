// Survey roof charts are streamed independently of collision and building geometry.
// Only the small region indexes and photo sheets currently needed for drawing are retained.
const ROOT = new URL('../../assets/map/roof-photos/', import.meta.url);
const SIDE = 2048;
const regions = new Map(), sheets = new Map();
let regionKeys, indexPending = false, indexRetry = 0;

async function loadIndex() {
  indexPending = true;
  try {
    const response = await fetch(new URL('index.json', ROOT));
    if (!response.ok) throw Error('Roof index unavailable');
    regionKeys = new Set((await response.json()).regionKeys);
  } catch { indexRetry = Date.now() + 30000; }
  finally { indexPending = false; }
}

function cached(cache, key, limit, load) {
  let item = cache.get(key);
  if (!item || (item.retry && item.retry < Date.now())) {
    item = {};
    cache.set(key, item);
    load(key).then(value => { item.value = value; }).catch(() => { item.retry = Date.now() + 30000; });
  } else if (item !== cache.lastUsed) {
    cache.delete(key);
    cache.set(key, item);
  }
  cache.lastUsed = item;
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  return item.value;
}

async function loadRegion(key) {
  const res = await fetch(new URL(key + '.bin.gz', ROOT));
  if (!res.ok) throw Error('Roof chart index unavailable');
  let bytes = await res.arrayBuffer();
  const header = new Uint8Array(bytes, 0, 2);
  if (header[0] === 31 && header[1] === 139) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = await new Response(stream).arrayBuffer();
  }
  const basis = new Float32Array(bytes, 0, 4), data = new Int16Array(bytes, 16);
  const lookup = new Map();
  for (let i = 0; i < data.length; i += 5) lookup.set(data[i] * 32768 + data[i + 1], i);
  return { basis, data, lookup };
}

async function loadSheet(id) {
  const image = new Image();
  image.src = new URL('sheets/' + id + '.webp', ROOT);
  await image.decode();
  return { image, patterns: new WeakMap() };
}

export function roofPhoto(ctx, b, st) {
  if (st.photo === null) return;
  if (!st.photo) {
    if (!regionKeys) {
      if (!indexPending && Date.now() >= indexRetry) loadIndex();
      return;
    }
    const cx = (b.bb[0] + b.bb[2]) * 0.5, cy = (b.bb[1] + b.bb[3]) * 0.5;
    const rx = Math.floor(cx / SIDE), ry = Math.floor(cy / SIDE);
    const key = rx + '_' + ry;
    if (!regionKeys.has(key)) { st.photo = null; return; }
    const region = cached(regions, key, 12, loadRegion);
    if (!region) return;
    const dx = Math.round((cx - rx * SIDE) * 10), dy = Math.round((cy - ry * SIDE) * 10);
    const i = region.lookup.get(dx * 32768 + dy);
    if (i === undefined) { st.photo = null; return; }
    const data = region.data;
    st.photo = { id: data[i + 2], x: rx * SIDE + dx / 10, y: ry * SIDE + dy / 10,
      u: data[i + 3] / 10, v: data[i + 4] / 10, basis: region.basis };
  }
  const sheet = cached(sheets, st.photo.id, 20, loadSheet);
  if (!sheet) return;
  let pattern = sheet.patterns.get(ctx);
  if (!pattern) { pattern = ctx.createPattern(sheet.image, 'no-repeat'); sheet.patterns.set(ctx, pattern); }
  return { chart: st.photo, pattern, image: sheet.image };
}

// Project the atlas basis onto each roof plane. The same survey coordinates meet on
// both sides of the ridge, even though those two slopes have different screen transforms.
export function paintRoofPhoto(ctx, cam, photo, x, y, h, gx, gy, brightness) {
  const { chart, pattern } = photo;
  const [xx, xy, yx, yy] = chart.basis;
  const pf = cam.pf(cam.ch(h)), scale = cam.zoom * pf;
  const ox = x - cam.x - cam.shakeX, oy = y - cam.y - cam.shakeY;
  const derivative = pf * Math.exp(-h / cam.Hc) / cam.D;
  const du = derivative * (gx * xx + gy * yx), dv = derivative * (gx * xy + gy * yy);
  const a = scale * (xx + ox * du), b = scale * (yx + oy * du);
  const c = scale * (xy + ox * dv), d = scale * (yy + oy * dv);
  const dx = chart.x - x, dy = chart.y - y, dz = derivative * (gx * dx + gy * dy);
  pattern.setTransform({ a, b, c, d,
    e: cam.W * 0.5 + scale * (ox + dx + ox * dz) - a * chart.u - c * chart.v,
    f: cam.H * 0.5 + scale * (oy + dy + oy * dz) - b * chart.u - d * chart.v });
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = pattern;
  ctx.fill();
  ctx.imageSmoothingEnabled = smoothing;
  if (brightness < 0.99) {
    ctx.fillStyle = 'rgba(11,15,25,' + Math.max(0, 1 - brightness) + ')';
    ctx.fill();
  }
}
