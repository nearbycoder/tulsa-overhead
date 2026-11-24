// Tulsa Overhead — procedural audio system (src/engine/audio.js)
// -----------------------------------------------------------------------------
// Every sound is synthesised with the Web Audio API: no samples, no downloads,
// no third-party code. One-shots are baked once into AudioBuffers via
// OfflineAudioContext; loops and musical instruments are baked by small JS DSP
// routines (Karplus-Strong, additive, FM, formant); engines and sirens are live
// node graphs; radio music comes from per-genre generative sequencers scheduled
// with a lookahead timer.
//
// PUBLIC API  (import { audio } from './engine/audio.js')
//   await audio.init()                 call from the first user gesture (click/keydown)
//   audio.setVolumes({master,sfx,music,voice,radio})   0..1 (audio-taper); audio.volumes
//   audio.setMuted(bool)
//   audio.setListener(x, y, zoom)      world metres, every frame. zoom = camera scale
//                                      (1 default, <1 zoomed out => hear further)
//   audio.play(name, {x, y, vol, pitch, rand, delay, bus}) -> {stop(f), playing}
//   audio.createEngine(profile) -> {setState({rpm,throttle,speed}), setPos(x,y),
//                                   setPlayer(bool), setVolume(v), stop(), live}
//   audio.createSiren('police'|'ambulance'|'fire') -> {setPos, setMode, setVelocity, setVolume, stop}
//        modes: 'auto' (police/ambulance default, alternates), 'wail', 'yelp', 'hilo', 'growl' (fire default)
//   audio.createLoop(name) -> {setIntensity(0..1), setPos(x,y), setVolume, stop}
//   audio.playVoice(url, {channel, onEnd, vol}) -> Promise<bool natural end>; audio.stopVoice(channel?); audio.preloadVoice(url)
//   audio.radio: {stations, current (-1 = off), station, nowPlaying, play(i), next(), prev(), off(),
//                 onChange(cb) -> unsubscribe, setInCar(bool)}
//   audio.playMusic('title'|'mission'|'chase'), audio.stopMusic(fade), audio.setMusicIntensity(0..1)
//   catalogues: audio.soundNames, engineProfiles, loopNames, sirenTypes, stations
//   tooling: renderStation / renderEngine / renderSiren / renderLoop / renderInstrument /
//            renderStress / renderOffline, AudioSys.encodeWAV(buffer)
// -----------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

// Small deterministic PRNG (mulberry32) with musical helpers.
class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(a) { return a[Math.floor(this.next() * a.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  // pairs: [[item, weight], ...]
  wpick(pairs) {
    let tot = 0;
    for (const p of pairs) tot += p[1];
    let r = this.next() * tot;
    for (const p of pairs) { if ((r -= p[1]) <= 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }
}

// ---------------------------------------------------------------- JS DSP ----
// RBJ biquad for offline baking (types: lp hp bp pk).
class BQ {
  constructor(sr, type = 'lp', f = 1000, q = 0.707, db = 0) {
    this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, db);
  }
  set(type, f, q = 0.707, db = 0) {
    const w = (TAU * clamp(f, 5, this.sr * 0.45)) / this.sr;
    const c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), A = Math.pow(10, db / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'hp': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'pk': b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
      default: b0 = 1; b1 = b2 = 0; a0 = 1; a1 = a2 = 0;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(a) { for (let i = 0; i < a.length; i++) a[i] = this.p(a[i]); return a; }
}

// Smooth low-frequency random signal (cosine-interpolated random points).
class LFN {
  constructor(rng, rate, sr, lo = -1, hi = 1) {
    this.rng = rng; this.step = rate / sr; this.ph = 0; this.lo = lo; this.hi = hi;
    this.a = rng.range(lo, hi); this.b = rng.range(lo, hi);
  }
  next() {
    this.ph += this.step;
    if (this.ph >= 1) { this.ph -= 1; this.a = this.b; this.b = this.rng.range(this.lo, this.hi); }
    const w = (1 - Math.cos(this.ph * Math.PI)) * 0.5;
    return this.a + (this.b - this.a) * w;
  }
}

function fillNoise(arr, rng, kind = 'white') {
  const n = arr.length;
  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      arr[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  } else if (kind === 'brown') {
    let l = 0;
    for (let i = 0; i < n; i++) { l = (l + 0.02 * (rng.next() * 2 - 1)) / 1.02; arr[i] = l * 3.5; }
  } else {
    for (let i = 0; i < n; i++) arr[i] = rng.next() * 2 - 1;
  }
  return arr;
}

function mkBuf(sr, len, ch = 1) {
  return new AudioBuffer({ length: Math.max(1, len | 0), numberOfChannels: ch, sampleRate: sr });
}
function bufFrom(sr, chans) {
  const b = mkBuf(sr, chans[0].length, chans.length);
  chans.forEach((d, i) => b.copyToChannel(d, i));
  return b;
}
function peakOf(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }
function normalize(a, peak = 0.9) { const m = peakOf(a); if (m > 1e-9) { const k = peak / m; for (let i = 0; i < a.length; i++) a[i] *= k; } return a; }
function normalizeMulti(chs, peak = 0.9) {
  let m = 0; for (const c of chs) m = Math.max(m, peakOf(c));
  if (m > 1e-9) { const k = peak / m; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }
  return chs;
}
function fadeEnds(a, inN = 32, outN = 256) {
  inN = Math.min(inN, a.length >> 1); outN = Math.min(outN, a.length >> 1);
  for (let i = 0; i < inN; i++) a[i] *= i / inN;
  for (let i = 0; i < outN; i++) a[a.length - 1 - i] *= i / outN;
  return a;
}
// Remove DC with a one-pole high-pass (~fc Hz).
function dcBlock(a, sr, fc = 15) {
  const R = Math.exp((-TAU * fc) / sr); let x1 = 0, y1 = 0;
  for (let i = 0; i < a.length; i++) { const y = a[i] - x1 + R * y1; x1 = a[i]; y1 = y; a[i] = y; }
  return a;
}
// Make a seamless loop: returns a new array (len - X) whose end flows into its start.
function loopXfade(d, X) {
  const N = d.length - X; const out = d.slice(0, N);
  for (let i = 0; i < X; i++) { const w = i / X; out[i] = d[i] * Math.sqrt(w) + d[N + i] * Math.sqrt(1 - w); }
  return out;
}
// Make loop region [ls, le) (samples) seamless in-place by blending the tail with pre-loop material.
function sustainLoop(d, ls, le, X) {
  X = Math.min(X, ls, le - ls - 1);
  for (let i = 0; i < X; i++) { const w = i / X; const j = le - X + i; d[j] = d[j] * (1 - w) + d[ls - X + i] * w; }
  return d;
}
// Trim trailing near-silence (keeps a short fade).
function trimTail(a, thr = 2e-4, minLen = 64) {
  let end = a.length - 1;
  while (end > minLen && Math.abs(a[end]) < thr) end--;
  const out = a.slice(0, Math.min(a.length, end + 64));
  return fadeEnds(out, 0, Math.min(256, out.length >> 2));
}

// ------------------------------------------------------- shared curves ----
const _curveCache = new Map();
function driveCurve(k) {
  const key = 'd' + k;
  if (_curveCache.has(key)) return _curveCache.get(key);
  const n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  _curveCache.set(key, c);
  return c;
}
function rectCurve() {
  if (_curveCache.has('rect')) return _curveCache.get('rect');
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = x > 0 ? Math.pow(x, 1.3) : 0; }
  _curveCache.set('rect', c);
  return c;
}

// Fourier coefficients of a periodic function fn(x), x∈[0,1). Normalised to peak 1, DC removed.
const _coefCache = new Map();
function fourier(key, fn, H = 64, N = 2048) {
  if (_coefCache.has(key)) return _coefCache.get(key);
  const x = new Float32Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) { x[i] = fn(i / N); mean += x[i]; }
  mean /= N;
  let mx = 0, mn = 0;
  for (let i = 0; i < N; i++) { x[i] -= mean; }
  for (let i = 0; i < N; i++) { if (x[i] > mx) mx = x[i]; if (x[i] < mn) mn = x[i]; }
  const sc = 1 / Math.max(mx, -mn, 1e-9);
  for (let i = 0; i < N; i++) x[i] *= sc;
  const cos = new Float32Array(N), sin = new Float32Array(N);
  for (let i = 0; i < N; i++) { cos[i] = Math.cos((TAU * i) / N); sin[i] = Math.sin((TAU * i) / N); }
  const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
  for (let h = 1; h <= H; h++) {
    let a = 0, b = 0, idx = 0;
    for (let i = 0; i < N; i++) { a += x[i] * cos[idx]; b += x[i] * sin[idx]; idx += h; if (idx >= N) idx -= N; }
    re[h] = (2 * a) / N; im[h] = (2 * b) / N;
  }
  const res = { re, im, min: mn * sc, max: mx * sc };
  _coefCache.set(key, res);
  return res;
}
const _waveCache = new WeakMap();
function periodicWave(ctx, key, fn, H, N) {
  let m = _waveCache.get(ctx);
  if (!m) { m = new Map(); _waveCache.set(ctx, m); }
  if (m.has(key)) return m.get(key);
  const c = fourier(key, fn, H, N);
  const w = { wave: ctx.createPeriodicWave(c.re, c.im, { disableNormalization: true }), min: c.min, max: c.max };
  m.set(key, w);
  return w;
}

// WAV encoder (16-bit PCM) — used by the test page / offline checker.
function encodeWAV(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = clamp(data[c][i], -1, 1); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return out.buffer;
}

// ============================================================ ONE-SHOTS ====
// Each recipe builds a node graph inside an OfflineAudioContext which is then
// rendered once into an AudioBuffer (normalised + tail-trimmed).

const _noiseBufs = new Map();
function noiseBufs(sr) {
  if (_noiseBufs.has(sr)) return _noiseBufs.get(sr);
  const rng = new RNG(1234), len = sr * 2, o = {};
  for (const k of ['white', 'pink', 'brown']) o[k] = bufFrom(sr, [normalize(fillNoise(new Float32Array(len), rng, k), 0.9)]);
  _noiseBufs.set(sr, o);
  return o;
}

// Offline graph builder.
class G {
  constructor(ctx, rng) {
    this.ctx = ctx; this.rng = rng; this.nb = noiseBufs(ctx.sampleRate);
    this.out = ctx.createGain(); this.out.connect(ctx.destination);
  }
  A(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  F(type, f, q = 0.707, gain = 0) {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b;
  }
  S(k = 2) { const s = this.ctx.createWaveShaper(); s.curve = driveCurve(k); return s; }
  O(type, f, t, dur) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = f; o.start(t); o.stop(t + dur); return o;
  }
  N(kind, t, dur, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.nb[kind || 'white']; s.loop = true; s.playbackRate.value = rate;
    s.start(t, this.rng.range(0, 1.9)); s.stop(t + dur); return s;
  }
  B(buf, t, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.start(t); return s; }
  // pts: [[dt, value, mode]] — mode 'e' exponential, 's' step, default linear
  E(p, t, pts) {
    let first = true;
    for (const [dt, v, mode] of pts) {
      const tt = t + dt;
      if (first) { p.setValueAtTime(v, tt); first = false; continue; }
      if (mode === 'e') p.exponentialRampToValueAtTime(Math.max(v, 1e-4), tt);
      else if (mode === 's') p.setValueAtTime(v, tt);
      else p.linearRampToValueAtTime(v, tt);
    }
  }
  drive(k, to) { const m = this.A(1); m.connect(this.S(k)).connect(to || this.out); return m; }
}

// Noise burst: {t, kind, type, f, f2, fd, fpts, q, a, h, d, v, to}
function burst(g, o) {
  const t = o.t || 0, a = o.a ?? 0.001, h = o.h || 0, d = o.d ?? 0.1, v = o.v ?? 1;
  const src = g.N(o.kind || 'white', t, a + h + d + 0.05, o.rate || 1);
  let node = src;
  if (o.type !== 'none') {
    const f = g.F(o.type || 'bandpass', o.f || 1000, o.q ?? 0.8);
    if (o.fpts) g.E(f.frequency, t, o.fpts.map((p) => [p[0], p[1], 'e']));
    else if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.fd || a + h + d)); }
    node = node.connect(f);
  }
  const e = g.A(0);
  g.E(e.gain, t, [[0, 0], [a, v], [a + h, v], [a + h + d, 0.0001, 'e']]);
  node.connect(e); e.connect(o.to || g.out);
  return e;
}
// Tone: {t, type, f, f2, fd, lin, a, h, d, v, vib:[rate, depth], filt:[type,f,q], to}
function tone(g, o) {
  const t = o.t || 0, a = o.a ?? 0.002, h = o.h || 0, d = o.d ?? 0.2, v = o.v ?? 1, len = a + h + d + 0.05, f0 = o.f ?? (o.fpts ? o.fpts[0][1] : 440);
  const osc = g.O(o.type || 'sine', f0, t, len);
  if (o.fpts) g.E(osc.frequency, t, o.fpts.map((p) => [p[0], p[1], o.lin ? 'l' : 'e']));
  else if (o.f2) {
    osc.frequency.setValueAtTime(o.f, t);
    const fd = o.fd ?? a + h + d;
    if (o.lin) osc.frequency.linearRampToValueAtTime(o.f2, t + fd); else osc.frequency.exponentialRampToValueAtTime(o.f2, t + fd);
  }
  if (o.vib) { const l = g.O('sine', o.vib[0], t, len); const lg = g.A(f0 * o.vib[1]); l.connect(lg).connect(osc.frequency); }
  let node = osc;
  if (o.filt) node = node.connect(g.F(o.filt[0], o.filt[1], o.filt[2] ?? 0.707));
  const e = g.A(0);
  g.E(e.gain, t, [[0, 0], [a, v], [a + h, v * (o.sus ?? 1)], [a + h + d, 0.0001, 'e']]);
  node.connect(e).connect(o.to || g.out);
  return e;
}
// Inharmonic ringing partials (metal, bells).
function ring(g, o) {
  const t = o.t || 0, r = o.ratios || [1, 1.5, 2.3], dec = o.decays || r.map((_, i) => (o.d || 0.5) / (1 + i * 0.4));
  r.forEach((k, i) => tone(g, { t, f: o.f * k * (o.jit ? g.rng.range(1 - o.jit, 1 + o.jit) : 1), a: o.a ?? 0.0008, d: dec[i], v: (o.v ?? 0.5) * (o.amps ? o.amps[i] : 1 / (1 + i * 0.5)), to: o.to }));
}
// Mechanical click (latch, slide, mag)
function clk(g, t, f, v = 0.7, d = 0.02, to) {
  burst(g, { t, kind: 'white', type: 'bandpass', f, q: 2.5, a: 0.0004, d, v, to });
  tone(g, { t, f: f * 1.37, a: 0.0004, d: d * 0.8, v: v * 0.35, to });
}
// Feedback echo (outdoor slap / room).
function echo(g, input, o = {}) {
  const dl = g.ctx.createDelay(2); dl.delayTime.value = o.dt ?? 0.2;
  const fb = g.A(o.fb ?? 0.3), lp = g.F('lowpass', o.lp ?? 1800, 0.5), wet = g.A(o.v ?? 0.3);
  input.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(o.to || g.out);
}
// Formant "voice" (screams, ouch, crowd, animals).
const VOW = {
  a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410],
  u: [300, 870, 2240], ae: [660, 1720, 2410], uh: [640, 1190, 2390], m: [250, 900, 2200],
};
function voice(g, P) {
  const t = P.t || 0, dur = P.dur, fs = P.fscale || 1, f0 = P.f0pts[0][1];
  const src = g.O(P.wave || 'sawtooth', f0, t, dur + 0.1);
  g.E(src.frequency, t, P.f0pts.map((p) => [p[0], p[1]]));
  if (P.vib) { const l = g.O('sine', P.vib[0], t, dur + 0.1); const lg = g.A(f0 * P.vib[1]); l.connect(lg).connect(src.frequency); }
  if (P.rough) { const n = g.N('brown', t, dur + 0.1); const ng = g.A(f0 * P.rough * 6); n.connect(ng).connect(src.frequency); }
  const mix = g.A(1); src.connect(mix);
  if (P.breath) { const n = g.N('white', t, dur + 0.1); const ng = g.A(P.breath); n.connect(ng).connect(mix); }
  const env = g.A(0), [ea, eh] = P.env || [0.03, dur * 0.5];
  g.E(env.gain, t, [[0, 0], [ea, P.v ?? 1], [ea + eh, (P.v ?? 1) * 0.85], [dur, 0.0001, 'e']]);
  const amps = [1, 0.55, 0.3], bws = [90, 120, 160];
  for (let k = 0; k < 3; k++) {
    const F0 = VOW[P.vowels[0][1]][k] * fs;
    const bp = g.F('bandpass', F0, F0 / bws[k]);
    g.E(bp.frequency, t, P.vowels.map(([dt, vw]) => [dt, VOW[vw][k] * fs]));
    const fg = g.A(amps[k] * (F0 / bws[k]) * 0.5);
    mix.connect(bp).connect(fg).connect(env);
  }
  env.connect(P.to || g.out);
  return env;
}
// Glass shards.
function glassLayer(g, o = {}) {
  const t = o.t || 0, n = o.n || 30, v = o.v ?? 0.6, sp = o.spread || 0.6, r = g.rng;
  burst(g, { t, kind: 'white', type: 'highpass', f: 2500, q: 0.7, a: 0.001, d: 0.09, v, to: o.to });
  for (let i = 0; i < n; i++) {
    const tt = t + Math.pow(r.next(), 1.8) * sp;
    tone(g, { t: tt, f: r.range(2500, 9500), a: 0.0005, d: r.range(0.03, 0.2), v: v * r.range(0.08, 0.4) * (1 - (tt - t) / (sp + 0.3)), to: o.to });
  }
}
function bellRing(g, t, f, v = 0.6, d = 0.8, to) {
  ring(g, { t, f, ratios: [1, 1.59, 2.33, 3.11, 4.2], decays: [d, d * 0.7, d * 0.5, d * 0.35, d * 0.2], amps: [1, 0.6, 0.45, 0.3, 0.2], v, to });
}
function horn(g, freqs, o = {}) {
  const dur = o.dur || 0.55, a = o.a ?? 0.012, r = o.r ?? 0.07, t = o.t || 0;
  const mix = g.A(1), env = g.A(0);
  mix.connect(g.S(o.drive ?? 3)).connect(g.F('bandpass', o.bp ?? 1800, o.q ?? 1.1)).connect(g.F('highpass', 220, 0.7)).connect(env).connect(o.to || g.out);
  for (const f of freqs) {
    const os = g.O(o.type || 'sawtooth', f, t, dur + 0.1);
    os.frequency.setValueAtTime(f * (o.scoop ?? 0.97), t); os.frequency.linearRampToValueAtTime(f, t + Math.max(a, 0.03));
    os.connect(g.A(0.5)).connect(mix);
  }
  g.E(env.gain, t, [[0, 0], [a, 1], [dur - r, 0.9], [dur, 0.0001, 'e']]);
}
// Saw "brass/synth" note with filter env (for jingles).
function brass(g, o) {
  const t = o.t || 0, d = o.d || 0.3, v = o.v ?? 0.5, mix = g.A(1);
  for (const det of o.det || [-6, 6]) { const os = g.O(o.type || 'sawtooth', o.f, t, d + 0.4); os.detune.value = det; os.connect(mix); }
  if (o.vib) { /* simple vibrato via detune automation */ }
  const lp = g.F('lowpass', 400, 1.5);
  g.E(lp.frequency, t, [[0, (o.cut || 2600) * 0.25], [0.04, o.cut || 2600], [d + 0.3, (o.cut || 2600) * 0.4]]);
  const e = g.A(0);
  g.E(e.gain, t, [[0, 0], [o.a ?? 0.02, v], [d, v * 0.8], [d + (o.r ?? 0.25), 0.0001, 'e']]);
  mix.connect(lp).connect(e).connect(o.to || g.out);
}

// ---- guns ---------------------------------------------------------------
function gun(g, P) {
  const r = g.rng, mix = g.drive(P.drive ?? 2.5);
  burst(g, { kind: 'white', type: 'highpass', f: 1500, a: 0.0003, d: 0.008, v: 1, to: mix });
  burst(g, { kind: 'white', type: 'bandpass', f: P.crackF * r.range(0.9, 1.1), q: P.crackQ ?? 0.7, a: 0.0005, d: P.crackD, v: P.crackV ?? 0.9, to: mix });
  burst(g, { kind: 'pink', type: 'lowpass', f: P.bodyF * r.range(0.92, 1.08), q: 0.9, a: 0.001, d: P.bodyD, v: P.bodyV ?? 1, to: mix });
  tone(g, { f: P.thumpF * r.range(0.95, 1.05), f2: 38, fd: P.thumpD, a: 0.001, d: P.thumpD, v: P.thumpV ?? 0.9, to: mix });
  burst(g, { kind: 'brown', type: 'lowpass', f: P.tailF ?? 700, q: 0.5, a: 0.015, d: P.tail, v: P.tailV ?? 0.35 });
  if (P.echo) echo(g, mix, { dt: P.echo * r.range(0.9, 1.1), fb: 0.28, lp: 1400, v: 0.28 });
  if (P.mech) P.mech(g);
}
const GUNS = {
  pistol: [0.9, { crackF: 2800, crackD: 0.05, bodyF: 1600, bodyD: 0.09, thumpF: 160, thumpD: 0.08, tail: 0.55, tailV: 0.3, echo: 0.16, drive: 2.5 }],
  revolver: [1.5, { crackF: 2200, crackD: 0.07, bodyF: 1300, bodyD: 0.14, thumpF: 120, thumpD: 0.14, thumpV: 1, tail: 1.1, tailV: 0.42, echo: 0.22, drive: 3 }],
  smg: [0.5, { crackF: 3200, crackD: 0.035, bodyF: 1800, bodyD: 0.06, thumpF: 180, thumpD: 0.05, tail: 0.3, tailV: 0.22, echo: 0.1, drive: 2.2 }],
  shotgun: [1.9, { crackF: 1800, crackQ: 0.5, crackD: 0.09, bodyF: 1100, bodyD: 0.22, thumpF: 100, thumpD: 0.2, thumpV: 1, tail: 1.3, tailV: 0.45, echo: 0.25, drive: 3.5,
    mech: (g) => { clk(g, 0.52, 1700, 0.5, 0.04); burst(g, { t: 0.53, kind: 'white', type: 'bandpass', f: 900, f2: 2200, q: 2, a: 0.01, d: 0.06, v: 0.25 }); clk(g, 0.7, 2300, 0.7, 0.035); clk(g, 0.72, 1300, 0.4, 0.04); } }],
  rifle: [1.1, { crackF: 3600, crackD: 0.045, bodyF: 1900, bodyD: 0.1, thumpF: 140, thumpD: 0.1, tail: 0.8, tailV: 0.35, echo: 0.2, drive: 3 }],
  sniper: [2.4, { crackF: 4500, crackD: 0.06, crackV: 1, bodyF: 1400, bodyD: 0.2, thumpF: 90, thumpD: 0.25, thumpV: 1, tail: 2.0, tailV: 0.5, echo: 0.35, drive: 3.5,
    mech: (g) => { clk(g, 1.0, 1900, 0.35, 0.03); clk(g, 1.12, 2600, 0.4, 0.03); clk(g, 1.3, 2200, 0.45, 0.03); } }],
  minigun_shot: [0.2, { crackF: 3000, crackD: 0.025, bodyF: 1700, bodyD: 0.04, thumpF: 200, thumpD: 0.035, tail: 0.1, tailV: 0.12, drive: 2 }],
};
function boom(g, P) {
  const r = g.rng, mix = g.drive(P.drive || 3);
  for (const [bt, s] of P.blasts) {
    burst(g, { t: bt, kind: 'white', type: 'lowpass', f: 7000, f2: 700, fd: 0.18, a: 0.001, d: 0.3 * s, v: s, to: mix });
    tone(g, { t: bt, f: 78, f2: 24, fd: 0.9, a: 0.002, d: 1.1 * s, v: s, to: mix });
    burst(g, { t: bt, kind: 'brown', type: 'lowpass', f: 1800, f2: 140, fd: P.dur * 0.6, q: 0.6, a: 0.006, d: P.dur * 0.65 * s, v: s, to: mix });
  }
  for (let i = 0; i < P.debris; i++) {
    const t = r.range(0.15, P.dur * 0.6);
    burst(g, { t, kind: 'white', type: 'bandpass', f: r.range(1200, 5000), q: 2, a: 0.001, d: r.range(0.01, 0.06), v: r.range(0.04, 0.22) * (1 - t / P.dur) });
  }
  echo(g, mix, { dt: 0.32, fb: 0.35, lp: 600, v: 0.35 });
}
function crash(g, P) {
  const r = g.rng, mix = g.drive(P.drive), sz = P.size;
  tone(g, { f: P.thumpF, f2: 35, a: 0.001, d: P.thumpD, v: 1, to: mix });
  burst(g, { kind: 'pink', type: 'lowpass', f: 900, a: 0.001, d: 0.15 * sz, v: 0.9, to: mix });
  for (let i = 0; i < P.crunch; i++) {
    burst(g, { t: r.range(0, 0.12 * sz), kind: 'white', type: 'bandpass', f: r.range(700, 3500), q: r.range(0.8, 2), a: 0.001, d: r.range(0.02, 0.09), v: r.range(0.4, 0.9), to: mix });
  }
  const base = r.range(280, 560), ratios = [1, 1.52, 2.27, 2.94, 3.83, 5.1];
  ratios.forEach((k, i) => tone(g, { t: r.range(0, 0.02), f: base * k * r.range(0.97, 1.03), a: 0.001, d: r.range(0.2, 0.6) * sz, v: 0.22 / (1 + i * 0.3) }));
  if (P.glass) glassLayer(g, { t: 0.02, n: P.glass, v: 0.45 });
  for (let i = 0; i < P.rattle; i++) {
    burst(g, { t: r.range(0.08, 0.45 * sz + 0.1), kind: 'white', type: 'bandpass', f: r.range(1800, 6000), q: 3, a: 0.001, d: r.range(0.01, 0.035), v: r.range(0.05, 0.22) });
  }
}

const SFX = {};
function def(name, dur, fn, o = {}) {
  SFX[name] = { name, dur, fn, vars: o.vars || 1, vol: o.vol ?? 1, range: o.range || 1, peak: o.peak ?? 0.95, max: o.max || 4, internal: !!o.internal };
}

