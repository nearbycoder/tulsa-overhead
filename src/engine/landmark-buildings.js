// Match the imported survey outline once, when the ordinary building style is cached.
// The game keeps its existing collision, fade, painter order and 2D rendering fallback.
import { landmarkModels } from '../data/landmark-models.js';

const sitesByX = new Map();
for (const site of landmarkModels) {
  const x = site.footprint[0];
  if (!sitesByX.has(x)) sitesByX.set(x, []);
  sitesByX.get(x).push(site);
}

const vertexSource = `#version 300 es
  in vec3 aPosition;
  in vec4 aColor;
  uniform vec2 uOffset;
  uniform vec2 uScreen;
  uniform vec3 uCamera;
  out vec4 color;
  out vec3 localPosition;
  void main() {
    vec3 pos = aPosition * .01;
    float h = uCamera.z * (1.0 - exp(-max(pos.z, 0.0) / uCamera.z));
    float perspective = uCamera.y / (uCamera.y - h);
    vec2 screen = (uOffset + pos.xy) * uCamera.x * perspective / uScreen;
    gl_Position = vec4(screen.x, -screen.y, -pos.z / 300.0, 1.0);
    localPosition = pos;
    color = aColor;
  }`;
const fragmentSource = `#version 300 es
  precision highp float;
  in vec4 color;
  in vec3 localPosition;
  uniform float uNight;
  uniform sampler2D uRoof;
  uniform sampler2D uFinishes;
  uniform vec4 uRoofUV;
  out vec4 result;
  void main() {
    vec3 rgb = color.rgb * (1.0 - .40 * uNight);
    int flags = int(color.a * 255.0 + .5);
    if (uRoofUV.z > 0.0 && (flags & 2) != 0) {
      vec3 aerial = texture(uRoof, (localPosition.xy - uRoofUV.xy) / uRoofUV.zw).rgb;
      // Retain modeled roof planes and decorative caps while restoring measured
      // rooftop variation from the registered NAIP image.
      float luma = dot(aerial, vec3(.24, .58, .18));
      rgb = mix(rgb, aerial * (.86 + .18 * dot(color.rgb, vec3(.3,.5,.2))) * (1.0 - .40 * uNight), .64)
            * (.96 + .08 * luma);
    }
    int finish = flags >> 2;
    if (finish > 0) {
      vec3 n = normalize(cross(dFdx(localPosition), dFdy(localPosition)));
      if (n.z < 0.) n = -n;
      vec2 u = length(n.xy) > .02 ? normalize(vec2(-n.y, n.x)) : vec2(1.,0.);
      vec3 v = cross(n, vec3(u, 0.));
      vec2 uv = vec2(dot(localPosition.xy, u), dot(localPosition, v)) / 3.2;
      vec2 uvAtlas = vec2(float(finish - 1), 0.) + clamp(fract(uv), .002, .998);
      float grain = textureGrad(uFinishes, uvAtlas * vec2(.25, 1.), dFdx(uv)*vec2(.25,1.), dFdy(uv)*vec2(.25,1.)).r;
      rgb *= .54 + .92 * grain;
    }
    if ((flags & 1) != 0) {
      float row = floor(localPosition.z / 3.4);
      float bay = floor((localPosition.x + localPosition.y) / 3.3);
      float lit = step(.70, fract(sin(row * 14.35 + bay * 9.54) * 456.51));
      rgb = mix(rgb, vec3(.84, .69, .40), lit * uNight * .77);
    }
    result = vec4(rgb, 1.0);
  }`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
  return shader;
}

let surface;
function getSurface() {
  if (surface !== undefined) return surface;
  surface = null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: true, depth: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;
  try {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uFinishes'), 1);
    gl.activeTexture(gl.TEXTURE1);
    const finishes = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, finishes);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128,128,128,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    const image = new Image();
    image.onload = () => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, finishes);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.activeTexture(gl.TEXTURE0);
    };
    image.src = new URL('../../assets/landmarks/materials.webp', import.meta.url).href;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.SCISSOR_TEST);
    surface = { canvas, gl, buffers: new Map(),
      position: gl.getAttribLocation(program, 'aPosition'), color: gl.getAttribLocation(program, 'aColor'),
      offset: gl.getUniformLocation(program, 'uOffset'), screen: gl.getUniformLocation(program, 'uScreen'),
      camera: gl.getUniformLocation(program, 'uCamera'), night: gl.getUniformLocation(program, 'uNight'),
      roofUV: gl.getUniformLocation(program, 'uRoofUV') };
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); surface = null; });
    canvas.addEventListener('webglcontextrestored', () => { surface = undefined; });
  } catch (error) {
    console.warn('Landmark rendering unavailable', error);
  }
  return surface;
}

