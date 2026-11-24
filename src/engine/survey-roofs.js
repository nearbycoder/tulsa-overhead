// Close views use the surveyed LiDAR surface where it matches this footprint. Each
// visible roof occupies one slot of a shared WebGL canvas, then the 2D painter
// composites that slot at its normal building depth (including player occlusion).
import { materialTile, ROOF_MATERIAL_PERIOD } from './building-materials.js';
import { roofPhoto } from './roof-photos.js';

const ROOT = new URL('../../assets/map/survey-roofs/', import.meta.url);
const SIDE = 2048;
const regions = new Map();
let keys, retry = 0, loading = false, gpu;

async function loadIndex() {
  loading = true;
  try {
    const res = await fetch(new URL('index.json', ROOT));
    if (!res.ok) throw Error();
    keys = new Set((await res.json()).regionKeys);
  } catch { retry = Date.now() + 30000; }
  finally { loading = false; }
}

async function readRegion(key) {
  const res = await fetch(new URL(key + '.bin.gz', ROOT));
  if (!res.ok) throw Error();
  let bytes = await res.arrayBuffer();
  const header = new Uint8Array(bytes, 0, 2);
  if (header[0] === 31 && header[1] === 139) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = await new Response(stream).arrayBuffer();
  }
  const entries = new Map(), words = new Uint16Array(bytes);
  for (let pos = 0; pos < bytes.byteLength;) {
    const at = pos / 2, nv = words[at + 2], nt = words[at + 3], nr = words[at + 4];
    const vertices = new Int16Array(bytes, pos + 10, nv * 3);
    const faces = new Uint8Array(bytes, pos + 10 + nv * 6, nt * 3);
    const rim = new Uint8Array(bytes, faces.byteOffset + faces.length, nr);
    let eave = Infinity, peak = 0;
    for (const i of rim) eave = Math.min(eave, vertices[i * 3 + 2] / 100);
    for (let i = 2; i < vertices.length; i += 3) peak = Math.max(peak, vertices[i] / 100);
    entries.set(words[at] * 32768 + words[at + 1], { vertices, faces, rim, eave, peak });
    pos = rim.byteOffset + rim.length;
    pos += pos % 2;
  }
  return entries;
}

function lookup(b) {
  const cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2;
  const rx = Math.floor(cx / SIDE), ry = Math.floor(cy / SIDE), key = rx + '_' + ry;
  if (!keys.has(key)) return;
  let region = regions.get(key);
  if (!region || region.retry < Date.now()) {
    region = {};
    regions.set(key, region);
    readRegion(key).then(entries => { region.entries = entries; }).catch(() => { region.retry = Date.now() + 30000; });
    if (regions.size > 12) regions.delete(regions.keys().next().value);
  } else if (regions.last !== key) {
    regions.delete(key); regions.set(key, region);
  }
  regions.last = key;
  if (!region.entries) return;
  const dx = Math.round((cx - rx * SIDE) * 10), dy = Math.round((cy - ry * SIDE) * 10);
  const mesh = region.entries.get(dx * 32768 + dy);
  if (mesh && mesh.x === undefined) {
    mesh.key = key + '/' + dx + '_' + dy;
    mesh.x = rx * SIDE + dx / 10;
    mesh.y = ry * SIDE + dy / 10;
  }
  return mesh;
}

