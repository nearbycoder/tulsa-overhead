// Pixel budgets and scene presets for sustained play. Explicit graphics presets bypass tuning.
export const AUTO_TIERS = [
  { short: 360, preset: 'retro' }, { short: 540, preset: 'low' }, { short: 720, preset: 'low' },
  { short: 900, preset: 'medium' }, { short: 1080, preset: 'high' }, { short: 1440, preset: 'high' },
];

export function deviceTiers(nav = globalThis.navigator, coarse = globalThis.matchMedia?.('(pointer: coarse)').matches) {
  const cores = nav?.hardwareConcurrency, memory = nav?.deviceMemory;
  const limited = (memory > 0 && memory <= 2) || (cores > 0 && cores <= 2);
  const modest = (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
  if (limited) return { start: 1, ceiling: 2 };
  if (coarse || modest) return { start: 2, ceiling: 3 };
  return { start: 4, ceiling: 5 };
}

export class AdaptiveQuality {
  constructor(device = deviceTiers()) {
    this.device = device;
    this.reset();
  }
  reset() {
    this.tier = this.device.start;
    this.spareWindows = 0;
    this.clearSamples();
  }
  clearSamples() { this.elapsed = 0; this.work = 0; this.frames = 0; }
  sample(interval, work, target) {
    if (interval <= 0) return false;
    // A single stall cannot fill a measurement window, but sustained slow frames still count.
    interval = Math.min(interval, 250);
    this.frames++;
    this.elapsed += interval;
    this.work += Math.min(interval, work);
    if (this.elapsed < 2500) return false;
    const average = this.elapsed / this.frames, cost = this.work / this.frames;
    this.clearSamples();
    if (average > target * 1.22 || cost > target * 0.88) {
      this.spareWindows = 0;
      if (this.tier === 0) return false;
      this.tier--;
      return true;
    }
    this.spareWindows = average < target * 1.09 && cost < target * 0.53 ? this.spareWindows + 1 : 0;
    if (this.spareWindows < 6 || this.tier === this.device.ceiling) return false;
    this.spareWindows = 0;
    this.tier++;
    return true;
  }
}
