// Verify cropped source rectangles against the original strips, poses and untrimmed rendering.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--disable-gpu'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/package.json');
  const report = await page.evaluate(async () => {
    const { Assets } = await import('/src/game/assets.js');
    const assets = new Assets();
    await assets.load();
    const samples = [], counts = { sheets: 0, slices: 0, pixels: 0, submitted: 0 };
    const scratch = document.createElement('canvas');
    const read = scratch.getContext('2d', { willReadFrequently: true });
    function verify(sprite, image = sprite.img) {
      const { w, h, count } = sprite;
      const bounds = image.stackSliceBounds;
      if (bounds?.length !== count * 4) throw Error('Missing bounds on ' + image.src);
      scratch.width = image.width;
      scratch.height = image.height;
      read.drawImage(image, 0, 0);
      const rgba = read.getImageData(0, 0, scratch.width, scratch.height).data;
      for (let i = 0; i < count; i++) {
        const [left, top, width, height] = bounds.subarray(i * 4, i * 4 + 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (x >= left && x < left + width && y >= top && y < top + height) continue;
          if (rgba[(y * image.width + i * w + x) * 4 + 3] !== 0) throw Error('A nontransparent texel was cropped');
        }
        counts.submitted += width * height;
      }
      counts.sheets++;
      counts.slices += count;
      counts.pixels += w * h * count;
    }

    for (const prop of assets.props.values()) for (const sprite of prop.sprites) verify(sprite);
    for (const car of assets.vehicles) verify(assets.vehicleSprite(car, -1));
    for (const name of ['elm', 'water_tower', 'traffic_light_green', 'gas_station_canopy']) {
      const sprite = assets.props.get(name).sprite;
      samples.push([sprite, sprite.img]);
    }
    const painted = assets.vehicleSprite(assets.vehicle('cimarron_thunderhead'), 7);
    verify(painted);
    samples.push([painted, painted.img]);
    for (const id of [0, 31, 151, 354]) {
      const { sprite, frames } = assets.ped(id);
      for (const value of Object.values(frames)) {
        for (const img of Array.isArray(value) ? value : [value]) verify(sprite, img);
      }
      samples.push([sprite, frames.walk[2]], [sprite, frames.dead]);
    }

    function context() {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 240;
      return c.getContext('2d', { willReadFrequently: true });
    }
    const full = context(), trimmed = context();
    let opaque = 0, visiblyDifferent = 0, totalCalls = 0, trimmedCalls = 0;
    let fullTexels = 0, trimmedTexels = 0, filteredDifferent = 0;
    for (const [sprite, img] of samples) {
      const saved = img.stackSliceBounds;
      for (let frame = 0; frame < 12; frame++) {
        const zoom = [3.15, 8.3, 15.743][frame % 3];
        const cam = { W: 320, H: 240, zoom, D: 75, x: 0, y: 0, shakeX: 0.1, shakeY: 0,
          ch(z) { return this.D * 0.44 * (1 - Math.exp(-z / (this.D * 0.44))); } };
        const smooth = frame > 9, alpha = frame % 2 ? 0.75 : 1;
        for (const target of [full, trimmed]) {
          target.clearRect(0, 0, cam.W, cam.H);
          target.imageSmoothingEnabled = smooth;
          img.stackSliceBounds = target === trimmed ? saved : undefined;
          const wrap = {
            imageSmoothingEnabled: smooth,
            set globalAlpha(a) { target.globalAlpha = a; },
            setTransform(...args) { target.setTransform(...args); },
            drawImage(...args) {
              if (!smooth) {
                if (target === full) { totalCalls++; fullTexels += args[3] * args[4]; }
                else { trimmedCalls++; trimmedTexels += args[3] * args[4]; }
              }
              target.drawImage(...args);
            },
          };
          sprite.draw(wrap, cam, (frame - 5) * 1.7, (frame % 5 - 2) * 1.9, frame * 0.537 + 1.2,
            { img, alpha, z: frame % 3 * 1.4, step: frame % 3 + 1, from: frame % 2, to: sprite.count - frame % 3 });
        }
        const a = full.getImageData(0, 0, cam.W, cam.H).data;
        const b = trimmed.getImageData(0, 0, cam.W, cam.H).data;
        for (let p = 0; p < a.length; p += 4) {
          if (!(a[p + 3] || b[p + 3])) continue;
          if (smooth) {
            if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]) filteredDifferent++;
            continue;
          }
          opaque++;
          // Compare the composited channels, including coverage, at subpixel edges.
          const change = Math.max(Math.abs(a[p + 3] - b[p + 3]), ...[0, 1, 2].map(c =>
            Math.abs(a[p + c] * a[p + 3] - b[p + c] * b[p + 3]) / 255));
          if (change > 8) visiblyDifferent++;
        }
        img.stackSliceBounds = saved;
      }
    }
    return { ...counts, totalCalls, trimmedCalls, fullTexels, trimmedTexels, opaque, visiblyDifferent, filteredDifferent };
  });
  assert(report.sheets > 250 && report.slices > 5000);
  assert(report.trimmedTexels < report.fullTexels * 0.5 && report.trimmedCalls < report.totalCalls);
  assert.equal(report.filteredDifferent, 0);
  // Canvas rasterizers can round equivalent cropped source coordinates to opposite
  // sides of a texel boundary. Allow up to one such visible pixel in one thousand.
  assert(report.visiblyDifferent < report.opaque * 0.001, JSON.stringify(report));
  console.log(report);
} finally {
  await browser.close();
}
