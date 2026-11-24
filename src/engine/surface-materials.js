// Close-range photomaterials for the game surface. Patterns are measured in
// world metres, so moving the camera or crossing a cache tile cannot move the grain.
export class SurfaceMaterials {
  constructor(base, refresh) {
    this.base = base;
    this.refresh = refresh;
    this.angles = new WeakMap();
  }

  prepare() {
    if (this.images || this.request || performance.now() < (this.retryAt || 0)) return;
    const controller = new AbortController();
    this.request = controller;
    this.load(controller.signal).catch(() => {
      if (!controller.signal.aborted) this.retryAt = performance.now() + 30000;
    }).finally(() => {
      if (this.request === controller) this.request = null;
    });
  }

  async load(signal) {
    const fetchAsset = async name => {
      const response = await fetch(this.base + '/ground/materials.' + name, { signal });
      if (!response.ok) throw new Error('Ground material unavailable');
      return name === 'json' ? response.json() : response.blob();
    };
    const [layout, blob] = await Promise.all([fetchAsset('json'), fetchAsset('webp')]);
    const sheet = await createImageBitmap(blob);
    const images = new Map();
    try {
      if (signal.aborted) return;
      for (const [name, [col, row, metres]] of Object.entries(layout.patterns)) {
        const size = layout.size;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(sheet, col*size, row*size, size, size, 0, 0, size, size);
        images.set(name, { canvas, scale: metres / size });
      }
      this.images = images;
      this.refresh();
    } finally { sheet.close(); }
  }

  pattern(ctx, name) {
    const entry = this.images?.get(name);
    if (!entry) return null;
    if (!entry.pattern) {
      entry.pattern = ctx.createPattern(entry.canvas, 'repeat');
      entry.pattern.setTransform(new DOMMatrix().scale(entry.scale));
    }
    return entry.pattern;
  }

  road(ctx, name, road, fallback) {
    const pattern = this.pattern(ctx, name);
    if (!pattern) return fallback;
    if (name === 'brick' || name === 'pavers') {
      let angle = this.angles.get(road);
      if (angle === undefined) {
        let longest = 0;
        angle = 0;
        const p = road.pts;
        for (let i = 2; i < p.length; i += 2) {
          const dx = p[i] - p[i-2], dy = p[i+1] - p[i-1], length = dx*dx + dy*dy;
          if (length > longest) { longest = length; angle = Math.atan2(dy, dx) * 180 / Math.PI; }
        }
        this.angles.set(road, angle);
      }
      pattern.setTransform(new DOMMatrix().rotate((angle + 180) % 180).scale(this.images.get(name).scale));
    }
    return pattern;
  }

  release() {
    this.request?.abort();
    this.request = null;
    if (this.images) for (const entry of this.images.values()) entry.canvas.width = entry.canvas.height = 0;
    this.images = null;
  }
}
