// Exercise the compact photo blend independently of the terrain edition installed on disk.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio']
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:' + (process.env.PORT || 8137));
  const result = await page.evaluate(async () => {
    const { Ground } = await import('/src/engine/ground.js');
    const ground = Object.create(Ground.prototype);
    ground.nativeArea = 'towns';
    ground.quality = 1;
    ground.surveyGrain = '#808080';
    const image = color => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const c = canvas.getContext('2d');
      c.fillStyle = color;
      c.fillRect(0, 0, 8, 8);
      return canvas;
    };
    // Put the patch on a negative region boundary to exercise cross-region neighbours.
    const left = -2048, top = -2048;
    const native = { image: image('red'), left, top, span: 512, gutter: 0, opaque: true, paving: true };
    const overview = { image: image('blue'), left, top, span: 2048, gutter: 0, opaque: true, paving: true };
    let requests = 0;
    ground.surveyAt = () => { requests++; return overview; };
    const canvas = document.createElement('canvas'), side = 32, gpm = 32;
    canvas.width = canvas.height = side*gpm;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function setMissing(offsets) {
      ground.fullRegions = new Map();
      for (let ry = -2; ry <= -1; ry++) for (let rx = -2; rx <= -1; rx++) {
        ground.fullRegions.set(rx+','+ry, [rx, ry, 65535, 0, 0]);
      }
      for (const [dx, dy] of offsets) {
        const x = left+dx*512, y = top+dy*512, rx = Math.floor(x/2048), ry = Math.floor(y/2048);
        const bit = (y-ry*2048)/512*4+(x-rx*2048)/512;
        ground.fullRegions.get(rx+','+ry)[2] &= ~(1 << bit);
      }
      delete native.overviewNeighbors;
    }
    function draw(dx, dy) {
      const x = left+(dx < 0 ? 0 : dx > 0 ? 512-side : 256);
      const y = top+(dy < 0 ? 0 : dy > 0 ? 512-side : 256);
      ctx.setTransform(gpm, 0, 0, gpm, -x*gpm, -y*gpm);
      ground.drawSurvey(ctx, x, y, gpm, side, native);
      return (distance) => {
        const coord = dir => Math.floor((dir < 0 ? distance : dir > 0 ? side-distance : 16)*gpm);
        return Array.from(ctx.getImageData(coord(dx), coord(dy), 1, 1).data);
      };
    }

    const directions = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      setMissing([[dx, dy]]);
      const sample = draw(dx, dy);
      const edge = sample(0.5), middle = sample(dx && dy ? 8.5 : 12), interior = sample(26);
      directions.push({ dx, dy, edge, middle, interior });
    }
    // Where two missing sides meet, the nearby corner also fades, while a patch
    // with all eight native neighbours never asks for the overview.
    setMissing([[-1, 0], [0, -1]]);
    const corner = draw(-1, -1)(0.5);
    setMissing([]);
    requests = 0;
    draw(1, 1);
    setMissing([[1, 0]]);
    draw(-1, 0);
    ground.nativeArea = 'all';
    draw(1, 0);
    ground.nativeArea = 'towns';
    ground.quality = 0;
    draw(1, 0);
    const skippedRequests = requests;

    ground.quality = 1;
    overview.opaque = false;
    overview.image.getContext('2d').clearRect(0, 0, 8, 8);
    const noCoverage = draw(1, 0)(0.5);
    return { directions, corner, skippedRequests, noCoverage };
  });
  for (const { dx, dy, edge, middle, interior } of result.directions) {
    assert.ok(edge[2] > 250 && edge[3] === 255, 'Overview at boundary ' + [dx, dy]);
    assert.ok(middle[0] > 115 && middle[0] < 140 && middle[2] > 115 && middle[2] < 140,
      'Half-density blend ' + [dx, dy, middle]);
    assert.deepEqual(interior, [255, 0, 0, 255]);
  }
  assert.ok(result.corner[2] > 250 && result.corner[3] === 255);
  assert.equal(result.skippedRequests, 0);
  assert.deepEqual(result.noCoverage, [255, 0, 0, 255]);
  console.log('Compact native and overview blending passed all eight directions, adjoining edges, opacity and inactive paths.');
} finally {
  await browser.close();
}
