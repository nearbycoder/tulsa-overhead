// Exercise both drawing backends and the release of replaced or evicted bitmap surfaces.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL || 'http://localhost:8137') + '/package.json');
  const result = await page.evaluate(async () => {
    const { Ground } = await import('/src/engine/ground.js');
    function fixture(quality) {
      const ground = Object.create(Ground.prototype);
      Object.assign(ground, {
        quality, world: { forEachInRect() {} }, patsLo: {}, patsHi: {}, cache: new Map(),
        crossingsByTile: new Map(), surveyAt: () => null, drawSurvey: () => false, drawRelief() {},
        drawVectorGround(ctx, x, y, span) {
          ctx.fillStyle = '#5d805b'; ctx.fillRect(x, y, span, span);
          ctx.fillStyle = '#ab523b'; ctx.fillRect(x+3, y+5, span/2, span/2);
          ctx.fillStyle = '#81796d'; ctx.fillRect(x+9, y, 1, span);
        },
      });
      return ground;
    }
    function pixels(tile) {
      const c = document.createElement('canvas');
      c.width = tile.canvas.width; c.height = tile.canvas.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(tile.canvas, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    }

    const high = fixture(3), low = fixture(0);
    const first = high.renderTile(-1, 2, 0, 1);
    const reference = low.renderTile(-1, 2, 0, 1);
    const a = pixels(first), b = pixels(reference);
    const equal = a.every((v, i) => v === b[i]);
    const baker = high.tileBaker;
    const next = high.renderTile(-1, 2, 0, 1, first);
    const reusedBaker = high.tileBaker === baker && baker.width === 1;
    const staleClosed = first.canvas.width === 0;
    high.cache.set('sample', next);
    high.cacheBytes = next.canvas.width * next.canvas.height * 4;
    high.releaseTile('sample', true);
    const evicted = !high.cache.size && !high.cacheBytes && !next.canvas.width;
    low.cache.set('mutable', reference);
    low.cacheBytes = reference.canvas.width * reference.canvas.height * 4;
    const retained = low.releaseTile('mutable', true);
    const replacement = low.renderTile(5, -1, 0, 1, retained);
    const reusedMutable = retained === reference && replacement.canvas === reference.canvas &&
      !low.cache.size && !low.cacheBytes && pixels(replacement).every((v, i) => v === b[i]);

    // An existing 2D implementation may lack transfer support, or the first
    // transfer can fail. The completed tile must still display in both cases.
    const saved = OffscreenCanvas.prototype.transferToImageBitmap;
    const failing = fixture(2);
    let failureMatch, failureDisabled, legacy;
    try {
      OffscreenCanvas.prototype.transferToImageBitmap = () => { throw Error('failed transfer'); };
      const failure = failing.renderTile(-1, 2, 0, 1);
      failureMatch = pixels(failure).every((v, i) => v === b[i]);
      failureDisabled = failing.tileBaker === null;
      OffscreenCanvas.prototype.transferToImageBitmap = undefined;
      legacy = fixture(2).renderTile(-1, 2, 0, 1).canvas instanceof HTMLCanvasElement;
    } finally {
      OffscreenCanvas.prototype.transferToImageBitmap = saved;
    }
    return { equal, bitmap: first.canvas instanceof ImageBitmap, low: reference.canvas instanceof HTMLCanvasElement,
      staleClosed, evicted, reusedBaker, reusedMutable, failureMatch, failureDisabled, legacy };
  });
  for (const [check, passed] of Object.entries(result)) assert.equal(passed, true, check);
  console.log('Terrain bitmap and canvas output, replacement, eviction and transfer fallbacks passed.');
} finally {
  await browser.close();
}