// UI ------------------------------------------------------------------------
def('ui_click', 0.07, (g) => { tone(g, { type: 'square', f: 1900, a: 0.001, d: 0.022, v: 0.5, filt: ['lowpass', 5000] }); burst(g, { type: 'highpass', f: 4000, d: 0.006, v: 0.3 }); }, { vol: 0.45, max: 3 });
def('ui_back', 0.14, (g) => tone(g, { type: 'square', f: 760, f2: 400, fd: 0.07, a: 0.002, d: 0.09, v: 0.5, filt: ['lowpass', 3500] }), { vol: 0.45 });
def('ui_select', 0.22, (g) => { tone(g, { type: 'square', f: 880, a: 0.002, d: 0.06, v: 0.45, filt: ['lowpass', 5000] }); tone(g, { t: 0.06, type: 'square', f: 1320, a: 0.002, d: 0.12, v: 0.45, filt: ['lowpass', 5000] }); }, { vol: 0.45 });
def('menu_open', 0.5, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 400, f2: 3000, fd: 0.25, q: 1.2, a: 0.1, d: 0.2, v: 0.4 });
  [523, 659, 784, 1047].forEach((f, i) => tone(g, { t: 0.04 + i * 0.045, type: 'triangle', f, a: 0.002, d: 0.2, v: 0.35 }));
}, { vol: 0.5 });
def('pickup', 0.4, (g) => {
  [988, 1319, 1976].forEach((f, i) => tone(g, { t: i * 0.05, type: 'square', f, a: 0.001, d: 0.12, v: 0.45, filt: ['lowpass', 6000] }));
  tone(g, { t: 0.1, f: 3951, a: 0.001, d: 0.2, v: 0.12 });
}, { vol: 0.55 });
def('pickup_weapon', 0.55, (g) => {
  clk(g, 0, 1500, 0.9, 0.03); clk(g, 0.07, 2400, 0.8, 0.03); tone(g, { t: 0.07, f: 180, f2: 120, a: 0.001, d: 0.08, v: 0.5 });
  tone(g, { t: 0.13, type: 'square', f: 440, f2: 880, fd: 0.06, a: 0.002, d: 0.16, v: 0.35, filt: ['lowpass', 4000] });
}, { vol: 0.6 });
def('pickup_health', 0.75, (g) => {
  [523, 659, 784, 1047].forEach((f, i) => { tone(g, { t: i * 0.06, type: 'triangle', f, a: 0.004, d: 0.4, v: 0.45 }); tone(g, { t: i * 0.06, f: f * 2, a: 0.004, d: 0.25, v: 0.12 }); });
}, { vol: 0.55 });
def('pickup_armor', 0.85, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 3000, f2: 7500, fd: 0.3, q: 2, a: 0.02, d: 0.3, v: 0.5 });
  ring(g, { f: 900, ratios: [1, 2.4, 3.9, 5.3], d: 0.45, v: 0.4 });
  tone(g, { f: 210, f2: 150, a: 0.001, d: 0.09, v: 0.5 });
}, { vol: 0.6 });
def('cash', 1.2, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 3500, q: 0.8, d: 0.06, v: 0.45 }); clk(g, 0, 1800, 0.6);
  tone(g, { t: 0.06, f: 110, f2: 80, d: 0.1, v: 0.5 });
  bellRing(g, 0.12, 2100, 0.7, 0.9);
  for (let i = 0; i < 7; i++) tone(g, { t: g.rng.range(0.15, 0.55), f: g.rng.range(4000, 8000), a: 0.0005, d: 0.08, v: 0.15 });
}, { vol: 0.6 });
def('money_lost', 1.1, (g) => {
  [784, 659, 523].forEach((f, i) => tone(g, { t: i * 0.12, type: 'square', f, a: 0.003, d: 0.12, v: 0.4, filt: ['lowpass', 3000] }));
  tone(g, { t: 0.36, type: 'square', f: 392, f2: 370, fd: 0.5, a: 0.003, h: 0.25, d: 0.35, v: 0.4, vib: [7, 0.02], filt: ['lowpass', 1800] });
}, { vol: 0.42 });
def('phone_ring', 1.35, (g) => {
  for (const [t0, t1] of [[0, 0.45], [0.65, 1.1]]) {
    const os = g.O('square', 1000, t0, t1 - t0 + 0.05);
    for (let t = t0, k = 0; t < t1; t += 1 / 32, k++) os.frequency.setValueAtTime(k % 2 ? 1250 : 1000, t);
    const e = g.A(0); g.E(e.gain, t0, [[0, 0], [0.01, 0.4], [t1 - t0 - 0.02, 0.4], [t1 - t0, 0.0001, 'e']]);
    os.connect(g.F('lowpass', 4000)).connect(e).connect(g.out);
  }
}, { vol: 0.38 });
def('phone_pickup', 0.35, (g) => { clk(g, 0, 1500, 0.7, 0.03); tone(g, { t: 0.08, f: 1400, a: 0.003, d: 0.1, v: 0.4 }); tone(g, { t: 0.16, f: 1800, a: 0.003, d: 0.08, v: 0.35 }); }, { vol: 0.5 });
def('checkpoint', 0.65, (g) => {
  tone(g, { type: 'triangle', f: 1047, a: 0.002, d: 0.25, v: 0.55 }); tone(g, { t: 0.07, type: 'triangle', f: 1568, a: 0.002, d: 0.45, v: 0.55 });
  tone(g, { t: 0.07, f: 3136, a: 0.002, d: 0.2, v: 0.12 });
}, { vol: 0.55 });
def('wanted_up', 0.75, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 2000, q: 1, d: 0.05, v: 0.35 });
  tone(g, { t: 0.03, type: 'square', f: 880, a: 0.002, d: 0.1, v: 0.45, filt: ['lowpass', 4000] });
  tone(g, { t: 0.14, type: 'square', f: 1175, a: 0.002, h: 0.1, d: 0.25, v: 0.45, vib: [18, 0.015], filt: ['lowpass', 4000] });
  tone(g, { f: 110, f2: 70, a: 0.002, d: 0.15, v: 0.5 });
}, { vol: 0.48 });
def('wanted_lost', 1.1, (g) => {
  [784, 659, 523].forEach((f, i) => tone(g, { t: i * 0.1, type: 'triangle', f, a: 0.003, d: i === 2 ? 0.6 : 0.15, v: 0.45 }));
  [262, 330, 392].forEach((f) => tone(g, { t: 0.2, type: 'sine', f, a: 0.15, h: 0.2, d: 0.5, v: 0.15 }));
}, { vol: 0.55 });
// Stings --------------------------------------------------------------------
def('mission_start', 2.0, (g) => {
  tone(g, { f: 98, f2: 88, a: 0.002, d: 0.9, v: 0.9 }); burst(g, { kind: 'pink', type: 'lowpass', f: 400, d: 0.3, v: 0.6 });
  const mix = g.A(1), lp = g.F('lowpass', 250, 2); g.E(lp.frequency, 0, [[0, 250], [0.6, 1800, 'e'], [1.9, 300, 'e']]);
  mix.connect(lp).connect(g.out);
  [73.4, 110, 146.8, 174.6].forEach((f) => brass(g, { f, d: 1.3, a: 0.35, r: 0.5, v: 0.3, cut: 6000, to: mix }));
  const tr = tone(g, { f: 1175, a: 0.5, h: 0.6, d: 0.6, v: 0.15 });
  const am = g.O('sine', 12, 0, 2); const ag = g.A(0.08); am.connect(ag).connect(tr.gain);
}, { vol: 0.7 });
def('mission_pass', 3.3, (g) => {
  const N = [[0, 392, 0.1], [0.12, 523, 0.1], [0.24, 659, 0.1], [0.36, 784, 0.22], [0.62, 659, 0.1], [0.74, 784, 1.0]];
  for (const [t, f, d] of N) { brass(g, { t, f, d, v: 0.4, cut: 3200 }); brass(g, { t, f: f / 2, d, v: 0.18, cut: 2000 }); }
  [262, 330, 392, 523].forEach((f) => brass(g, { t: 0.74, f, d: 1.7, a: 0.05, r: 0.7, v: 0.16, cut: 2200, det: [-9, 0, 9] }));
  tone(g, { f: 65.4, a: 0.003, d: 0.25, v: 0.6 }); tone(g, { t: 0.74, f: 65.4, a: 0.003, h: 0.8, d: 0.9, v: 0.6 });
  for (const t of [0, 0.74]) { tone(g, { t, f: 140, f2: 45, d: 0.25, v: 0.8 }); }
  burst(g, { t: 0.36, kind: 'white', type: 'bandpass', f: 2500, q: 0.7, d: 0.12, v: 0.4 });
  burst(g, { t: 0.74, kind: 'white', type: 'highpass', f: 3500, a: 0.002, d: 1.8, v: 0.35 });
  ring(g, { t: 0.74, f: 3200, ratios: [1, 1.41, 1.83, 2.6], d: 1.2, v: 0.08 });
  [1047, 1319, 1568, 2093].forEach((f, i) => tone(g, { t: 0.95 + i * 0.09, f, a: 0.002, d: 0.6, v: 0.15 }));
}, { vol: 0.75 });
def('mission_fail', 2.6, (g) => {
  tone(g, { f: 98, f2: 80, a: 0.002, d: 1.2, v: 0.8 });
  [[0, 587], [0.35, 523], [0.7, 440]].forEach(([t, f], i) => brass(g, { t, f, d: i === 2 ? 1.2 : 0.3, a: 0.03, v: 0.35, cut: 1800 }));
  [146.8, 174.6, 220, 155.6].forEach((f) => brass(g, { t: 0.7, f, d: 1.4, a: 0.3, r: 0.5, v: 0.14, cut: 900 }));
}, { vol: 0.7 });
def('wasted', 3.8, (g) => {
  const mix = g.drive(2);
  tone(g, { f: 62, f2: 26, fd: 2, a: 0.003, d: 2.2, v: 1, to: mix });
  burst(g, { kind: 'brown', type: 'lowpass', f: 300, a: 0.003, d: 1.3, v: 0.8, to: mix });
  burst(g, { kind: 'white', type: 'lowpass', f: 3000, a: 0.001, d: 0.15, v: 0.6, to: mix });
  const pad = g.A(1), lp = g.F('lowpass', 1400, 1.5); g.E(lp.frequency, 0, [[0, 1400], [3.5, 180, 'e']]); pad.connect(lp).connect(g.out);
  for (const f of [73.4, 103.8, 146.8, 155.6]) {
    const o1 = g.O('sawtooth', f, 0, 3.7); o1.frequency.setValueAtTime(f, 0); o1.frequency.exponentialRampToValueAtTime(f * 0.92, 3.5);
    const e = g.A(0); g.E(e.gain, 0, [[0, 0], [0.25, 0.2], [2.2, 0.15], [3.6, 0.0001, 'e']]); o1.connect(e).connect(pad);
  }
  bellRing(g, 0.05, 196, 0.5, 3.0);
  echo(g, pad, { dt: 0.4, fb: 0.35, lp: 800, v: 0.3 });
}, { vol: 0.85 });
def('busted', 2.9, (g) => {
  tone(g, { type: 'square', f: 600, f2: 1500, fd: 0.35, a: 0.005, d: 0.38, v: 0.3, filt: ['bandpass', 1500, 0.8] });
  for (const t of [0.45, 0.78]) {
    [130.8, 155.6, 196].forEach((f) => brass(g, { t, f, d: 0.15, a: 0.01, r: 0.15, v: 0.28, cut: 2500 }));
    tone(g, { t, f: 65.4, a: 0.002, d: 0.25, v: 0.7 }); burst(g, { t, kind: 'white', type: 'bandpass', f: 2200, q: 0.7, d: 0.15, v: 0.45 });
  }
  const slam = g.A(1); slam.connect(g.out);
  ring(g, { t: 1.15, f: 140, ratios: [1, 1.47, 2.3, 3.1, 4.5, 6.2], d: 1.3, v: 0.4, to: slam });
  tone(g, { t: 1.15, f: 90, f2: 40, a: 0.001, d: 0.3, v: 0.9, to: slam });
  burst(g, { t: 1.15, kind: 'pink', type: 'lowpass', f: 1200, a: 0.001, d: 0.2, v: 0.8, to: slam });
  clk(g, 1.13, 2500, 0.7, 0.03, slam);
  echo(g, slam, { dt: 0.23, fb: 0.4, lp: 1500, v: 0.35 });
}, { vol: 0.8 });
// Foley ----------------------------------------------------------------------
def('door_open', 0.45, (g) => { clk(g, 0, 1800, 0.9, 0.03); clk(g, 0.03, 1200, 0.5, 0.03); burst(g, { t: 0.06, kind: 'white', type: 'bandpass', f: 800, q: 3, a: 0.02, d: 0.12, v: 0.2 }); tone(g, { t: 0.02, f: 160, d: 0.06, v: 0.3 }); }, { vol: 0.6 });
def('door_close', 0.55, (g) => {
  const m = g.drive(2); tone(g, { f: 92, f2: 52, a: 0.001, d: 0.18, v: 1, to: m }); burst(g, { kind: 'pink', type: 'lowpass', f: 700, d: 0.12, v: 0.9, to: m });
  clk(g, 0.01, 2200, 0.6, 0.03); burst(g, { t: 0.05, kind: 'white', type: 'bandpass', f: 3500, q: 3, d: 0.08, v: 0.08 });
}, { vol: 0.7 });
def('car_start', 2.3, (g) => {
  const st = g.O('sawtooth', 210, 0, 1.0), sn = g.N('white', 0, 1.0), sm = g.A(0);
  st.connect(g.F('bandpass', 650, 1.2)).connect(sm); sn.connect(g.F('bandpass', 1500, 1)).connect(g.A(0.4)).connect(sm);
  const pts = [[0, 0]]; for (let t = 0.02, k = 0; t < 0.9; t += 1 / 7, k++) { pts.push([t, 0.7]); pts.push([t + 0.07, 0.25]); }
  pts.push([0.95, 0.0001, 'e']); g.E(sm.gain, 0, pts); sm.connect(g.out);
  st.frequency.setValueAtTime(180, 0); st.frequency.linearRampToValueAtTime(240, 0.85);
  const pw = periodicWave(g.ctx, 'carstart', (x) => Math.exp(-((x - 0.1) ** 2) / 0.002), 96);
  const eo = g.O(pw.wave, 4, 0.85, 1.45);
  g.E(eo.frequency, 0.85, [[0, 4], [0.25, 18], [0.5, 34], [0.8, 14], [1.4, 13]]);
  const em = g.A(0), nz = g.N('white', 0.85, 1.45), am = g.A(0);
  eo.connect(g.F('lowpass', 900, 1)).connect(em); eo.connect(am.gain); nz.connect(g.F('bandpass', 1100, 0.8)).connect(am).connect(g.A(0.4)).connect(em);
  g.E(em.gain, 0.85, [[0, 0], [0.05, 0.9], [1.0, 0.7], [1.42, 0.0001, 'e']]);
  em.connect(g.S(2.5)).connect(g.F('lowpass', 2200)).connect(g.out);
}, { vol: 0.75 });
def('gear_shift', 0.3, (g) => { clk(g, 0, 1600, 0.8, 0.03); tone(g, { f: 140, f2: 90, d: 0.06, v: 0.6 }); burst(g, { kind: 'pink', type: 'lowpass', f: 1500, d: 0.05, v: 0.5 }); clk(g, 0.06, 2600, 0.4, 0.02); }, { vol: 0.5 });
def('brakes_hiss', 1.35, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 5500, q: 0.6, a: 0.008, h: 0.1, d: 0.9, v: 1 });
  burst(g, { kind: 'white', type: 'highpass', f: 2500, a: 0.005, d: 0.4, v: 0.6 }); tone(g, { f: 120, d: 0.05, v: 0.3 });
}, { vol: 0.6, range: 1.3 });
def('punch', 0.35, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 600, f2: 1800, q: 1.2, a: 0.03, d: 0.06, v: 0.3 });
  const m = g.drive(2.5);
  tone(g, { t: 0.05, f: 130, f2: 55, a: 0.001, d: 0.12, v: 1, to: m }); burst(g, { t: 0.05, kind: 'pink', type: 'lowpass', f: 1200, d: 0.08, v: 0.8, to: m });
  burst(g, { t: 0.05, kind: 'white', type: 'bandpass', f: 2500, q: 1, d: 0.02, v: 0.5, to: m });
}, { vars: 3, vol: 0.8 });
def('punch_hit', 0.4, (g) => {
  const m = g.drive(4);
  tone(g, { f: 100, f2: 45, a: 0.001, d: 0.18, v: 1, to: m }); burst(g, { kind: 'pink', type: 'lowpass', f: 900, d: 0.12, v: 1, to: m });
  burst(g, { kind: 'white', type: 'bandpass', f: 1800 * g.rng.range(0.8, 1.2), q: 0.8, d: 0.04, v: 0.9, to: m });
  burst(g, { kind: 'white', type: 'highpass', f: 4000, d: 0.015, v: 0.6, to: m });
}, { vars: 3, vol: 0.9 });
def('footstep', 0.18, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 1600 * g.rng.range(0.8, 1.25), q: 1.2, a: 0.001, d: 0.03, v: 0.7 });
  tone(g, { f: 95, f2: 60, a: 0.001, d: 0.05, v: 0.6 }); burst(g, { t: 0.025, kind: 'white', type: 'bandpass', f: 3000, q: 2, d: 0.02, v: 0.25 });
}, { vars: 4, vol: 0.35, max: 6 });
def('footstep_grass', 0.22, (g) => {
  for (let i = 0; i < 8; i++) burst(g, { t: g.rng.range(0, 0.07), kind: 'white', type: 'highpass', f: 2500, a: 0.001, d: g.rng.range(0.01, 0.025), v: g.rng.range(0.2, 0.5) });
  tone(g, { f: 80, a: 0.002, d: 0.04, v: 0.3 }); burst(g, { kind: 'pink', type: 'lowpass', f: 2000, a: 0.005, d: 0.06, v: 0.3 });
}, { vars: 4, vol: 0.3, max: 6 });
def('body_fall', 0.9, (g) => {
  const m = g.drive(2);
  tone(g, { f: 75, f2: 38, a: 0.002, d: 0.3, v: 1, to: m }); burst(g, { kind: 'pink', type: 'lowpass', f: 600, d: 0.25, v: 0.9, to: m });
  burst(g, { kind: 'white', type: 'bandpass', f: 2500, q: 0.7, a: 0.03, d: 0.2, v: 0.2 });
  tone(g, { t: 0.2, f: 70, f2: 40, a: 0.002, d: 0.15, v: 0.5, to: m }); burst(g, { t: 0.2, kind: 'pink', type: 'lowpass', f: 500, d: 0.12, v: 0.4, to: m });
}, { vars: 2, vol: 0.8 });
def('scream_m', 1.45, (g) => {
  const k = g.rng.range(0.9, 1.15), m = g.drive(3);
  voice(g, { dur: 1.4, f0pts: [[0, 190 * k], [0.12, 330 * k], [0.8, 300 * k], [1.35, 200 * k]], vowels: [[0, 'ae'], [0.2, 'a'], [1.2, 'o']], rough: 0.05, vib: [6, 0.02], breath: 0.15, env: [0.06, 0.8], to: m });
}, { vars: 2, vol: 0.55, range: 1.2 });
def('scream_f', 1.45, (g) => {
  const k = g.rng.range(0.92, 1.1), m = g.drive(2.2);
  voice(g, { dur: 1.4, f0pts: [[0, 450 * k], [0.1, 880 * k], [0.9, 820 * k], [1.35, 600 * k]], vowels: [[0, 'ae'], [0.2, 'a'], [1.2, 'e']], fscale: 1.18, rough: 0.025, vib: [6.5, 0.025], breath: 0.1, env: [0.05, 0.8], to: m });
}, { vars: 2, vol: 0.5, range: 1.2 });
def('ouch', 0.5, (g) => {
  const fem = g.rng.chance(0.35), k = (fem ? 1.8 : 1) * g.rng.range(0.9, 1.15), m = g.drive(2);
  voice(g, { dur: 0.45, f0pts: [[0, 240 * k], [0.08, 265 * k], [0.42, 165 * k]], vowels: [[0, 'a'], [0.15, 'a'], [0.38, 'u']], fscale: fem ? 1.15 : 1, rough: 0.03, breath: 0.12, env: [0.02, 0.12], to: m });
}, { vars: 3, vol: 0.55 });
def('dog_bark', 0.75, (g) => {
  const k = g.rng.range(0.8, 1.25), m = g.drive(3);
  for (const t of [0, 0.3]) {
    voice(g, { t, dur: 0.17, f0pts: [[0, 380 * k], [0.04, 470 * k], [0.16, 260 * k]], vowels: [[0, 'a'], [0.1, 'uh']], fscale: 1.25 / Math.sqrt(k), rough: 0.08, breath: 0.5, env: [0.006, 0.03], to: m });
    burst(g, { t, kind: 'white', type: 'bandpass', f: 1200, q: 1, a: 0.004, d: 0.08, v: 0.3, to: m });
  }
}, { vars: 2, vol: 0.7, range: 1.4 });
def('cow_moo', 2.1, (g) => {
  const out = g.A(1), lp = g.F('lowpass', 500, 0.7); g.E(lp.frequency, 0, [[0, 400], [0.4, 1800, 'e'], [1.5, 1400], [2.0, 500, 'e']]);
  out.connect(lp).connect(g.out);
  voice(g, { dur: 2.0, f0pts: [[0, 92], [0.3, 118], [1.3, 112], [1.9, 84]], vowels: [[0, 'm'], [0.35, 'o'], [0.9, 'o'], [1.5, 'u'], [1.9, 'm']], fscale: 0.8, rough: 0.03, vib: [5, 0.012], breath: 0.08, env: [0.25, 1.0], to: out });
}, { vol: 0.8, range: 1.5 });
def('crowd_cheer', 3.0, (g) => {
  const r = g.rng;
  for (let i = 0; i < 14; i++) {
    const fem = r.chance(0.45), b = (fem ? r.range(260, 400) : r.range(120, 200)), t = r.range(0, 0.3), d = r.range(1.4, 2.6);
    voice(g, { t, dur: d, f0pts: [[0, b], [0.3, b * 1.3], [d * 0.7, b * 1.2], [d, b * 0.95]], vowels: [[0, 'e'], [0.3, r.pick(['ae', 'a', 'e'])], [d * 0.8, r.pick(['a', 'o'])]], fscale: fem ? 1.15 : 1, rough: 0.03, vib: [r.range(5, 7), 0.02], breath: 0.2, env: [0.15, d * 0.4], v: r.range(0.25, 0.45) });
  }
  const sr = g.ctx.sampleRate, ap = new Float32Array(Math.floor(sr * 2.6));
  for (let c = 0; c < 450; c++) {
    const st = Math.floor(Math.pow(r.next(), 0.8) * (ap.length - sr * 0.02)), f = r.range(800, 2600), amp = r.range(0.2, 1) * (1 - st / ap.length);
    const bq = new BQ(sr, 'bp', f, 1.2);
    for (let i = 0; i < sr * 0.012; i++) ap[st + i] += bq.p((r.next() * 2 - 1) * Math.exp(-i / (sr * 0.002))) * amp;
  }
  normalize(ap, 0.5);
  g.B(bufFrom(sr, [ap]), 0.05).connect(g.out);
  tone(g, { t: 0.4, f: 2200, f2: 2900, fd: 0.4, a: 0.05, h: 0.4, d: 0.2, v: 0.08 });
}, { vol: 0.7, range: 1.5 });
def('splash', 1.3, (g) => {
  const r = g.rng;
  burst(g, { kind: 'white', type: 'lowpass', f: 4000, f2: 600, fd: 0.5, a: 0.005, d: 0.6, v: 1 });
  burst(g, { kind: 'pink', type: 'lowpass', f: 1200, a: 0.01, d: 0.4, v: 0.8 });
  for (let i = 0; i < 14; i++) { const f = r.range(400, 1400); tone(g, { t: r.range(0.05, 0.9), f, f2: f * 1.7, a: 0.002, d: r.range(0.04, 0.08), v: r.range(0.1, 0.3) }); }
  for (let i = 0; i < 8; i++) tone(g, { t: r.range(0.3, 1.1), f: r.range(2000, 4000), a: 0.001, d: 0.02, v: 0.1 });
}, { vol: 0.7 });
def('glass', 1.0, (g) => { glassLayer(g, { n: 40, v: 0.6, spread: 0.65 }); tone(g, { f: 180, f2: 90, d: 0.08, v: 0.3 }); }, { vars: 2, vol: 0.7 });
def('crash_light', 0.75, (g) => crash(g, { size: 0.6, thumpF: 110, thumpD: 0.12, crunch: 3, glass: 0, rattle: 4, drive: 2 }), { vars: 2, vol: 0.7 });
def('crash_med', 1.3, (g) => crash(g, { size: 1, thumpF: 90, thumpD: 0.2, crunch: 7, glass: 6, rattle: 10, drive: 3 }), { vars: 2, vol: 0.85, range: 1.2 });
def('crash_heavy', 2.2, (g) => crash(g, { size: 1.6, thumpF: 70, thumpD: 0.35, crunch: 14, glass: 30, rattle: 20, drive: 4 }), { vars: 2, vol: 1, range: 1.4 });
def('scrape', 1.25, (g) => {
  const r = g.rng, src = g.N('white', 0, 1.25), bp1 = g.F('bandpass', 1500, 4), bp2 = g.F('bandpass', 4000, 3), am = g.A(0), env = g.A(0);
  const fp = [[0, 1500]]; for (let t = 0.03; t < 1.2; t += 0.03) fp.push([t, r.range(900, 2500), 'e']); g.E(bp1.frequency, 0, fp);
  const ap = [[0, 0.5]]; for (let t = 0.015; t < 1.2; t += 0.015) ap.push([t, r.range(0.2, 1)]); g.E(am.gain, 0, ap);
  src.connect(bp1).connect(am); src.connect(bp2).connect(g.A(0.4)).connect(am);
  g.E(env.gain, 0, [[0, 0], [0.05, 1], [0.85, 0.8], [1.2, 0.0001, 'e']]);
  am.connect(g.S(2.5)).connect(env).connect(g.out);
  tone(g, { f: 1250, f2: 1150, a: 0.05, h: 0.7, d: 0.4, v: 0.12, vib: [9, 0.01] });
}, { vol: 0.6 });
def('explosion', 2.7, (g) => boom(g, { dur: 2.6, debris: 25, blasts: [[0, 1]], drive: 3 }), { vars: 2, vol: 1, range: 2, max: 6 });
def('explosion_big', 4.6, (g) => boom(g, { dur: 4.5, debris: 45, blasts: [[0, 1], [0.4, 0.75], [1.1, 0.55]], drive: 4 }), { vol: 1, range: 2.6, max: 3 });
def('bullet_hit_metal', 0.4, (g) => {
  ring(g, { f: g.rng.range(1800, 2700), ratios: [1, 1.7, 2.4, 3.3], d: 0.22, v: 0.45, jit: 0.03 });
  burst(g, { kind: 'white', type: 'highpass', f: 3000, d: 0.012, v: 0.8 }); burst(g, { kind: 'white', type: 'bandpass', f: 2000, q: 1, d: 0.03, v: 0.4 });
}, { vars: 3, vol: 0.55, max: 6 });
def('bullet_hit_flesh', 0.3, (g) => {
  tone(g, { f: 110, f2: 60, d: 0.08, v: 0.9 }); burst(g, { kind: 'pink', type: 'lowpass', f: 700, d: 0.07, v: 0.8 });
  burst(g, { kind: 'white', type: 'bandpass', f: 1400, q: 3, d: 0.05, v: 0.4 }); burst(g, { t: 0.01, kind: 'white', type: 'bandpass', f: 500, f2: 1500, q: 6, d: 0.1, v: 0.25 });
}, { vars: 3, vol: 0.6, max: 6 });
def('bullet_hit_wall', 0.35, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 1800 * g.rng.range(0.8, 1.2), q: 1, d: 0.04, v: 1 });
  burst(g, { kind: 'white', type: 'highpass', f: 4000, a: 0.005, d: 0.2, v: 0.22 });
  for (let i = 0; i < 4; i++) burst(g, { t: g.rng.range(0.02, 0.2), kind: 'white', type: 'bandpass', f: g.rng.range(2500, 6000), q: 3, d: 0.01, v: 0.15 });
}, { vars: 3, vol: 0.5, max: 6 });
def('ricochet', 0.75, (g) => {
  const f = g.rng.range(2800, 4200);
  burst(g, { kind: 'white', type: 'highpass', f: 2500, d: 0.01, v: 0.7 });
  tone(g, { f, f2: f * 0.38, fd: 0.55, a: 0.004, d: 0.6, v: 0.5, vib: [g.rng.range(25, 40), 0.02] });
  tone(g, { f: f * 1.48, f2: f * 0.55, fd: 0.5, a: 0.004, d: 0.4, v: 0.12 });
}, { vars: 3, vol: 0.5, max: 4 });
def('shell_drop', 0.45, (g) => {
  [[0, 1], [0.09, 0.6], [0.15, 0.4], [0.19, 0.25], [0.22, 0.15]].forEach(([t, v]) => ring(g, { t, f: g.rng.range(4800, 6200), ratios: [1, 1.52, 2.1], d: 0.05, v: 0.5 * v }));
}, { vars: 2, vol: 0.3, max: 6 });
def('reload', 1.0, (g) => {
  clk(g, 0, 2500, 0.6); clk(g, 0.12, 1500, 0.5); burst(g, { t: 0.12, kind: 'pink', type: 'lowpass', f: 1000, d: 0.05, v: 0.4 });
  clk(g, 0.42, 1800, 0.9); tone(g, { t: 0.42, f: 260, d: 0.05, v: 0.4 });
  burst(g, { t: 0.62, kind: 'white', type: 'bandpass', f: 1000, f2: 3000, fd: 0.07, q: 2, a: 0.01, d: 0.06, v: 0.5 });
  clk(g, 0.72, 2200, 1); clk(g, 0.74, 3500, 0.6);
}, { vol: 0.55 });
def('empty_click', 0.12, (g) => { clk(g, 0, 3000, 1, 0.015); clk(g, 0.005, 6000, 0.4, 0.01); }, { vol: 0.45 });
def('melee_swing', 0.35, (g) => burst(g, { kind: 'white', type: 'bandpass', fpts: [[0, 500], [0.12, 2600], [0.26, 800]], q: 1.5, a: 0.08, d: 0.16, v: 1 }), { vars: 2, vol: 0.45 });
def('bat_hit', 0.4, (g) => {
  const m = g.drive(2);
  tone(g, { f: 230, f2: 190, d: 0.1, v: 0.9, to: m }); tone(g, { f: 680, d: 0.05, v: 0.4, to: m });
  burst(g, { kind: 'white', type: 'bandpass', f: 1100, q: 3, d: 0.06, v: 0.7, to: m }); tone(g, { f: 90, f2: 50, d: 0.15, v: 0.9, to: m });
}, { vars: 2, vol: 0.8 });
def('knife_stab', 0.35, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 1500, f2: 3500, q: 1.5, a: 0.02, d: 0.06, v: 0.4 });
  burst(g, { t: 0.05, kind: 'white', type: 'bandpass', f: 700, f2: 1600, q: 5, d: 0.12, v: 0.6 }); tone(g, { t: 0.05, f: 140, f2: 80, d: 0.08, v: 0.5 });
}, { vars: 2, vol: 0.6 });
for (const [n, [dur, P]] of Object.entries(GUNS)) def(n, dur, (g) => gun(g, P), { vars: 2, vol: n === 'minigun_shot' ? 0.75 : 0.95, range: n === 'sniper' ? 2.5 : 1.8, max: n === 'minigun_shot' || n === 'smg' ? 8 : 5 });
def('rocket_launch', 1.7, (g) => {
  const m = g.drive(2);
  burst(g, { kind: 'white', type: 'highpass', f: 800, d: 0.05, v: 1, to: m }); tone(g, { f: 90, f2: 40, d: 0.25, v: 0.9, to: m });
  burst(g, { kind: 'white', type: 'bandpass', f: 500, f2: 2200, fd: 0.5, q: 0.6, a: 0.05, h: 0.3, d: 1.0, v: 0.8, to: m });
  burst(g, { kind: 'brown', type: 'lowpass', f: 900, a: 0.03, h: 0.3, d: 1.1, v: 0.7, to: m });
  for (let i = 0; i < 20; i++) burst(g, { t: g.rng.range(0.05, 1.0), kind: 'white', type: 'highpass', f: 2000, d: 0.01, v: 0.3 });
}, { vol: 0.9, range: 1.8 });
def('grenade_throw', 0.7, (g) => {
  clk(g, 0, 2600, 0.5); ring(g, { f: 3500, ratios: [1, 1.5], d: 0.15, v: 0.3 });
  burst(g, { t: 0.25, kind: 'white', type: 'bandpass', fpts: [[0, 400], [0.1, 1800], [0.25, 600]], q: 1.4, a: 0.06, d: 0.2, v: 0.7 });
}, { vol: 0.55 });
def('molotov_throw', 0.9, (g) => {
  ring(g, { f: 1700, ratios: [1, 2.3, 3.6], d: 0.2, v: 0.3 });
  burst(g, { kind: 'pink', type: 'lowpass', fpts: [[0, 300], [0.1, 900], [0.2, 400], [0.3, 800]], a: 0.05, d: 0.3, v: 0.5 });
  burst(g, { t: 0.05, kind: 'brown', type: 'lowpass', f: 800, a: 0.05, d: 0.25, v: 0.4 });
  burst(g, { t: 0.3, kind: 'white', type: 'bandpass', fpts: [[0, 400], [0.1, 1600], [0.25, 500]], q: 1.4, a: 0.06, d: 0.2, v: 0.6 });
}, { vol: 0.55 });
def('taser', 0.95, (g) => {
  const m = g.drive(4), o1 = g.O('sawtooth', 95, 0, 0.95), o2 = g.O('square', 190, 0, 0.95), am = g.A(0);
  o1.connect(am); o2.connect(g.A(0.5)).connect(am);
  const pts = [[0, 0.2]]; for (let t = 0.008; t < 0.85; t += 0.008) pts.push([t, g.rng.range(0.15, 1), 's']); pts.push([0.9, 0.0001, 'e']); g.E(am.gain, 0, pts);
  am.connect(g.F('bandpass', 2500, 0.7)).connect(m);
  for (let t = 0; t < 0.85; t += 0.05) burst(g, { t, kind: 'white', type: 'highpass', f: 3000, d: 0.01, v: 0.8, to: m });
}, { vol: 0.55 });
// Vehicles / horns ---------------------------------------------------------------
def('horn_high', 0.55, (g) => horn(g, [500, 630]), { vol: 0.75, range: 1.5, max: 3 });
def('horn_mid', 0.55, (g) => horn(g, [405, 510]), { vol: 0.75, range: 1.5, max: 3 });
def('horn_low', 0.6, (g) => horn(g, [310, 390], { dur: 0.6, bp: 1400 }), { vol: 0.8, range: 1.5, max: 3 });
def('horn_truck', 1.2, (g) => horn(g, [175, 220, 262], { dur: 1.15, a: 0.08, bp: 900, q: 0.7, drive: 4, scoop: 0.9 }), { vol: 0.9, range: 2, max: 2 });
def('horn_moto', 0.45, (g) => horn(g, [430], { type: 'square', dur: 0.42, bp: 2000, q: 2, drive: 2 }), { vol: 0.6, range: 1.3 });
def('horn_squeaky', 0.5, (g) => {
  for (const t of [0, 0.22]) tone(g, { t, type: 'square', fpts: [[0, 620], [0.06, 880], [0.17, 700]], a: 0.01, h: 0.1, d: 0.06, v: 0.4, filt: ['bandpass', 1500, 1.5] });
}, { vol: 0.6 });
def('horn_bike_bell', 0.6, (g) => { bellRing(g, 0, 2600, 0.6, 0.35); bellRing(g, 0.16, 2600, 0.55, 0.4); }, { vol: 0.5 });
def('bicycle_bell', 1.0, (g) => {
  for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) bellRing(g, k * 0.38 + i * 0.03, 2450, 0.4 * (1 - i * 0.08), 0.5);
}, { vol: 0.5 });
def('train_horn', 2.7, (g) => horn(g, [311, 370, 415, 494, 622], { dur: 2.6, a: 0.15, r: 0.4, bp: 1200, q: 0.5, drive: 2.5, scoop: 0.96 }), { vol: 1, range: 3, max: 2 });
def('train_bell', 2.9, (g) => { for (let i = 0; i < 7; i++) ring(g, { t: i * 0.42, f: 720, ratios: [1, 2.0, 2.76, 3.9, 5.4], d: 0.6, v: 0.5 }); }, { vol: 0.7, range: 2 });
def('helicopter_flyby', 6.0, (g) => {
  const pw = periodicWave(g.ctx, 'blade', (x) => Math.exp(-((x - 0.5) ** 2) / 0.003), 64);
  const bo = g.O(pw.wave, 18.5, 0, 6); g.E(bo.frequency, 0, [[0, 18.5], [2.8, 18], [3.4, 16], [6, 15.5]]);
  const rect = g.ctx.createWaveShaper(); rect.curve = rectCurve(); const am = g.A(0), nz = g.N('white', 0, 6);
  bo.connect(rect).connect(am.gain); nz.connect(g.F('lowpass', 1100, 0.8)).connect(am);
  const env = g.A(0), lp = g.F('lowpass', 600, 0.7);
  g.E(env.gain, 0, [[0, 0], [2.9, 1, 'l'], [6, 0.0001, 'e']]); g.E(lp.frequency, 0, [[0, 600], [3, 3500, 'e'], [6, 500, 'e']]);
  am.connect(lp); bo.connect(g.F('lowpass', 130)).connect(g.A(0.8)).connect(lp);
  const wh = g.O('sine', 3900, 0, 6); g.E(wh.frequency, 0, [[0, 3900], [2.9, 3800], [3.3, 3300], [6, 3250]]); wh.connect(g.A(0.06)).connect(lp);
  lp.connect(env).connect(g.out);
}, { vol: 0.9, range: 2.5 });
// Ambience / Oklahoma ------------------------------------------------------------
def('thunder', 5.6, (g) => {
  const r = g.rng, m = g.drive(2);
  burst(g, { kind: 'white', type: 'lowpass', f: 8000, f2: 1500, fd: 0.3, a: 0.002, d: 0.45, v: 0.9, to: m });
  const src = g.N('brown', 0, 5.6), lp = g.F('lowpass', 1200, 0.6), env = g.A(0);
  g.E(lp.frequency, 0, [[0, 1500], [5.5, 120, 'e']]);
  const pts = [[0, 0]]; let t = 0.05; while (t < 5.3) { pts.push([t, r.range(0.3, 1) * Math.exp(-t / 2.2)]); t += r.range(0.08, 0.3); } pts.push([5.5, 0.0001, 'e']);
  g.E(env.gain, 0, pts); src.connect(lp).connect(env).connect(m);
  tone(g, { f: 40, f2: 28, fd: 2, a: 0.05, d: 2, v: 0.6, to: m });
}, { vol: 1 });
def('tornado_siren', 16.0, (g) => {
  const pw = periodicWave(g.ctx, 'tsiren', (x) => Math.tanh(3 * Math.sin(TAU * x)), 32);
  const mix = g.A(1), lp = g.F('lowpass', 1500, 0.7), rot = g.A(0), env = g.A(0);
  for (const k of [1, 1.2]) {
    const o = g.O(pw.wave, 60 * k, 0, 16);
    g.E(o.frequency, 0, [[0, 60 * k], [3.5, 450 * k, 'e'], [5, 478 * k], [8, 470 * k], [11, 476 * k], [16, 85 * k, 'e']]);
    o.connect(g.A(0.5)).connect(mix);
  }
  const rp = [], lpts = [];
  for (let t = 0; t <= 16; t += 0.25) { const c = Math.pow(0.5 + 0.5 * Math.cos((TAU * t) / 7.5), 1.5); rp.push([t, 0.3 + 0.7 * c]); lpts.push([t, 700 + 2600 * c]); }
  g.E(rot.gain, 0, rp); g.E(lp.frequency, 0, lpts);
  g.E(env.gain, 0, [[0, 0], [1, 0.8], [11, 1], [15.9, 0.0001, 'e']]);
  mix.connect(g.S(1.5)).connect(lp).connect(rot).connect(env).connect(g.out);
  echo(g, env, { dt: 0.45, fb: 0.35, lp: 1200, v: 0.4 });
}, { vol: 0.8, range: 6, max: 1 });
// Internal (used by engine/radio code)
def('backfire', 0.5, (g) => { const m = g.drive(3); burst(g, { kind: 'white', type: 'lowpass', f: 3000, d: 0.05, v: 1, to: m }); tone(g, { f: 120, f2: 50, d: 0.1, v: 1, to: m }); burst(g, { kind: 'brown', type: 'lowpass', f: 600, d: 0.2, v: 0.5, to: m }); }, { vars: 2, vol: 0.7, internal: true });
def('radio_tune', 0.4, (g) => {
  burst(g, { kind: 'white', type: 'bandpass', f: 600, f2: 3000, fd: 0.3, q: 2, a: 0.01, h: 0.2, d: 0.15, v: 0.7 });
  burst(g, { kind: 'white', type: 'highpass', f: 2000, a: 0.005, h: 0.25, d: 0.1, v: 0.25 });
  tone(g, { t: 0.05, f: 2000, f2: 400, fd: 0.15, d: 0.18, v: 0.15 });
}, { vol: 0.35, internal: true });
def('squelch', 0.25, (g) => burst(g, { kind: 'white', type: 'bandpass', f: 2000, q: 0.5, a: 0.001, d: 0.14, v: 1 }), { vol: 0.3, internal: true });

// ============================================================== ENGINES ====
// Live graph per engine: a PeriodicWave holding one full engine cycle (firing
// pulses with per-cylinder unevenness) drives (a) the tonal exhaust note and
// (b) an AM gate on shared noise (combustion hiss/clatter). Fixed resonant
// peaking filters model the exhaust/muffler, a lowpass opens with load.

const _kits = new WeakMap();
// Shared looping sources per AudioContext (white noise + slow "jitter" noise).
function kitFor(ctx) {
  let k = _kits.get(ctx);
  if (k) return k;
  const sr = ctx.sampleRate, nb = noiseBufs(sr);
  const noise = ctx.createBufferSource(); noise.buffer = nb.white; noise.loop = true; noise.start();
  const rng = new RNG(77), len = sr * 4, jd = new Float32Array(len), l1 = new LFN(rng, 9, sr), l2 = new LFN(rng, 23, sr);
  for (let i = 0; i < len; i++) jd[i] = l1.next() * 0.75 + l2.next() * 0.25;
  const jitter = ctx.createBufferSource(); jitter.buffer = bufFrom(sr, [loopXfade(jd, sr >> 3)]); jitter.loop = true; jitter.start();
  k = { noise, jitter };
  _kits.set(ctx, k);
  return k;
}

