// Exercise the shipped rural imagery and the same renderer used during a quality or camera change.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?autostart=new&nomission');
  await page.waitForFunction(() => window.__game?.player && __game.renderer.ground.fullRegions.size);
  const result = await page.evaluate(async () => {
    const g = __game, renderer = g.renderer, ground = renderer.ground, cam = g.cam;
    const { settings } = await import('/src/engine/settings.js');
    const wait = ms => new Promise(done => setTimeout(done, ms));
    async function until(check) {
      const end = performance.now() + 10000;
      while (!check()) {
        if (performance.now() > end) throw Error('Terrain did not load');
        await wait(50);
      }
    }
    // Two native photos in rural Pawnee County share the middle of this 2 km region.
    const [rx, ry] = [-35, -12], x = rx*2048 + 512, y = ry*2048 + 256;
    if (!(ground.fullRegions.get(rx + ',' + ry)?.[2] & 2)) throw Error('Missing Pawnee fixture');
    g.paused = true;
    settings.applyPreset('ultra');
    await g.world.update(x, y);
    g.player.ped.x = cam.x = x; g.player.ped.y = cam.y = y;
    cam.viewH = 46; cam.updateDerived();
    renderer.night = 0.9; renderer.rain = 0.8;
    let left, right;
    await until(() => {
      left = ground.surveyAt(x-1, y, 48);
      right = ground.surveyAt(x+1, y, 48);
      return left?.span === 512 && right?.span === 512;
    });
    await until(() => ground.photoMaterials.images?.has('grassGrain') && [...ground.reliefImages.values()].some(e => e.ready));
    const materials = ground.photoMaterials.images.size, relief = ground.reliefImages.size;
    function border(entry, col) {
      const c = document.createElement('canvas');
      c.width = 1; c.height = entry.image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(entry.image, col, 0, 1, c.height, 0, 0, 1, c.height);
      return ctx.getImageData(0, 0, 1, c.height).data;
    }
    // The right gutter and its neighbor's first interior column cover the same ground.
    const a = border(left, left.image.width-1), b = border(right, 1);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (i%4 !== 3) diff += Math.abs(a[i]-b[i]);
    const seam = diff/(a.length*0.75);
    const positions = new WeakMap();
    let recycled = 0, snapshots = 0;
    const bakers = new Set(), bake = ground.renderTile;
    ground.renderTile = function (...args) {
      const tile = bake.apply(this, args);
      if (typeof tile.canvas.close === 'function') {
        snapshots++;
        bakers.add(this.tileBaker);
      }
      return tile;
    };
    function usage() {
      let bytes = 0, ppm = 0;
      for (const tile of ground.cache.values()) {
        const previous = positions.get(tile.canvas);
        if (previous && (previous.tx !== tile.tx || previous.ty !== tile.ty)) recycled++;
        positions.set(tile.canvas, tile);
        bytes += tile.canvas.width * tile.canvas.height * 4;
        if (tile.lvl === ground.level && tile.used === ground.frame) ppm = tile.canvas.width/tile.span;
      }
      if (ground.cacheBytes !== bytes || bytes > ground.cacheBudget) throw Error('Ground cache exceeded its budget');
      return { bytes, ppm, frame: [cam.W, cam.H], patches: ground.detailImages.size };
    }
    let peak = 0;
    for (let step = 0; step < 18; step++) {
      cam.x = g.player.ped.x = x + 15*step;
      await wait(65);
      peak = Math.max(peak, usage().bytes);
    }
    const ultra = usage();
    // At 4K this street view used to alternate between 32 and 48 texels/m
    // when the margin around the screen crossed a tile boundary.
    const streetLevels = new Set();
    cam.viewH = 64;
    cam.updateDerived();
    cam.x = x + 16;
    for (const offset of [0, 16, 32, 48]) {
      cam.y = y + offset;
      ground.draw(renderer.ctx, cam, true, 0);
      streetLevels.add(ground.level);
    }
    settings.applyPreset('low');
    await until(() => ground.quality === 0 && usage().ppm > 0);
    const low = usage();
    let overview;
    await until(() => (overview = ground.surveyAt(x, y, 8))?.ready);
    if (!left.opaque || !right.opaque || !overview.opaque) throw Error('Full-coverage imagery lost its opacity flag');
    return { ultra, low, peak, seam, materials, relief, recycled, snapshots, bakers: bakers.size, streetLevels: streetLevels.size,
      photoWidth: right.image.width, overviewWidth: overview?.image.width };
  });
  assert.deepEqual(result.ultra.frame, [3840, 2160]);
  assert.ok(result.ultra.ppm >= 48);
  assert.deepEqual(result.low.frame, [1280, 720]);
  assert.ok(result.low.ppm <= 8);
  assert.equal(result.low.patches, 0);
  if (result.snapshots) {
    assert.ok(result.snapshots > 1, 'Travel should bake multiple immutable terrain images');
    assert.equal(result.bakers, 1, 'All immutable tiles should share one working surface');
  } else {
    assert.ok(result.recycled > 0, 'Travel should reuse evicted mutable terrain surfaces');
  }
  assert.equal(result.streetLevels, 1, 'Street camera density must stay stable while panning');
  assert.equal(result.photoWidth, 856);
  assert.equal(result.overviewWidth, 514);
  assert.ok(result.seam < 10, JSON.stringify(result));
  const changed = await page.evaluate(async () => {
    const { S, MASK_N } = await import('/src/world/shared.js');
    const surface = [S.LAWN, S.BUILDING, S.WATER, S.ROAD, S.LAWN, S.FARM, S.DIRT, S.PARKING];
    const color = ['#609747', '#609747', '#609747', '#609747', '#aaa', '#ae7950', '#ae7950', '#ae7950'];
    const image = document.createElement('canvas'), dest = document.createElement('canvas');
    image.width = image.height = 8; dest.width = dest.height = 16;
    const src = image.getContext('2d'), ctx = dest.getContext('2d'), mask = new Uint8Array(MASK_N*8);
    for (let i = 0; i < surface.length; i++) { src.fillStyle = color[i]; src.fillRect(i, 0, 1, 8); }
    for (let row = 0; row < 8; row++) mask.set(surface, row*MASK_N);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 16, 16);
    // Exaggerate the microstructure to verify exactly where it is allowed to draw.
    __game.renderer.ground.drawCoverGrain.call({
      world: { regionAt: () => ({ ox: 0, oy: 0, mask }) },
      photoMaterials: { pattern: () => '#fff' }
    }, ctx, { image, left: 0, top: 0, span: 16, gutter: 0 }, 0, 0, 16);
    const row = ctx.getImageData(0, 8, 16, 1).data;
    return surface.map((_, i) => row[(2*i+1)*4] > 128);
  });
  assert.deepEqual(changed, [true, false, false, false, false, true, true, false]);
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (new URL(req.url()).pathname.startsWith('/assets/map/ground/full/-35_-12/15.')) req.abort();
    else req.continue();
  });
  await page.evaluate(async () => (await import('/src/engine/settings.js')).settings.applyPreset('high'));
  await page.waitForFunction(() => {
    const g = __game.renderer.ground;
    const photo = g.surveyAt(-35*2048 + 1792, -12*2048 + 1792, 16);
    return g.detailImages.get('full/-35_-12/15')?.failed && photo?.ready && photo.span === 2048;
  });
  assert.deepEqual(errors, []);
  console.log(result);
} finally {
  await browser.close();
}