// Draw the ground silhouette of the entire measured surface, including a higher
// wing casting over its lower neighbour. A path uses metres relative to the mesh
// origin, so camera motion and resolution changes can reuse it.
const shadowPaths = new Map();
export function drawSurveyShadow(ctx, cam, b, sunX, sunY, detail) {
  if (!gpu || !keys || detail < 2 || cam.zoom < 3.5 || b._st?.drawLandmark) return false;
  const mesh = lookup(b);
  if (!mesh) return false;
  const sx = Math.round(sunX * 100) / 100, sy = Math.round(sunY * 100) / 100;
  const hc = Math.round(cam.Hc * 2) / 2;
  let cached = shadowPaths.get(mesh.key);
  if (cached) shadowPaths.delete(mesh.key);
  if (!cached || cached.sx !== sx || cached.sy !== sy || cached.hc !== hc) {
    const { vertices, rim, faces } = mesh, path = new Path2D();
    const px = new Float32Array(vertices.length / 3), py = new Float32Array(px.length);
    for (let i = 0; i < px.length; i++) {
      const h = hc * (1 - Math.exp(-vertices[i * 3 + 2] / (100 * hc)));
      px[i] = vertices[i * 3] / 100 + h * sx;
      py[i] = vertices[i * 3 + 1] / 100 + h * sy;
    }
    // Give every projected triangle and wall the same winding for their union.
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i + 1], c = faces[i + 2];
      const forward = (px[b] - px[a]) * (py[c] - py[a]) >= (py[b] - py[a]) * (px[c] - px[a]);
      path.moveTo(px[a], py[a]);
      path.lineTo(px[forward ? b : c], py[forward ? b : c]);
      path.lineTo(px[forward ? c : b], py[forward ? c : b]);
      path.closePath();
    }
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i], b = rim[(i + 1) % rim.length];
      const ax = vertices[a * 3] / 100, ay = vertices[a * 3 + 1] / 100;
      const bx = vertices[b * 3] / 100, by = vertices[b * 3 + 1] / 100;
      path.moveTo(ax, ay);
      if ((bx - ax) * sy >= (by - ay) * sx) {
        path.lineTo(bx, by); path.lineTo(px[b], py[b]); path.lineTo(px[a], py[a]);
      } else {
        path.lineTo(px[a], py[a]); path.lineTo(px[b], py[b]); path.lineTo(bx, by);
      }
      path.closePath();
    }
    cached = { path, sx, sy, hc };
  }
  shadowPaths.set(mesh.key, cached);
  if (shadowPaths.size > 128) shadowPaths.delete(shadowPaths.keys().next().value);
  ctx.save();
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, cam.W / 2 + (mesh.x - cam.x - cam.shakeX) * cam.zoom,
    cam.H / 2 + (mesh.y - cam.y - cam.shakeY) * cam.zoom);
  ctx.fill(cached.path);
  ctx.restore();
  return true;
}

// The roof can project beyond the ordinary eave at gable ends and over stepped
// wings. Test its real triangles only when the player is inside its screen tile.
export function surveyCoversFocus(tile, cam, x, y) {
  if (x < tile.x || y < tile.y || x > tile.x + tile.w || y > tile.y + tile.h) return false;
  const { mesh } = tile, { vertices, faces } = mesh;
  const projected = mesh.projected ||= new Float32Array(vertices.length / 3 * 2);
  const xy = [0, 0];
  for (let v = 0, p = 0; v < vertices.length; v += 3, p += 2) {
    cam.toScreen(mesh.x + vertices[v] / 100, mesh.y + vertices[v + 1] / 100, vertices[v + 2] / 100, xy);
    projected[p] = xy[0] - x;
    projected[p + 1] = xy[1] - y;
  }
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] * 2, b = faces[i + 1] * 2, c = faces[i + 2] * 2;
    const ab = projected[a] * projected[b+1] - projected[a+1] * projected[b];
    const bc = projected[b] * projected[c+1] - projected[b+1] * projected[c];
    const ca = projected[c] * projected[a+1] - projected[c+1] * projected[a];
    if ((ab > 0 && bc > 0 && ca > 0) || (ab < 0 && bc < 0 && ca < 0)) return true;
  }
  return false;
}

const VS = `#version 300 es
in vec3 point;
uniform vec2 anchor, centre, perspective;
uniform float zoom;
uniform vec4 crop;
out vec3 pos;
void main() {
  pos = point * .01;
  float h = perspective.y * (1. - exp(-pos.z / perspective.y));
  float scale = perspective.x / (perspective.x - h);
  vec2 screen = centre + zoom * scale * (anchor + pos.xy);
  vec2 uv = (screen - crop.xy) / crop.zw;
  gl_Position = vec4(uv * vec2(2., -2.) + vec2(-1., 1.), -pos.z / 32., 1.);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 pos;
uniform vec3 color;
uniform vec2 anchor;
uniform float daylight;
uniform bool photo, wall;
uniform vec2 uvOrigin;
uniform mat2 uvBasis;
uniform sampler2D sheet, material;
uniform vec2 axis;
uniform float period;
out vec4 pixel;
void main() {
  vec3 n = normalize(cross(dFdx(pos), dFdy(pos)));
  float lit;
  if (wall) {
    // Normals of visible upper walls point horizontally towards the camera.
    if (dot(n.xy, anchor + pos.xy) > 0.) n = -n;
    lit = .62 + .38 * max(-.3, dot(n.xy, vec2(-.55, -.83)));
  } else {
    if (n.z < 0.) n = -n;
    lit = .81 + .24 * dot(n, normalize(vec3(-.55, -.83, .9)));
  }
  vec3 base = color;
  if (photo) {
    base = texture(sheet, uvOrigin + uvBasis * pos.xy).rgb;
    lit = .50 + .50 * lit;
  }
  vec3 finish = base * lit * daylight;
  if (!wall) {
    // Snap courses to the footprint axes. Adjacent triangles on a nearly planar
    // survey face then share their texture, including across sampling noise.
    vec2 across = vec2(-axis.y, axis.x);
    vec2 uv = vec2(dot(pos.xy, axis), dot(pos.xy, across)) / period;
    if (abs(dot(n.xy, axis)) > abs(dot(n.xy, across))) uv = vec2(uv.y, -uv.x);
    vec4 grain = texture(material, uv);
    finish = mix(finish, grain.rgb * daylight, grain.a * .85);
  }
  pixel = vec4(finish, 1.);
}`;