const ENGINE_PROFILES = {
  i4:         { cyl: 4, idle: 850, max: 6800, tau: 0.04, res: [[380, 7, 1.3], [1350, 4, 2]], lp: [900, 5200], noise: 0.22, nf: 1400, drive: 1.6, vol: 1.1, jit: 0.012 },
  v6:         { cyl: 6, idle: 800, max: 6500, tau: 0.028, amps: [1, 0.9, 0.95, 0.88, 1, 0.92], res: [[260, 8, 1.2], [950, 4, 1.6]], lp: [800, 4600], noise: 0.25, nf: 1200, drive: 1.8, vol: 0.73, jit: 0.012 },
  v8:         { cyl: 8, idle: 750, max: 6200, tau: 0.021, amps: [1, 0.78, 0.86, 1, 0.8, 0.95, 0.9, 0.76], res: [[170, 9, 1], [620, 5, 1.4]], lp: [700, 4000], noise: 0.28, nf: 1000, drive: 2.2, vol: 0.56, jit: 0.015 },
  v8_muscle:  { cyl: 8, idle: 680, max: 6000, cycles: 2, lope: 0.45, tau: 0.02, amps: [1, 0.7, 0.85, 1, 0.75, 0.95, 0.9, 0.7], res: [[140, 10, 1], [520, 6, 1.3]], lp: [600, 3600], noise: 0.32, nf: 900, drive: 3, vol: 0.82, jit: 0.03, pops: true },
  v12_super:  { cyl: 12, idle: 950, max: 8800, tau: 0.014, res: [[700, 6, 1.4], [2300, 5, 2]], lp: [1800, 9000], noise: 0.2, nf: 2600, drive: 2.2, vol: 0.86, jit: 0.008, pops: true },
  diesel:     { cyl: 6, idle: 680, max: 3800, tau: 0.03, res: [[150, 8, 1], [480, 5, 1.3]], lp: [650, 3000], noise: 0.5, nf: 2600, drive: 2.4, vol: 0.55, jit: 0.015, clatter: 1, turbo: [2200, 6500] },
  diesel_big: { cyl: 6, idle: 600, max: 2100, tau: 0.03, res: [[95, 9, 1], [340, 6, 1.2]], lp: [450, 2200], noise: 0.5, nf: 2200, drive: 2.8, vol: 0.61, jit: 0.015, clatter: 1, turbo: [1800, 5200] },
  electric:   { kind: 'electric', vol: 1.75 },
  moto_2t:    { cyl: 1, stroke: 2, idle: 1500, max: 11000, tau: 0.06, res: [[1150, 12, 4], [2600, 6, 3]], lp: [2400, 9000], noise: 0.35, nf: 3000, drive: 3.5, vol: 1.19, jit: 0.02, pops: true },
  moto_4t:    { cyl: 4, idle: 1250, max: 13000, tau: 0.035, res: [[520, 7, 2], [1700, 6, 2]], lp: [1400, 8500], noise: 0.25, nf: 2000, drive: 2.2, vol: 0.85, jit: 0.01 },
  moto_v2:    { cyl: 2, idle: 850, max: 5600, fire: [0, 315 / 720], tau: 0.045, res: [[130, 9, 1], [430, 6, 1.4]], lp: [500, 2800], noise: 0.35, nf: 900, drive: 3, vol: 0.8, jit: 0.03, pops: true },
  atv:        { cyl: 1, idle: 1300, max: 7800, tau: 0.05, res: [[330, 7, 2], [1000, 5, 2]], lp: [800, 4200], noise: 0.3, nf: 1600, drive: 2.5, vol: 1.33, jit: 0.02, pops: true },
  bicycle:    { kind: 'bicycle', vol: 2.4 },
  tractor:    { cyl: 2, idle: 550, max: 2000, fire: [0, 0.25], tau: 0.05, res: [[110, 9, 1], [380, 6, 1.4]], lp: [380, 1800], noise: 0.4, nf: 900, drive: 2.6, vol: 1.03, jit: 0.02, clatter: 0.6 },
  mower:      { cyl: 1, idle: 2400, max: 3600, tau: 0.06, res: [[650, 7, 3], [1800, 5, 3]], lp: [1400, 4500], noise: 0.45, nf: 2500, drive: 3, vol: 1.02, jit: 0.025 },
  outboard:   { cyl: 2, stroke: 2, idle: 900, max: 5800, tau: 0.05, res: [[480, 8, 2.5], [1500, 6, 2]], lp: [900, 5000], noise: 0.35, nf: 1800, drive: 2.8, vol: 0.96, jit: 0.02, gurgle: 1 },
  turbine:    { kind: 'turbine', vol: 3.4 },
};

function engineWave(ctx, name, P) {
  const M = P.cycles || 1, fire = P.fire || Array.from({ length: P.cyl }, (_, i) => i / P.cyl);
  const amps = P.amps || fire.map(() => 1), rng = new RNG(hashStr(name)), ev = [];
  for (let c = 0; c < M; c++) fire.forEach((ph, k) => {
    let a = amps[k % amps.length];
    if (P.lope) a *= 1 - P.lope * rng.next();
    ev.push([(c + ph + rng.range(-0.006, 0.006) * (P.lope ? 1 : 0.3)) / M, a]);
  });
  const tau = P.tau / M;
  const fn = (x) => {
    let s = 0;
    for (const [ph, a] of ev) { let d = x - ph; d -= Math.floor(d); const u = d / tau; if (u < 16) s += a * Math.exp(-u / 1.8) * Math.sin(u); }
    return s;
  };
  return periodicWave(ctx, 'eng_' + name, fn, 400, 2048);
}
// Generic node-tracking base for live voices.
class LiveVoice {
  constructor(ctx) { this.ctx = ctx; this.nodes = []; this.srcs = []; this.shared = []; this.dead = false; }
  n(x) { this.nodes.push(x); return x; }
  gain(v) { const g = this.n(this.ctx.createGain()); g.gain.value = v; return g; }
  filt(type, f, q = 0.707, db = 0) { const b = this.n(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = db; return b; }
  osc(type, f) {
    const o = this.n(this.ctx.createOscillator());
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = f; o.start(); this.srcs.push(o); return o;
  }
  shaper(curve) { const s = this.n(this.ctx.createWaveShaper()); s.curve = curve; return s; }
  share(src, dst) { src.connect(dst); this.shared.push([src, dst]); return dst; }
  kill(fade = 0.05) {
    if (this.dead) return; this.dead = true;
    const t = this.ctx.currentTime;
    if (this.out) { this.out.gain.cancelScheduledValues(t); this.out.gain.setValueAtTime(this.out.gain.value, t); this.out.gain.setTargetAtTime(0, t, fade); }
    for (const s of this.srcs) { try { s.stop(t + fade * 6 + 0.05); } catch (e) { /* already stopped */ } }
    setTimeout(() => {
      for (const [s, d] of this.shared) { try { s.disconnect(d); } catch (e) { /* gone */ } }
      for (const nd of this.nodes) { try { nd.disconnect(); } catch (e) { /* gone */ } }
    }, (fade * 6 + 0.2) * 1000);
  }
}

class EngineVoice extends LiveVoice {
  constructor(ctx, dest, name, P, player) {
    super(ctx);
    this.P = P; this.player = player;
    const kit = kitFor(ctx);
    this.out = this.gain(0); this.pan = this.n(ctx.createStereoPanner());
    this.out.connect(this.pan).connect(dest);
    if (P.kind === 'electric') this._electric(kit);
    else if (P.kind === 'bicycle') this._bicycle(kit);
    else if (P.kind === 'turbine') this._turbine(kit);
    else this._ice(kit, name);
  }
  _ice(kit, name) {
    const P = this.P, w = engineWave(this.ctx, name, P);
    const o = (this.o = this.osc(w.wave, 10));
    this.jg = this.share(kit.jitter, this.gain(0)); this.jg.connect(o.frequency);
    const mix = this.gain(1);
    o.connect(this.gain(1)).connect(mix);
    const rect = this.shaper(rectCurve()); o.connect(rect);
    const am = this.share(kit.noise, this.gain(0)); rect.connect(am.gain);
    this.nl = this.gain(P.noise); am.connect(this.filt('bandpass', P.nf, 0.6)).connect(this.nl).connect(mix);
    if (P.clatter) { this.cl = this.gain(0); am.connect(this.filt('highpass', 2800, 0.7)).connect(this.cl).connect(mix); }
    let chain = mix.connect(this.shaper(driveCurve(P.drive)));
    for (const [f, db, q] of P.res) chain = chain.connect(this.filt('peaking', f, q, db));
    this.lp = this.filt('lowpass', P.lp[0], 0.8);
    chain.connect(this.lp).connect(this.out);
    if (this.player) {
      this.sub = this.osc('sine', 40); this.subG = this.gain(0); this.sub.connect(this.subG).connect(this.out);
      this.road = this.gain(0); this.share(kit.noise, this.filt('lowpass', 420, 0.6)).connect(this.road).connect(this.out);
    }
    if (P.turbo) { this.tb = this.osc('sine', P.turbo[0]); this.tbG = this.gain(0); this.tb.connect(this.tbG).connect(this.out); }
    if (P.gurgle) {
      this.gu = this.gain(0); const gam = this.gain(0);
      this.share(kit.noise, this.filt('lowpass', 380, 1)).connect(gam).connect(this.gu).connect(this.out);
      this.share(kit.jitter, gam.gain);
    }
  }
  _electric(kit) {
    this.m1 = this.osc('sine', 100); this.m2 = this.osc('triangle', 250); this.inv = this.osc('sine', 7200);
    this.g1 = this.gain(0); this.g2 = this.gain(0); this.gi = this.gain(0);
    this.m1.connect(this.g1).connect(this.out);
    this.m2.connect(this.filt('bandpass', 1800, 1)).connect(this.g2).connect(this.out);
    this.inv.connect(this.gi).connect(this.out);
    this.road = this.gain(0); this.share(kit.noise, this.filt('lowpass', 500, 0.6)).connect(this.road).connect(this.out);
  }
  _bicycle(kit) {
    const tw = periodicWave(this.ctx, 'tick', (x) => Math.exp(-((x - 0.05) ** 2) / 0.00008) - 0.5 * Math.exp(-((x - 0.08) ** 2) / 0.0002), 200);
    this.tk = this.osc(tw.wave, 10); this.tkG = this.gain(0);
    this.tk.connect(this.filt('highpass', 2500, 0.7)).connect(this.filt('peaking', 4500, 2, 6)).connect(this.tkG).connect(this.out);
    this.chn = this.gain(0); this.share(kit.noise, this.filt('bandpass', 1800, 1.5)).connect(this.chn).connect(this.out);
    this.ty = this.gain(0); this.share(kit.noise, this.filt('lowpass', 350, 0.7)).connect(this.ty).connect(this.out);
  }
  _turbine(kit) {
    const bw = periodicWave(this.ctx, 'blade', (x) => Math.exp(-((x - 0.5) ** 2) / 0.003), 64);
    this.bo = this.osc(bw.wave, 16); this.bj = this.share(kit.jitter, this.gain(0)); this.bj.connect(this.bo.frequency);
    const rect = this.shaper(rectCurve()), am = this.share(kit.noise, this.gain(0));
    this.bo.connect(rect).connect(am.gain);
    this.wg = this.gain(0); am.connect(this.filt('lowpass', 1100, 0.8)).connect(this.wg).connect(this.out);
    this.th = this.gain(0); this.bo.connect(this.filt('lowpass', 130, 0.7)).connect(this.th).connect(this.out);
    this.w1 = this.osc('sine', 3000); this.w1g = this.gain(0); this.w1.connect(this.w1g).connect(this.out);
    this.w2 = this.osc('sine', 4800); this.w2g = this.gain(0); this.w2.connect(this.w2g).connect(this.out);
  }
  // st: {rpm, throttle, speed}; sp: {g, pan, lp}
  apply(st, sp, vol = 1) {
    if (this.dead) return;
    const P = this.P, t = this.ctx.currentTime, tc = 0.045;
    const rpm = clamp(st.rpm || 0), thr = clamp(st.throttle || 0), spd = Math.abs(st.speed || 0);
    const set = (p, v, k = tc) => p.setTargetAtTime(v, t, k);
    let lvl = P.vol;
    if (P.kind === 'electric') {
      const f = 90 + 1900 * rpm;
      set(this.m1.frequency, f); set(this.m2.frequency, f * 2.5); set(this.inv.frequency, 7200 + 300 * rpm);
      set(this.g1.gain, 0.35 * Math.max(0.08, (0.35 + 0.65 * thr) * (0.3 + 0.7 * rpm)));
      set(this.g2.gain, 0.12 * thr * (0.2 + 0.8 * rpm)); set(this.gi.gain, 0.02 * thr); set(this.road.gain, clamp(spd / 30) * 0.4);
    } else if (P.kind === 'bicycle') {
      set(this.tk.frequency, clamp(spd * 6.5, 0.5, 90));
      set(this.tkG.gain, (1 - thr) * clamp(spd / 1.2) * 0.6); set(this.chn.gain, thr * clamp(spd / 3) * 0.12); set(this.ty.gain, clamp(spd / 10) * 0.35);
    } else if (P.kind === 'turbine') {
      const bh = 3 + 15 * rpm;
      set(this.bo.frequency, bh, 0.25); set(this.bj.gain, bh * 0.01);
      set(this.wg.gain, (0.3 + 0.7 * thr) * 0.9 * clamp(rpm * 1.5)); set(this.th.gain, 0.6 * clamp(rpm * 1.3));
      set(this.w1.frequency, 1400 + 2800 * rpm, 0.3); set(this.w1g.gain, 0.05 * rpm); set(this.w2.frequency, (1400 + 2800 * rpm) * 1.62, 0.3); set(this.w2g.gain, 0.02 * rpm);
    } else {
      const RPM = P.idle + (P.max - P.idle) * rpm, cyc = RPM / (P.stroke === 2 ? 60 : 120), M = P.cycles || 1;
      this.fireHz = cyc * P.cyl;
      set(this.o.frequency, cyc / M);
      set(this.jg.gain, (cyc / M) * P.jit * (1.3 - rpm));
      const load = clamp(0.25 * rpm + 0.75 * thr * (0.45 + 0.55 * rpm));
      set(this.lp.frequency, lerp(P.lp[0], P.lp[1], load) * (sp.lp ?? 1));
      set(this.nl.gain, P.noise * (0.35 + 0.65 * thr) * 1.6);
      if (this.cl) set(this.cl.gain, P.clatter * 0.5 * (1 - 0.6 * rpm));
      if (this.sub) { set(this.sub.frequency, this.fireHz / 2); set(this.subG.gain, 0.2 * (0.5 + 0.5 * thr)); set(this.road.gain, clamp(spd / 35) * 0.35); }
      if (this.tb) { set(this.tb.frequency, lerp(P.turbo[0], P.turbo[1], rpm)); set(this.tbG.gain, 0.025 * thr * rpm * rpm); }
      if (this.gu) set(this.gu.gain, 0.3);
      lvl = P.vol * (0.5 + 0.32 * thr + 0.22 * rpm);
    }
    set(this.out.gain, lvl * (sp.g ?? 1) * vol * (this.player ? 0.42 : 0.3), 0.05);
    set(this.pan.pan, sp.pan ?? 0, 0.05);
  }
}

const NOPOS = { g: 1, pan: 0, lp: 1 };

class EngineHandle {
  constructor(sys, profile) {
    this.sys = sys; this.profile = ENGINE_PROFILES[profile] ? profile : 'i4'; this.P = ENGINE_PROFILES[this.profile];
    this.state = { rpm: 0, throttle: 0, speed: 0 }; this.x = null; this.y = null; this.player = false;
    this.voice = null; this.alive = true; this.vol = 1; this._last = 0; this._dirty = false;
  }
  setState(s = {}) {
    const st = this.state, prevT = st.throttle;
    if (s.rpm != null) st.rpm = +s.rpm || 0;
    if (s.throttle != null) st.throttle = +s.throttle || 0;
    if (s.speed != null) st.speed = +s.speed || 0;
    if (this.voice && this.P.pops && prevT > 0.6 && st.throttle < 0.15 && st.rpm > 0.6 && Math.random() < 0.4) {
      this.sys.play('backfire', this.player || this.x == null ? { vol: 0.5 } : { x: this.x, y: this.y, vol: 0.5 });
    }
    this._apply();
    return this;
  }
  setPos(x, y) { this.x = x; this.y = y; this._apply(); return this; }
  setPlayer(b = true) {
    b = !!b; if (b === this.player) return this;
    this.player = b; this._despawn(); this.sys._updateEngines();
    return this;
  }
  setVolume(v) { this.vol = clamp(v, 0, 2); this._apply(true); return this; }
  stop() { this.alive = false; this._despawn(); this.sys._engines.delete(this); }
  get live() { return !!this.voice; }
  _sp() { return this.player || this.x == null ? NOPOS : this.sys._spatial(this.x, this.y, 1.2); }
  _score() { if (this.player) return 1e9; return this._sp().g * this.P.vol * this.vol * (0.6 + 0.4 * this.state.throttle); }
  _apply(force) {
    if (!this.voice) return;
    const t = nowMs();
    if (!force && t - this._last < 30) { this._dirty = true; return; }
    this._last = t; this._dirty = false;
    this.voice.apply(this.state, this._sp(), this.vol);
  }
  _spawn() {
    if (!this.sys.ctx || this.voice) return;
    this.voice = new EngineVoice(this.sys.ctx, this.sys.engBus, this.profile, this.P, this.player);
    this._apply(true);
  }
  _despawn() { if (this.voice) { this.voice.kill(0.04); this.voice = null; } }
}

// =============================================================== SIRENS ====
const SIREN_SHAPES = {
  wail: (x) => (x < 0.55 ? Math.sin(((x / 0.55) * Math.PI) / 2) : Math.cos((((x - 0.55) / 0.45) * Math.PI) / 2)),
  yelp: (x) => (x < 0.5 ? x * 2 : (1 - x) * 2),
  hilo: (x) => Math.tanh(6 * Math.sin(TAU * x)),
  growl: (x) => (x < 0.3 ? 1 - Math.pow(1 - x / 0.3, 2) : Math.exp(-(x - 0.3) * 4.5)),
};
const SIRENS = {
  police: { modes: { wail: { rate: 0.23, lo: 640, hi: 1480 }, yelp: { rate: 3.3, lo: 680, hi: 1500 }, hilo: { rate: 0.8, lo: 760, hi: 980 } },
    def: 'auto', auto: [['wail', 6.5], ['yelp', 4]], osc: ['square', 'sawtooth'], det: 1.003, mix2: 0.35, bp: [1500, 0.9], drive: 2.5, vol: 0.32 },
  ambulance: { modes: { wail: { rate: 0.2, lo: 700, hi: 1550 }, yelp: { rate: 4, lo: 720, hi: 1550 }, hilo: { rate: 0.9, lo: 650, hi: 875 } },
    def: 'auto', auto: [['hilo', 5], ['yelp', 3.5]], osc: ['sawtooth', 'triangle'], det: 2.0, mix2: 0.3, bp: [1700, 1], drive: 1.8, vol: 0.45 },
  fire: { modes: { growl: { rate: 0.1, lo: 180, hi: 1050 }, wail: { rate: 0.2, lo: 600, hi: 1400 }, yelp: { rate: 3, lo: 650, hi: 1400 }, hilo: { rate: 0.8, lo: 700, hi: 930 } },
    def: 'growl', osc: ['sawtooth', 'square'], det: 0.5, mix2: 0.4, bp: [900, 0.6], drive: 3, vol: 0.45, growlAM: 31 },
};

class SirenVoice extends LiveVoice {
  constructor(ctx, dest, type) {
    super(ctx);
    const T = (this.T = SIRENS[type] || SIRENS.police);
    this.lfo = this.osc('sine', 0.2); this.d1 = this.gain(0); this.d2 = this.gain(0);
    this.o1 = this.osc(T.osc[0], 1000); this.o2 = this.osc(T.osc[1], 1000 * T.det);
    this.lfo.connect(this.d1).connect(this.o1.frequency); this.lfo.connect(this.d2).connect(this.o2.frequency);
    const mix = this.gain(1); this.o1.connect(this.gain(0.5)).connect(mix); this.o2.connect(this.gain(T.mix2)).connect(mix);
    this.lp = this.filt('lowpass', 5500, 0.7); this.am = this.gain(1);
    mix.connect(this.shaper(driveCurve(T.drive))).connect(this.filt('peaking', T.bp[0], T.bp[1], 6)).connect(this.filt('highpass', 300, 0.7)).connect(this.lp).connect(this.am);
    if (T.growlAM) { this.am.gain.value = 0.65; const l = this.osc('sine', T.growlAM); l.connect(this.gain(0.35)).connect(this.am.gain); }
    this.out = this.gain(0); this.pan = this.n(ctx.createStereoPanner());
    this.am.connect(this.out).connect(this.pan).connect(dest);
  }
  mode(m) {
    const T = this.T, key = T.modes[m] ? m : Object.keys(T.modes)[0], M = T.modes[key], shape = key;
    const w = periodicWave(this.ctx, 'siren_' + shape, SIREN_SHAPES[shape], 48);
    const d = (M.hi - M.lo) / (w.max - w.min), c = M.lo - d * w.min, t = this.ctx.currentTime;
    this.lfo.setPeriodicWave(w.wave); this.lfo.frequency.setValueAtTime(M.rate, t);
    this.o1.frequency.setTargetAtTime(c, t, 0.03); this.d1.gain.setTargetAtTime(d, t, 0.03);
    this.o2.frequency.setTargetAtTime(c * T.det, t, 0.03); this.d2.gain.setTargetAtTime(d * T.det, t, 0.03);
  }
  apply(sp, cents, vol) {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(this.T.vol * sp.g * vol, t, 0.05); this.pan.pan.setTargetAtTime(sp.pan, t, 0.05);
    this.lp.frequency.setTargetAtTime(5500 * sp.lp, t, 0.05);
    this.o1.detune.setTargetAtTime(cents, t, 0.08); this.o2.detune.setTargetAtTime(cents, t, 0.08);
  }
}

class SirenHandle {
  constructor(sys, type) {
    this.sys = sys; this.type = SIRENS[type] ? type : 'police'; this.x = null; this.y = null; this.vx = 0; this.vy = 0;
    this.vol = 1; this.voice = null; this.alive = true; this._mode = SIRENS[this.type].def; this._timer = null;
    this._ensure();
  }
  _ensure() {
    if (this.voice || !this.alive || !this.sys.ctx) return;
    this.voice = new SirenVoice(this.sys.ctx, this.sys.sirenBus, this.type);
    this.setMode(this._mode); this._update();
  }
  setMode(m) {
    this._mode = m; clearTimeout(this._timer); this._ensure();
    if (!this.voice) return this;
    const T = SIRENS[this.type];
    if (m === 'auto' && T.auto) {
      let i = 0;
      const step = () => { if (!this.alive || this._mode !== 'auto') return; const [mm, dur] = T.auto[i++ % T.auto.length]; this.voice.mode(mm); this._timer = setTimeout(step, dur * 1000); };
      step();
    } else this.voice.mode(m === 'auto' ? Object.keys(T.modes)[0] : m);
    return this;
  }
  setPos(x, y) { this.x = x; this.y = y; this._update(); return this; }
  setVelocity(vx, vy) { this.vx = vx || 0; this.vy = vy || 0; this._update(); return this; }
  setVolume(v) { this.vol = clamp(v, 0, 2); this._update(); return this; }
  stop() { this.alive = false; clearTimeout(this._timer); if (this.voice) this.voice.kill(0.08); this.voice = null; this.sys._sirens.delete(this); }
  _update() {
    this._ensure();
    if (!this.voice) return;
    let sp = NOPOS, cents = 0;
    if (this.x != null) {
      sp = this.sys._spatial(this.x, this.y, 1.7);
      const L = this.sys.listener, dx = this.x - L.x, dy = this.y - L.y, d = Math.hypot(dx, dy) || 1;
      const vr = (dx * (this.vx - L.vx) + dy * (this.vy - L.vy)) / d; // + = receding
      cents = clamp(1200 * Math.log2(343 / (343 + clamp(vr, -150, 150))), -350, 350);
    }
    this.voice.apply(sp, cents, this.vol);
  }
}

// ================================================================ LOOPS ====
function genSqueal(sr, rng, N) {
  const out = new Float32Array(N), fj = new LFN(rng, 7, sr), aj = new LFN(rng, 30, sr, 0.45, 1), aj2 = new LFN(rng, 3, sr, 0.6, 1), bp = new BQ(sr, 'bp', 2600, 2);
  let p1 = 0, p2 = 0, p3 = 0; const f0 = rng.range(1050, 1250);
  for (let i = 0; i < N; i++) {
    const f = f0 * (1 + 0.07 * fj.next());
    p1 = (p1 + f / sr) % 1; p2 = (p2 + (2.03 * f) / sr) % 1; p3 = (p3 + (3.07 * f) / sr) % 1;
    const a = aj.next() * aj2.next();
    out[i] = (Math.sin(TAU * p1) + 0.45 * Math.sin(TAU * p2) + 0.18 * Math.sin(TAU * p3)) * a * 0.7 + bp.p(rng.next() * 2 - 1) * 0.3 * a;
  }
  return [out];
}
function genRain(sr, rng, N) {
  return [0, 1].map(() => {
    const d = fillNoise(new Float32Array(N), rng, 'pink'), hp = new BQ(sr, 'hp', 400), lp = new BQ(sr, 'lp', 6500), rl = new BQ(sr, 'lp', 200), br = fillNoise(new Float32Array(N), rng, 'brown');
    for (let i = 0; i < N; i++) d[i] = lp.p(hp.p(d[i])) * 0.35 + rl.p(br[i]) * 0.25;
    const drops = Math.floor((N / sr) * 170);
    for (let k = 0; k < drops; k++) {
      const s = rng.int(0, N - 1), f = rng.range(1800, 7000), dec = rng.range(0.002, 0.008) * sr, amp = Math.pow(rng.next(), 2) * 0.5, L = Math.min(N - s, Math.floor(dec * 5));
      for (let j = 0; j < L; j++) d[s + j] += amp * Math.sin((TAU * f * j) / sr) * Math.exp(-j / dec);
    }
    return d;
  });
}
function genWind(sr, rng, N) {
  return [0, 1].map(() => {
    const br = fillNoise(new Float32Array(N), rng, 'brown'), wh = fillNoise(new Float32Array(N), rng, 'white'), out = new Float32Array(N);
    const bp = new BQ(sr, 'bp', 500, 0.8), ws = new BQ(sr, 'bp', 1200, 18), fc = new LFN(rng, 0.25, sr, 250, 750), gust = new LFN(rng, 0.15, sr, 0.3, 1), wf = new LFN(rng, 0.2, sr, 900, 1600);
    for (let i = 0; i < N; i++) {
      const gv = gust.next(), f = fc.next(), w = wf.next();
      if ((i & 63) === 0) { bp.set('bp', f * (0.8 + 0.4 * gv), 0.8); ws.set('bp', w, 18); }
      out[i] = bp.p(br[i]) * gv * 1.5 + ws.p(wh[i]) * gv * gv * 0.25;
    }
    return out;
  });
}
function genFire(sr, rng, N) {
  const d = fillNoise(new Float32Array(N), rng, 'brown'), lp = new BQ(sr, 'lp', 500), fl = new LFN(rng, 3, sr, 0.4, 1);
  for (let i = 0; i < N; i++) d[i] = lp.p(d[i]) * fl.next() * 0.8;
  const secs = N / sr;
  for (let k = 0; k < secs * 30; k++) {
    const s = rng.int(0, N - 1), L = Math.min(N - s, Math.floor(rng.range(0.0008, 0.006) * sr)), amp = Math.pow(rng.next(), 3) * 0.9;
    let prev = 0;
    for (let j = 0; j < L; j++) { const w = rng.next() * 2 - 1; d[s + j] += (w - prev) * amp * Math.exp((-4 * j) / L); prev = w; }
  }
  for (let k = 0; k < secs * 1.5; k++) {
    const s = rng.int(0, N - 1), L = Math.min(N - s, Math.floor(0.08 * sr)), amp = rng.range(0.3, 0.7);
    for (let j = 0; j < L; j++) d[s + j] += amp * (Math.sin((TAU * 80 * j) / sr) * 0.6 + (rng.next() * 2 - 1) * 0.5) * Math.exp(-j / (0.012 * sr));
  }
  return [d];
}
function genFlame(sr, rng, N) {
  const w = fillNoise(new Float32Array(N), rng, 'white'), b = fillNoise(new Float32Array(N), rng, 'brown'), out = new Float32Array(N);
  const lp = new BQ(sr, 'lp', 2800, 0.6), hp = new BQ(sr, 'hp', 5000), bp = new BQ(sr, 'bp', 250, 1), fl = new LFN(rng, 45, sr, 0.5, 1), sl = new LFN(rng, 2, sr, 0.8, 1);
  for (let i = 0; i < N; i++) out[i] = (lp.p(w[i]) * 0.6 + b[i] * 0.7 + bp.p(b[i]) * 1.2) * fl.next() * sl.next() + hp.p(w[i]) * 0.12;
  return [out];
}
function genWater(sr, rng, N) {
  return [0, 1].map(() => {
    const p = fillNoise(new Float32Array(N), rng, 'pink'), out = new Float32Array(N), lp = new BQ(sr, 'lp', 650), bp = new BQ(sr, 'bp', 1200, 1.2);
    const env = new Float32Array(N);
    for (let t = rng.range(0, 0.5) * sr; t < N; t += rng.range(0.6, 1.8) * sr) {
      const a = 0.35 * sr, dcy = 0.7 * sr, amp = rng.range(0.4, 1);
      for (let j = 0; j < a + dcy * 3 && t + j < N; j++) env[Math.floor(t + j)] += amp * (j < a ? Math.sin(((j / a) * Math.PI) / 2) : Math.exp(-(j - a) / dcy));
    }
    for (let i = 0; i < N; i++) out[i] = lp.p(p[i]) * (0.3 + 0.7 * env[i]) + bp.p(p[i]) * env[i] * env[i] * 0.35;
    for (let k = 0; k < (N / sr) * 0.8; k++) {
      const s = rng.int(0, N - 1), f = rng.range(900, 2500), L = Math.min(N - s, Math.floor(0.05 * sr));
      for (let j = 0; j < L; j++) out[s + j] += 0.08 * Math.sin((TAU * f * (1 + j / L) * j) / sr) * Math.exp(-j / (0.012 * sr));
    }
    return out;
  });
}
// Speech-like formant babble (crowd, police scanner chatter).
function babble(sr, N, rng, o = {}) {
  const out = new Float32Array(N), f1 = new BQ(sr, 'bp', 500, 5), f2 = new BQ(sr, 'bp', 1500, 7), f3 = new BQ(sr, 'bp', 2500, 9);
  const vs = Object.values(VOW), fs = o.fs || 1;
  let ph = 0, i = Math.floor(rng.range(0, o.pause ? o.pause[1] : 0.3) * sr * (o.lead ?? 1));
  while (i < N) {
    const syl = rng.int(o.syl ? o.syl[0] : 3, o.syl ? o.syl[1] : 9);
    let pitch = (o.f0 || 130) * rng.range(0.95, 1.15);
    for (let s = 0; s < syl && i < N; s++) {
      const len = Math.floor((sr / (o.rate || 5)) * rng.range(0.6, 1.4)), va = rng.pick(vs), vb = rng.pick(vs);
      const cons = rng.chance(0.6) ? Math.floor(len * rng.range(0.15, 0.3)) : 0, accent = rng.range(0.6, 1);
      for (let k = 0; k < len && i < N; k++, i++) {
        if ((k & 63) === 0) { const u = k / len; f1.set('bp', lerp(va[0], vb[0], u) * fs, 5); f2.set('bp', lerp(va[1], vb[1], u) * fs, 7); f3.set('bp', lerp(va[2], vb[2], u) * fs, 9); }
        const env = Math.pow(Math.sin((Math.PI * k) / len), 0.6) * accent;
        ph += (pitch * (1 + 0.04 * Math.sin(k / 900))) / sr; ph -= Math.floor(ph);
        let src = ph * 2 - 1;
        if (k < cons) src = (rng.next() * 2 - 1) * 0.5;
        out[i] = (f1.p(src) + f2.p(src) * 0.6 + f3.p(src) * 0.3) * env;
      }
      pitch *= 0.975;
    }
    i += Math.floor(sr * (o.pause ? rng.range(o.pause[0], o.pause[1]) : rng.range(0.1, 0.5)));
  }
  return out;
}
function genCrowd(sr, rng, N) {
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let v = 0; v < 16; v++) {
    const fem = rng.chance(0.45), b = babble(sr, N, rng, { f0: fem ? rng.range(190, 260) : rng.range(95, 150), fs: fem ? 1.15 : 1, rate: rng.range(4, 6), pause: [0.15, 0.9] });
    const pan = rng.range(-1, 1), gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4), a = rng.range(0.4, 1);
    for (let i = 0; i < N; i++) { L[i] += b[i] * gl * a; R[i] += b[i] * gr * a; }
  }
  const bed = fillNoise(new Float32Array(N), rng, 'pink'), lpL = new BQ(sr, 'lp', 3200), lpR = new BQ(sr, 'lp', 3200), bl = new BQ(sr, 'lp', 700);
  for (let i = 0; i < N; i++) { const m = bl.p(bed[i]) * 0.5; L[i] = lpL.p(L[i]) + m; R[i] = lpR.p(R[i]) + m; }
  return [L, R];
}
function genCity(sr, rng, N) {
  const L = new Float32Array(N), R = new Float32Array(N), secs = N / sr;
  for (const ch of [L, R]) { const b = fillNoise(new Float32Array(N), rng, 'brown'), lp = new BQ(sr, 'lp', 180); for (let i = 0; i < N; i++) ch[i] = lp.p(b[i]) * 0.6; }
  for (let c = 0; c < 6; c++) {
    const ctr = rng.range(0, secs) * sr, w = rng.range(2.5, 5) * sr, dir = rng.sign(), p = fillNoise(new Float32Array(N), rng, 'pink'), bp = new BQ(sr, 'bp', rng.range(350, 800), 0.7), a = rng.range(0.3, 0.8);
    for (let i = 0; i < N; i++) {
      let dt = i - ctr; if (dt > N / 2) dt -= N; if (dt < -N / 2) dt += N;
      const e = Math.exp(-((dt / w) ** 2) * 4); if (e < 1e-3) { bp.p(p[i]); continue; }
      const pan = clamp((dt / w) * dir, -1, 1), s = bp.p(p[i]) * e * a;
      L[i] += s * Math.cos(((pan + 1) * Math.PI) / 4); R[i] += s * Math.sin(((pan + 1) * Math.PI) / 4);
    }
  }
  { const s = Math.floor(rng.range(1, secs - 1) * sr), len = Math.floor(0.35 * sr), lp = new BQ(sr, 'lp', 1400), pan = rng.range(-0.8, 0.8);
    for (let j = 0; j < len && s + j < N; j++) { const t = j / sr, v = ((((410 * t) % 1) * 2 - 1) + (((520 * t) % 1) * 2 - 1)) * 0.06 * Math.min(1, j / 400, (len - j) / 400); const y = lp.p(v); L[s + j] += y * (1 - pan) * 0.5; R[s + j] += y * (1 + pan) * 0.5; } }
  for (let b = 0; b < 5; b++) {
    const s0 = Math.floor(rng.range(0, secs - 1) * sr), pan = rng.range(-1, 1), f0 = rng.range(2800, 3800);
    for (let r = 0; r < rng.int(2, 4); r++) {
      const s = s0 + Math.floor(r * 0.13 * sr), len = Math.floor(0.08 * sr);
      let ph = 0;
      for (let j = 0; j < len && s + j < N; j++) { ph += (f0 * (1 + (0.5 * j) / len)) / sr; const v = Math.sin(TAU * ph) * Math.sin((Math.PI * j) / len) * 0.05; L[s + j] += v * (1 - pan) * 0.5; R[s + j] += v * (1 + pan) * 0.5; }
    }
  }
  return [L, R];
}
function genCrickets(sr, rng, N) {
  const L = new Float32Array(N), R = new Float32Array(N), secs = N / sr;
  const add = (f, pan, amp, starts, plen) => {
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4), pl = Math.floor(plen * sr);
    for (const st of starts) { const s = Math.floor(st * sr); for (let j = 0; j < pl && s + j < N; j++) { const e = Math.pow(Math.sin((Math.PI * j) / pl), 2), v = Math.sin((TAU * f * j) / sr) * e * amp; L[s + j] += v * gl; R[s + j] += v * gr; } }
  };
  for (let c = 0; c < 7; c++) {
    const f = rng.range(3800, 5200), pl = rng.range(0.01, 0.018), pp = rng.range(0.022, 0.035), np = rng.int(3, 5), cp = rng.range(0.45, 1.1), st = [];
    for (let t = rng.range(0, cp); t < secs; t += cp * rng.range(0.95, 1.05)) for (let k = 0; k < np; k++) st.push(t + k * pp);
    add(f, rng.range(-0.9, 0.9), rng.range(0.25, 1), st, pl);
  }
  const tr = []; for (let t = 0; t < secs; t += 1 / 45) tr.push(t); add(2900, 0, 0.25, tr, 0.012);
  return [L, R];
}
function genCicadas(sr, rng, N) {
  const L = new Float32Array(N), R = new Float32Array(N), secs = N / sr;
  const bed = new BQ(sr, 'bp', 5200, 3);
  for (let i = 0; i < N; i++) { const t = i / sr, v = bed.p(rng.next() * 2 - 1) * Math.pow(0.5 + 0.5 * Math.cos(TAU * 160 * t), 2) * 0.35; L[i] += v; R[i] += v; }
  for (let c = 0; c < 5; c++) {
    const f = rng.range(4300, 6500), tym = rng.range(110, 220), start = rng.range(0, secs), hold = rng.range(2.5, 4), pan = rng.range(-0.8, 0.8), bp = new BQ(sr, 'bp', f, 5), amp = rng.range(0.5, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < N; i++) {
      const t = i / sr; let u = t - start; u -= Math.floor(u / secs) * secs;
      const e = u < 2.5 ? u / 2.5 : u < 2.5 + hold ? 1 : Math.max(0, 1 - (u - 2.5 - hold) / 2);
      const n = rng.next() * 2 - 1, y = bp.p(n);
      if (e <= 0) continue;
      const v = (y * 1.5 + 0.4 * Math.sin(TAU * f * t)) * Math.pow(0.5 + 0.5 * Math.cos(TAU * tym * t), 3) * e * e * amp;
      L[i] += v * gl; R[i] += v * gr;
    }
  }
  return [L, R];
}

