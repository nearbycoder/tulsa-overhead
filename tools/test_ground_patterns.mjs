// Check every shipped terrain pattern against the procedural art and exercise a missing pack.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/package.json');
  const results = await page.evaluate(async () => {
    const { Ground, groundPatternRecipes, makeTexture } = await import('/src/engine/ground.js');
    const actual = document.createElement('canvas');
    const ctx = actual.getContext('2d', { willReadFrequently: true });
    const sources = new WeakMap();
    const patternContext = { createPattern(image, repeat) {
      const pattern = ctx.createPattern(image, repeat);
      sources.set(pattern, image);
      return pattern;
    } };
    const verified = [];
    for (const [fine, missing] of [[false, false], [true, false], [false, true]]) {
      const g = Object.create(Ground.prototype);
      g.world = { base: missing ? '/missing-test-map' : '/assets/map' };
      const tile = { stale: false };
      g.cache = new Map([[0, tile]]);
      const patterns = g[fine ? 'patsHi' : 'patsLo'] = g.initPatterns(patternContext, fine);
      if (typeof patterns.lawn !== 'string') throw Error('Loading blocked the first terrain bake');
      const end = performance.now() + 10000;
      while (!tile.stale) {
        if (performance.now() > end) throw Error('Material preparation timed out');
        await new Promise(done => setTimeout(done, 8));
      }
      for (const [name, recipe] of Object.entries(groundPatternRecipes(fine))) {
        const image = sources.get(patterns[name]);
        if (missing !== (image instanceof HTMLCanvasElement)) throw Error('Wrong material source for ' + name);
        actual.width = actual.height = recipe.size;
        ctx.drawImage(image, 0, 0);
        const a = ctx.getImageData(0, 0, recipe.size, recipe.size).data;
        const expected = makeTexture(recipe.base, recipe.options, recipe.seed);
        const b = expected.getContext('2d').getImageData(0, 0, recipe.size, recipe.size).data;
        if (!a.every((value, i) => value === b[i])) throw Error('Texture mismatch in ' + name);
        verified.push(name);
      }
    }
    return verified.length;
  });
  assert.equal(results, 84);
  console.log('Both packed terrain tiers and the procedural fallback match their source pixels.');
} finally {
  await browser.close();
}