function makeGpu() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true, stencil: false });
  if (!gl) return null;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gpu = null; });
  canvas.addEventListener('webglcontextrestored', () => { gpu = undefined; });
  const program = gl.createProgram();
  const shaders = [];
  for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    gl.attachShader(program, shader); shaders.push(shader);
  }
  gl.linkProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  const loc = {};
  for (const name of ['anchor','centre','perspective','zoom','crop','color','daylight','photo','wall','uvOrigin','uvBasis','axis','period']) {
    loc[name] = gl.getUniformLocation(program, name);
  }
  // A complete texture is required by WebGL even if the shader's photo branch is disabled.
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, 'material'), 1);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.activeTexture(gl.TEXTURE0);
  return { canvas, gl, loc, materials: new Map(), vertex: gl.getAttribLocation(program, 'point'), blank, meshes: new Map(), sheets: new Map() };
}

function buffers(g, mesh) {
  const key = mesh.key;
  let result = g.meshes.get(key);
  if (result) { g.meshes.delete(key); g.meshes.set(key, result); return result; }
  const { gl } = g, { vertices, faces, rim } = mesh;
  const nv = vertices.length / 3;
  const coords = new Int16Array(vertices.length + rim.length * 3);
  const indices = new Uint16Array(faces.length + rim.length * 6);
  coords.set(vertices); indices.set(faces);
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    coords.set([vertices[rim[i] * 3], vertices[rim[i] * 3 + 1], Math.round(mesh.eave * 100)], (nv + i) * 3);
    indices.set([rim[i], rim[j], nv + j, rim[i], nv + j, nv + i], faces.length + i * 6);
  }
  const vbo = gl.createBuffer(), ebo = gl.createBuffer(), vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
  gl.vertexAttribPointer(g.vertex, 3, gl.SHORT, false, 0, 0); gl.enableVertexAttribArray(g.vertex);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  result = { vbo, ebo, vao };
  g.meshes.set(key, result);
  if (g.meshes.size > 160) {
    const first = g.meshes.keys().next().value, old = g.meshes.get(first);
    gl.deleteVertexArray(old.vao); gl.deleteBuffer(old.vbo); gl.deleteBuffer(old.ebo);
    g.meshes.delete(first);
  }
  return result;
}

function texture(g, image) {
  let tex = g.sheets.get(image);
  if (tex) { g.sheets.delete(image); g.sheets.set(image, tex); return tex; }
  const { gl } = g;
  tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  g.sheets.set(image, tex);
  if (g.sheets.size > 6) {
    const first = g.sheets.keys().next().value;
    gl.deleteTexture(g.sheets.get(first)); g.sheets.delete(first);
  }
  return tex;
}

function bindMaterial(g, kind) {
  const { gl } = g;
  gl.activeTexture(gl.TEXTURE1);
  let tex = g.materials.get(kind);
  if (!tex) {
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, materialTile(kind));
    gl.generateMipmap(gl.TEXTURE_2D);
    g.materials.set(kind, tex);
  } else gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.activeTexture(gl.TEXTURE0);
}