const LOOP_DEFS = {
  tyre_squeal:    { secs: 2.5, sr: 44100, gen: genSqueal, vol: 0.55, pos: true, map: (i) => ({ g: Math.pow(i, 0.7), lp: 3000 + 12000 * i, rate: 0.9 + 0.2 * i }) },
  rain:           { secs: 7, sr: 44100, gen: genRain, vol: 0.55, map: (i) => ({ g: Math.pow(i, 0.6), lp: 2000 + 14000 * i }) },
  wind:           { secs: 9, sr: 24000, gen: genWind, vol: 0.6, map: (i) => ({ g: Math.pow(i, 0.8), lp: 600 + 5000 * i, rate: 0.85 + 0.3 * i }) },
  fire:           { secs: 5, sr: 32000, gen: genFire, vol: 0.7, pos: true, map: (i) => ({ g: Math.pow(i, 0.6), lp: 1500 + 12000 * i }) },
  flamethrower:   { secs: 3, sr: 32000, gen: genFlame, vol: 0.7, pos: true, map: (i) => ({ g: Math.pow(i, 0.5), lp: 1200 + 9000 * i, rate: 0.85 + 0.3 * i }) },
  water_lap:      { secs: 8, sr: 24000, gen: genWater, vol: 0.5, map: (i) => ({ g: Math.pow(i, 0.7), lp: 900 + 5000 * i }) },
  crowd:          { secs: 8, sr: 24000, gen: genCrowd, vol: 0.5, map: (i) => ({ g: Math.pow(i, 0.7), lp: 1500 + 9000 * i, rate: 0.95 + 0.1 * i }) },
  helicopter:     { special: 'turbine', vol: 0.9, pos: true },
  city_ambience:  { secs: 14, sr: 24000, gen: genCity, vol: 0.45, map: (i) => ({ g: Math.pow(i, 0.8), lp: 2500 + 10000 * i }) },
  night_crickets: { secs: 7, sr: 44100, gen: genCrickets, vol: 0.3, map: (i) => ({ g: Math.pow(i, 0.8), lp: 15000 }) },
  cicadas:        { secs: 11, sr: 44100, gen: genCicadas, vol: 0.28, map: (i) => ({ g: Math.pow(i, 0.8), lp: 15000 }) },
};
const _loopBufs = new Map();
function loopBuffer(name) {
  if (_loopBufs.has(name)) return _loopBufs.get(name);
  return cacheSamples('loop', name, synthesizeSamples('loop', name));
}
function loopSamples(name) {
  const D = LOOP_DEFS[name], sr = D.sr, X = Math.floor(sr * 0.25), N = Math.floor(D.secs * sr) + X;
  const chans = D.gen(sr, new RNG(hashStr(name)), N).map((c) => loopXfade(dcBlock(c, sr, 20), X));
  normalizeMulti(chans, 0.8);
  return [{ sr, channels: chans }];
}

class LoopHandle {
  constructor(sys, name) {
    this.sys = sys; this.name = LOOP_DEFS[name] ? name : 'wind'; this.D = LOOP_DEFS[this.name];
    this.i = 0.5; this.x = null; this.y = null; this.vol = 1; this.alive = true; this.v = null;
    this._ensure();
  }
  _ensure() {
    if (this.v || !this.alive || !this.sys.ctx) return;
    const ctx = this.sys.ctx, D = this.D;
    if (D.special === 'turbine') {
      this.v = new EngineVoice(ctx, this.sys.ambBus, 'turbine', ENGINE_PROFILES.turbine, false);
    } else {
      if (this.sys.onDemand && !_loopBufs.has(this.name)) {
        if (!this.loading) this.loading = this.sys.prepareSamples('loop', this.name).then(() => this._ensure())
          .catch(error => { this.stop(); console.warn('[audio] loop unavailable', this.name, error); });
        return;
      }
      const v = (this.v = new LiveVoice(ctx));
      const src = v.n(ctx.createBufferSource()); src.buffer = loopBuffer(this.name); src.loop = true;
      src.start(ctx.currentTime, Math.random() * src.buffer.duration); v.srcs.push(src);
      v.src = src; v.lp = v.filt('lowpass', 8000, 0.6); v.out = v.gain(0); v.pan = v.n(ctx.createStereoPanner());
      src.connect(v.lp).connect(v.out).connect(v.pan).connect(this.sys.ambBus);
    }
    this._update();
  }
  setIntensity(i) { this.i = clamp(+i || 0); this._update(); return this; }
  setPos(x, y) { this.x = x; this.y = y; this._update(); return this; }
  setVolume(v) { this.vol = clamp(v, 0, 2); this._update(); return this; }
  stop() { this.alive = false; if (this.v) this.v.kill(0.15); this.v = null; this.sys._loops.delete(this); }
  _update() {
    this._ensure();
    if (!this.v) return;
    const sp = this.x == null ? NOPOS : this.sys._spatial(this.x, this.y, 1.3);
    if (this.D.special === 'turbine') { this.v.apply({ rpm: 1, throttle: this.i, speed: 0 }, sp, this.vol * this.D.vol * clamp(this.i * 3)); return; }
    const m = this.D.map(this.i), t = this.sys.ctx.currentTime, v = this.v;
    v.out.gain.setTargetAtTime(this.D.vol * m.g * sp.g * this.vol, t, 0.08);
    v.lp.frequency.setTargetAtTime(Math.min(18000, m.lp * sp.lp), t, 0.08);
    v.pan.pan.setTargetAtTime(sp.pan, t, 0.08);
    if (m.rate) v.src.playbackRate.setTargetAtTime(m.rate, t, 0.1);
  }
}

// ========================================================= INSTRUMENTS ====
// Sampled instruments are synthesised in JS once (lazily) into multi-zone
// AudioBuffers; notes are a BufferSource + Gain (cheap). Synth voices
// (pads/leads/arps/bass) are tiny live oscillator graphs.

// Karplus–Strong plucked string with fractional delay + tunable loop filter.
function ks(sr, f, secs, o = {}) {
  const N = Math.floor(sr * secs), out = new Float32Array(N), S = o.S ?? 0.5;
  const p = sr / f - S, D = Math.floor(p), fr = p - D;
  const size = 1 << Math.ceil(Math.log2(D + 4)), mask = size - 1, buf = new Float32Array(size);
  const g = Math.pow(10, -3 / ((o.t60 ?? 2) * f)), rng = o.rng || new RNG(5);
  const exLen = Math.max(2, Math.round(sr / f)), ex = new Float32Array(exLen), eb = o.exBright ?? 0.7;
  let lp = 0, mean = 0;
  for (let i = 0; i < exLen; i++) {
    const w = o.smooth ? Math.sin((Math.PI * i) / exLen) * (0.6 + 0.4 * (rng.next() * 2 - 1)) : rng.next() * 2 - 1;
    lp += eb * (w - lp); ex[i] = lp;
  }
  if (o.pick) { const pd = Math.max(1, Math.round(exLen * o.pick)); for (let i = exLen - 1; i >= pd; i--) ex[i] -= ex[i - pd]; }
  for (let i = 0; i < exLen; i++) mean += ex[i];
  mean /= exLen;
  for (let i = 0; i < exLen; i++) ex[i] -= mean;
  let w = 0;
  for (let n = 0; n < N; n++) {
    const r0 = (w - D) & mask, r1 = (w - D - 1) & mask, r2 = (w - D - 2) & mask;
    const a = buf[r0] * (1 - fr) + buf[r1] * fr, b = buf[r1] * (1 - fr) + buf[r2] * fr;
    let y = g * ((1 - S) * a + S * b);
    if (n < exLen) y += ex[n];
    buf[w] = y; out[n] = y; w = (w + 1) & mask;
  }
  return out;
}
const durFor = (f, mx, mn) => clamp(mx * Math.pow(110 / f, 0.4), mn, mx);
function post(d, sr, chain = [], peak = 0.85) {
  for (const [type, f, q, db] of chain) new BQ(sr, type, f, q ?? 0.707, db ?? 0).run(d);
  dcBlock(d, sr, 20); normalize(d, peak); return fadeEnds(d, 8, Math.min(2000, d.length >> 3));
}
function soft(d, k) { const n = Math.tanh(k); for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k) / n; return d; }
function addSine(d, sr, f, amp, dec) { for (let i = 0; i < d.length; i++) d[i] += amp * Math.sin((TAU * f * i) / sr) * Math.exp(-i / (dec * sr)) * Math.min(1, i / 40); return d; }
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function distChord(sr, f, rng, secs, t60) {
  const N = Math.floor(secs * sr), d = new Float32Array(N);
  [[1, 0], [1.4983, 0.004], [2, 0.008]].forEach(([k, off], i) => {
    const s = ks(sr, f * k * Math.pow(2, rng.range(-4, 4) / 1200), secs, { S: 0.4, t60, exBright: 0.8, pick: 0.13, rng }), o = Math.floor(off * sr);
    for (let n = 0; n + o < N; n++) d[n + o] += s[n] * (i === 0 ? 1 : 0.8);
  });
  new BQ(sr, 'hp', 100).run(d);
  for (let i = 0; i < N; i++) d[i] = Math.tanh(d[i] * 10);
  return post(d, sr, [['lp', 4800, 0.8], ['pk', 110, 1, 3], ['pk', 800, 0.8, -3], ['lp', 6500, 0.7]], 0.8);
}
function additive(sr, dur, parts, rng, att = 0.002) {
  const N = Math.floor(dur * sr), d = new Float32Array(N);
  for (const [fk, amp, Ts, Tf = 0, mixF = 0] of parts) {
    if (fk >= sr * 0.45) continue;
    const w = (TAU * fk) / sr, c = 2 * Math.cos(w), ph = rng.range(0, TAU);
    let s0 = Math.sin(ph - w), s1 = Math.sin(ph), eS = 1, eF = 1;
    const kS = Math.exp(-1 / (Ts * sr)), kF = Tf ? Math.exp(-1 / (Tf * sr)) : 0;
    for (let n = 0; n < N; n++) {
      const s2 = c * s1 - s0; s0 = s1; s1 = s2;
      d[n] += s2 * amp * ((1 - mixF) * eS + mixF * eF); eS *= kS; eF *= kF;
    }
  }
  const A = Math.floor(att * sr);
  for (let n = 0; n < A && n < N; n++) d[n] *= n / A;
  return d;
}
function bakePiano(sr, f, rng) {
  const dur = clamp(4.5 * Math.pow(110 / f, 0.5), 0.8, 4.5), B = 0.00025 * Math.pow(f / 110, 0.6), nP = Math.min(14, Math.floor((sr * 0.45) / f)), parts = [];
  for (let k = 1; k <= nP; k++) {
    const fk = k * f * Math.sqrt(1 + B * k * k), amp = Math.pow(k, -1.15) * Math.exp(-k * 0.08 * Math.pow(f / 220, 0.3)), Ts = (dur * 0.6) / Math.sqrt(k);
    for (const det of [-0.0007, 0.0007]) parts.push([fk * (1 + det), amp, Ts, Ts * 0.12, 0.55]);
  }
  const d = additive(sr, dur, parts, rng, 0.002), hb = new BQ(sr, 'lp', 2200);
  for (let n = 0; n < sr * 0.008; n++) d[n] += hb.p(rng.next() * 2 - 1) * 0.25 * (1 - n / (sr * 0.008));
  return post(d, sr, [['pk', 300, 1, 2]]);
}
function bakeEP(sr, f, rng) {
  const dur = clamp(3.5 * Math.pow(110 / f, 0.35), 1, 3.5), N = Math.floor(dur * sr), d = new Float32Array(N), tA = f < 600 ? 0.15 : 0.07;
  for (let n = 0; n < N; n++) {
    const t = n / sr, I = 1.8 * Math.exp(-t / 0.35) + 0.25;
    const car = Math.sin(TAU * f * t + I * Math.sin(TAU * f * t)), tine = Math.sin(TAU * f * 7.1 * t) * Math.exp(-t / 0.04) * tA;
    d[n] = (car + tine) * Math.exp(-t / (dur * 0.35)) * Math.min(1, n / (sr * 0.003));
  }
  return post(soft(d, 1.3), sr, [['lp', 6000]]);
}
function bakeVibes(sr, f, rng) {
  const k = Math.pow(440 / f, 0.3), d = additive(sr, 3.5, [[f, 1, 3.2 * k], [f * 3.93, 0.3, 0.8 * k], [f * 9.2, 0.1, 0.25 * k]], rng, 0.001);
  for (let n = 0; n < sr * 0.002; n++) d[n] += (rng.next() * 2 - 1) * 0.15;
  return post(d, sr, [['hp', 120]]);
}
function bakeBell(sr, f) {
  const N = Math.floor(2.5 * sr), d = new Float32Array(N);
  for (let n = 0; n < N; n++) { const t = n / sr, I = 2.5 * Math.exp(-t / 0.5); d[n] = Math.sin(TAU * f * t + I * Math.sin(TAU * f * 3.5 * t)) * Math.exp(-t / 1.5) * Math.min(1, n / (sr * 0.002)); }
  return post(d, sr, []);
}
function bakePluck(sr, f) {
  const N = Math.floor(0.9 * sr), d = new Float32Array(N), lp = new BQ(sr, 'lp', 5000, 1.2), dt = f / sr;
  let ph = 0;
  for (let n = 0; n < N; n++) {
    const t = n / sr;
    if ((n & 31) === 0) lp.set('lp', 400 + 5000 * Math.exp(-t / 0.12), 1.2);
    ph += dt; if (ph >= 1) ph -= 1;
    d[n] = lp.p(2 * ph - 1 - polyblep(ph, dt)) * Math.exp(-t / 0.35) * Math.min(1, n / 30);
  }
  return post(d, sr, []);
}
function sustained(sr, dur, ls, le, d) {
  sustainLoop(d, Math.floor(ls * sr), Math.floor(le * sr), Math.floor(0.08 * sr));
  return { d: post(d, sr, [], 0.8), ls, le };
}
function bakeOrgan(sr, f, rng) {
  const parts = [[0.5, 0.6], [1, 1], [1.5, 0.7], [2, 0.55], [3, 0.35], [4, 0.3], [6, 0.15]].map(([k, a]) => [f * k, a, 1e9]);
  const d = additive(sr, 1.6, parts, rng, 0.004);
  for (let n = 0; n < sr * 0.004; n++) d[n] += (rng.next() * 2 - 1) * 0.3;
  return sustained(sr, 1.6, 0.3, 1.5, d);
}
function bakeSteel(sr, f, rng) {
  const parts = [];
  for (let k = 1; k <= 10; k++) for (const c of [-4, 4]) parts.push([f * k * Math.pow(2, c / 1200), Math.pow(k, -1.3) * (k === 3 ? 1.5 : 1), 1e9]);
  const d = additive(sr, 2.0, parts, rng, 0.04);
  for (let n = 0; n < d.length; n++) d[n] *= 1 - 0.25 * Math.min(1, n / (sr * 0.3));
  return sustained(sr, 2.0, 0.4, 1.9, d);
}
function blepSaw(sr, N, fAt) {
  const d = new Float32Array(N); let ph = 0;
  for (let n = 0; n < N; n++) { const dt = fAt(n) / sr; ph += dt; if (ph >= 1) ph -= 1; d[n] = 2 * ph - 1 - polyblep(ph, dt); }
  return d;
}
function bakeSax(sr, f, rng) {
  const N = Math.floor(2.2 * sr), vib = (n) => { const t = n / sr; return f * Math.pow(2, (15 * Math.min(1, Math.max(0, t - 0.3) / 0.3) * Math.sin(TAU * 5 * t)) / 1200); };
  const s = blepSaw(sr, N, vib), b1 = new BQ(sr, 'bp', 550, 1.5), b2 = new BQ(sr, 'bp', 1600, 2.5), lp = new BQ(sr, 'lp', 3500), nb = new BQ(sr, 'bp', 2200, 1);
  const d = new Float32Array(N);
  for (let n = 0; n < N; n++) { const x = s[n]; d[n] = lp.p(b1.p(x) * 1.2 + b2.p(x) * 0.8 + x * 0.25) + nb.p(rng.next() * 2 - 1) * 0.06; }
  for (let n = 0; n < sr * 0.03; n++) d[n] *= n / (sr * 0.03);
  return sustained(sr, 2.2, 0.4, 2.0, soft(d, 1.5));
}
function bakeChoir(sr, f, rng, vw) {
  const N = Math.floor(2.1 * sr), d = new Float32Array(N), F = VOW[vw];
  for (const [c, vp] of [[-7, 0], [0, 2], [7, 4]]) {
    const s = blepSaw(sr, N, (n) => f * Math.pow(2, (c + 12 * Math.sin((TAU * 5 * n) / sr + vp)) / 1200));
    const tl = new BQ(sr, 'lp', 2500), f1 = new BQ(sr, 'bp', F[0], 6), f2 = new BQ(sr, 'bp', F[1], 8), f3 = new BQ(sr, 'bp', F[2], 10);
    for (let n = 0; n < N; n++) { const x = tl.p(s[n]); d[n] += f1.p(x) * 3 + f2.p(x) * 1.6 + f3.p(x) * 0.8; }
  }
  const nb = new BQ(sr, 'bp', 3000, 1);
  for (let n = 0; n < N; n++) d[n] += nb.p(rng.next() * 2 - 1) * 0.04;
  return sustained(sr, 2.1, 0.35, 1.95, d);
}
// drums ------------------------------------------------------------------------
function kickS(sr, rng, o) {
  const dur = o.dur || o.ad * 3, N = Math.floor(dur * sr), d = new Float32Array(N); let ph = 0;
  for (let n = 0; n < N; n++) {
    const t = n / sr, f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / o.pd); ph += f / sr;
    let v = Math.sin(TAU * ph) * Math.exp(-t / o.ad);
    if (t < 0.006) v += (rng.next() * 2 - 1) * o.click * (1 - t / 0.006);
    d[n] = Math.tanh(v * o.drive);
  }
  return post(d, sr, o.lp ? [['lp', o.lp]] : [], o.peak || 0.6);
}
function snareS(sr, rng, o) {
  const N = Math.floor(0.5 * sr), d = new Float32Array(N), bp = new BQ(sr, 'bp', o.nf, 0.6), hp = new BQ(sr, 'hp', 700), lp = new BQ(sr, 'lp', o.nlp || 8000, 0.6);
  for (let n = 0; n < N; n++) {
    const t = n / sr;
    let v = 1.3 * (Math.sin(TAU * o.tone[0] * t) * Math.exp(-t / o.td) + 0.6 * Math.sin(TAU * o.tone[1] * t) * Math.exp(-t / (o.td * 0.7)));
    v += lp.p(hp.p(bp.p(rng.next() * 2 - 1) * 2.2)) * o.nv * Math.exp(-t / o.nd);
    d[n] = Math.tanh(v * o.drive);
  }
  if (o.clap) { const c = clapS(sr, rng); for (let n = 0; n < Math.min(N, c.length); n++) d[n] += c[n] * 0.6; }
  return post(d, sr, o.lp ? [['lp', o.lp]] : [], 0.9);
}
function clapS(sr, rng) {
  const N = Math.floor(0.4 * sr), d = new Float32Array(N), bp = new BQ(sr, 'bp', 1200, 1.2);
  for (let n = 0; n < N; n++) {
    const t = n / sr; let e = 0;
    for (const o of [0, 0.011, 0.022]) if (t >= o) e += Math.exp(-(t - o) / 0.003);
    if (t >= 0.022) e += 0.5 * Math.exp(-(t - 0.022) / 0.09);
    d[n] = bp.p(rng.next() * 2 - 1) * e;
  }
  return post(d, sr, [], 0.9);
}
function metalS(sr, rng, o) {
  const N = Math.floor((o.d * 4 + 0.05) * sr), d = new Float32Array(N), fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map((x) => x * (o.k || 1));
  const bp = new BQ(sr, 'bp', o.bp || 9000, 0.8), hp = new BQ(sr, 'hp', o.hp || 7000), ph = fr.map(() => rng.next());
  for (let n = 0; n < N; n++) {
    const t = n / sr; let m = 0;
    for (let i = 0; i < 6; i++) { ph[i] += fr[i] / sr; m += ph[i] % 1 < 0.5 ? 1 : -1; }
    const e = Math.min(1, t / (o.a || 0.0008)) * Math.exp(-t / o.d);
    d[n] = hp.p(bp.p(m * 0.15 * (o.metal ?? 1) + (rng.next() * 2 - 1) * (o.noise ?? 0.6))) * e;
  }
  if (o.ping) addSine(d, sr, o.ping, 0.15, o.d * 0.6);
  return post(d, sr, [['lp', o.lp || 11000, 0.7]], o.peak || 0.45);
}
function tomS(sr, rng, f0) {
  const N = Math.floor(0.6 * sr), d = new Float32Array(N), bp = new BQ(sr, 'bp', f0 * 4, 1); let ph = 0;
  for (let n = 0; n < N; n++) { const t = n / sr; ph += (f0 * (0.75 + 0.25 * Math.exp(-t / 0.08))) / sr; d[n] = Math.tanh((Math.sin(TAU * ph) * Math.exp(-t / 0.3) + bp.p(rng.next() * 2 - 1) * 0.4 * Math.exp(-t / 0.04)) * 1.5); }
  return post(d, sr, [], 0.85);
}
function noiseHit(sr, rng, o) {
  const N = Math.floor(o.len * sr), d = new Float32Array(N), f1 = new BQ(sr, o.t1 || 'bp', o.f1, o.q1 || 0.7), f2 = o.f2 ? new BQ(sr, o.t2 || 'hp', o.f2, 0.7) : null;
  for (let n = 0; n < N; n++) {
    const t = n / sr, e = o.env(t, n);
    let v = f1.p(rng.next() * 2 - 1); if (f2) v = f2.p(v);
    d[n] = v * e;
  }
  return post(d, sr, [], 0.85);
}
const INST = {
  gtr_clean: { sr: 32000, roots: [40, 46, 52, 58, 64, 70, 76, 82], ch: 'gtr', damp: 0.06, bake: (sr, f, rng) => post(ks(sr, f, durFor(f, 3.2, 0.9), { S: 0.45, t60: 2.6 * Math.pow(110 / f, 0.3), exBright: 0.6, pick: 0.18, rng }), sr, [['hp', 80], ['pk', 220, 1.2, 3], ['pk', 3000, 1, 2]]) },
  gtr_twang: { sr: 32000, roots: [40, 46, 52, 58, 64, 70, 76, 82], ch: 'lead', damp: 0.08, bake: (sr, f, rng) => post(soft(post(ks(sr, f, durFor(f, 3.5, 1), { S: 0.28, t60: 3.2 * Math.pow(110 / f, 0.25), exBright: 0.9, pick: 0.1, rng }), sr, [['hp', 140], ['pk', 2800, 1, 5], ['pk', 700, 1, -2]]), 1.8), sr) },
  gtr_mute: { sr: 32000, roots: [40, 46, 52, 58, 64], ch: 'gtr', bake: (sr, f, rng) => post(ks(sr, f, 0.45, { S: 0.5, t60: 0.16, exBright: 0.5, pick: 0.2, rng }), sr, [['hp', 90], ['pk', 1800, 1, 3]]) },
  gtr_dist: { sr: 32000, roots: [33, 38, 43, 48, 53], ch: 'gtr', damp: 0.05, bake: (sr, f, rng) => distChord(sr, f, rng, 2.6, 3.0) },
  gtr_dist_mute: { sr: 32000, roots: [33, 38, 43, 48, 53], ch: 'gtr', bake: (sr, f, rng) => distChord(sr, f, rng, 0.35, 0.12) },
  gtr_lead: { sr: 32000, roots: [52, 58, 64, 70, 76, 82, 88], ch: 'lead', damp: 0.06, bake: (sr, f, rng) => post(soft(ks(sr, f, 3.0, { S: 0.35, t60: 4, exBright: 0.8, pick: 0.15, rng }), 7), sr, [['hp', 120], ['lp', 5200, 0.8], ['pk', 1500, 1, 3]]) },
  bass_finger: { sr: 22050, roots: [28, 34, 40, 46, 52], ch: 'bass', damp: 0.04, bake: (sr, f, rng) => post(addSine(ks(sr, f, 2.4, { S: 0.55, t60: 2.2, exBright: 0.35, pick: 0.25, rng }), sr, f, 0.25, 1.2), sr, [['lp', 2400, 0.7], ['pk', 90, 1, 2]], 0.55) },
  bass_upright: { sr: 22050, roots: [28, 34, 40, 46, 52], ch: 'bass', damp: 0.05, bake: (sr, f, rng) => post(addSine(ks(sr, f, 1.6, { S: 0.6, t60: 0.9, exBright: 0.25, pick: 0.3, rng, smooth: true }), sr, f, 0.35, 0.25), sr, [['lp', 1800, 0.7], ['pk', 120, 1, 3], ['pk', 700, 1, 3]], 0.55) },
  piano: { sr: 32000, roots: [36, 42, 48, 54, 60, 66, 72, 78, 84, 90], ch: 'keys', damp: 0.12, bake: bakePiano },
  epiano: { sr: 32000, roots: [40, 46, 52, 58, 64, 70, 76, 82], ch: 'keys', damp: 0.1, bake: bakeEP },
  vibes: { sr: 32000, roots: [53, 59, 65, 71, 77, 83, 89], ch: 'lead', damp: 0.25, bake: bakeVibes },
  bell: { sr: 32000, roots: [60, 66, 72, 78, 84, 90], ch: 'lead', bake: bakeBell },
  pluck: { sr: 32000, roots: [48, 54, 60, 66, 72, 78, 84], ch: 'lead', damp: 0.05, bake: bakePluck },
  organ: { sr: 32000, roots: [36, 42, 48, 54, 60, 66, 72, 78], ch: 'keys', loop: true, a: 0.01, r: 0.08, bake: bakeOrgan },
  steel: { sr: 32000, roots: [52, 58, 64, 70, 76, 82, 88], ch: 'steel', loop: true, a: 0.12, r: 0.5, bake: bakeSteel },
  sax: { sr: 32000, roots: [46, 52, 58, 64, 70, 76, 82], ch: 'lead', loop: true, a: 0.03, r: 0.12, bake: bakeSax },
  choir_oo: { sr: 24000, roots: [45, 51, 57, 63, 69, 75, 81], ch: 'choir', loop: true, a: 0.15, r: 0.4, bake: (sr, f, rng) => bakeChoir(sr, f, rng, 'u') },
  choir_ah: { sr: 24000, roots: [45, 51, 57, 63, 69, 75, 81], ch: 'choir', loop: true, a: 0.1, r: 0.35, bake: (sr, f, rng) => bakeChoir(sr, f, rng, 'a') },
  kick_rock: { drum: 1, ch: 'drums', bake: (sr, r) => kickS(sr, r, { f0: 150, f1: 52, pd: 0.03, ad: 0.35, click: 0.35, drive: 1.8 }) },
  kick_house: { drum: 1, ch: 'drums', bake: (sr, r) => kickS(sr, r, { f0: 130, f1: 48, pd: 0.045, ad: 0.45, click: 0.25, drive: 2.5 }) },
  kick_boom: { drum: 1, ch: 'drums', bake: (sr, r) => kickS(sr, r, { f0: 110, f1: 55, pd: 0.035, ad: 0.32, click: 0.15, drive: 2, lp: 2500 }) },
  kick_soft: { drum: 1, ch: 'drums', bake: (sr, r) => kickS(sr, r, { f0: 90, f1: 55, pd: 0.02, ad: 0.22, click: 0.05, drive: 1 }) },
  kick_808: { drum: 1, root: 33, ch: 'bass', damp: 0.06, bake: (sr, r) => kickS(sr, r, { f0: 110, f1: 55, pd: 0.03, ad: 1.6, click: 0.1, drive: 1.6, dur: 2.2 }) },
  snare_rock: { drum: 1, ch: 'snare', bake: (sr, r) => snareS(sr, r, { tone: [185, 330], td: 0.06, nd: 0.18, nf: 3000, nv: 0.9, drive: 1.6 }) },
  snare_dry: { drum: 1, ch: 'drums', bake: (sr, r) => snareS(sr, r, { tone: [200, 360], td: 0.04, nd: 0.1, nf: 3500, nv: 0.6, drive: 1.2 }) },
  snare_boom: { drum: 1, ch: 'drums', bake: (sr, r) => snareS(sr, r, { tone: [180, 310], td: 0.05, nd: 0.16, nf: 2500, nv: 1, drive: 2.4, lp: 5000 }) },
  snare_trap: { drum: 1, ch: 'drums', bake: (sr, r) => snareS(sr, r, { tone: [240, 420], td: 0.03, nd: 0.12, nf: 4500, nv: 0.9, drive: 1.5, clap: true }) },
  clap: { drum: 1, ch: 'drums', bake: (sr, r) => clapS(sr, r) },
  rim: { drum: 1, ch: 'drums', bake: (sr, r) => { const N = Math.floor(0.12 * sr), d = new Float32Array(N); for (let n = 0; n < N; n++) { const t = n / sr; d[n] = Math.sin(TAU * 1700 * t) * Math.exp(-t / 0.008) + 0.7 * Math.sin(TAU * 480 * t) * Math.exp(-t / 0.02) + (t < 0.002 ? (r.next() * 2 - 1) * 0.5 : 0); } return post(d, sr); } },
  brush_tap: { drum: 1, ch: 'drums', bake: (sr, r) => noiseHit(sr, r, { len: 0.3, t1: 'lp', f1: 5500, f2: 600, env: (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.09) }) },
  brush_swish: { drum: 1, ch: 'drums', bake: (sr, r) => noiseHit(sr, r, { len: 0.45, f1: 3000, q1: 0.6, t2: 'lp', f2: 7000, env: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.42)), 1.5) }) },
  hat_c: { drum: 1, ch: 'hats', bake: (sr, r) => metalS(sr, r, { d: 0.045 }) },
  hat_o: { drum: 1, ch: 'hats', bake: (sr, r) => metalS(sr, r, { d: 0.32 }) },
  hat_p: { drum: 1, ch: 'hats', bake: (sr, r) => metalS(sr, r, { d: 0.03, bp: 7000, hp: 5000, noise: 0.4 }) },
  ride: { drum: 1, ch: 'hats', bake: (sr, r) => metalS(sr, r, { d: 1.6, k: 1.6, bp: 5000, hp: 2500, noise: 0.2, metal: 1.4, ping: 3300, lp: 8000, peak: 0.5 }) },
  crash: { drum: 1, ch: 'cym', bake: (sr, r) => metalS(sr, r, { d: 1.9, k: 1.3, bp: 6000, hp: 2500, noise: 0.9, a: 0.002, lp: 9000, peak: 0.5 }) },
  tamb: { drum: 1, ch: 'hats', gain: 0.6, bake: (sr, r) => noiseHit(sr, r, { len: 0.3, f1: 8000, q1: 1.5, f2: 5000, env: (t) => (Math.min(1, t / 0.002) * Math.exp(-t / 0.08)) * (0.7 + 0.3 * Math.sin(t * 900)) }) },
  shaker: { drum: 1, ch: 'hats', gain: 0.55, bake: (sr, r) => noiseHit(sr, r, { len: 0.15, f1: 6000, q1: 1, f2: 3000, env: (t) => Math.min(1, t / 0.015) * Math.exp(-Math.max(0, t - 0.015) / 0.035) }) },
  tom_hi: { drum: 1, ch: 'drums', bake: (sr, r) => tomS(sr, r, 190) },
  tom_mid: { drum: 1, ch: 'drums', bake: (sr, r) => tomS(sr, r, 140) },
  tom_lo: { drum: 1, ch: 'drums', bake: (sr, r) => tomS(sr, r, 98) },
  crackle: { drum: 1, ch: 'fx', sr: 22050, bake: (sr, r) => { const N = 4 * sr, d = new Float32Array(N), lp = new BQ(sr, 'lp', 3000), hp = new BQ(sr, 'hp', 800); for (let n = 0; n < N; n++) d[n] = lp.p(hp.p(r.next() * 2 - 1)) * 0.05; for (let k = 0; k < 90; k++) { const s = r.int(0, N - 20), a = Math.pow(r.next(), 3); for (let j = 0; j < 12; j++) d[s + j] += (r.next() * 2 - 1) * a * (1 - j / 12); } return post(d, sr, [], 0.5); } },
  whoosh: { drum: 1, ch: 'fx', sr: 32000, bake: (sr, r) => { const N = Math.floor(1.2 * sr), d = new Float32Array(N), bp = new BQ(sr, 'bp', 400, 1.5); for (let n = 0; n < N; n++) { const t = n / sr; if ((n & 63) === 0) bp.set('bp', 300 * Math.pow(20, t / 1.2), 1.5); d[n] = bp.p(r.next() * 2 - 1) * Math.pow(Math.sin(Math.PI * t / 1.2), 2); } return post(d, sr, [], 0.6); } },
  scan_vox: { pick: 1, ch: 'fx', sr: 16000, bake: (sr, r) => Array.from({ length: 8 }, (_, i) => { const fem = i % 3 === 2, N = Math.floor(r.range(1.4, 3.2) * sr); const d = babble(sr, N, r, { f0: fem ? r.range(190, 230) : r.range(100, 135), fs: fem ? 1.12 : 1, rate: 6.5, syl: [4, 11], pause: [0.04, 0.22], lead: 0 }); return post(soft(post(d, sr, [['hp', 450], ['lp', 2800]]), 2.5), sr, [['lp', 3000]]); }) },
  scan_fx: { pick: 1, ch: 'fx', sr: 16000, bake: (sr, r) => [
    noiseHit(sr, r, { len: 0.07, f1: 2000, q1: 0.5, env: (t) => (t < 0.002 ? 1 : 0.5 * Math.exp(-t / 0.03)) }),
    noiseHit(sr, r, { len: 0.22, f1: 1500, q1: 0.5, env: (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.07) * (t < 0.03 ? 1.5 : 1) }),
    noiseHit(sr, r, { len: 0.5, f1: 1800, q1: 0.4, env: (t) => (0.4 + 0.6 * (Math.sin(t * 300) > 0.6 ? 1 : 0.3)) * Math.min(1, t / 0.01) * Math.min(1, (0.5 - t) / 0.05) }),
    noiseHit(sr, r, { len: 4, f1: 1600, q1: 0.35, env: (t) => 0.35 * Math.min(1, t / 0.01) }),
  ] },
  pad: { live: 'pad', ch: 'pad', a: 0.4, r: 0.9, cut: 2200 },
  pad_dark: { live: 'pad', ch: 'pad', a: 0.6, r: 1.2, cut: 900 },
  lead: { live: 'lead', ch: 'lead', a: 0.01, r: 0.15, cut: 3500 },
  arp: { live: 'arp', ch: 'arp', cut: 3000 },
  sbass: { live: 'sbass', ch: 'bass', cut: 900 },
  stab: { live: 'stab', ch: 'stab', cut: 2600 },
  sub: { live: 'sub', ch: 'bass' },
  tone: { live: 'tone', ch: 'fx' },
  fsk: { live: 'fsk', ch: 'fx' },
};
const _banks = new Map();
function instBank(name) {
  if (_banks.has(name)) return _banks.get(name);
  return cacheSamples('instrument', name, synthesizeSamples('instrument', name));
}
// Pure PCM generation runs unchanged in the sample worker or offline test renderer.
export function synthesizeSamples(kind, name) {
  if (kind === 'loop') return loopSamples(name);
  const D = INST[name], rng = new RNG(hashStr(name)), sr = D.sr || 44100;
  if (D.drum) return [{ root: D.root ?? 60, sr, channels: [D.bake(sr, rng)] }];
  if (D.pick) return D.bake(sr, rng).map((d, root) => ({ root, sr, channels: [d] }));
  return D.roots.map(root => {
    const res = D.bake(sr, mtof(root), rng);
    return { root, sr, channels: [res.d || res], ls: res.ls, le: res.le };
  });
}
function cacheSamples(kind, name, samples) {
  if (kind === 'loop') {
    const buf = bufFrom(samples[0].sr, samples[0].channels);
    _loopBufs.set(name, buf);
    return buf;
  }
  const bank = samples.map(s => ({ root: s.root, buf: bufFrom(s.sr, s.channels), ls: s.ls, le: s.le }));
  _banks.set(name, bank);
  return bank;
}