async function loadMesh(s, site) {
  const url = new URL('../../assets/landmarks/' + site.model + '.mesh.gz', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw Error(`${response.status} ${url.pathname}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 31 && bytes[1] === 139) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const header = new DataView(bytes.buffer);
  const vertexBytes = header.getUint32(0, true) * 10;
  const count = header.getUint32(4, true);
  const indexOffset = Math.ceil((8 + vertexBytes) / 4) * 4;
  if (indexOffset + count * 4 !== bytes.byteLength) throw Error('Invalid landmark mesh length');
  const gl = s.gl;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, bytes.subarray(8, 8 + vertexBytes), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(s.position);
  gl.vertexAttribPointer(s.position, 3, gl.SHORT, false, 10, 0);
  gl.enableVertexAttribArray(s.color);
  gl.vertexAttribPointer(s.color, 4, gl.UNSIGNED_BYTE, true, 10, 6);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bytes.subarray(indexOffset), gl.STATIC_DRAW);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // A complete default texture also covers landmarks without usable roof photography.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const mesh = { vao, count, texture, roofUV: [0, 0, 0, 0] };
  s.buffers.set(site.model, mesh);
  if (site.roofUV) {
    const image = new Image();
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      mesh.roofUV = site.roofUV;
    };
    image.src = new URL(site.model + '.webp', url).href;
  }
}

function drawModel(ctx, cam, building, style, detail, night) {
  const site = style.landmark;
  if (!detail) return false;
  const surface = getSurface();
  if (!surface) return false;
  const mesh = surface.buffers.get(site.model);
  if (!mesh) {
    if (!surface.buffers.has(site.model) && !(site.retryAt > performance.now())) {
      surface.buffers.set(site.model, null);
      loadMesh(surface, site).catch(error => {
        surface.buffers.delete(site.model);
        site.retryAt = performance.now() + 30000;
        console.warn('Landmark model unavailable', site.model, error);
      });
    }
    return false;
  }

  // A scissored transparent buffer allows props and people to interleave with
  // individual landmarks in the game's normal painter order.
  const [xmin, ymin, xmax, ymax, height] = site.bounds;
  const dx = site.x - cam.x - cam.shakeX, dy = site.y - cam.y - cam.shakeY;
  const perspective = cam.D / (cam.D - cam.ch(height));
  const left = Math.max(0, Math.floor(cam.W / 2 + (dx + xmin) * cam.zoom * (dx + xmin < 0 ? perspective : 1)) - 1);
  const top = Math.max(0, Math.floor(cam.H / 2 + (dy + ymin) * cam.zoom * (dy + ymin < 0 ? perspective : 1)) - 1);
  const right = Math.min(cam.W, Math.ceil(cam.W / 2 + (dx + xmax) * cam.zoom * (dx + xmax > 0 ? perspective : 1)) + 1);
  const bottom = Math.min(cam.H, Math.ceil(cam.H / 2 + (dy + ymax) * cam.zoom * (dy + ymax > 0 ? perspective : 1)) + 1);
  const w = right - left, h = bottom - top;
  if (w <= 0 || h <= 0) return true;
  const { gl, canvas } = surface;
  // Keep the original viewport origin. Moving it can change triangle edge
  // coverage and the texture samples of a narrow window, even by whole pixels.
  const neededW = right, neededH = cam.H - top;
  // A canvas snapshot can cost the full backing-store size even for a source
  // rectangle. Trim the unused upper and right portions at full resolution.
  const resized = surface.viewW !== cam.W || surface.viewH !== cam.H;
  if (resized || !surface.remaining || canvas.width < neededW || canvas.height < neededH) {
    // Grow immediately. Shrink to the largest model in the last 120 draws so
    // differently sized neighbouring buildings can share a stable surface.
    const retainW = resized ? 0 : surface.remaining ? canvas.width : surface.peakW;
    const retainH = resized ? 0 : surface.remaining ? canvas.height : surface.peakH;
    const targetW = Math.min(cam.W, Math.ceil(Math.max(neededW, retainW) / 128) * 128);
    const targetH = Math.min(cam.H, Math.ceil(Math.max(neededH, retainH) / 128) * 128);
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
  }
  if (resized || !surface.remaining) {
    surface.viewW = cam.W; surface.viewH = cam.H;
    surface.peakW = 0; surface.peakH = 0; surface.remaining = 120;
  }
  surface.remaining--;
  surface.peakW = Math.max(surface.peakW, neededW);
  surface.peakH = Math.max(surface.peakH, neededH);
  if (resized) gl.viewport(0, 0, cam.W, cam.H);
  gl.scissor(left, cam.H - bottom, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform2f(surface.offset, dx, dy);
  gl.uniform2f(surface.screen, cam.W / 2, cam.H / 2);
  gl.uniform3f(surface.camera, cam.zoom, cam.D, cam.Hc);
  gl.uniform1f(surface.night, night);
  gl.bindTexture(gl.TEXTURE_2D, mesh.texture);
  gl.uniform4fv(surface.roofUV, mesh.roofUV);
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  ctx.drawImage(canvas, left, canvas.height - neededH, w, h, left, top, w, h);
  return true;
}

function drawWaterTower(ctx, cam, building) {
  const { x, y, sprite } = building.towerSprite;
  sprite.draw(ctx, cam, x, y, Math.PI / 2, { step: cam.zoom < 5 ? 2 : 1 });
  return true;
}

// Use the ordinary footprint height while a mesh is downloading, if WebGL is
// unavailable or when detail is off. Sprite towers are available at every preset.
export function displayedLandmarkHeight(building, detail) {
  if (building.towerSprite) return building.towerSprite.sprite.height;
  const site = building._st?.landmark;
  return detail && site && surface?.buffers.get(site.model) ? site.bounds[4] : null;
}

export function applyLandmarkStyle(building, style) {
  if (building.towerSprite) {
    style.drawLandmark = drawWaterTower;
    return style;
  }
  const p = building.pts;
  const candidates = sitesByX.get(Math.round(p[0] * 10));
  if (!candidates) return style;
  for (const site of candidates) {
    const [, y, length, dx, dy] = site.footprint;
    if (p.length !== length || Math.round(p[1] * 10) !== y ||
        Math.round((p[2] - p[0]) * 10) !== dx || Math.round((p[3] - p[1]) * 10) !== dy) continue;
    style.landmark = site;
    style.drawLandmark = drawModel;
    break;
  }
  return style;
}
