import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AdaptiveQuality, deviceTiers } from '../src/engine/adaptive.js';
import { frameDimensions, settings } from '../src/engine/settings.js';
import { buildPedFrameData, getPedModel, lazyPedSprites, pedModelCount } from '../src/data/peds.js';

assert.deepEqual(deviceTiers({ hardwareConcurrency: 2 }, true), { start: 1, ceiling: 2 });
assert.deepEqual(deviceTiers({ hardwareConcurrency: 8 }, true), { start: 2, ceiling: 3 });
assert.deepEqual(deviceTiers({ hardwareConcurrency: 8 }, false), { start: 4, ceiling: 5 });
const tuner = new AdaptiveQuality({ start: 2, ceiling: 3 });
const sample = (frames, dt, work, target = 1000/60) => {
  for (let i = 0; i < frames; i++) tuner.sample(dt, work, target);
};
sample(65, 40, 28);
assert.equal(tuner.tier, 1);
sample(190, 40, 28);
assert.equal(tuner.tier, 0);
sample(850, 1000/60, 4);
assert.equal(tuner.tier, 0);
sample(2200, 1000/60, 4);
assert.equal(tuner.tier, 3);
tuner.reset();
sample(90, 1000/30, 15, 1000/30);
assert.equal(tuner.tier, 2);
settings.applyPreset('ultra');
for (let i = 0; i < 200; i++) settings.sampleFrame(50, 40);
assert.deepEqual(frameDimensions(844, 390, 3, settings.v), [3840, 1774]);
settings.applyPreset('auto');
settings.set('terrainDetail', 2);
for (let i = 0; i < 200; i++) settings.sampleFrame(50, 40);
assert.equal(settings.get('terrainDetail'), 2); // Adaptive resolution respects explicit scene settings.
assert.deepEqual(frameDimensions(390, 844, 3, { resolutionMode: 'adaptive', autoHeight: 720 }), [591, 1280]);

for (const group of ['vehicles', 'props']) {
  const folder = new URL('../assets/' + group + '/', import.meta.url);
  const { images, sliceBoundDeltas, ...catalog } = JSON.parse(await readFile(new URL('sprites.json', folder), 'utf8'));
  assert.deepEqual(catalog, JSON.parse(await readFile(new URL('catalog.json', folder), 'utf8')));
  const referenced = new Set();
  for (const entry of catalog[group]) {
    for (const name of entry.frames || [entry.file]) {
      referenced.add(name);
      assert.equal(Buffer.from(sliceBoundDeltas[name], 'base64').length, entry.count * 4);
    }
    if (entry.rotor) referenced.add(entry.rotor.file || entry.rotor);
    if (entry.emissive) referenced.add(entry.emissive);
  }
  for (const name of referenced)
    assert.deepEqual(Buffer.from(images[name], 'base64'), await readFile(new URL(name, folder)), name);
}

// Capture the exact pixels uploaded to on-demand sprite canvases.
let strips = 0;
globalThis.ImageData = class { constructor(data) { this.data = data; } };
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; strips++; }
  getContext() { return { putImageData: im => { this.pixels = im.data; } }; }
};
for (let i = 0; i < pedModelCount(); i += 13) {
  const raw = buildPedFrameData(i), before = strips, sprite = lazyPedSprites(i);
  assert.equal(strips, before, getPedModel(i).name);
  assert.deepEqual(sprite.colors, raw.colors);
  for (const [pose, images] of Object.entries(raw.frames)) {
    if (Array.isArray(images)) images.forEach((image, k) => assert.deepEqual(sprite.frames[pose][k].pixels, image));
    else assert.deepEqual(sprite.frames[pose].pixels, images);
  }
  assert.equal(strips - before, 19);
  assert.equal(sprite.frames.idle, sprite.frames.idle);
}
console.log('Adaptive frame budgets, manual overrides, portrait sizing and exact on-demand pedestrian frames passed.');