// ============================================================== REVERB ====
const _irs = new Map();
function makeIR(sr, type) {
  const key = type + sr; if (_irs.has(key)) return _irs.get(key);
  const P = { room: { d: 1.0, hi: 7000, lo: 2500, pre: 0.008, er: 6 }, hall: { d: 2.8, hi: 6000, lo: 1500, pre: 0.02, er: 10 }, plate: { d: 1.8, hi: 9000, lo: 3500, pre: 0.002, er: 0 }, spring: { d: 1.7, hi: 4500, lo: 1800, pre: 0.004, er: 0, spring: 1 } }[type] || { d: 1.2, hi: 6000, lo: 2000, pre: 0.01, er: 4 };
  const len = Math.floor(P.d * sr), chans = [0, 1].map((ch) => {
    const d = new Float32Array(len), rng = new RNG(hashStr(type) + ch * 101); let lp = 0;
    const pre = Math.floor(P.pre * sr);
    for (let i = pre; i < len; i++) { const t = i / sr, fc = lerp(P.hi, P.lo, t / P.d), a = 1 - Math.exp((-TAU * fc) / sr); lp += a * (rng.next() * 2 - 1 - lp); d[i] = lp * Math.exp((-6.9 * t) / P.d) * Math.min(1, (i - pre) / (sr * 0.004)); }
    for (let k = 0; k < P.er; k++) { const idx = Math.floor((P.pre + rng.range(0.005, 0.06)) * sr); if (idx < len) d[idx] += rng.range(-0.6, 0.6); }
    if (P.spring) { const D = Math.floor(0.033 * sr); for (let i = D; i < len; i++) d[i] += 0.55 * d[i - D]; new BQ(sr, 'hp', 300).run(d); new BQ(sr, 'lp', 4500).run(d); }
    return d;
  });
  normalizeMulti(chans, 0.5);
  const b = bufFrom(sr, chans);
  _irs.set(key, b);
  return b;
}

// ============================================================ MUSIC RIG ====
// One rig per playing station/score: channels -> glue compressor -> out, with
// reverb + tempo-synced delay sends, optional AM-radio colouring.
class MusicRig {
  constructor(sys, ctx, dest, fx = {}) {
    this.sys = sys; this.ctx = ctx; this.fx = fx; this.voices = []; this.maxVoices = fx.maxVoices || 56; this.chans = {}; this.nodes = []; this.shared = [];
    const N = (x) => (this.nodes.push(x), x);
    const G = (v) => { const g = N(ctx.createGain()); g.gain.value = v; return g; };
    const F = (type, f, q = 0.707, db = 0) => { const b = N(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = db; return b; };
    this.G = G; this.F = F; this.N = N;
    this.out = G(0); this.out.gain.setTargetAtTime(fx.gain ?? 0.8, ctx.currentTime, 0.05);
    let tail = this.out;
    if (fx.am) {
      const hp = F('highpass', fx.am.hp || 380, 0.7), pk = F('peaking', 1400, 1, 4), sh = N(ctx.createWaveShaper()), lp = F('lowpass', fx.am.lp || 3200, 0.9), lp2 = F('lowpass', (fx.am.lp || 3200) * 1.3, 0.7);
      sh.curve = driveCurve(fx.am.drive || 1.8);
      const post = G(fx.am.post ?? 0.6);
      tail.connect(hp).connect(pk).connect(sh).connect(lp).connect(lp2).connect(post); tail = post;
      const hiss = G(fx.am.hiss ?? 0.012); this.shared.push([kitFor(ctx).noise, hiss]); kitFor(ctx).noise.connect(hiss); hiss.connect(hp);
    }
    tail.connect(dest);
    this.bus = G(1); this.comp = N(ctx.createDynamicsCompressor());
    this.comp.threshold.value = -16; this.comp.knee.value = 10; this.comp.ratio.value = 3; this.comp.attack.value = 0.006; this.comp.release.value = 0.15;
    this.bus.connect(this.comp).connect(this.out);
    this.rev = N(ctx.createConvolver()); this.rev.buffer = makeIR(ctx.sampleRate, fx.rev || 'room');
    this.rev.connect(G(fx.revAmt ?? 1)).connect(this.out);
    this.dly = N(ctx.createDelay(2)); this.dly.delayTime.value = 0.375;
    const fb = G(fx.fb ?? 0.3), dlp = F('lowpass', 3200, 0.5); this.dly.connect(dlp).connect(fb).connect(this.dly); dlp.connect(G(1)).connect(this.out);
  }
  setTempo(bpm) { this.dly.delayTime.setValueAtTime(Math.min(1.9, (this.fx.delayBeats || 0.75) * (60 / bpm)), this.ctx.currentTime); }
  ch(name) {
    if (this.chans[name]) return this.chans[name];
    const c = (this.fx.ch && (this.fx.ch[name] || this.fx.ch.default)) || {}, g = this.G(c.g ?? 0.8);
    let head = g;
    if (c.lp) { const f = this.F('lowpass', c.lp, 0.7); f.connect(g); head = f; }
    if (c.hp) { const f = this.F('highpass', c.hp, 0.7); f.connect(head); head = f; }
    let tail = g;
    if (c.pan) { const p = this.N(this.ctx.createStereoPanner()); p.pan.value = c.pan; g.connect(p); tail = p; }
    tail.connect(this.bus);
    if (c.rev) tail.connect(this.G(c.rev)).connect(this.rev);
    if (c.dly) tail.connect(this.G(c.dly)).connect(this.dly);
    if (c.trem) { const l = this.N(this.ctx.createOscillator()); l.frequency.value = c.trem[0]; l.start(); const dg = this.G((c.g ?? 0.8) * c.trem[1]); l.connect(dg).connect(g.gain); this.lfo = l; }
    head._g = g; head._base = c.g ?? 0.8;
    this.chans[name] = head;
    return head;
  }
  setChannelGain(name, v, tc = 0.3) { const h = this.ch(name); h._target = v; h._g.gain.setTargetAtTime(h._base * v, this.ctx.currentTime, tc); }
  chanMuted(name) { const h = name && this.chans[name]; return !!(h && h._target != null && h._target < 0.01); }
  _track(src, g, start, end) {
    const v = { src, g, start, end }; this.voices.push(v);
    src.onended = () => { try { g.disconnect(); src.disconnect(); } catch (e) { /* gone */ } const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    this._steal();
  }
  // Polyphony cap: only voices already sounding can be stolen (offline renders
  // schedule everything up-front, so future notes must never be cut).
  _steal() {
    const t = this.ctx.currentTime;
    let sounding = 0; for (const v of this.voices) if (v.start <= t + 0.3 && !v.stolen) sounding++;
    for (const o of this.voices) {
      if (sounding <= this.maxVoices) break;
      if (o.stolen || o.start > t + 0.3) continue;
      o.stolen = true; sounding--;
      try { o.g.gain.cancelScheduledValues(t); o.g.gain.setTargetAtTime(0, t, 0.01); o.src.stop(t + 0.06); } catch (e) { /* ignore */ }
    }
  }
  play(ev, t, spb) {
    const D = INST[ev.i]; if (!D) return;
    const ctx = this.ctx, dur = Math.max(0.02, (ev.d ?? 0.5) * spb), v = (ev.v ?? 0.8) * (D.gain ?? 1), dest = this.ch(ev.ch || D.ch || 'main');
    if (D.live) return this._live(D, ev, t, dur, v, dest, spb);
    const bank = instBank(ev.i); if (!bank) return;
    let z = bank[0], rate = ev.rate || 1;
    if (D.pick) z = bank[(ev.n ?? 0) % bank.length];
    else if (ev.m != null) {
      let best = 1e9; for (const zz of bank) { const dd = Math.abs(zz.root - ev.m); if (dd < best) { best = dd; z = zz; } }
      rate *= Math.pow(2, (ev.m - z.root) / 12);
    }
    const src = ctx.createBufferSource(); src.buffer = z.buf;
    if (ev.sl) { src.playbackRate.setValueAtTime(rate * Math.pow(2, (ev.sl.from - ev.m) / 12), t); src.playbackRate.linearRampToValueAtTime(rate, t + (ev.sl.d ?? 0.2) * spb); }
    else src.playbackRate.setValueAtTime(rate, t);
    if (ev.bend) { const [st, at, bd] = ev.bend; src.playbackRate.setValueAtTime(rate, t + at * spb); src.playbackRate.linearRampToValueAtTime(rate * Math.pow(2, st / 12), t + (at + bd) * spb); }
    if (z.ls != null) { src.loop = true; src.loopStart = z.ls; src.loopEnd = z.le; }
    const g = ctx.createGain(), a = ev.a ?? D.a ?? 0.002;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a);
    let end;
    if (z.ls != null || (D.damp && !ev.ring)) {
      const rel = z.ls != null ? (ev.r ?? D.r ?? 0.1) : D.damp, off = t + Math.max(a, dur);
      g.gain.setValueAtTime(v, off); g.gain.setTargetAtTime(0, off, rel / 3);
      end = Math.min(off + rel * 1.5, t + (z.ls != null ? 1e4 : z.buf.duration / rate));
    } else end = t + Math.min(z.buf.duration / rate, D.max || 8);
    src.connect(g).connect(dest); src.start(t); src.stop(end + 0.02);
    this._track(src, g, t, end);
  }
  _live(D, ev, t, dur, v, dest, spb) {
    const ctx = this.ctx, f = mtof(ev.m ?? 60), g = ctx.createGain(), oscs = [], made = [g], k = D.live;
    const O = (type, fr, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.detune.value = det; oscs.push(o); made.push(o); return o; };
    const glide = (o, mult = 1) => { if (ev.sl) { o.frequency.setValueAtTime(mtof(ev.sl.from) * mult, t); o.frequency.exponentialRampToValueAtTime(f * mult, t + (ev.sl.d ?? 0.15) * spb); } };
    const lpF = (fc, q) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = fc; b.Q.value = q; b.connect(g); made.push(b); return b; };
    let end = t + dur;
    if (k === 'pad') {
      const lp = lpF(D.cut * 0.4, 0.5), a = ev.a ?? D.a, r = ev.r ?? D.r;
      for (const det of [-9, 9]) O('sawtooth', f, det).connect(lp);
      lp.frequency.setValueAtTime(D.cut * 0.4, t); lp.frequency.linearRampToValueAtTime(D.cut, t + a); lp.frequency.setTargetAtTime(D.cut * 0.6, t + a, dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.5, t + a); g.gain.setValueAtTime(v * 0.5, t + Math.max(a, dur)); g.gain.setTargetAtTime(0, t + Math.max(a, dur), r / 3);
      end = t + Math.max(a, dur) + r * 1.5;
    } else if (k === 'lead') {
      const lp = lpF(D.cut, 1.2), o1 = O('sawtooth', f, 4), o2 = O('square', f / 2, -4), g2 = ctx.createGain(); made.push(g2);
      o1.connect(lp); g2.gain.value = 0.35; o2.connect(g2).connect(lp); glide(o1); glide(o2, 0.5);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.4, t + (D.a || 0.01)); g.gain.setValueAtTime(v * 0.4, t + dur); g.gain.setTargetAtTime(0, t + dur, D.r / 3);
      end = t + dur + D.r * 1.5;
    } else if (k === 'arp') {
      const lp = lpF(D.cut, 2); O('square', f).connect(lp);
      lp.frequency.setValueAtTime(D.cut, t); lp.frequency.exponentialRampToValueAtTime(D.cut * 0.15, t + 0.18);
      g.gain.setValueAtTime(v * 0.35, t); g.gain.setTargetAtTime(0, t + 0.01, 0.07); end = t + 0.4;
    } else if (k === 'sbass') {
      const lp = lpF(D.cut, 4), o = O('sawtooth', f); o.connect(lp); glide(o);
      lp.frequency.setValueAtTime(D.cut * 1.6, t); lp.frequency.exponentialRampToValueAtTime(D.cut * 0.3, t + 0.2);
      g.gain.setValueAtTime(v * 0.4, t); g.gain.setValueAtTime(v * 0.4, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.02); end = t + dur + 0.1;
    } else if (k === 'stab') {
      const lp = lpF(D.cut, 1); for (const det of [-12, 0, 12]) O('sawtooth', f, det).connect(lp);
      lp.frequency.setValueAtTime(D.cut, t); lp.frequency.exponentialRampToValueAtTime(D.cut * 0.25, t + 0.25);
      g.gain.setValueAtTime(v * 0.3, t); g.gain.setTargetAtTime(0, t + Math.min(dur, 0.2), 0.06); end = t + Math.min(dur, 0.2) + 0.35;
    } else if (k === 'sub' || k === 'tone') {
      const o = O('sine', f); o.connect(g); glide(o);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * (k === 'sub' ? 0.45 : 0.6), t + 0.005); g.gain.setValueAtTime(v * (k === 'sub' ? 0.45 : 0.6), t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02); end = t + dur + 0.03;
    } else if (k === 'fsk') {
      const o = O('square', 1200); o.connect(g);
      for (let tt = t; tt < t + dur; tt += 0.012) o.frequency.setValueAtTime(Math.random() < 0.5 ? 1200 : 2200, tt);
      g.gain.setValueAtTime(v * 0.12, t); g.gain.setValueAtTime(0, t + dur); end = t + dur + 0.01;
    }
    g.connect(dest);
    for (const o of oscs) { o.start(t); o.stop(end); }
    const last = oscs[oscs.length - 1];
    if (!last) { g.disconnect(); return; }
    const vo = { src: last, g, start: t, end };
    this.voices.push(vo); this._steal();
    last.onended = () => { for (const n of made) { try { n.disconnect(); } catch (e) { /* gone */ } } const i = this.voices.indexOf(vo); if (i >= 0) this.voices.splice(i, 1); };
  }
  setLayers(x, tc = 0.4) {
    for (const [name, a, b] of this.fx.layers || []) { let g = b <= a ? 1 : clamp((x - a) / (b - a)); g = g * g * (3 - 2 * g); this.setChannelGain(name, g, tc); }
  }
  stop(fade = 0.3) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setValueAtTime(this.out.gain.value, t); this.out.gain.setTargetAtTime(0, t, fade / 4);
    for (const v of this.voices) { try { v.src.stop(t + fade + 0.05); } catch (e) { /* ignore */ } }
    setTimeout(() => {
      for (const [s, d] of this.shared) { try { s.disconnect(d); } catch (e) { /* gone */ } }
      for (const n of this.nodes) { try { n.disconnect(); if (n.stop) n.stop(); } catch (e) { /* gone */ } }
      for (const v of this.voices) { try { v.g.disconnect(); } catch (e) { /* gone */ } }
    }, (fade + 0.3) * 1000);
  }
}

// ========================================================== SEQ PLAYER ====
// Lookahead scheduler for one generative stream (radio station or score).
class SeqPlayer {
  constructor(sys, ctx, dest, genre, opts = {}) {
    this.sys = sys; this.ctx = ctx; this.genre = genre; this.Gn = GENRES[genre]; this.opts = opts;
    this.rig = new MusicRig(sys, ctx, dest, this.Gn.fx);
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0); this.songN = opts.songN || 0;
    this.queue = []; this.notes = 0; this.song = null; this.bar = 0; this.barT = 0; this.stopped = false;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.hum = new RNG(this.seed ^ 0x5bd1e995);
  }
  static make(genre, seed, songN, station) {
    const G = GENRES[genre], s = G.make(new RNG((seed * 31 + songN * 7919 + 17) >>> 0), station);
    s.G = G; s.genre = genre; s.songN = songN; s.bpb = s.bpb || 4;
    s.dur = (s.bars.length * s.bpb * 60) / s.bpm;
    return s;
  }
  start(t0, song, bar = 0) {
    this.song = song || SeqPlayer.make(this.genre, this.seed, this.songN, this.opts.station);
    this.bar = clamp(bar, 0, this.song.bars.length - 1); this.barT = t0; this.songT = t0 - (this.bar * this.song.bpb * 60) / this.song.bpm;
    this.rig.setTempo(this.song.bpm); this.opts.onSong?.(this.song, this.songT);
    if (this.genre === 'score') this.rig.setLayers?.(this.sys.musicIntensity);
  }
  _next() {
    const was = this.song;
    if (!was.jingle && this.Gn.jingle && this.hum.chance(this.opts.jingleP ?? 0.6)) this.song = makeJingle(this.genre, this.opts.station);
    else { this.songN++; this.song = SeqPlayer.make(this.genre, this.seed, this.songN, this.opts.station); }
    this.bar = 0; this.songT = this.barT; this.rig.setTempo(this.song.bpm); this.opts.onSong?.(this.song, this.songT);
  }
  pump(until) {
    if (this.stopped || !this.song || this.warming) return;
    const now = this.offline ? 0 : this.ctx.currentTime;
    if (!this.offline && this.barT < now - 1) { // fell behind (throttled tab): skip ahead silently
      while (this.barT < now) { this.barT += (this.song.bpb * 60) / this.song.bpm; if (++this.bar >= this.song.bars.length) this._next(); }
      this.queue.length = 0;
    }
    let guard = 0;
    while (this.barT < until && guard++ < 64) {
      if (this.bar >= this.song.bars.length) this._next();
      const S = this.song, spb = 60 / S.bpm, evs = S.G.bar(S, this.bar) || [];
      for (const e of evs) {
        let bt = e.t || 0; const fl = Math.floor(bt + 1e-6), fr = bt - fl;
        if (S.swing && Math.abs(fr - 0.5) < 1e-3) bt = fl + 0.5 + S.swing / 6;
        else if (S.swing16 && (Math.abs(fr - 0.25) < 1e-3 || Math.abs(fr - 0.75) < 1e-3)) bt += S.swing16 / 12;
        let t = this.barT + bt * spb + (e.lag || 0);
        if (e.h) { t += this.hum.range(-0.006, 0.006); e.v = (e.v ?? 0.8) * this.hum.range(0.88, 1.06); }
        this.queue.push([t, e, spb]);
      }
      this.barT += S.bpb * spb; this.bar++;
    }
    this.queue.sort((a, b) => a[0] - b[0]);
    if (this.sys.onDemand && !this.offline && guard) {
      const missing = new Set();
      for (const [, e] of this.queue) if (INST[e.i] && !INST[e.i].live && !_banks.has(e.i)) missing.add(e.i);
      if (missing.size) {
        this.warming = true;
        Promise.all([...missing].map(name => this.sys.prepareSamples('instrument', name))).then(() => {
          this.warming = false;
          if (this.stopped) return;
          // Keep the first beat and its notes together even on a slow device.
          const wait = Math.max(0, this.ctx.currentTime + 0.04 - this.queue[0][0]);
          if (wait) {
            for (const note of this.queue) note[0] += wait;
            this.barT += wait;
            this.songT += wait;
          }
          this.pump(this.ctx.currentTime + 0.2);
        }).catch(error => { this.warming = false; this.stop(); console.warn('[audio] instruments unavailable', error); });
        return;
      }
    }
    let k = 0;
    for (; k < this.queue.length && this.queue[k][0] < until; k++) {
      const [t, e, spb] = this.queue[k];
      if (!this.offline && t < now - 0.03) continue;
      if (this.rig.chanMuted(e.ch)) continue;
      try { this.rig.play(e, Math.max(t, now), spb); this.notes++; } catch (err) { this.errors = (this.errors || 0) + 1; if (this.errors < 4) console.warn('[audio] note error', e, err); }
    }
    if (k) this.queue.splice(0, k);
  }
  stop(fade = 0.3) { this.stopped = true; this.queue.length = 0; this.rig.stop(fade); }
}

// ============================================================== THEORY ====
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10],
  harm: [0, 2, 3, 5, 7, 8, 11], phryg: [0, 1, 3, 5, 7, 8, 10], majPent: [0, 2, 4, 7, 9], minPent: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
};
const QUAL = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], 5: [0, 7, 12], 7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], 13: [0, 4, 7, 10, 14, 21], add9: [0, 4, 7, 14], '7b9': [0, 4, 7, 10, 13], mM7: [0, 3, 7, 11],
};
const RN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
const pcOf = (m) => ((m % 12) + 12) % 12;
function chord(key, rn) {
  const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(rn);
  if (!m) throw new Error('bad chord ' + rn);
  const up = m[2] === m[2].toUpperCase(), s = m[3];
  const deg = RN[m[2].toUpperCase()] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
  const q = s === '' ? (up ? 'maj' : 'min') : s === '7' ? (up ? '7' : 'm7') : s === '9' ? (up ? '9' : 'm9') : s === '6' ? (up ? '6' : 'm6')
    : s === 'o' ? 'dim' : s === 'o7' ? 'dim7' : s === 'h7' ? 'm7b5' : s === 'maj7' ? (up ? 'maj7' : 'mM7') : QUAL[s] ? s : up ? 'maj' : 'min';
  const root = pcOf(key + deg);
  return { root, q, iv: QUAL[q], pcs: [...new Set(QUAL[q].map((i) => pcOf(root + i)))], name: NOTE_NAMES[root] + (q === 'maj' ? '' : q === 'min' ? 'm' : q) };
}
const prog = (key, str) => str.trim().split(/\s+/).map((bar) => bar.split('/').map((rn) => chord(key, rn)));
const chordAt = (bar, beat, bpb = 4) => { const c = bar.chords; return c[Math.min(c.length - 1, Math.floor((beat + 1e-6) / (bpb / c.length)))]; };
function scaleNotes(key, scale, lo, hi) { const s = SCALES[scale] || scale, out = []; for (let m = lo; m <= hi; m++) if (s.includes(pcOf(m - key))) out.push(m); return out; }
function nearestIdx(list, m) { let bi = 0, bd = 1e9; for (let i = 0; i < list.length; i++) { const d = Math.abs(list[i] - m); if (d < bd) { bd = d; bi = i; } } return bi; }
function nearPc(pcs, m, lo = 0, hi = 127) {
  m = Math.round(m);
  for (let d = 0; d < 12; d++) for (const s of d ? [1, -1] : [1]) { const x = m + d * s; if (x >= lo && x <= hi && pcs.includes(pcOf(x))) return x; }
  return clamp(m, lo, hi);
}
const inRange = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
// Closest-motion voicing of pitch classes (root-first order) within [lo,hi].
function voicing(pcsIn, lo, hi, prev, n) {
  let pcs = pcsIn.slice();
  while (pcs.length > n) pcs.splice(pcs.length > 3 ? 2 : pcs.length - 1, 1);
  while (pcs.length < n) pcs.push(pcs[pcs.length % pcsIn.length]);
  let best = null, bestC = 1e9;
  for (let r = 0; r < pcs.length; r++) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    for (let base = lo; base < lo + 12; base++) {
      if (pcOf(base) !== order[0]) continue;
      const v = [base];
      for (let k = 1; k < order.length; k++) { let m = v[k - 1] + 1; while (pcOf(m) !== order[k]) m++; v.push(m); }
      if (v[v.length - 1] > hi) continue;
      const c = prev && prev.length === v.length ? v.reduce((s, m, k) => s + Math.abs(m - prev[k]), 0) : Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2) * 2;
      if (c < bestC) { bestC = c; best = v; }
    }
  }
  return best || pcs.map((p) => inRange(lo + pcOf(p - lo), lo, hi)).sort((a, b) => a - b);
}
const rootless = (ch) => { const iv = ch.iv; if (iv.length < 4) return [iv[1], 9, iv[2], 14].map((i) => pcOf(ch.root + i)); return [iv[1], iv[3], 14, iv[2] === 7 && ch.q === '7' ? 21 : iv[2]].map((i) => pcOf(ch.root + i)); };