function color(gl, loc, hex) {
  const rgb = parseInt(hex.slice(1), 16);
  gl.uniform3f(loc, (rgb >>> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255);
}

export function prepareSurveyRoofs(ctx, cam, blds, detail, daylight, getStyle) {
  const tiles = new Map();
  if (detail < 2 || cam.zoom < 3.5 || !blds.length || gpu === null) return tiles;
  if (!keys) {
    if (!loading && Date.now() >= retry) loadIndex();
    return tiles;
  }
  let sx = 0, sy = 0, row = 0;
  // At most one 1536-square render target. Clip to the viewport and downsample
  // oversized roofs so a single campus cannot allocate a screen-sized canvas.
  const atlasSize = 1536;
  for (const b of blds) {
    const mesh = lookup(b);
    if (!mesh) continue;
    const st = b._st || (b._st = getStyle(b));
    if (st.drawLandmark) continue;
    const ox = cam.x + cam.shakeX, oy = cam.y + cam.shakeY;
    const peakScale = cam.pf(cam.ch(mesh.peak)), eaveScale = cam.pf(cam.ch(mesh.eave));
    const [x0,y0,x1,y1] = b.bb;
    const edge = (value, centre, origin, low) => {
      const offset = (value - origin) * cam.zoom;
      const peak = offset * peakScale, eave = offset * eaveScale;
      return centre + (low ? Math.min(peak, eave) : Math.max(peak, eave));
    };
    // The footprint importer simplifies within a metre, so include its tolerance.
    const margin = 1 + cam.zoom * peakScale;
    const x = Math.max(0, Math.floor(edge(x0, cam.W / 2, ox, true) - margin));
    const y = Math.max(0, Math.floor(edge(y0, cam.H / 2, oy, true) - margin));
    const w = Math.min(cam.W, Math.ceil(edge(x1, cam.W / 2, ox, false) + margin)) - x;
    const h = Math.min(cam.H, Math.ceil(edge(y1, cam.H / 2, oy, false) + margin)) - y;
    if (w < 1 || h < 1) continue;
    const scale = Math.min(1, 768 / Math.max(w,h));
    const sw = Math.ceil(w * scale), sh = Math.ceil(h * scale);
    if (sx + sw > atlasSize) { sx = 0; sy += row; row = 0; }
    if (sy + sh > atlasSize) continue;
    const tile = { sx, sy, sw, sh, x, y, w, h, mesh };
    tiles.set(b, tile);
    sx += sw; row = Math.max(sh, row);
  }
  if (!tiles.size) return tiles;
  if (gpu === undefined) gpu = makeGpu();
  if (!gpu) { tiles.clear(); return tiles; }
  const { gl, loc, canvas } = gpu;
  if (canvas.width !== atlasSize) canvas.width = atlasSize;
  // Grow in 128px steps. Most driving views need only a few hundred rows.
  const needed = Math.ceil((sy + row) / 128) * 128;
  if (canvas.height < needed) canvas.height = needed;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform2f(loc.centre, cam.W / 2, cam.H / 2);
  gl.uniform2f(loc.perspective, cam.D, cam.Hc);
  gl.uniform1f(loc.zoom, cam.zoom); gl.uniform1f(loc.daylight, daylight);
  for (const [b,t] of tiles) {
    const { mesh } = t, st = b._st;
    gl.bindVertexArray(buffers(gpu, mesh).vao);
    gl.viewport(t.sx, canvas.height - t.sy - t.sh, t.sw, t.sh);
    gl.uniform4f(loc.crop, t.x, t.y, t.w, t.h);
    gl.uniform2f(loc.anchor, mesh.x - cam.x - cam.shakeX, mesh.y - cam.y - cam.shakeY);
    color(gl, loc.color, st.wall);
    gl.uniform1i(loc.wall, 1); gl.uniform1i(loc.photo, 0);
    gl.drawElements(gl.TRIANGLES, mesh.rim.length * 6, gl.UNSIGNED_SHORT, mesh.faces.length * 2);
    const photo = roofPhoto(ctx, b, st);
    gl.uniform1i(loc.wall, 0); gl.uniform1i(loc.photo, !!photo);
    color(gl, loc.color, st.roof);
    // A complex pitched house can have a flat classification in the coarser survey.
    const material = st.windows === 'house' ? 'shingle' : st.material;
    bindMaterial(gpu, material);
    gl.uniform2fv(loc.axis, st.axis);
    gl.uniform1f(loc.period, ROOF_MATERIAL_PERIOD[material]);
    if (photo) {
      const { chart, image } = photo, [a,bx,c,d] = chart.basis, det = a * d - bx * c;
      gl.bindTexture(gl.TEXTURE_2D, texture(gpu, image));
      gl.uniformMatrix2fv(loc.uvBasis, false, [d / det / image.width, -c / det / image.height,
        -bx / det / image.width, a / det / image.height]);
      gl.uniform2f(loc.uvOrigin, chart.u / image.width, chart.v / image.height);
    } else gl.bindTexture(gl.TEXTURE_2D, gpu.blank);
    gl.drawElements(gl.TRIANGLES, mesh.faces.length, gl.UNSIGNED_SHORT, 0);
    t.canvas = canvas;
  }
  return tiles;
}
