// Persistent player settings: resolution/fidelity, graphics, audio, gameplay.
import { AdaptiveQuality, AUTO_TIERS } from './adaptive.js';
const KEY = 'gtpolly.settings.v1';

// Fixed modes fit the viewport into a 16:9 frame (or 9:16 in portrait).
// Native uses physical display pixels up to UHD. Custom retains the previous scale slider.
const fixedHeight = { retro: 480, hd: 720, fullHD: 1080, qhd: 1440, uhd: 2160 };

export const PRESETS = {
  auto:   { label: 'Automatic', resolutionMode: 'adaptive' },
  retro:  { label: 'Retro · 480p', resolutionMode: 'retro', terrainDetail: 0, shadows: false, buildingDetail: 0, particles: 0.5, trafficDensity: 0.7, pedDensity: 0.7, treeDensity: 0.6, lighting: false, weather: true, smoothGround: false, pixelPerfect: true, drawDistance: 0 },
  low:    { label: 'Low · 720p', resolutionMode: 'hd', terrainDetail: 0, shadows: false, buildingDetail: 1, particles: 0.6, trafficDensity: 0.8, pedDensity: 0.8, treeDensity: 0.7, lighting: true, weather: true, smoothGround: true, pixelPerfect: false, drawDistance: 1 },
  medium: { label: 'Medium · 1080p', resolutionMode: 'fullHD', terrainDetail: 1, shadows: true, buildingDetail: 2, particles: 1, trafficDensity: 1, pedDensity: 1, treeDensity: 1, lighting: true, weather: true, smoothGround: true, pixelPerfect: false, drawDistance: 1 },
  high:   { label: 'High · Native', resolutionMode: 'native', terrainDetail: 2, shadows: true, buildingDetail: 2, particles: 1, trafficDensity: 1.2, pedDensity: 1.2, treeDensity: 1, lighting: true, weather: true, smoothGround: true, pixelPerfect: false, drawDistance: 2 },
  ultra:  { label: 'Ultra · 4K', resolutionMode: 'uhd', terrainDetail: 3, shadows: true, buildingDetail: 2, particles: 1.5, trafficDensity: 1.5, pedDensity: 1.5, treeDensity: 1.3, lighting: true, weather: true, smoothGround: true, pixelPerfect: false, drawDistance: 2 },
};

export function frameDimensions(cssW, cssH, dpr, values) {
  const w = Math.max(1, cssW), h = Math.max(1, cssH);
  const mode = values.resolutionMode;
  if (mode === 'scaled') {
    const scale = Math.min(1, Math.max(0, Number(values.resolutionScale) || 0));
    if (!scale) return [Math.max(1, Math.round(480 * w / h)), 480];
    const factor = (values.nativeHiDPI ? dpr : 1) * scale;
    return [Math.max(320, Math.round(w * factor)), Math.max(240, Math.round(h * factor))];
  }
  const fixed = Object.hasOwn(fixedHeight, mode);
  const short = mode === 'adaptive' ? values.autoHeight || 720 : fixed ? fixedHeight[mode] : 2160;
  const fit = Math.min(short / Math.min(w, h), Math.round(short * 16 / 9) / Math.max(w, h));
  const scale = fixed ? fit : Math.min(fit, dpr);
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

const { label, ...highGraphics } = PRESETS.high;

export const DEFAULTS = {
  ...highGraphics,
  preset: 'auto', resolutionMode: 'adaptive', frameLimit: 60,
  resolutionScale: 0.75,   // used by the custom window scale mode
  nativeHiDPI: false,      // include the display pixel ratio in custom window scale
  dayNightCycle: true,
  screenShake: true,
  cameraLead: true,
  perspective: 1,
  showFps: false,
  // Audio
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.6,
  radioVolume: 0.7,
  voiceVolume: 1.0,
  subtitles: true,
  // Gameplay
  aimMode: 'mouse',        // mouse | tank
  autoRadio: true,
  difficulty: 1,           // 0.7 easy .. 1.4 hard
  speedUnits: 'mph',
  vibration: true,         // controller rumble
  promptStyle: 'auto',     // auto | xbox | ps | kb — which buttons on-screen prompts show
};

class Settings {
  constructor() {
    this.v = { ...DEFAULTS };
    this.listeners = new Set();
    this.adaptive = new AdaptiveQuality();
    this.applyAutoLevel();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
        Object.assign(this.v, saved);
        if (saved.preset === 'auto') this.applyAutoLevel();
        if (!saved.resolutionMode && ('resolutionScale' in saved || 'preset' in saved)) {
          this.v.resolutionMode = 'scaled';
          this.v.terrainDetail = PRESETS[saved.preset]?.terrainDetail ?? PRESETS.medium.terrainDetail;
          this.v.preset = 'custom';
        }
      }
    } catch (e) { /* storage unavailable */ }
  }
  get(k) { return this.v[k]; }
  applyAutoLevel() {
    const tier = AUTO_TIERS[this.adaptive.tier];
    this.v.autoHeight = tier.short;
    if (this.v.preset === 'auto') {
      for (const [k, val] of Object.entries(PRESETS[tier.preset])) if (k !== 'label') this.v[k] = val;
      this.v.resolutionMode = 'adaptive';
    }
  }
  sampleFrame(interval, work) {
    if (this.v.resolutionMode !== 'adaptive') return;
    const target = this.v.frameLimit === 30 ? 1000 / 30 : 1000 / 60;
    if (this.adaptive.sample(interval, work, target)) {
      this.applyAutoLevel();
      for (const fn of this.listeners) fn('autoQuality');
    }
  }
  set(k, val) {
    this.v[k] = val;
    if (k === 'resolutionScale' || k === 'nativeHiDPI') this.v.resolutionMode = 'scaled';
    if (k in PRESETS.medium || k === 'resolutionScale' || k === 'nativeHiDPI') this.v.preset = 'custom';
    this.save();
    for (const fn of this.listeners) fn(k, val);
  }
  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    for (const [k, val] of Object.entries(p)) if (k !== 'label') this.v[k] = val;
    this.v.preset = name;
    if (name === 'auto') { this.adaptive.reset(); this.applyAutoLevel(); }
    this.save();
    for (const fn of this.listeners) fn('*', null);
  }
  reset() { this.v = { ...DEFAULTS }; this.adaptive.reset(); this.applyAutoLevel(); this.save(); for (const fn of this.listeners) fn('*', null); }
  save() { try { const { autoHeight, ...saved } = this.v; localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ } }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const settings = new Settings();