// Rhythm cells: [weight, lengthBeats, [[onset, dur], ...]]
const CELLS = {
  vocal: [[3, 1, [[0, 1]]], [3, 1, [[0, 0.5], [0.5, 0.5]]], [2, 2, [[0, 1.5], [1.5, 0.5]]], [1.5, 1, [[0.5, 0.5]]], [1.5, 2, [[0, 2]]], [1, 1, []], [1.5, 2, [[0, 0.5], [0.5, 1], [1.5, 0.5]]], [1, 2, [[0, 0.75], [0.75, 0.75], [1.5, 0.5]]]],
  ballad: [[3, 2, [[0, 2]]], [2, 1, [[0, 1]]], [2, 2, [[0, 1.5], [1.5, 0.5]]], [1, 1, [[0, 0.5], [0.5, 0.5]]], [1, 2, [[0, 1], [1, 1]]], [0.7, 1, []]],
  swing: [[3, 1, [[0, 1]]], [2, 1, [[0, 0.5], [0.5, 0.5]]], [2, 2, [[0, 1.5], [1.5, 0.5]]], [2, 1, [[0.5, 0.5]]], [1.5, 2, [[0.5, 1], [1.5, 0.5]]], [1, 2, [[0, 2]]], [1, 1, []]],
  lick: [[3, 1, [[0, 0.5], [0.5, 0.5]]], [2, 1, [[0, 0.25], [0.25, 0.25], [0.5, 0.5]]], [1.5, 1, [[0, 0.75], [0.75, 0.25]]], [1, 1, [[0, 1]]], [1, 1, []], [1, 2, [[0, 1.5], [1.5, 0.5]]]],
  sparse: [[2, 2, [[0, 1.5]]], [2, 1, [[0, 0.5], [0.5, 0.5]]], [2, 1, []], [1, 2, [[0, 0.75], [0.75, 0.75], [1.5, 0.5]]], [1, 1, [[0.5, 0.5]]]],
  hook: [[3, 1, [[0, 0.5], [0.5, 0.5]]], [2, 1, [[0, 0.25], [0.25, 0.25], [0.5, 0.25], [0.75, 0.25]]], [2, 1, [[0, 0.75], [0.75, 0.25]]], [1, 1, []], [1, 1, [[0.5, 0.5]]], [1, 1, [[0, 1]]]],
  synth: [[3, 1, [[0, 0.5], [0.5, 0.5]]], [2, 2, [[0, 2]]], [2, 1, [[0, 1]]], [1.5, 2, [[0, 1.5], [1.5, 0.5]]], [1, 1, []], [1, 2, [[0, 0.75], [0.75, 0.75], [1.5, 0.5]]]],
};
function genRhythm(rng, cells, beats) {
  const out = []; let b = 0;
  while (b < beats - 1e-6) {
    const fit = cells.filter((c) => c[1] <= beats - b + 1e-6), c = rng.wpick(fit.map((x) => [x, x[0]]));
    for (const [on, d] of c[2]) out.push({ t: b + on, d });
    b += c[1];
  }
  return out;
}
// Phrase-structured melody over a section: 2-bar units with motif reuse (A/B
// letters), chord tones on strong beats, stepwise motion between, cadence on
// the last unit. Returns note lists per bar of the section.
function genMelody(rng, S, bars, o) {
  const bpb = S.bpb || 4, nb = bars.length - (bars.length % 2), units = Math.max(1, nb / 2);
  const sc = scaleNotes(S.key, o.scale || S.scale, o.lo, o.hi);
  const form = o.form || (units >= 6 ? rng.pick(['ABABCD', 'AABAAC', 'ABACABAD']) : units >= 4 ? rng.pick(['ABAC', 'AABC', 'ABAB', 'AAAB']) : units === 3 ? 'ABA' : units === 2 ? rng.pick(['AB', 'AA']) : 'A');
  const rh = {}, pat = {}, out = Array.from({ length: bars.length }, () => []);
  const tones = (ch) => (o.diatonic ? [ch.root, ...sc.filter((m) => pcOf(m - ch.root) >= 3 && pcOf(m - ch.root) <= 4).slice(0, 1).map(pcOf), pcOf(ch.root + 7)] : ch.pcs);
  let prev = sc[nearestIdx(sc, o.start ?? (o.lo + o.hi) / 2)], dir = rng.sign();
  for (let u = 0; u < units; u++) {
    const L = form[u % form.length], last = u === units - 1 && o.cadence !== false;
    let r = rh[L] || (rh[L] = genRhythm(rng, o.cells, 2 * bpb));
    if (last) { r = r.filter((n) => n.t < bpb - 1e-6).map((n) => (n.t + n.d > bpb ? { t: n.t, d: bpb - n.t } : n)); r.push({ t: bpb, d: bpb * rng.pick([0.75, 1, 1]) }); }
    const P = pat[L], pits = [];
    r.forEach((n, k) => {
      const bi = u * 2 + Math.floor((n.t + 1e-6) / bpb); if (bi >= nb) return;
      const beat = n.t - Math.floor((n.t + 1e-6) / bpb) * bpb, ch = chordAt(bars[bi], beat, bpb), ct = tones(ch);
      const strong = (Math.abs(beat - Math.round(beat)) < 1e-6 && Math.round(beat) % 2 === 0) || n.d >= 1.5;
      let m;
      if (last && k === r.length - 1) m = nearPc(o.endPcs ? o.endPcs.map((p) => pcOf(p + S.key)) : [ch.root], prev, o.lo, o.hi);
      else if (P && k < P.length) { m = sc[clamp(nearestIdx(sc, prev) + P[k], 0, sc.length - 1)]; if (strong && !ct.includes(pcOf(m))) m = nearPc(ct, m, o.lo, o.hi); }
      else if (u === 0 && k === 0) m = nearPc(ct, prev, o.lo, o.hi);
      else if (strong) m = nearPc(ct, prev + dir * rng.int(1, 4), o.lo, o.hi);
      else m = sc[clamp(nearestIdx(sc, prev) + rng.wpick([[1, 5], [2, 2], [0, 1], [3, 1]]) * dir, 0, sc.length - 1)];
      if (m >= o.hi - 1) dir = -1; else if (m <= o.lo + 1) dir = 1; else if (rng.chance(o.turn ?? 0.22)) dir = -dir;
      pits.push(nearestIdx(sc, m) - nearestIdx(sc, prev));
      prev = m;
      out[bi].push({ t: beat, d: n.d, m, v: strong ? 0.85 : 0.72 });
    });
    if (!P) pat[L] = pits;
  }
  return out;
}
// Bebop-ish 8th-note line: chord tones on beats, chromatic approaches, phrases + rests.
function genBop(rng, S, bars, o) {
  const out = bars.map(() => []), sc = scaleNotes(S.key, o.scale || S.scale, o.lo, o.hi);
  let prev = (o.lo + o.hi) >> 1, dir = 1, left = rng.int(5, 12), rest = 0;
  bars.forEach((B, bi) => {
    for (let p = 0; p < 8; p++) {
      if (rest > 0) { rest--; continue; }
      if (left <= 0) { rest = rng.int(1, 4); left = rng.int(5, 14); if (out[bi].length) out[bi][out[bi].length - 1].d = 1; continue; }
      const beat = p / 2, ch = chordAt(B, beat);
      let m;
      if (p % 2 === 0) m = nearPc(ch.pcs, prev + dir * 2, o.lo, o.hi);
      else {
        const nch = p === 7 ? chordAt(bars[bi + 1] || B, 0) : chordAt(B, beat + 0.5), tgt = nearPc(nch.pcs, prev + dir * 2, o.lo, o.hi);
        m = rng.chance(0.45) && tgt !== prev ? tgt + (tgt > prev ? -1 : 1) : sc[clamp(nearestIdx(sc, prev) + dir, 0, sc.length - 1)];
      }
      if (m >= o.hi - 2) dir = -1; else if (m <= o.lo + 2) dir = 1; else if (rng.chance(0.15)) dir = -dir;
      out[bi].push({ t: beat, d: 0.5, m, v: (p % 2 ? 0.62 : 0.8) * rng.range(0.9, 1.05) });
      prev = m; left--;
    }
  });
  return out;
}
function walkBar(rng, bar, next, prev, lo = 31, hi = 50) {
  const notes = []; let p = prev;
  for (let b = 0; b < 4; b++) {
    const ch = chordAt(bar, b), pc = b ? chordAt(bar, b - 1) : null, nch = b === 3 ? (next ? chordAt(next, 0) : ch) : chordAt(bar, b + 1);
    let m;
    if (!pc || pc.name !== ch.name) m = nearPc([ch.root], p, lo, hi);
    else if (nch.name !== ch.name || b === 3) { const tgt = nearPc([nch.root], p, lo + 1, hi - 1); m = rng.chance(0.7) ? tgt + (rng.chance(0.5) ? 1 : -1) : nearPc([pcOf(nch.root + 7)], tgt, lo, hi); }
    else { m = nearPc(ch.pcs, p + rng.sign() * rng.int(2, 5), lo, hi); if (m === p) m = nearPc(ch.pcs, p + 4, lo, hi); }
    notes.push({ t: b, d: 0.92, m, v: b % 2 ? 0.72 : 0.84 }); p = m;
  }
  return { notes, last: p };
}
// ---- song skeleton helpers ----
function mkSong(o) {
  const bars = [];
  for (const [name, n, p, energy, extra] of o.secs) {
    const pr = typeof p === 'string' ? prog(o.key, p) : p;
    for (let i = 0; i < n; i++) bars.push(Object.assign({ sec: name, i, n, chords: pr[i % pr.length], energy: energy ?? 1 }, extra || {}));
  }
  bars.forEach((b, i) => { b.next = bars[i + 1] || null; b.last = b.i === b.n - 1; b.first = b.i === 0; b.idx = i; });
  const S = Object.assign({}, o, { bars, mel: {}, st: {}, bpb: 4 });
  delete S.secs;
  return S;
}
const secBars = (S, name) => { const out = []; for (const b of S.bars) { if (b.sec === name) out.push(b); else if (out.length) break; } return out; };
const E = (t, i, m, d, v, ch, x) => Object.assign({ t, i, m, d, v, ch }, x);
const Dm = (t, i, v = 0.8, ch) => ({ t, i, v, ch, h: 1 });
const endsSec = (B) => B.last && B.next && B.next.sec !== B.sec;
function strum(out, t, notes, dir, inst, v, d, spb, ch, gap = 0.011) {
  const ns = dir === 'U' ? notes.slice().reverse().slice(0, 3) : notes;
  ns.forEach((m, k) => out.push({ t: t + (k * gap) / spb, i: inst, m, d, v: v * (dir === 'U' ? 0.7 : 1) * (1 - k * 0.04), ch }));
}
const NAMES = {
  country: [['Red Dirt', 'Turnpike', 'Cimarron', 'Prairie', 'Keystone', 'Muskogee', 'Grand Lake', 'Tallgrass', 'Okmulgee', 'Gravel Road', 'Section Line', 'Sooner'], ['Heartache', 'Two-Step', 'Sundown', 'Rodeo Queen', 'Whiskey Night', 'Highway', 'Wind Song', 'Porch Light', 'Tailgate', 'Lonesome Mile', 'Revival', 'Sweetheart'], ['Cody Ray', 'Darla Jean', 'Wade', 'Billie Jo', 'Travis Lee', 'Lacey'], ['Hollister', 'McCall', 'Barlow', 'Tatum', 'Wheeler', 'Pruitt'], ['Ramblers', 'Drifters', 'Section Liners', 'Mile Markers', 'Tumbleweeds']],
  tulsa: [['Cherry Street', 'Brady', 'Riverside', 'Leon\'s', 'Midnight', 'Low Down', 'Easy', 'Sand Springs', 'Mohawk', 'Lazy'], ['Shuffle', 'Groove', 'Boogie', 'Rambler', 'Swamp Walk', 'Mumble', 'Ride', 'Daydream', 'Strut'], ['J.D.', 'Lonnie', 'Rudy', 'Dee', 'Earl'], ['Calloway', 'Mabry', 'Teague', 'Fontaine', 'Sizemore'], ['Leaning Porch Band', 'Riverside Three', 'Shelter Session', 'Slow Burners']],
  jazz: [['Greenwood', 'Archer Street', 'Deep Deuce', 'Black Wall Street', 'Elgin Avenue', 'Pine Street', 'Night Owl', 'Blue Lantern'], ['Stomp', 'Strut', 'Bounce', 'Ballad', 'Blues', 'Shuffle', 'Reverie', 'Changes', 'Hop'], ['Lester', 'Mae', 'Odell', 'Hattie', 'Clarence', 'Viola'], ['Whitaker', 'Booker', 'Lyle', 'Pettiford', 'Mims', 'Gaines'], ['Quartet', 'Trio', 'Combo', 'Sextet']],
  rock: [['Driller', 'Oilfield', 'Concrete', 'Static', 'Tornado', 'Rust Belt', 'Pipeline', 'Broken', 'Dustbowl', 'Glasshouse'], ['Halo', 'Machine', 'Sky', 'Season', 'Feedback', 'Saint', 'Spiral', 'Overpass', 'Fever'], ['Derrick', 'Shale', 'Wildcat', 'Gusher', 'Roughneck', 'Slag'], ['Hum', 'Bloom', 'Season', 'Sound', 'Cartel', 'Theory'], ['Saltwater', 'Pumpjack', 'Lowboy', 'Drillbit', 'Grackle']],
  hiphop: [['918', 'Northside', 'Prairie', 'Red Clay', 'Turnpike', 'Night Shift', 'Corner Store', 'Riverparks', 'Westside', 'Low Rider'], ['Dreams', 'Cypher', 'Tape', 'Interlude', 'Ride', 'Hustle', 'Paper', 'Smoke', 'Flow'], ['DJ', 'MC', 'Lil', 'Big', 'Young'], ['Mesquite', 'Tumbleweed', 'Okie', 'Sooner', 'Redbud', 'Twister'], ['Beats', 'Tapes', 'Collective', 'Crew']],
  oldies: [['Route 66', 'Moonlight', 'Sweet', 'Drive-In', 'Little', 'Diner', 'Starlight', 'Soda Fountain', 'Midnight', 'Jukebox'], ['Darling', 'Baby', 'Sweetheart', 'Hop', 'Rock', 'Stroll', 'Kiss', 'Angel', 'Twist'], ['Bobby', 'Ronnie', 'Dottie', 'Frankie', 'Peggy', 'Eddie'], ['Rae', 'Valentine', 'Starr', 'Lane', 'Dee', 'Moon'], ['Chromatones', 'Starlites', 'Hi-Fives', 'Del-Rays', 'Moonbeams']],
  synth: [['Neon', 'Midnight', 'Chrome', 'Laser', 'Expressway', 'Arcade', 'Night', 'Electric', 'Sunset', 'Afterglow'], ['Okie', 'Drive', 'Dreams', 'Horizon', 'Pulse', 'Runner', 'Grid', 'Mirage', 'Skyline'], ['Vector', 'Nova', 'Kid', 'Lux', 'Echo'], ['Prairie', 'Cruise', 'Tulsa', 'Driftwood', 'Static'], ['Collective', 'Machine', 'Systems', 'Club']],
};
function nameSong(S, rng, g) {
  const N = NAMES[g]; if (!N) return;
  S.title = rng.pick(N[0]) + ' ' + rng.pick(N[1]);
  S.artist = rng.chance(0.5) ? rng.pick(N[2]) + ' ' + rng.pick(N[3]) : 'The ' + rng.pick(N[4]);
  if (g === 'hiphop') S.artist = rng.pick(N[2]) + ' ' + rng.pick(N[3]);
}

// ============================================================== GENRES ====
const GENRES = {};

GENRES.country = {
  fx: { rev: 'room', revAmt: 0.9, fb: 0.25, delayBeats: 0.75, gain: 1.1, ch: { drums: { g: 0.7, rev: 0.12 }, hats: { g: 0.4, pan: 0.25 }, cym: { g: 0.4 }, bass: { g: 0.75 }, gtr: { g: 0.42, pan: -0.3, rev: 0.12 }, lead: { g: 0.6, rev: 0.25, dly: 0.12 }, steel: { g: 0.5, rev: 0.4, dly: 0.18, pan: 0.2 }, keys: { g: 0.32, pan: 0.3, rev: 0.2 } } },
  jingle: { lead: 'steel', chord: 'gtr_clean', scale: 'majPent' },
  make(rng) {
    const key = rng.pick([7, 9, 2, 4, 0]), ballad = rng.chance(0.22), bpm = ballad ? rng.int(72, 86) : rng.int(106, 134);
    const style = ballad ? 'ballad' : rng.pick(['twostep', 'twostep', 'train']);
    const V = rng.pick(['I I IV I', 'I IV I V', 'I V vi IV', 'I I IV IV I I V V', 'vi IV I V', 'I iii IV V', 'I IV vi V']);
    const C = rng.pick(['IV I V I', 'IV V I vi', 'I V IV I', 'IV I V V', 'vi IV I V', 'IV IV I I V V I I']);
    const Br = rng.pick(['vi IV I V', 'ii V I I', 'IV IV I I ii ii V V', 'bVII IV I I']);
    const S = mkSong({ key, scale: 'major', bpm, style, swing: style === 'twostep' ? rng.range(0.1, 0.3) : 0, piano: rng.chance(0.6),
      secs: [['intro', 4, C, 0.5], ['verse', 8, V, 0.7], ['chorus', 8, C, 1], ['verse', 8, V, 0.7], ['chorus', 8, C, 1], ['solo', 8, V, 0.9], ['bridge', 4, Br, 0.8], ['chorus', 8, C, 1], ['outro', 4, C, 0.6]] });
    S.leadV = rng.pick(['gtr_twang', 'steel']); S.leadC = S.leadV === 'steel' ? 'gtr_twang' : 'steel';
    S.mel.verse = genMelody(rng, S, secBars(S, 'verse'), { lo: 60, hi: 76, cells: ballad ? CELLS.ballad : CELLS.vocal });
    S.mel.chorus = genMelody(rng, S, secBars(S, 'chorus'), { lo: 64, hi: 79, cells: ballad ? CELLS.ballad : CELLS.vocal });
    S.mel.solo = genMelody(rng, S, secBars(S, 'solo'), { lo: 62, hi: 84, cells: CELLS.lick, scale: 'majPent', turn: 0.3 });
    S.mel.bridge = genMelody(rng, S, secBars(S, 'bridge'), { lo: 62, hi: 77, cells: CELLS.vocal });
    nameSong(S, rng, 'country'); S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], spb = 60 / S.bpm, sec = B.sec, st = S.st, r = S.r;
    if (!(sec === 'intro' && B.i < 2)) {
      if (S.style === 'ballad') { out.push(Dm(0, 'kick_rock', 0.7), Dm(2, 'kick_rock', 0.5), Dm(1, 'rim', 0.5), Dm(3, 'rim', 0.5)); for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.22 : 0.32)); }
      else if (S.style === 'train') { out.push(Dm(0, 'kick_rock', 0.85), Dm(2, 'kick_rock', 0.8)); for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'snare_dry', k === 2 || k === 6 ? 0.8 : 0.3)); }
      else { out.push(Dm(0, 'kick_rock', 0.85), Dm(2, 'kick_rock', 0.75), Dm(1, 'snare_dry', 0.8), Dm(3, 'snare_dry', 0.8)); for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.3 : 0.45)); }
      if (sec === 'chorus' || sec === 'solo') out.push(Dm(1, 'tamb', 0.45), Dm(3, 'tamb', 0.45));
      if (B.first && (sec === 'chorus' || sec === 'solo' || sec === 'outro')) out.push(Dm(0, 'crash', 0.55));
      if (endsSec(B)) for (let k = 0; k < 4; k++) out.push(Dm(3 + k / 4, k < 2 ? 'snare_dry' : 'tom_mid', 0.5 + k * 0.1));
    }
    if (!(sec === 'intro' && B.i < 1)) {
      const rt = inRange(36 + c.root, 36, 47), c2 = B.chords[1] || c, r2 = inRange(36 + c2.root, 36, 47);
      const second = c2 === c ? (rt - 5 >= 31 ? rt - 5 : rt + 7) : r2;
      if (S.style === 'ballad') out.push(E(0, 'bass_finger', rt, 1.9, 0.8), E(2, 'bass_finger', second, 1.9, 0.7));
      else {
        out.push(E(0, 'bass_finger', rt, 0.9, 0.85, null, { h: 1 }), E(2, 'bass_finger', second, 0.9, 0.75, null, { h: 1 }));
        const nx = B.next && B.next.chords[0];
        if (nx && nx.root !== c2.root && r.chance(0.6)) { const tg = inRange(36 + nx.root, 36, 47), s = tg > second ? -1 : 1; out.push(E(3, 'bass_finger', tg + 2 * s, 0.45, 0.6), E(3.5, 'bass_finger', tg + s, 0.45, 0.62)); }
      }
    }
    const pat = S.style === 'ballad' ? [[0, 'D', 1], [2, 'D', 0.8], [3, 'U', 0.6]] : [[0, 'D', 1], [1, 'D', 0.8], [1.5, 'U', 0.6], [2.5, 'U', 0.6], [3, 'D', 0.85], [3.5, 'U', 0.6]];
    pat.forEach(([t, d, a], k) => {
      const ch = chordAt(B, t), vv = (st.gv = voicing(ch.pcs, 52, 69, st.gv, 4)), nt = k + 1 < pat.length ? pat[k + 1][0] : 4;
      strum(out, t, d === 'D' ? [inRange(40 + ch.root, 40, 51), ...vv] : vv, d, 'gtr_clean', 0.5 * a, nt - t, spb, 'gtr');
    });
    if (S.piano && (sec === 'chorus' || sec === 'solo')) for (const t of [0.5, 1.5, 2.5, 3.5]) { const ch = chordAt(B, t); (st.pv = voicing(ch.pcs, 62, 77, st.pv, 3)).forEach((m) => out.push(E(t, 'piano', m, 0.4, 0.33, 'keys'))); }
    const mel = S.mel[sec], notes = mel && mel[B.i % mel.length], inst = sec === 'chorus' ? S.leadC : sec === 'solo' ? 'gtr_twang' : S.leadV;
    if (notes) for (const n of notes) {
      const e = E(n.t, inst, n.m, sec === 'solo' ? Math.min(n.d, 0.45) : n.d, n.v * 0.9, inst === 'steel' ? 'steel' : 'lead');
      if (inst === 'steel' && n.d >= 1) e.sl = { from: n.m - (r.chance(0.5) ? 2 : 1), d: 0.3 };
      if (inst === 'gtr_twang' && n.d >= 1 && r.chance(0.35)) e.sl = { from: n.m - 2, d: 0.12 };
      out.push(e);
    }
    if ((sec === 'verse' || sec === 'intro' || sec === 'outro') && S.leadV !== 'steel') {
      const pv = voicing([c.pcs[1], c.pcs[2]], 64, 79, st.sv, 2);
      pv.forEach((m, k) => out.push(E(0, 'steel', m, 3.8, 0.26, 'steel', st.sv && Math.abs(st.sv[k] - m) <= 5 && st.sv[k] !== m ? { sl: { from: st.sv[k], d: 0.6 } } : {})));
      st.sv = pv;
    }
    return out;
  },
};

GENRES.tulsa = {
  fx: { rev: 'spring', revAmt: 0.6, fb: 0.2, delayBeats: 0.5, gain: 1.2, ch: { drums: { g: 0.6, rev: 0.05 }, hats: { g: 0.22, pan: 0.3, lp: 7000 }, cym: { g: 0.25 }, bass: { g: 0.85 }, gtr: { g: 0.6, pan: -0.25, rev: 0.1 }, keys: { g: 0.36, pan: 0.3, rev: 0.15, trem: [5.5, 0.35] }, lead: { g: 0.55, rev: 0.3, dly: 0.1, pan: 0.1 } } },
  jingle: { lead: 'gtr_clean', chord: 'epiano', scale: 'minPent' },
  make(rng) {
    const key = rng.pick([4, 9, 2, 7, 0]), bpm = rng.int(90, 110), form = rng.pick(['vamp', 'blues', 'two']);
    const V = form === 'blues' ? 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7' : form === 'vamp' ? 'i7 i7 i7 i7 IV7 IV7 i7 i7' : rng.pick(['I7 I7 bVII7 IV7', 'i7 IV7 i7 IV7', 'I7 bIII7 IV7 IV7']);
    const H = form === 'blues' ? 'IV7 IV7 I7 I7 V7 IV7 I7 I7' : rng.pick(['IV7 IV7 i7 i7 bVII7 bVII7 i7 i7', 'bVI7 bVII7 i7 i7', 'IV7 bVII7 I7 I7']);
    const vb = form === 'blues' ? 12 : 8;
    const secs = form === 'blues'
      ? [['intro', 4, V, 0.5], ['verse', 12, V, 0.8], ['hook', 8, H, 1], ['verse', 12, V, 0.8], ['solo', 12, V, 0.9], ['hook', 8, H, 1], ['outro', 4, V, 0.5]]
      : [['intro', 4, V, 0.5], ['verse', vb, V, 0.8], ['hook', 8, H, 1], ['verse', vb, V, 0.8], ['hook', 8, H, 1], ['solo', vb, V, 0.9], ['verse', vb, V, 0.8], ['hook', 8, H, 1], ['outro', 4, V, 0.5]];
    const S = mkSong({ key, scale: 'minPent', bpm, swing: rng.range(0.35, 0.6), secs });
    const riff = [{ t: 0, iv: 0 }], ivs = [0, 0, 3, 5, 7, 10, 12, -2];
    for (const s of [0.5, 0.75, 1, 1.5, 1.75, 2, 2.5, 3, 3.5]) if (rng.chance(0.38)) riff.push({ t: s, iv: rng.pick(ivs) });
    S.riff = riff; S.kick2 = rng.chance(0.4);
    S.mel.verse = genMelody(rng, S, secBars(S, 'verse'), { lo: 55, hi: 69, cells: CELLS.sparse });
    S.mel.hook = genMelody(rng, S, secBars(S, 'hook'), { lo: 57, hi: 72, cells: CELLS.vocal });
    S.mel.solo = genMelody(rng, S, secBars(S, 'solo'), { lo: 57, hi: 81, cells: CELLS.lick, scale: 'blues', turn: 0.3 });
    nameSong(S, rng, 'tulsa'); S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], sec = B.sec, st = S.st, r = S.r;
    if (!(sec === 'intro' && B.i < 2)) {
      out.push(Dm(0, 'kick_soft', 0.9), Dm(2.5, 'kick_soft', 0.7), E(1, 'snare_dry', null, 0, 0.55, null, { lag: 0.014, h: 1 }), E(3, 'snare_dry', null, 0, 0.6, null, { lag: 0.014, h: 1 }));
      if (S.kick2) out.push(Dm(1.75, 'kick_soft', 0.45));
      for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.2 : 0.3));
      if (endsSec(B)) out.push(Dm(3.5, 'snare_dry', 0.45), Dm(3.75, 'snare_dry', 0.55));
    }
    for (let k = 0; k < 16; k++) out.push(Dm(k / 4, 'shaker', k % 2 ? 0.12 : 0.2));
    for (const rf of S.riff) { const ch = chordAt(B, rf.t), rt = inRange(40 + ch.root, 40, 51); out.push(E(rf.t, 'gtr_mute', rt + rf.iv, 0.3, 0.7, 'gtr', { h: 1 })); }
    if (!(sec === 'intro' && B.i < 2)) for (const rf of S.riff) if ([0, 1.5, 2, 2.5, 3].includes(rf.t)) { const ch = chordAt(B, rf.t), rt = inRange(28 + ch.root, 28, 39); out.push(E(rf.t, 'bass_finger', rf.t === 0 ? rt : rt + (rf.iv === 7 ? 7 : 0), rf.t === 0 ? 0.9 : 0.45, 0.78, null, { h: 1 })); }
    if (sec !== 'intro') {
      const hits = sec === 'hook' ? [[0, 1.4], [1.5, 0.45], [3.5, 0.4]] : [[1.5, 0.45], [3.5, 0.4]];
      for (const [t, d] of hits) { const ch = chordAt(B, t); (st.kv = voicing(ch.pcs.length > 3 ? ch.pcs : [...ch.pcs, pcOf(ch.root + 2)], 57, 74, st.kv, 4)).forEach((m) => out.push(E(t, 'epiano', m, d, 0.36, 'keys'))); }
    }
    const mel = S.mel[sec], notes = mel && mel[B.i % mel.length];
    if (notes) for (const n of notes) {
      const e = E(n.t, sec === 'solo' ? 'gtr_twang' : 'gtr_clean', n.m, n.d, n.v * 0.85, 'lead');
      if (n.d >= 0.75 && r.chance(sec === 'solo' ? 0.5 : 0.35)) e.sl = { from: n.m - (sec === 'solo' ? 2 : 1), d: sec === 'solo' ? 0.18 : 0.25 };
      out.push(e);
    }
    return out;
  },
};

GENRES.jazz = {
  fx: { rev: 'room', revAmt: 1, fb: 0.15, delayBeats: 0.75, gain: 1.05, ch: { drums: { g: 0.5, rev: 0.2 }, hats: { g: 0.35, pan: 0.3, rev: 0.2, lp: 7000 }, cym: { g: 0.3, pan: 0.3, rev: 0.2, lp: 7000 }, bass: { g: 0.95, rev: 0.05 }, keys: { g: 0.5, pan: -0.25, rev: 0.25 }, lead: { g: 0.6, pan: 0.15, rev: 0.3, trem: [5, 0.25] }, solo: { g: 0.55, pan: -0.1, rev: 0.25 } } },
  jingle: { lead: 'vibes', chord: 'piano', scale: 'major' },
  make(rng) {
    const key = rng.pick([5, 10, 3, 0, 8, 7]), style = rng.wpick([['swing', 0.5], ['bebop', 0.25], ['ballad', 0.25]]);
    const bpm = style === 'swing' ? rng.int(132, 176) : style === 'bebop' ? rng.int(200, 236) : rng.int(64, 76);
    const form = rng.wpick([['aaba', 0.5], ['blues', 0.35], ['minor', 0.15]]);
    let chorus;
    if (form === 'aaba') {
      const A = rng.pick(['Imaj7/vi7 ii7/V7 iii7/VI7 ii7/V7 Imaj7/I7 IV7/#ivo7 iii7/VI7 ii7/V7', 'ii7 V7 Imaj7 Imaj7 ii7 V7 iii7/VI7 ii7/V7', 'Imaj7 Imaj7 #io7 ii7 V7 V7 Imaj7/vi7 ii7/V7', 'Imaj7 IV7 iii7 VI7 ii7 V7 Imaj7/VI7 ii7/V7']);
      const Bp = rng.pick(['III7 III7 VI7 VI7 II7 II7 ii7 V7', 'v7 I7 IVmaj7 IVmaj7 ii7/V7 iii7/VI7 ii7 V7', 'iv7 bVII7 Imaj7 Imaj7 ii7 V7 iii7/VI7 ii7/V7']);
      chorus = [['A', A], ['A', A], ['B', Bp], ['A', A]];
    } else if (form === 'blues') chorus = [['A', 'I7 IV7 I7 v7/I7 IV7 #ivo7 I7 VI7 ii7 V7 I7/VI7 ii7/V7']];
    else chorus = [['A', 'i7 iv7 i7 i7 iv7 iv7 i7 i7 bVI7 V7 i7 iih7/V7']];
    const cb = chorus.reduce((s, c) => s + c[1].trim().split(/\s+/).length, 0), cd = (cb * 4 * 60) / bpm, long = cd > 75;
    const total = long ? 2 : clamp(Math.round(165 / cd), 3, 10), head = form === 'aaba' || total < 7 ? 1 : 2, solos = long ? 0 : Math.max(1, total - 2 * head);
    const plan = []; for (let h = 0; h < head; h++) plan.push('head');
    for (let s = 0; s < solos; s++) plan.push(s < Math.ceil(solos / 2) ? 'solo1' : 'solo2');
    for (let h = 0; h < head; h++) plan.push('out');
    const secs = [];
    plan.forEach((p, ci) => {
      let off = 0;
      chorus.forEach(([lab, ps], k) => { const n = ps.trim().split(/\s+/).length; if (!(long && p === 'out' && form === 'aaba' && k < 2)) secs.push([p, n, ps, 1, { lab, ci, cb0: off }]); off += n; });
    });
    secs.push(['tag', 2, form === 'minor' ? 'iih7/V7 i7' : 'ii7/V7 Imaj7', 1, { lab: 'T', ci: plan.length, cb0: 0 }]);
    const S = mkSong({ key, scale: form === 'minor' ? 'dorian' : form === 'blues' ? 'mixo' : 'major', bpm, style, form, swing: style === 'ballad' ? 0.5 : rng.range(0.55, 0.7), secs });
    for (const b of S.bars) b.cb = (b.cb0 || 0) + b.i;
    const aBars = S.bars.filter((b) => b.ci === 0 && b.lab === 'A').slice(0, form === 'aaba' ? 8 : 12);
    S.mel.A = genMelody(rng, S, aBars, { lo: 63, hi: 82, cells: style === 'ballad' ? CELLS.ballad : CELLS.swing, form: form === 'aaba' ? 'ABAC' : 'ABABCD' });
    if (form === 'aaba') S.mel.B = genMelody(rng, S, S.bars.filter((b) => b.ci === 0 && b.lab === 'B'), { lo: 63, hi: 82, cells: CELLS.swing });
    S.solo = {}; S.r = rng;
    S.title = rng.pick(NAMES.jazz[0]) + ' ' + rng.pick(NAMES.jazz[1]); S.artist = rng.pick(NAMES.jazz[2]) + ' ' + rng.pick(NAMES.jazz[3]) + ' ' + rng.pick(NAMES.jazz[4]);
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], st = S.st, r = S.r, sec = B.sec, brushes = S.style === 'ballad' && (sec === 'head' || sec === 'out' || sec === 'tag');
    if (brushes) { for (let b = 0; b < 4; b++) out.push(Dm(b, 'brush_swish', 0.35)); out.push(Dm(1, 'brush_tap', 0.4), Dm(3, 'brush_tap', 0.4), Dm(1, 'hat_p', 0.35), Dm(3, 'hat_p', 0.35)); }
    else {
      [[0, 0.6], [1, 0.75], [1.5, 0.45], [2, 0.6], [3, 0.75], [3.5, 0.45]].forEach(([t, v]) => out.push(E(t, 'ride', null, 0, v * 0.55, 'cym', { h: 1 })));
      out.push(Dm(1, 'hat_p', 0.5), Dm(3, 'hat_p', 0.5));
      for (let b = 0; b < 4; b++) out.push(Dm(b, 'kick_soft', 0.13));
      for (let k = 0; k < 8; k++) if (r.chance(0.16)) out.push(Dm(k / 2, 'snare_dry', r.range(0.12, 0.3)));
      if (r.chance(0.08)) out.push(Dm(r.pick([2.5, 3.5]), 'kick_soft', 0.5));
    }
    if (B.cb === 0 && sec !== 'head') out.push(Dm(0, 'crash', 0.3, 'cym'));
    if (sec === 'tag' && B.last) {
      const ch = B.chords[0];
      voicing([ch.pcs[1], ch.pcs[3] ?? ch.pcs[2], pcOf(ch.root + 2), pcOf(ch.root + 9)], 55, 74, st.pv, 4).forEach((m) => out.push(E(0, 'piano', m, 4, 0.45, 'keys', { ring: 1 })));
      out.push(E(0, 'bass_upright', inRange(28 + ch.root, 31, 42), 4, 0.85), E(0.02, 'vibes', inRange(72 + ch.root + 7, 72, 86), 4, 0.5, 'lead'), Dm(0, 'crash', 0.3, 'cym'));
      return out;
    }
    if (brushes && sec !== 'tag') { const c = B.chords[0], c2 = B.chords[1] || c; out.push(E(0, 'bass_upright', nearPc([c.root], st.bass ?? 40, 31, 50), 1.9, 0.8), E(2, 'bass_upright', nearPc([c2 === c ? pcOf(c.root + 7) : c2.root], st.bass ?? 40, 31, 50), 1.9, 0.72)); st.bass = 40; }
    else { const w = walkBar(r, B, B.next, st.bass ?? 40); w.notes.forEach((n) => out.push(E(n.t, 'bass_upright', n.m, n.d, n.v, 'bass', { h: 1 }))); st.bass = w.last; }
    const segs = B.chords.length === 2 ? [[0, 2, B.chords[0]], [2, 2, B.chords[1]]] : [[0, 4, B.chords[0]]];
    const pianoSolo = sec === 'solo2';
    for (const [s, len, ch] of segs) {
      const v = (st.pv = voicing(rootless(ch), 50, 70, st.pv, 4));
      const rh = brushes ? [[s, len]] : r.pick(len === 4 ? [[[s, 1], [s + 1.5, 0.5]], [[s + 0.5, 0.5], [s + 2.5, 1]], [[s + 1.5, 1]], [[s, 2]], [[s + 0.5, 0.5], [s + 2, 1]]] : [[[s, 1]], [[s + 0.5, 0.5]], [[s + 1.5, 0.5]], [[s, 0.5], [s + 1.5, 0.5]]]);
      for (const [t, d] of rh) if (!pianoSolo || r.chance(0.6)) v.forEach((m) => out.push(E(t, 'piano', pianoSolo ? m - 5 : m, d, pianoSolo ? 0.3 : 0.4, 'keys', { h: 1 })));
    }
    if (sec === 'head' || sec === 'out') {
      const mel = S.mel[B.lab], ns = mel && mel[B.lab === 'A' ? B.cb % (S.form === 'aaba' ? 8 : 12) : B.cb - 16];
      if (ns) for (const n of ns) out.push(E(n.t, 'vibes', n.m, n.d, n.v * 0.85, 'lead'));
    } else if (sec === 'solo1' || sec === 'solo2') {
      if (!S.solo[B.ci]) S.solo[B.ci] = genBop(r, S, S.bars.filter((b) => b.ci === B.ci), sec === 'solo1' ? { lo: 60, hi: 86 } : { lo: 62, hi: 88 });
      const ns = S.solo[B.ci][B.cb];
      if (ns) for (const n of ns) out.push(E(n.t, sec === 'solo1' ? 'vibes' : 'piano', n.m, n.d, n.v * 0.8, sec === 'solo1' ? 'lead' : 'solo', { h: 1 }));
    }
    return out;
  },
};

GENRES.rock = {
  fx: { rev: 'room', revAmt: 0.8, fb: 0.25, delayBeats: 0.75, gain: 1.0, ch: { drums: { g: 0.75, rev: 0.12 }, snare: { g: 0.72, rev: 0.22 }, hats: { g: 0.3, pan: 0.25, lp: 9000 }, cym: { g: 0.35, pan: -0.2, rev: 0.1, lp: 9000 }, bass: { g: 0.85 }, gtr: { g: 0.55, rev: 0.08 }, clean: { g: 0.42, pan: -0.2, rev: 0.3, dly: 0.25 }, lead: { g: 0.45, pan: 0.15, rev: 0.25, dly: 0.2 } } },
  jingle: { lead: 'gtr_lead', chord: 'gtr_dist', scale: 'minPent', power: true },
  make(rng) {
    const key = rng.pick([4, 2, 9, 6, 1, 7, 11]), grunge = rng.chance(0.55), bpm = grunge ? rng.int(92, 118) : rng.int(122, 148);
    const V = rng.pick(['i5 i5 bVI5 bVII5', 'i5 bIII5 bVII5 IV5', 'i5 bVII5 bVI5 bVII5', 'i5 iv5 bVI5 bVII5', 'i5 i5 bII5 bII5']);
    const C = rng.pick(['bVI5 bVII5 i5 i5', 'i5 bVI5 bIII5 bVII5', 'IV5 i5 bVI5 bVII5', 'bIII5 bVII5 iv5 bVI5', 'bVI5 bIII5 bVII5 i5']);
    const P = rng.pick(['iv5 iv5 bVI5 bVII5', 'bVI5 bVI5 bVII5 bVII5', 'bIII5 bIII5 iv5 iv5']);
    const S = mkSong({ key, scale: 'minor', bpm, grunge, secs: [['intro', 4, V, 0.6], ['verse', 8, V, 0.5], ['pre', 4, P, 0.75], ['chorus', 8, C, 1], ['verse', 8, V, 0.5], ['pre', 4, P, 0.75], ['chorus', 8, C, 1], ['solo', 8, V, 0.9], ['chorus', 8, C, 1], ['outro', 4, C, 0.8]] });
    const riff = [[0, 'A']]; for (let s = 1; s < 16; s++) if (rng.chance(s % 2 === 0 ? 0.55 : 0.2)) riff.push([s / 4, rng.chance(0.3) ? 'A' : 'm']);
    S.riff = riff; S.arp = Array.from({ length: 8 }, () => rng.int(0, 4));
    S.mel.verse = genMelody(rng, S, secBars(S, 'verse'), { lo: 55, hi: 69, cells: CELLS.vocal, diatonic: true });
    S.mel.chorus = genMelody(rng, S, secBars(S, 'chorus'), { lo: 60, hi: 76, cells: CELLS.vocal, diatonic: true });
    S.mel.solo = genMelody(rng, S, secBars(S, 'solo'), { lo: 62, hi: 86, cells: CELLS.lick, scale: 'minPent', turn: 0.3, diatonic: true });
    nameSong(S, rng, 'rock'); S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], sec = B.sec, st = S.st, r = S.r;
    const loud = sec === 'chorus' || sec === 'solo' || sec === 'outro' || sec === 'intro';
    if (sec === 'outro' && B.last) { out.push(E(0, 'gtr_dist', inRange(38 + c.root, 38, 49), 4, 0.85, 'gtr', { ring: 1 }), Dm(0, 'crash', 0.7, 'cym'), Dm(0, 'kick_rock', 0.9), E(0, 'bass_finger', inRange(28 + c.root, 28, 39), 4, 0.85)); return out; }
    const drums = !(sec === 'intro' && B.i < 2);
    if (drums) {
      if (sec === 'verse') { out.push(Dm(0, 'kick_rock', 0.8), Dm(2.5, 'kick_rock', 0.7), Dm(1, 'snare_rock', 0.7), Dm(3, 'snare_rock', 0.75)); for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.26 : 0.4)); }
      else if (sec === 'pre') {
        out.push(Dm(0, 'kick_rock', 0.85), Dm(2, 'kick_rock', 0.8), Dm(1, 'snare_rock', 0.8), Dm(3, 'snare_rock', 0.8));
        for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', 0.35));
        if (B.last) for (let k = 8; k < 16; k++) out.push(Dm(k / 4, 'snare_rock', 0.35 + (k - 8) * 0.06));
      } else {
        out.push(Dm(0, 'kick_rock', 0.95), Dm(S.grunge ? 1.5 : 0.5, 'kick_rock', 0.7), Dm(2, 'kick_rock', 0.85), Dm(2.5, 'kick_rock', 0.75), Dm(1, 'snare_rock', 0.95), Dm(3, 'snare_rock', 0.95));
        for (let k = 0; k < 8; k++) out.push(Dm(k / 2, sec === 'solo' ? 'ride' : 'hat_o', k % 2 ? 0.25 : 0.35, sec === 'solo' ? 'cym' : 'hats'));
        if (B.i % 2 === 0 && sec !== 'intro') out.push(Dm(0, 'crash', 0.6, 'cym'));
      }
      if (endsSec(B)) ['tom_hi', 'tom_hi', 'tom_mid', 'tom_lo'].forEach((tm, k) => out.push(Dm(3 + k / 4, tm, 0.7 + k * 0.05)));
    }
    if (loud) {
      S.riff.forEach(([t, ty], k) => {
        const ch = chordAt(B, t), rt = inRange(38 + ch.root, 38, 49), nt = k + 1 < S.riff.length ? S.riff[k + 1][0] : 4;
        out.push(ty === 'A' ? E(t, 'gtr_dist', rt, nt - t, 0.8, 'gtr') : E(t, 'gtr_dist_mute', rt, 0.25, 0.62, 'gtr', { h: 1 }));
      });
    } else if (sec === 'pre') {
      const rt = inRange(38 + c.root, 38, 49);
      if (B.last) out.push(E(0, 'gtr_dist', rt, 4, 0.75, 'gtr'));
      else for (let k = 0; k < 8; k++) out.push(E(k / 2, 'gtr_dist_mute', rt, 0.3, k === 0 ? 0.7 : 0.5, 'gtr', { h: 1 }));
    } else {
      const base = inRange(52 + c.root, 52, 63), third = scaleNotes(S.key, 'minor', base + 3, base + 4)[0] ?? base + 3, pool = [base, base + 7, base + 12, base + 14, third + 12];
      S.arp.forEach((ix, k) => out.push(E(k / 2, 'gtr_clean', pool[ix], 1.2, 0.42, 'clean')));
    }
    if (drums) {
      const rt = inRange(28 + c.root, 28, 39);
      if (sec === 'verse') out.push(E(0, 'bass_finger', rt, 1.4, 0.8), E(1.5, 'bass_finger', rt, 0.4, 0.6), E(2, 'bass_finger', rt, 1, 0.72), E(3.5, 'bass_finger', rt, 0.4, 0.6));
      else for (let k = 0; k < 8; k++) { const ch = chordAt(B, k / 2); out.push(E(k / 2, 'bass_finger', inRange(28 + ch.root, 28, 39), 0.45, k === 0 ? 0.85 : 0.72, null, { h: 1 })); }
    }
    const mel = S.mel[sec], ns = mel && mel[B.i % mel.length];
    if (ns) for (const n of ns) { const e = E(n.t, 'gtr_lead', n.m, n.d, n.v * 0.75, 'lead'); if (n.d >= 0.75 && r.chance(sec === 'solo' ? 0.45 : 0.25)) e.sl = { from: n.m - 2, d: 0.2 }; out.push(e); }
    return out;
  },
};

GENRES.hiphop = {
  fx: { rev: 'room', revAmt: 0.7, fb: 0.3, delayBeats: 0.75, gain: 0.95, ch: { drums: { g: 0.85, rev: 0.05 }, hats: { g: 0.38, pan: 0.2 }, cym: { g: 0.3 }, bass: { g: 0.85 }, keys: { g: 0.45, lp: 2600, rev: 0.2, pan: -0.15 }, lead: { g: 0.4, rev: 0.3, dly: 0.25, pan: 0.2 }, pad: { g: 0.32, lp: 1800, rev: 0.4 }, fx: { g: 0.45 } } },
  jingle: { lead: 'bell', chord: 'epiano', scale: 'minPent' },
  make(rng) {
    let S;
    if (!rng.chance(0.45)) {
      const key = rng.pick([9, 0, 2, 5, 7, 4]), P = rng.pick(['i9 iv9', 'i7 bVImaj7 bIIImaj7 bVII', 'i9 i9 bVImaj7 V7', 'i7 iv7 bVII7 bIIImaj7', 'i9 bVII bVImaj7 bVImaj7']);
      S = mkSong({ key, scale: 'minor', bpm: rng.int(84, 96), swing16: rng.range(0.35, 0.6), trap: false, secs: [['intro', 4, P, 0.4], ['verse', 16, P, 0.8], ['hook', 8, P, 1], ['verse', 16, P, 0.8], ['hook', 8, P, 1], ['outro', 4, P, 0.5]] });
      S.kick = rng.pick([[0, 1.75, 2.5], [0, 0.75, 2.5, 3.25], [0, 2.25, 2.75], [0, 1.5, 2.5, 3.75], [0, 0.5, 2.5]]);
      S.keys = rng.pick([[[0, 1.5]], [[0, 1], [2.5, 1]], [[0, 0.75], [0.75, 0.75], [2.5, 1.5]], [[0, 3.5]], [[0.5, 1], [2.75, 1]]]);
      S.hook = genMelody(rng, S, secBars(S, 'hook').slice(0, 4), { lo: 67, hi: 84, cells: CELLS.hook, scale: 'minPent', cadence: false, form: 'AB' });
      S.lead = rng.pick(['vibes', 'bell', 'piano']);
    } else {
      const key = rng.pick([1, 4, 6, 8, 9, 11]), P = rng.pick(['i i bVI bVII', 'i bVI iv V', 'i i bII bII', 'i iv bVI V', 'i bVI bIII bVII']);
      S = mkSong({ key, scale: rng.pick(['harm', 'minor', 'phryg']), bpm: rng.int(132, 150), trap: true, secs: [['intro', 4, P, 0.4], ['verse', 16, P, 0.8], ['hook', 8, P, 1], ['verse', 16, P, 0.8], ['hook', 8, P, 1], ['verse', 8, P, 0.8], ['hook', 8, P, 1], ['outro', 4, P, 0.5]] });
      S.k808 = rng.pick([[[0, 1.5], [1.75, 0.75], [2.5, 1.5]], [[0, 2.5], [2.75, 1.25]], [[0, 0.75], [0.75, 1.25], [2.5, 1], [3.5, 0.5]], [[0, 1.5], [1.5, 1], [3, 1]]]);
      S.hook = genMelody(rng, S, secBars(S, 'hook').slice(0, 4), { lo: 67, hi: 84, cells: CELLS.hook, cadence: false, form: 'AB' });
      S.lead = rng.pick(['bell', 'pluck']);
    }
    nameSong(S, rng, 'hiphop'); S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], sec = B.sec, st = S.st, r = S.r;
    const drums = sec !== 'intro' && !(sec === 'outro' && B.i >= 2);
    const hk = S.hook[B.i % S.hook.length] || [];
    if (!S.trap) {
      if (drums) {
        for (const t of S.kick) out.push(Dm(t, 'kick_boom', t === 0 ? 0.95 : 0.75));
        out.push(Dm(1, 'snare_boom', 0.9), Dm(3, 'snare_boom', 0.9));
        if (r.chance(0.3)) out.push(Dm(3.75, 'snare_boom', 0.25));
        for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.26 : 0.42));
        if (r.chance(0.3)) out.push(Dm(r.pick([1.75, 3.25]), 'hat_c', 0.22));
        if (B.i % 4 === 3) out.push(Dm(3.5, 'hat_o', 0.3));
      }
      out.push(E(0, 'crackle', null, 0, 0.4, 'fx'));
      for (const [t, d] of S.keys) { const ch = chordAt(B, t); (st.kv = voicing(ch.pcs, 55, 72, st.kv, 4)).forEach((m) => out.push(E(t, 'epiano', m, d, 0.5, 'keys'))); }
      if (drums) S.kick.forEach((t, k) => { const ch = chordAt(B, t), nt = k + 1 < S.kick.length ? S.kick[k + 1] : 4; out.push(E(t, 'bass_finger', inRange(28 + ch.root, 28, 40), Math.min(nt - t, 1.5), 0.85)); });
      if (sec === 'hook' || (sec === 'verse' && B.i % 4 === 3)) for (const n of sec === 'hook' ? hk : hk.filter((x) => x.t >= 2)) out.push(E(n.t, S.lead, n.m, n.d, n.v * 0.6, 'lead'));
    } else {
      if (drums) {
        out.push(Dm(2, 'snare_trap', 0.9));
        const roll = B.i % 2 === 1 ? r.pick(['16', 'trip', '32', 'none']) : 'none';
        for (let k = 0; k < 8; k++) if (!(roll !== 'none' && k >= 6)) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.25 : 0.35));
        if (roll !== 'none') { const n = roll === '16' ? 4 : roll === 'trip' ? 6 : 8; for (let k = 0; k < n; k++) out.push(Dm(3 + k / n, 'hat_c', 0.18 + (0.25 * k) / n)); }
        if (r.chance(0.25)) out.push(Dm(1.5, 'hat_o', 0.25));
        S.k808.forEach(([t, d]) => {
          const ch = chordAt(B, t), note = inRange(31 + ch.root, 31, 42), e = E(t, 'kick_808', note, d, 0.9, 'bass');
          if (st.p808 != null && note !== st.p808 && r.chance(0.35)) e.sl = { from: st.p808, d: 0.2 };
          st.p808 = note; out.push(e);
        });
      }
      if (B.i % 2 === 0) (st.pv = voicing(c.pcs, 55, 70, st.pv, 3)).forEach((m) => out.push(E(0, 'pad', m, 7.5, 0.4, 'pad')));
      for (const n of hk) out.push(E(n.t, S.lead, n.m, n.d, n.v * (sec === 'hook' ? 0.6 : 0.4), 'lead'));
    }
    return out;
  },
};

GENRES.oldies = {
  fx: { am: { hp: 350, lp: 3000, drive: 2, hiss: 0.018, post: 0.62 }, rev: 'plate', revAmt: 0.9, fb: 0.18, delayBeats: 0.25, gain: 0.9, ch: { drums: { g: 0.55, rev: 0.15 }, hats: { g: 0.3 }, cym: { g: 0.3 }, bass: { g: 0.8 }, keys: { g: 0.42, rev: 0.2 }, choir: { g: 0.42, rev: 0.45 }, lead: { g: 0.55, rev: 0.3, dly: 0.2 }, gtr: { g: 0.4, rev: 0.15 } } },
  jingle: { lead: 'choir_ah', chord: 'piano', scale: 'majPent' },
  make(rng) {
    let S;
    if (rng.chance(0.5)) {
      const key = rng.pick([0, 7, 5, 10, 3]), V = rng.pick(['I vi IV V', 'I vi ii V']), Br = rng.pick(['IV IV I I II7 II7 V V', 'IV IV iii iii ii ii V7 V7']);
      S = mkSong({ key, scale: 'major', bpm: rng.int(66, 80), doo: true, secs: [['intro', 4, 'I vi IV V', 0.5], ['verse', 8, V, 0.8], ['verse', 8, V, 0.9], ['bridge', 8, Br, 0.9], ['solo', 8, V, 0.9], ['verse', 8, V, 1], ['outro', 4, 'I vi IV I', 0.6]] });
      S.mel.verse = genMelody(rng, S, secBars(S, 'verse'), { lo: 60, hi: 76, cells: CELLS.ballad });
      S.mel.bridge = genMelody(rng, S, secBars(S, 'bridge'), { lo: 62, hi: 77, cells: CELLS.ballad });
      S.mel.solo = genMelody(rng, S, secBars(S, 'solo'), { lo: 58, hi: 77, cells: CELLS.vocal });
    } else {
      const key = rng.pick([0, 7, 9, 2, 4]), B12 = 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7';
      S = mkSong({ key, scale: 'mixo', bpm: rng.int(150, 176), swing: rng.range(0.55, 0.8), doo: false, secs: [['intro', 4, 'V7 IV7 I7 V7', 0.7], ['verse', 12, B12, 0.9], ['verse', 12, B12, 0.9], ['solo', 12, B12, 1], ['verse', 12, B12, 0.9], ['solo2', 12, B12, 1], ['verse', 12, B12, 1], ['outro', 2, 'I7 I7', 0.8]] });
      S.mel.verse = genMelody(rng, S, secBars(S, 'verse'), { lo: 60, hi: 77, cells: CELLS.vocal, form: 'ABABCD' });
      S.mel.solo = genMelody(rng, S, secBars(S, 'solo'), { lo: 58, hi: 79, cells: CELLS.lick, scale: 'blues', form: 'AAAABC' });
      S.mel.solo2 = genMelody(rng, S, secBars(S, 'solo2'), { lo: 67, hi: 88, cells: CELLS.lick, scale: 'blues' });
    }
    nameSong(S, rng, 'oldies'); S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], sec = B.sec, st = S.st;
    if (S.doo) {
      for (let b = 0; b < 4; b++) for (let k = 0; k < 3; k++) { const t = b + k / 3, ch = chordAt(B, t); (st.pv = voicing(ch.pcs, 58, 72, st.pv, 3)).forEach((m) => out.push(E(t, 'piano', m, 0.3, k ? 0.2 : 0.3, 'keys'))); }
      if (sec !== 'solo') (st.cv = voicing(c.pcs, 57, 72, st.cv, 3)).forEach((m) => out.push(E(0, 'choir_oo', m, 3.9, 0.35, 'choir')));
      const rt = inRange(36 + c.root, 33, 44);
      [[0, 0], [1, 7], [2, 9], [3, 7]].forEach(([t, iv]) => out.push(E(t, 'bass_upright', rt + iv, 0.9, t ? 0.68 : 0.8, null, { h: 1 })));
      out.push(Dm(0, 'kick_soft', 0.5), Dm(2, 'kick_soft', 0.4), Dm(1, 'snare_dry', 0.55), Dm(3, 'snare_dry', 0.55));
      for (let k = 0; k < 12; k++) out.push(Dm(k / 3, 'shaker', k % 3 ? 0.1 : 0.16));
      const mel = S.mel[sec], ns = mel && mel[B.i % mel.length];
      if (ns) for (const n of ns) out.push(E(n.t, sec === 'solo' ? 'sax' : 'choir_ah', n.m, n.d, n.v * 0.7, 'lead', n.d >= 1 ? { sl: { from: n.m - 1, d: 0.2 } } : {}));
      if (sec === 'outro' && B.last) { out.length = 0; voicing(c.pcs, 55, 72, null, 4).forEach((m) => out.push(E(0, 'piano', m, 4, 0.5, 'keys', { ring: 1 }), E(0, 'choir_oo', m, 4, 0.35, 'choir'))); }
    } else {
      if (sec === 'outro' && B.last) { voicing(c.pcs, 55, 72, null, 4).forEach((m) => out.push(E(0, 'piano', m, 4, 0.5, 'keys', { ring: 1 }))); out.push(Dm(0, 'crash', 0.6, 'cym'), Dm(0, 'kick_rock', 0.8), E(0, 'bass_upright', inRange(36 + c.root, 33, 44), 2, 0.8)); return out; }
      out.push(Dm(0, 'kick_rock', 0.75), Dm(2, 'kick_rock', 0.7), Dm(1, 'snare_rock', 0.8, 'drums'), Dm(3, 'snare_rock', 0.8, 'drums'));
      for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'ride', k % 2 ? 0.25 : 0.35, 'cym'));
      if (B.first && sec !== 'intro') out.push(Dm(0, 'crash', 0.5, 'cym'));
      for (let k = 0; k < 8; k++) { const ch = chordAt(B, k / 2), rt = inRange(36 + ch.root, 33, 44); out.push(E(k / 2, 'bass_upright', rt + [0, 4, 7, 9, 10, 9, 7, 4][k], 0.45, k % 2 ? 0.62 : 0.78, null, { h: 1 })); }
      for (let b = 0; b < 4; b++) { const ch = chordAt(B, b), g = inRange(40 + ch.root, 40, 51); out.push(E(b, 'gtr_clean', g, 0.45, 0.4, 'gtr'), E(b, 'gtr_clean', g + 7, 0.45, 0.35, 'gtr'), E(b + 0.5, 'gtr_clean', g, 0.45, 0.32, 'gtr'), E(b + 0.5, 'gtr_clean', g + 9, 0.45, 0.3, 'gtr')); }
      if (sec !== 'solo2') for (const t of [0.5, 1.5, 2.5, 3.5]) { const ch = chordAt(B, t); (st.pv = voicing(ch.pcs, 64, 79, st.pv, 3)).forEach((m) => out.push(E(t, 'piano', m, 0.35, 0.24, 'keys'))); }
      const mel = S.mel[sec], ns = mel && mel[B.i % mel.length];
      if (ns) for (const n of ns) out.push(E(n.t, sec === 'solo2' ? 'piano' : 'sax', n.m, n.d, n.v * (sec === 'solo2' ? 0.55 : 0.7), 'lead', n.d >= 1 && sec !== 'solo2' ? { sl: { from: n.m - 1, d: 0.15 } } : {}));
    }
    return out;
  },
};

GENRES.synth = {
  fx: { rev: 'hall', revAmt: 1, fb: 0.38, delayBeats: 0.75, gain: 1.0, ch: { drums: { g: 0.75, rev: 0.1 }, snare: { g: 0.65, rev: 0.7 }, hats: { g: 0.33, pan: 0.2 }, cym: { g: 0.38, rev: 0.3 }, bass: { g: 0.7 }, arp: { g: 0.33, dly: 0.45, rev: 0.2, pan: -0.2 }, pad: { g: 0.4, rev: 0.5 }, lead: { g: 0.42, rev: 0.35, dly: 0.3, pan: 0.1 }, keys: { g: 0.45, rev: 0.25 } } },
  jingle: { lead: 'lead', chord: 'pad', scale: 'minor' },
  make(rng) {
    let S;
    if (!rng.chance(0.45)) {
      const key = rng.pick([9, 4, 2, 6, 1, 0]), P = rng.pick(['i bVI bIII bVII', 'i bVII bVI bVII', 'i iv bVI bVII', 'bVI bVII i i', 'i bIII bVII bVI']);
      S = mkSong({ key, scale: 'minor', bpm: rng.int(96, 118), house: false, secs: [['intro', 8, P, 0.4], ['verse', 8, P, 0.7], ['chorus', 8, P, 1], ['verse', 8, P, 0.7], ['chorus', 8, P, 1], ['bridge', 8, P, 0.5], ['chorus', 8, P, 1], ['outro', 8, P, 0.4]] });
      S.arp = rng.pick([[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 0, 2, 1, 3], [0, 1, 2, 3, 4, 3, 2, 1], [0, 0, 2, 1, 3, 1, 2, 1]]);
      S.mel.verse = genMelody(rng, S, secBars(S, 'verse'), { lo: 62, hi: 76, cells: CELLS.synth });
      S.mel.chorus = genMelody(rng, S, secBars(S, 'chorus'), { lo: 67, hi: 81, cells: CELLS.synth });
    } else {
      const key = rng.pick([9, 2, 7, 5, 0]), P = rng.pick(['i7 iv7', 'i9 i9 bVII bVII', 'i7 bVImaj7 bVII i7', 'iv9 iv9 i9 i9', 'i9 v7']);
      S = mkSong({ key, scale: 'dorian', bpm: rng.int(120, 126), house: true, secs: [['intro', 8, P, 0.4], ['A', 16, P, 0.8], ['break', 8, P, 0.5], ['B', 16, P, 1], ['A', 8, P, 0.8], ['outro', 8, P, 0.4]] });
      S.stab = rng.pick([[[0, 0.5], [0.75, 0.25], [2.5, 0.5]], [[0.5, 0.5], [1.5, 0.5], [3, 0.25], [3.5, 0.5]], [[0, 0.25], [1.75, 0.25], [2.5, 0.5], [3.25, 0.25]], [[0.75, 0.5], [2.75, 0.5]]]);
      S.stabI = rng.pick(['piano', 'organ', 'epiano']);
      S.hook = genMelody(rng, S, secBars(S, 'B').slice(0, 4), { lo: 67, hi: 84, cells: CELLS.hook, scale: 'minPent', cadence: false, form: 'AB' });
    }
    nameSong(S, rng, 'synth'); S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], sec = B.sec, st = S.st;
    if (!S.house) {
      const full = sec === 'chorus', drums = sec === 'verse' || sec === 'chorus';
      if (drums) {
        out.push(Dm(0, 'kick_house', 0.9), Dm(2, 'kick_house', 0.85), Dm(1, 'snare_rock', 0.8, 'snare'), Dm(3, 'snare_rock', 0.8, 'snare'));
        if (full) out.push(Dm(1, 'kick_house', 0.8), Dm(3, 'kick_house', 0.8));
        for (let k = 0; k < (full ? 16 : 8); k++) out.push(Dm(k / (full ? 4 : 2), 'hat_c', k % 2 ? 0.18 : 0.3));
        if (B.first && full) out.push(Dm(0, 'crash', 0.55, 'cym'));
        if (endsSec(B)) ['tom_hi', 'tom_hi', 'tom_mid', 'tom_lo'].forEach((tm, k) => out.push(Dm(3 + k / 4, tm, 0.65)));
      } else if (sec === 'bridge' && B.i >= 4) out.push(Dm(0, 'kick_house', 0.6), Dm(2, 'kick_house', 0.5));
      const rt = inRange(33 + c.root, 31, 42);
      if (sec === 'bridge' || (sec === 'intro' && B.i < 4) || (sec === 'outro' && B.i >= 4)) out.push(E(0, 'sbass', rt, 3.8, 0.4));
      else for (let k = 0; k < 8; k++) out.push(E(k / 2, 'sbass', k % 2 ? rt + 12 : rt, 0.42, k % 2 ? 0.45 : 0.55));
      const tri = (st.av = voicing(c.pcs.slice(0, 3), 60, 72, st.av, 3)), pool = [...tri, tri[0] + 12, tri[1] + 12];
      for (let k = 0; k < 16; k++) out.push(E(k / 4, 'arp', pool[S.arp[k % 8] % pool.length], 0.25, k % 4 === 0 ? 0.7 : 0.5));
      (st.pv = voicing(c.pcs, 52, 71, st.pv, 4)).forEach((m) => out.push(E(0, 'pad', m, 4, 0.5)));
      const mel = S.mel[sec], ns = mel && mel[B.i % mel.length];
      if (ns) ns.forEach((n, k) => { const e = E(n.t, 'lead', n.m, n.d, n.v * 0.7); const p = k ? ns[k - 1] : null; if (p && Math.abs(p.m - n.m) <= 4 && p.t + p.d >= n.t - 0.01) e.sl = { from: p.m, d: 0.08 }; out.push(e); });
    } else {
      const drums = sec !== 'break', kick = drums && !(sec === 'intro' && B.i < 2);
      if (kick) for (let b = 0; b < 4; b++) out.push(Dm(b, 'kick_house', 0.9));
      if (drums) {
        if (sec !== 'intro') out.push(Dm(1, 'clap', 0.7), Dm(3, 'clap', 0.7));
        for (let b = 0; b < 4; b++) out.push(Dm(b + 0.5, 'hat_o', 0.28));
        for (let k = 0; k < 16; k++) out.push(Dm(k / 4, 'shaker', k % 2 ? 0.1 : 0.15));
        if (sec === 'B') for (let b = 0; b < 4; b++) out.push(Dm(b, 'ride', 0.18, 'cym'));
        if (B.first && (sec === 'A' || sec === 'B')) out.push(Dm(0, 'crash', 0.5, 'cym'));
      }
      const rt = inRange(31 + c.root, 31, 42);
      if (sec === 'A' || sec === 'B' || sec === 'outro') for (const t of [0.5, 1.5, 2.5, 3.5]) out.push(E(t, 'sbass', t === 3.5 && B.i % 2 ? rt + 12 : rt, 0.35, 0.6));
      if (sec !== 'intro' && sec !== 'outro') for (const [t, d] of S.stab) { const ch = chordAt(B, t); (st.kv = voicing(ch.pcs, 55, 72, st.kv, 4)).forEach((m) => out.push(E(t, S.stabI, m, d, sec === 'break' ? 0.3 : 0.45, 'keys'))); }
      if (sec === 'break') (st.pv = voicing(c.pcs, 52, 71, st.pv, 4)).forEach((m) => out.push(E(0, 'pad', m, 4, 0.5)));
      if (sec === 'B') for (const n of S.hook[B.i % S.hook.length] || []) out.push(E(n.t, 'pluck', n.m, n.d, n.v * 0.6, 'lead'));
    }
    return out;
  },
};

GENRES.scanner = {
  fx: { am: { hp: 300, lp: 3000, drive: 2.5, hiss: 0.006, post: 0.5 }, rev: 'room', revAmt: 0.05, fb: 0, gain: 0.45, ch: { fx: { g: 0.8 } } },
  jingle: null,
  make(rng) { const S = mkSong({ key: 0, scale: 'major', bpm: 60, secs: [['scan', 40, 'I', 1]] }); S.title = 'Live dispatch'; S.artist = 'Metro dispatch (simulated)'; S.r = rng; return S; },
  bar(S) {
    const r = S.r, out = [], st = S.st, t0 = Math.max(0, (st.busy || 0) - 4);
    st.busy = 0;
    if (r.chance(0.72)) {
      const t = t0 + r.range(0, 1.2), len = r.range(1.4, 2.8), te = t + 0.1 + len;
      out.push({ t, i: 'scan_fx', n: 0, d: 0.2, v: 0.7, ch: 'fx' }, { t, i: 'scan_fx', n: 3, d: len + 0.1, v: 0.35, ch: 'fx' }, { t: t + 0.08, i: 'scan_vox', n: r.int(0, 7), d: len, v: 0.9, ch: 'fx' });
      if (r.chance(0.3)) out.push({ t: te, i: 'tone', m: 84, d: 0.12, v: 0.25, ch: 'fx' });
      out.push({ t: te + 0.05, i: 'scan_fx', n: 1, d: 0.3, v: 0.6, ch: 'fx' });
      st.busy = te + 0.6;
    } else if (r.chance(0.15)) out.push({ t: t0 + 0.5, i: 'tone', m: r.int(76, 82), d: 0.9, v: 0.3, ch: 'fx' }, { t: t0 + 1.45, i: 'tone', m: r.int(70, 79), d: 1.8, v: 0.3, ch: 'fx' });
    else if (r.chance(0.2)) out.push({ t: t0 + r.range(0, 2), i: 'fsk', d: 0.6, v: 0.5, ch: 'fx' });
    else if (r.chance(0.3)) out.push({ t: t0 + r.range(0, 3), i: 'scan_fx', n: 2, d: 0.5, v: 0.4, ch: 'fx' });
    return out;
  },
};
INST.scan_fx.damp = 0.02; INST.scan_vox.damp = 0.03;

// ---- title theme: moody twang-synth crime drama, E minor ----
const TITLE_A = [
  [[0, 52, 1.5], [1.5, 55, 0.5], [2, 59, 1], [3, 57, 0.5], [3.5, 55, 0.5]],
  [[0, 54, 1], [1, 52, 1], [2, 47, 2]],
  [[0, 48, 1.5], [1.5, 52, 0.5], [2, 55, 1], [3, 59, 1]],
  [[0, 57, 1.5], [1.5, 55, 0.5], [2, 52, 2]],
  [[0, 57, 1], [1, 60, 1], [2, 64, 1.5], [3.5, 62, 0.5]],
  [[0, 60, 1], [1, 59, 0.5], [1.5, 57, 0.5], [2, 52, 2]],
  [[0, 63, 1.5], [1.5, 66, 0.5], [2, 69, 1], [3, 66, 1]],
  [[0, 59, 2.5], [3, 47, 0.5], [3.5, 51, 0.5]],
];
const TITLE_B = [
  [[0, 67, 1], [1, 72, 1], [2, 71, 1], [3, 67, 1]],
  [[0, 69, 1.5], [1.5, 66, 0.5], [2, 62, 2]],
  [[0, 64, 0.5], [0.5, 67, 0.5], [1, 71, 1], [2, 76, 2]],
  [[0, 74, 1], [1, 71, 1], [2, 67, 1], [3, 64, 1]],
  [[0, 72, 1.5], [1.5, 71, 0.5], [2, 69, 1], [3, 64, 1]],
  [[0, 67, 1], [1, 69, 1], [2, 71, 1], [3, 72, 1]],
  [[0, 75, 2], [2, 71, 1], [3, 69, 1]],
  [[0, 66, 1], [1, 63, 1], [2, 59, 2]],
];
GENRES.title = {
  fx: { rev: 'spring', revAmt: 1, fb: 0.35, delayBeats: 0.75, gain: 1.05, ch: { twang: { g: 0.6, rev: 0.55, dly: 0.25, trem: [6.5, 0.5] }, pad: { g: 0.5, rev: 0.45 }, bass: { g: 0.7 }, drums: { g: 0.6, rev: 0.2 }, snare: { g: 0.55, rev: 0.6 }, hats: { g: 0.28, pan: 0.3 }, cym: { g: 0.35, rev: 0.3 }, lead: { g: 0.38, rev: 0.5, dly: 0.35 }, bell: { g: 0.22, rev: 0.6, dly: 0.4, pan: -0.3 } } },
  make() {
    const A = 'i i bVI bVI iv iv V7 V7', Bp = 'bVI bVII i i iv bVI V7 V7';
    const S = mkSong({ key: 4, scale: 'harm', bpm: 80, secs: [['intro', 4, 'i i bVI bVI', 0.4], ['A1', 8, A, 0.6], ['A2', 8, A, 0.8], ['B', 8, Bp, 1], ['A3', 8, A, 1], ['outro', 4, 'i i bVI V7', 0.5]] });
    S.title = 'Theme from Tulsa Overhead'; S.artist = 'Main titles';
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], sec = B.sec, st = S.st;
    (st.pv = voicing(c.pcs, 52, 67, st.pv, 4)).forEach((m) => out.push(E(0, 'pad_dark', m, 4, 0.5, 'pad')));
    const rt = inRange(28 + c.root, 28, 39);
    if (sec === 'intro' || sec === 'outro') out.push(E(0, 'bass_finger', rt, 1.8, 0.8, 'bass'), E(2, 'bass_finger', rt, 1.8, 0.6, 'bass'));
    else for (let k = 0; k < 8; k++) out.push(E(k / 2, 'bass_finger', rt, 0.45, k % 2 ? 0.45 : 0.7, 'bass'));
    if (sec === 'A2' || sec === 'B' || sec === 'A3') {
      out.push(Dm(0, 'kick_boom', 0.8, 'drums'), Dm(1.75, 'kick_boom', 0.45, 'drums'), Dm(2.5, 'kick_boom', 0.7, 'drums'));
      const sn = sec === 'A2' ? 'rim' : 'snare_rock';
      out.push(Dm(1, sn, 0.6, sec === 'A2' ? 'drums' : 'snare'), Dm(3, sn, 0.65, sec === 'A2' ? 'drums' : 'snare'));
      for (let k = 0; k < 8; k++) out.push(Dm(k / 2, 'hat_c', k % 2 ? 0.12 : 0.2, 'hats'));
      if (B.first && sec !== 'A2') out.push(Dm(0, 'crash', 0.45, 'cym'));
    } else if (sec === 'A1') out.push(Dm(3, 'rim', 0.35, 'drums'));
    if (sec === 'A1' || sec === 'A2' || sec === 'A3') {
      for (const [t, m, d] of TITLE_A[B.i]) out.push(E(t, 'gtr_twang', m, d, 0.75, 'twang', d >= 1.5 ? { sl: { from: m - 1, d: 0.15 } } : {}));
      if (sec === 'A3') for (const [t, m, d] of TITLE_A[B.i]) out.push(E(t, 'lead', m + 12, d, 0.3, 'lead'));
    }
    if (sec === 'B') {
      for (const [t, m, d] of TITLE_B[B.i]) out.push(E(t, 'lead', m, d, 0.6, 'lead'));
      if (B.i % 2 === 1) out.push(E(3.5, 'gtr_twang', inRange(40 + c.root, 40, 51), 0.5, 0.6, 'twang'));
    }
    if (sec === 'A2' || sec === 'A3' || sec === 'B') { const tri = voicing(c.pcs.slice(0, 3), 76, 88, null, 3); [[0, tri[0]], [1.5, tri[1]], [3, tri[2]]].forEach(([t, m]) => out.push(E(t, 'bell', m, 1, 0.3, 'bell'))); }
    if (sec === 'outro' && B.last) out.push(E(0, 'gtr_twang', 40, 4, 0.7, 'twang', { ring: 1 }));
    return out;
  },
};

// ---- adaptive action score: layers L0..L3 follow setMusicIntensity ----
GENRES.score = {
  fx: { rev: 'hall', revAmt: 0.8, fb: 0.3, delayBeats: 0.75, gain: 1.05, layers: [['L0', -1, 0], ['L1', 0.15, 0.35], ['L2', 0.45, 0.65], ['L3', 0.75, 0.9]],
    ch: { L0: { g: 0.6, rev: 0.3 }, L1: { g: 0.6, rev: 0.2, dly: 0.15 }, L2: { g: 0.75, rev: 0.1 }, L3: { g: 0.6, rev: 0.3, dly: 0.2 } } },
  make(rng) {
    const S = mkSong({ key: 2, scale: 'minor', bpm: 132, secs: [['loop', 8, 'i i bVI bVI iv iv V V', 1], ['loop2', 8, 'i bVII bVI V i bVII bVI V', 1]] });
    S.hook = genMelody(new RNG(4242), S, S.bars.slice(0, 8), { lo: 62, hi: 77, cells: CELLS.hook, cadence: false, form: 'ABAC' });
    S.title = 'Mission'; S.artist = 'Score'; S.r = rng;
    return S;
  },
  bar(S, i) {
    const B = S.bars[i], out = [], c = B.chords[0], st = S.st, rt = inRange(26 + c.root, 26, 37);
    (st.pv = voicing(c.pcs, 50, 65, st.pv, 3)).forEach((m) => out.push(E(0, 'pad_dark', m, 4, 0.32, 'L0')));
    for (let k = 0; k < 8; k++) out.push(E(k / 2, 'sbass', rt, 0.4, k % 2 ? 0.2 : 0.3, 'L0'));
    for (let k = 0; k < 16; k++) out.push(Dm(k / 4, 'hat_c', k % 4 === 0 ? 0.22 : 0.11, 'L1'));
    const os = [rt + 24, rt + 31, rt + 36, rt + 31];
    for (let k = 0; k < 8; k++) out.push(E(k / 2, 'arp', os[k % 4], 0.25, 0.5, 'L1'));
    out.push(Dm(0, 'tom_lo', 0.6, 'L1'));
    out.push(Dm(0, 'kick_rock', 0.9, 'L2'), Dm(1.5, 'kick_rock', 0.75, 'L2'), Dm(2, 'kick_rock', 0.85, 'L2'), Dm(3.5, 'kick_rock', 0.7, 'L2'), Dm(1, 'snare_rock', 0.85, 'L2'), Dm(3, 'snare_rock', 0.85, 'L2'));
    for (let k = 0; k < 8; k++) out.push(E(k / 2, 'gtr_dist_mute', inRange(38 + c.root, 38, 49), 0.3, k === 0 ? 0.65 : 0.5, 'L2', { h: 1 }));
    if (B.i % 4 === 0) out.push(Dm(0, 'crash', 0.5, 'L2'));
    for (const n of S.hook[B.i % 8] || []) out.push(E(n.t, 'lead', n.m, n.d, n.v * 0.65, 'L3'));
    for (const t of [0, 2.5]) (st.sv = voicing(c.pcs, 57, 72, st.sv, 3)).forEach((m) => out.push(E(t, 'stab', m, 0.3, 0.5, 'L3')));
    for (let b = 0; b < 4; b++) out.push(Dm(b + 0.5, 'hat_o', 0.18, 'L3'));
    if (B.i % 4 === 2) out.push(Dm(0, 'crash', 0.3, 'L3'));
    return out;
  },
};

// ---- station-ID jingles: a fixed short motif per station ----
const JINGLE = {
  bar(S, i) {
    const out = [], cf = S.cfg;
    if (i === 0) {
      out.push({ t: 0, i: 'whoosh', v: 0.45, ch: 'fx' });
      for (const [t, m, d] of S.motif) out.push(E(t + 0.5, cf.lead, m, d, 0.7, 'lead'));
    } else if (i === 1) {
      const ch = S.chord, notes = cf.power ? [inRange(38 + ch.root, 38, 49)] : voicing(ch.pcs, 55, 72, null, 4);
      for (const m of notes) out.push(E(0, cf.chord, m, 3.5, 0.45, 'keys', { ring: 1 }));
      out.push(E(0, cf.lead, S.motif[S.motif.length - 1][1] + 12, 3, 0.4, 'lead'), { t: 0, i: 'crash', v: 0.3, ch: 'cym' });
    }
    return out;
  },
};
function makeJingle(genre, station) {
  const cf = GENRES[genre] && GENRES[genre].jingle; if (!cf) return null;
  const rng = new RNG(hashStr(station ? station.id : genre) ^ 0xabc), key = rng.pick([0, 2, 5, 7, 9]);
  const sc = scaleNotes(key, cf.scale || 'majPent', 62, 81), motif = [];
  let t = 0, ix = nearestIdx(sc, 67 + rng.int(0, 5)); const n = rng.int(4, 6);
  for (let k = 0; k < n; k++) {
    const d = k === n - 1 ? 1.5 : rng.pick([0.25, 0.5, 0.5, 0.75]);
    motif.push([t, sc[clamp(ix, 0, sc.length - 1)], d]); t += d; ix += rng.pick([-2, -1, 1, 1, 2, 3]);
  }
  const last = motif[motif.length - 1]; last[1] = nearPc([key, pcOf(key + 7)], last[1], 62, 84);
  return { jingle: true, G: JINGLE, genre, bpm: 120, bpb: 4, bars: [{}, {}], motif, chord: chord(key, cf.scale === 'minor' || cf.scale === 'minPent' ? 'i' : 'I'), cfg: cf, title: station ? station.name : 'Station ID', artist: 'Station ID', dur: 4, songN: -1 };
}

// =============================================================== RADIO ====
const STATIONS = [
  { id: 'krdr', name: 'KRDR 98.6 Red Dirt Radio', freq: '98.6 FM', genre: 'country', desc: 'Red-dirt country and Okie twang: pedal steel, Telecaster licks and two-step drums.' },
  { id: 'tulsasound', name: 'The Tulsa Sound 101.1', freq: '101.1 FM', genre: 'tulsa', desc: 'Laid-back shuffle blues-rock: muted-guitar riffs, lazy snare and tremolo keys.' },
  { id: 'greenwood', name: 'Greenwood Jazz 88.3', freq: '88.3 FM', genre: 'jazz', desc: 'Swing and bebop combos with walking bass, ride cymbal, vibes and piano.' },
  { id: 'kdrl', name: 'KDRL Driller Rock 104.5', freq: '104.5 FM', genre: 'rock', desc: '90s alternative and grunge: quiet verses, loud distorted choruses.' },
  { id: 'prairie', name: 'Prairie Beats 93.9', freq: '93.9 FM', genre: 'hiphop', desc: 'Boom-bap and trap instrumentals from the 918.' },
  { id: 'route66', name: 'Route 66 Oldies 1330 AM', freq: '1330 AM', genre: 'oldies', desc: 'Doo-wop and rock & roll from the Mother Road, in authentic AM mono.' },
  { id: 'neonokie', name: 'Neon Okie FM 107.7', freq: '107.7 FM', genre: 'synth', desc: 'Synthwave and deep house for night drives down the expressway.' },
  { id: 'scanner', name: 'Police Scanner 154.4', freq: '154.4 MHz', genre: 'scanner', desc: 'Metro police and fire dispatch chatter. Unintelligible, as usual.' },
];

class Radio {
  constructor(sys) {
    this.sys = sys; this.stations = STATIONS.map((s) => ({ ...s })); this.current = -1; this.player = null; this.inCar = true;
    this.nowPlaying = null; this._cbs = new Set();
    const salt = (Math.random() * 1e9) | 0;
    this._virt = this.stations.map((s) => ({ seed: (hashStr(s.id) ^ salt) >>> 0, songN: 0, song: null, start: 0 }));
  }
  get station() { return this.current >= 0 ? this.stations[this.current] : null; }
  onChange(cb) { this._cbs.add(cb); return () => this._cbs.delete(cb); }
  _emit() {
    const info = { index: this.current, station: this.station, nowPlaying: this.nowPlaying };
    for (const cb of this._cbs) { try { cb(info); } catch (e) { console.warn('[audio] radio onChange', e); } }
  }
  play(i = 0) {
    const n = this.stations.length; i = ((Math.round(i) % n) + n) % n;
    const sys = this.sys, ctx = sys.ctx;
    if (ctx && i === this.current && this.player && !this.player.stopped) return this; // already on it
    this.current = i;
    if (!ctx) { this._emit(); return this; }
    this._stopPlayer(0.12);
    sys.play('radio_tune', { bus: 'radio', rand: 0.1 });
    const st = this.stations[i], v = this._virt[i], now = ctx.currentTime;
    if (!v.song) { v.song = SeqPlayer.make(st.genre, v.seed, v.songN, st); v.start = now - Math.random() * v.song.dur * 0.6; }
    let guard = 0;
    while (now > v.start + v.song.dur + 1.5 && guard++ < 50) { v.start += v.song.dur + 1.5; v.songN++; v.song = SeqPlayer.make(st.genre, v.seed, v.songN, st); }
    const barDur = (v.song.bpb * 60) / v.song.bpm, bar = Math.max(0, Math.floor((now - v.start) / barDur));
    const p = (this.player = new SeqPlayer(sys, ctx, sys.radioIn, st.genre, {
      seed: v.seed, songN: v.songN, station: st,
      onSong: (s, t0) => {
        if (!s.jingle) { v.song = s; v.songN = s.songN; v.start = t0; }
        this.nowPlaying = { title: s.title || '', artist: s.artist || '', jingle: !!s.jingle, bpm: s.bpm, key: s.key != null ? NOTE_NAMES[s.key] : '', style: s.style || (s.trap ? 'trap' : s.house ? 'house' : s.doo ? 'doo-wop' : '') };
        if (this.player === p || !this.player) this._emit();
      },
    }));
    sys._players.add(p);
    p.start(now + 0.15, v.song, bar);
    p.pump(now + 0.4);
    this._emit();
    return this;
  }
  next() { return this.play(this.current < 0 ? 0 : this.current + 1); }
  prev() { return this.play(this.current < 0 ? this.stations.length - 1 : this.current - 1); }
  off() { this._stopPlayer(0.25); this.current = -1; this.nowPlaying = null; this._emit(); return this; }
  setInCar(b) { this.inCar = !!b; this.sys._carFilter(this.inCar); return this; }
  _stopPlayer(fade) { if (this.player) { this.player.stop(fade); this.sys._players.delete(this.player); this.player = null; } }
}

// A decoded line can occupy several megabytes at the output sample rate.
const MAX_CACHED_VOICES = 24;
const VOICE_PRIORITY = { radio: 0, dispatch: 1, dialogue: 2 };

// ============================================================ AUDIO SYS ====
export class AudioSys {
  constructor() {
    this.ctx = null; this.ready = false; this.baked = false;
    this._sampleJobs = new Map();
    this._soundJobs = new Map();
    this._waitingShots = new Map();
    this.volumes = { master: 0.9, sfx: 1, music: 0.7, voice: 1, radio: 0.75 };
    this.muted = false;
    this.listener = { x: 0, y: 0, zoom: 1, vx: 0, vy: 0, _t: 0 };
    this.buffers = {}; this.maxEngines = 7; this.maxOneShots = 48;
    this._engines = new Set(); this._sirens = new Set(); this._loops = new Set(); this._players = new Set();
    this._active = new Map(); this._all = []; this._lastTick = 0; this._lastCull = 0;
    this.radio = new Radio(this);
    this.music = null; this.musicName = null; this.musicIntensity = 0.35;
    this._voice = null; this._voicePaused = false; this._voiceCache = new Map();
    this.stats = {};
  }
  // ---- catalogue ----
  get soundNames() { return Object.keys(SFX).filter((n) => !SFX[n].internal); }
  get engineProfiles() { return Object.keys(ENGINE_PROFILES); }
  get loopNames() { return Object.keys(LOOP_DEFS); }
  get sirenTypes() { return Object.keys(SIRENS); }
  get stations() { return this.radio.stations; }

  // ---- lifecycle ----
  init({ onDemand = false } = {}) {
    if (!this._initP) {
      this.onDemand = onDemand;
      this._initP = this._init();
    }
    return this._initP;
  }
  async _init() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) throw new Error('Web Audio not supported');
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const resume = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
    resume();
    if (typeof window !== 'undefined') for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, resume, { passive: true });
    this._buildGraph();
    this.ready = true;
    const t0 = nowMs();
    if (this.onDemand) await this._loadSound('ui_click').catch(e => console.warn('[audio] UI sound unavailable', e));
    else await this._bakeAll();
    this.baked = true; this.stats.bakeMs = Math.round(nowMs() - t0);
    this._startTimers();
    for (const s of this._sirens) s._ensure();
    for (const l of this._loops) l._ensure();
    this._updateEngines();
    if (this.radio.current >= 0 && !this.radio.player) { const c = this.radio.current; this.radio.current = -1; this.radio.play(c); }
    if (this._pendingMusic) { const m = this._pendingMusic; this._pendingMusic = null; this.playMusic(m); }
    if (!this.onDemand) setTimeout(() => this._idleBake(), 200);
    return this;
  }
  _buildGraph() {
    const ctx = this.ctx, G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.master = G(); this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 12; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
    this.master.connect(this.limiter).connect(ctx.destination);
    this.sfxVol = G(); this.sfxDuck = G(); this.sfxVol.connect(this.sfxDuck).connect(this.master);
    this.sfxBus = G(); this.sfxBus.connect(this.sfxVol);
    this.engBus = G(); this.sirenBus = G(); this.ambBus = G();
    for (const b of [this.engBus, this.sirenBus, this.ambBus]) b.connect(this.sfxBus);
    this.musicIn = G(); this.musicVol = G(); this.musicDuck = G();
    this.musicIn.connect(this.musicVol).connect(this.musicDuck).connect(this.master);
    this.radioIn = G(); this.radioVol = G(); this.radioDuck = G();
    const F = (type, f, q = 0.7, db = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = db; return b; };
    this.car = [F('highpass', 20), F('peaking', 120, 1, 0), F('peaking', 2500, 1, 0), F('lowpass', 20000)];
    this.radioIn.connect(this.car[0]).connect(this.car[1]).connect(this.car[2]).connect(this.car[3]).connect(this.radioVol).connect(this.radioDuck).connect(this.master);
    this.voiceVol = G(); this.voiceVol.connect(this.master);
    this.announcerVol = G(); this.announcerVol.connect(this.voiceVol);
    this._applyVolumes(true);
    this._carFilter(this.radio.inCar);
  }
  _startTimers() {
    const tick = () => {
      this._schedTimer = setTimeout(tick, this._players.size ? 25 : 200);
      const la = typeof document !== 'undefined' && document.hidden ? 1.2 : 0.2, until = this.ctx.currentTime + la;
      for (const p of this._players) p.pump(until);
    };
    tick();
    this._tickTimer = setInterval(() => this._tick(true), 120);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { const until = this.ctx.currentTime + (document.hidden ? 1.5 : 0.2); for (const p of this._players) p.pump(until); });
  }
  async _bakeAll() {
    const sr = this.ctx.sampleRate, jobs = [];
    for (const n of Object.keys(SFX)) for (let v = 0; v < SFX[n].vars; v++) jobs.push([n, v]);
    let k = 0;
    const worker = async () => {
      while (k < jobs.length) {
        const [n, v] = jobs[k++];
        try { (this.buffers[n] || (this.buffers[n] = []))[v] = await bakeSfx(n, v, sr); } catch (e) { console.warn('[audio] bake failed', n, e); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const n of Object.keys(this.buffers)) this.buffers[n] = this.buffers[n].filter(Boolean);
  }
  _loadSound(name) {
    let job = this._soundJobs.get(name);
    if (!job) {
      const D = SFX[name], sr = this.ctx.sampleRate;
      job = Promise.all(Array.from({ length: D.vars }, (_, variation) => bakeSfx(name, variation, sr)))
        .then(samples => { this.buffers[name] = samples; }).finally(() => this._soundJobs.delete(name));
      this._soundJobs.set(name, job);
    }
    return job;
  }

  prepareSamples(kind, name) {
    const cache = kind === 'loop' ? _loopBufs : _banks;
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    const key = kind + ':' + name;
    const existing = this._sampleJobs.get(key);
    if (existing) return existing.promise;
    if (!this._sampleWorker && !this._workerUnavailable) {
      try {
        this._sampleWorker = new Worker(new URL('./audio-samples-worker.js', import.meta.url), { type: 'module' });
        this._sampleWorker.onmessage = ({ data }) => {
          const job = this._sampleJobs.get(data.key);
          if (!job) return;
          if (data.samples) job.resolve(data.samples);
          else job.reject(new Error(data.error));
        };
        this._sampleWorker.onerror = () => {
          this._workerUnavailable = true;
          this._sampleWorker.terminate();
          this._sampleWorker = null;
          for (const job of this._sampleJobs.values()) job.reject(new Error('Sample worker unavailable'));
        };
      } catch { this._workerUnavailable = true; }
    }
    const job = {};
    const pcm = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    // A restricted browser can still render the requested sound using the same generator.
    job.promise = pcm.catch(() => synthesizeSamples(kind, name))
      .then(samples => cacheSamples(kind, name, samples)).finally(() => this._sampleJobs.delete(key));
    this._sampleJobs.set(key, job);
    try {
      if (!this._sampleWorker) throw new Error('Worker unavailable');
      this._sampleWorker.postMessage({ kind, name, key });
    } catch (error) { job.reject(error); }
    return job.promise;
  }
  _idleBake() {
    const job = (label, f) => Object.assign(f, { label });
    const queue = [...Object.keys(LOOP_DEFS).filter((n) => !LOOP_DEFS[n].special).map((n) => job('loop:' + n, () => loopBuffer(n))), ...Object.keys(INST).filter((n) => !INST[n].live).map((n) => job(n, () => instBank(n)))];
    const step = () => {
      const f = queue.shift(); if (!f) { this.stats.prebaked = true; return; }
      const t = nowMs();
      try { f(); } catch (e) { console.warn('[audio] prebake', e); }
      (this.stats.prebakeMs || (this.stats.prebakeMs = {}))[f.label] = Math.round(nowMs() - t);
      setTimeout(step, 30);
    };
    step();
  }
  suspend() { return this.ctx ? this.ctx.suspend() : Promise.resolve(); }
  resume() { return this.ctx ? this.ctx.resume() : Promise.resolve(); }

  // ---- volumes ----
  setVolumes(v = {}) {
    for (const k of ['master', 'sfx', 'music', 'voice', 'radio']) if (v[k] != null && isFinite(v[k])) this.volumes[k] = clamp(+v[k]);
    this._applyVolumes();
    return this.volumes;
  }
  setMuted(b) { this.muted = !!b; this._applyVolumes(); return this.muted; }
  _applyVolumes(now) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, V = this.volumes, set = (g, v) => { if (now) g.gain.value = v; else g.gain.setTargetAtTime(v, t, 0.04); };
    const sq = (x) => x * x; // perceptual (audio-taper) mapping
    set(this.master, this.muted ? 0 : sq(V.master)); set(this.sfxVol, sq(V.sfx)); set(this.musicVol, sq(V.music)); set(this.voiceVol, sq(V.voice)); set(this.radioVol, sq(V.radio)); set(this.announcerVol, sq(V.radio));
  }
  _carFilter(on) {
    if (!this.car) return;
    const t = this.ctx.currentTime, [hp, lo, hi, lp] = this.car;
    hp.frequency.setTargetAtTime(on ? 95 : 20, t, 0.05); lo.gain.setTargetAtTime(on ? 4 : 0, t, 0.05);
    hi.gain.setTargetAtTime(on ? -2.5 : 0, t, 0.05); lp.frequency.setTargetAtTime(on ? 7500 : 20000, t, 0.05);
  }

  // ---- spatial ----
  setListener(x, y, zoom = 1) {
    const L = this.listener, t = nowMs(), dt = (t - L._t) / 1000;
    if (L._t && dt > 0.001 && dt < 0.5) { const k = clamp(dt * 6); L.vx += ((x - L.x) / dt - L.vx) * k; L.vy += ((y - L.y) / dt - L.vy) * k; }
    else { L.vx = 0; L.vy = 0; }
    L.x = +x || 0; L.y = +y || 0; L.zoom = +zoom || 1; L._t = t;
    this._tick();
  }
  // zoom: camera scale (1 = default, <1 zoomed out -> hear further)
  _spatial(x, y, range = 1) {
    const L = this.listener, dx = x - L.x, dy = y - L.y, d = Math.hypot(dx, dy);
    const s = clamp(1 / (L.zoom || 1), 0.6, 3) * range, near = 20 * s, far = 180 * s;
    const u = clamp((d - near) / (far - near)), g = Math.pow(1 - u, 2.2);
    return { g, pan: clamp(dx / (near * 2.5), -1, 1) * 0.8, lp: 0.08 + 0.92 * Math.pow(1 - u, 1.5), d };
  }
  _tick(force) {
    const t = nowMs();
    if (!force && t - this._lastTick < 60) return;
    this._lastTick = t;
    for (const e of this._engines) if (e.voice && (e._dirty || (!e.player && e.x != null))) e._apply(true);
    for (const s of this._sirens) s._update();
    for (const l of this._loops) if (l.x != null) l._update();
    if (t - this._lastCull > 200) { this._lastCull = t; this._updateEngines(); }
  }

  // ---- one-shots ----
  play(name, o = {}) {
    const dummy = { name, playing: false, stop() {} };
    if (!this.ctx) return dummy;
    const D = SFX[name];
    if (!D) { if (!this._warned) this._warned = new Set(); if (!this._warned.has(name)) { this._warned.add(name); console.warn('[audio] unknown sound', name); } return dummy; }
    let g = (o.vol ?? 1) * D.vol, sp = null;
    if (o.x != null && o.y != null) { sp = this._spatial(o.x, o.y, D.range * (o.range || 1)); g *= sp.g; if (g < 0.002) return dummy; }
    const bufs = this.buffers[name];
    if (!bufs || !bufs.length) {
      if (!this.onDemand) return dummy;
      // While this sound first warms up, keep only its most recent occurrence.
      // A stopped handle, a distant source or an old shot must never replay late.
      this._waitingShots.get(name)?.stop();
      let pending = true, actual;
      const started = nowMs(), h = { name, get playing() { return pending || !!actual?.playing; },
        stop(fade) { pending = false; actual?.stop(fade); } };
      this._waitingShots.set(name, h);
      this._loadSound(name).then(() => {
        if (pending && nowMs() - started < 500 && !document.hidden) actual = this.play(name, o);
      }).catch(e => console.warn('[audio] bake failed', name, e)).finally(() => {
        pending = false;
        if (this._waitingShots.get(name) === h) this._waitingShots.delete(name);
      });
      return h;
    }
    const list = (this._active.get(name) || []).filter((h) => h.playing);
    while (list.length >= D.max) list.shift().stop(0.02);
    this._all = this._all.filter((h) => h.playing);
    while (this._all.length >= this.maxOneShots) this._all.shift().stop(0.02);
    const ctx = this.ctx, src = ctx.createBufferSource(), gn = ctx.createGain(), nodes = [src, gn];
    src.buffer = bufs[(Math.random() * bufs.length) | 0];
    const rand = o.rand ?? 0.05; src.playbackRate.value = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * rand);
    gn.gain.value = g;
    let tail = src.connect(gn);
    if (sp) {
      const lp = ctx.createBiquadFilter(), pn = ctx.createStereoPanner();
      lp.type = 'lowpass'; lp.frequency.value = 300 + 19000 * sp.lp * sp.lp; pn.pan.value = sp.pan;
      tail = tail.connect(lp).connect(pn); nodes.push(lp, pn);
    } else if (o.pan) { const pn = ctx.createStereoPanner(); pn.pan.value = clamp(o.pan, -1, 1); tail = tail.connect(pn); nodes.push(pn); }
    tail.connect(o.bus === 'music' ? this.musicIn : o.bus === 'radio' ? this.radioIn : this.sfxBus);
    src.start(ctx.currentTime + (o.delay || 0));
    const h = {
      name, src, gain: gn, playing: true,
      stop: (f = 0.03) => { if (!h.playing) return; const t = ctx.currentTime; gn.gain.cancelScheduledValues(t); gn.gain.setTargetAtTime(0, t, f); try { src.stop(t + f * 5); } catch (e) { /* not started */ } },
    };
    src.onended = () => { h.playing = false; for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    list.push(h); this._active.set(name, list); this._all.push(h);
    return h;
  }

  // ---- continuous emitters ----
  createEngine(profile = 'i4') { const e = new EngineHandle(this, profile); this._engines.add(e); this._updateEngines(); return e; }
  _updateEngines() {
    if (!this.ctx) return;
    const arr = [...this._engines].filter((e) => e.alive);
    for (const e of arr) e._s = e._score();
    arr.sort((a, b) => b._s - a._s);
    arr.forEach((e, i) => { const want = i < this.maxEngines && e._s > 0.003; if (want && !e.voice) e._spawn(); else if (!want && e.voice) e._despawn(); });
  }
  get liveEngines() { let n = 0; for (const e of this._engines) if (e.voice) n++; return n; }
  createSiren(type = 'police') { const s = new SirenHandle(this, type); this._sirens.add(s); return s; }
  createLoop(name) { const l = new LoopHandle(this, name); this._loops.add(l); return l; }

  // ---- voice ----
  _loadVoice(url) {
    const cache = this._voiceCache;
    let recording = cache.get(url);
    if (recording) cache.delete(url);
    else {
      recording = fetch(url, {signal: AbortSignal.timeout(12000)})
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
          return response.arrayBuffer();
        })
        .then(bytes => this.ctx.decodeAudioData(bytes));
      recording.catch(() => { if (cache.get(url) === recording) cache.delete(url); });
    }
    cache.set(url, recording);
    if (cache.size > MAX_CACHED_VOICES) cache.delete(cache.keys().next().value);
    return recording;
  }
  preloadVoice(url) { return this.ctx ? this._loadVoice(url).then(() => true, () => false) : Promise.resolve(false); }
  async playVoice(url, { channel = 'dialogue', vol = 1, onEnd } = {}) {
    let natural = false;
    if (this.ctx) {
      const active = this._voice;
      if (active?.channel === channel && active.url === url) {
        natural = await active.done;
      } else if (!active || VOICE_PRIORITY[channel] > VOICE_PRIORITY[active.channel] || channel === 'dialogue') {
        this.stopVoice();
        // Reserve the channel before decoding, so a late fetch cannot steal it.
        const voice = { url, channel, vol, offset: 0, buffer: null, source: null };
        voice.done = new Promise(resolve => { voice.resolve = resolve; });
        this._voice = voice;
        this._loadVoice(url).then(buffer => {
          if (this._voice !== voice) return;
          voice.buffer = buffer;
          if (!this._voicePaused) this._startVoice(voice);
        }).catch(error => {
          if (this._voice !== voice) return;
          console.warn('[audio] voice load failed', url, error);
          this.stopVoice(channel);
        });
        natural = await voice.done;
      }
    }
    onEnd?.(natural);
    return natural;
  }
  _startVoice(voice) {
    const ctx = this.ctx;
    if (ctx.state === 'closed' || ctx.state === 'suspended') { this.stopVoice(); return; }
    if (voice.offset >= voice.buffer.duration) { this._endVoice(voice, true); return; }
    const source = ctx.createBufferSource();
    source.buffer = voice.buffer;
    const gain = ctx.createGain();
    gain.gain.value = voice.vol;
    source.connect(gain).connect(voice.channel === 'radio' ? this.announcerVol : this.voiceVol);
    voice.source = source;
    voice.startedAt = ctx.currentTime;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this._voice === voice && voice.source === source) this._endVoice(voice, true);
    };
    this._duck(true);
    source.start(0, voice.offset);
  }
  _endVoice(voice, natural) {
    this._voice = null;
    this._duck(false);
    voice.resolve(natural);
  }
  stopVoice(channel) {
    const voice = this._voice;
    if (!voice || (channel && channel !== voice.channel)) return;
    this._endVoice(voice, false);
    voice.source?.stop();
  }
  setVoicePaused(paused) {
    if (this._voicePaused === paused) return;
    this._voicePaused = paused;
    const voice = this._voice;
    if (!voice?.buffer) return;
    if (paused && voice.source) {
      voice.offset += this.ctx.currentTime - voice.startedAt;
      const source = voice.source;
      voice.source = null;
      source.stop();
      this._duck(false);
    } else if (!paused && !voice.source) {
      this._startVoice(voice);
    }
  }
  get voicePlaying() { return !!this._voice?.source; }
  _duck(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = on ? 0.316 : 1; // -10 dB
    for (const d of [this.sfxDuck, this.musicDuck, this.radioDuck]) d.gain.setTargetAtTime(k, t, on ? 0.06 : 0.35);
  }

  // ---- music (title / mission / chase) ----
  playMusic(name = 'title') {
    if (!this.ctx || !this.baked) { this._pendingMusic = name; return; }
    const genre = name === 'title' ? 'title' : 'score';
    if (genre === 'score' && name !== 'mission' && name !== 'chase') console.warn('[audio] unknown music', name);
    if (genre === 'score' && this.music && this.music.genre === 'score') { this.musicName = name; this.setMusicIntensity(name === 'chase' ? 1 : 0.35); return; }
    this.stopMusic(1.2);
    if (genre === 'score') this.musicIntensity = name === 'chase' ? 1 : 0.35;
    const p = (this.music = new SeqPlayer(this, this.ctx, this.musicIn, genre, { seed: hashStr(name) }));
    this._players.add(p);
    p.start(this.ctx.currentTime + 0.1);
    if (genre === 'score') p.rig.setLayers(this.musicIntensity, 0.01);
    p.pump(this.ctx.currentTime + 0.35);
    this.musicName = name;
  }
  stopMusic(fade = 1.5) {
    this._pendingMusic = null;
    if (this.music) { this.music.stop(fade); this._players.delete(this.music); this.music = null; this.musicName = null; }
  }
  setMusicIntensity(i) {
    this.musicIntensity = clamp(+i || 0);
    if (this.music && this.music.genre === 'score') this.music.rig.setLayers(this.musicIntensity);
    return this.musicIntensity;
  }

  // ---- offline rendering helpers (tests / tooling) ----
  async renderOffline(seconds, build, { sampleRate = 44100, channels = 2 } = {}) {
    const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
    const dest = ctx.createGain(); dest.connect(ctx.destination);
    await build(ctx, dest);
    return ctx.startRendering();
  }
  renderStation(which, seconds = 8, o = {}) {
    const st = typeof which === 'number' ? STATIONS[which] : STATIONS.find((s) => s.id === which || s.genre === which) || { genre: which, id: which };
    let info = null;
    return this.renderOffline(seconds, (ctx, dest) => {
      let songs = 0;
      const p = new SeqPlayer(this, ctx, dest, st.genre, { seed: o.seed ?? 12345, songN: o.songN ?? 0, station: st, jingleP: o.jingleP, onSong: (s) => { info = info || s; songs++; } });
      p.start(0, null, o.bar || 0);
      if (st.genre === 'score') p.rig.setLayers(o.intensity ?? 1, 0.001);
      p.pump(seconds);
      this._lastRender = { notes: p.notes, songs, jingle: p.song && !!p.song.jingle, song: info && { title: info.title, artist: info.artist, bpm: info.bpm, key: NOTE_NAMES[info.key], style: info.style || (info.trap ? 'trap' : info.house ? 'house' : info.doo ? 'doo-wop' : '') } };
    });
  }
  renderEngine(profile, state, seconds = 2, player = true) {
    return this.renderOffline(seconds, (ctx, dest) => { const v = new EngineVoice(ctx, dest, profile, ENGINE_PROFILES[profile], player); v.apply(state, NOPOS, 1); this._lastRender = { fireHz: v.fireHz }; });
  }
  renderSiren(type, mode, seconds = 3) {
    return this.renderOffline(seconds, (ctx, dest) => { const v = new SirenVoice(ctx, dest, type); v.mode(mode || Object.keys(SIRENS[type].modes)[0]); v.apply(NOPOS, 0, 1); });
  }
  renderLoop(name, intensity = 0.8, seconds = 2) {
    return this.renderOffline(seconds, (ctx, dest) => {
      const D = LOOP_DEFS[name];
      if (D.special === 'turbine') { const v = new EngineVoice(ctx, dest, 'turbine', ENGINE_PROFILES.turbine, false); v.apply({ rpm: 1, throttle: intensity }, NOPOS, 1); return; }
      const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = loopBuffer(name); src.loop = true; g.gain.value = D.vol * D.map(intensity).g;
      src.connect(g).connect(dest); src.start();
    });
  }
  // Worst-case mix (8 engines, 3 sirens, 4 loops, radio + score, 40 one-shots) for CPU headroom checks.
  renderStress(seconds = 4) {
    return this.renderOffline(seconds, (ctx, dest) => {
      ['v8', 'i4', 'diesel_big', 'moto_2t', 'v8_muscle', 'electric', 'v6', 'turbine'].forEach((p, i) => new EngineVoice(ctx, dest, p, ENGINE_PROFILES[p], i === 0).apply({ rpm: 0.3 + 0.08 * i, throttle: 0.6, speed: 20 }, { g: i ? 0.4 : 1, pan: ((i % 3) - 1) * 0.5, lp: 0.7 }, 1));
      for (const t of ['police', 'ambulance', 'fire']) { const v = new SirenVoice(ctx, dest, t); v.mode(t === 'fire' ? 'growl' : 'wail'); v.apply({ g: 0.5, pan: 0, lp: 0.8 }, 0, 1); }
      for (const n of ['rain', 'fire', 'crowd', 'city_ambience']) { const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = loopBuffer(n); s.loop = true; g.gain.value = 0.3; s.connect(g).connect(dest); s.start(); }
      const p = new SeqPlayer(this, ctx, dest, 'rock', { seed: 5, station: STATIONS[3] }); p.start(0, null, 12); p.pump(seconds);
      const m = new SeqPlayer(this, ctx, dest, 'score', { seed: 6 }); m.start(0); m.rig.setLayers(1, 0.001); m.pump(seconds);
      const names = ['pistol', 'smg', 'explosion', 'crash_med', 'glass', 'footstep', 'punch_hit', 'shotgun'];
      for (let k = 0; k < 40; k++) {
        const s = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), pn = ctx.createStereoPanner();
        s.buffer = this.buffers[names[k % names.length]][0]; g.gain.value = 0.2; s.connect(g).connect(lp).connect(pn).connect(dest); s.start((k * seconds) / 40);
      }
    }, { sampleRate: this.ctx.sampleRate });
  }
  // Audition one instrument note (tooling): renderInstrument('gtr_twang', 64, 2)
  renderInstrument(name, midi = 60, seconds = 1.5, vel = 0.8) {
    return this.renderOffline(seconds, (ctx, dest) => { const rig = new MusicRig(this, ctx, dest, { gain: 1, revAmt: 0 }); rig.play({ i: name, m: midi, d: seconds * 0.6, v: vel, ch: 'x' }, 0, 1); });
  }
  get instruments() { return Object.keys(INST); }
  static encodeWAV(buffer) { return encodeWAV(buffer); }
}

async function bakeSfx(name, v, sr) {
  const D = SFX[name], ctx = new OfflineAudioContext(1, Math.ceil(D.dur * sr) + 64, sr);
  D.fn(new G(ctx, new RNG(hashStr(name) + v * 9973)));
  const buf = await ctx.startRendering(), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) d[i] = 0;
  normalize(d, D.peak);
  return bufFrom(sr, [trimTail(d, 2e-4)]);
}

export const audio = new AudioSys();
export { STATIONS, ENGINE_PROFILES, SFX as SOUND_DEFS, LOOP_DEFS, SIRENS, encodeWAV };
export default audio;
