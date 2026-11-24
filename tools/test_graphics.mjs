// With npm start running, verify graphics presets via the in-game controls and actual canvas buffers.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const viewport = { width: 1280, height: 720, deviceScaleFactor: 1 };
  await page.setViewport(viewport);
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?autostart=new&nomission');
  await page.waitForFunction(() => window.__game?.player && !__game.ui.open);
  const size = () => page.$eval('#game', c => [c.width, c.height]);
  assert.deepEqual(await size(), [1280, 720]);
  await page.evaluate(() => {
    const game = __game, render = game.render.bind(game);
    window.worldDraws = 0;
    game.render = dt => { worldDraws++; render(dt); };
    window.waitFrames = async n => {
      for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
    };
  });
  await page.keyboard.press('Escape');
  await page.locator('button::-p-text(Settings)').click();
  await page.locator('button::-p-text(Graphics)').click();
  const pausedDraws = await page.evaluate(async () => {
    await waitFrames(2);
    const previous = worldDraws;
    await waitFrames(6);
    return worldDraws - previous;
  });
  assert.equal(pausedDraws, 0);
  await page.click('[data-preset=ultra]');
  assert.deepEqual(await size(), [3840, 2160]);
  await page.waitForFunction(() => __game.hud.canvas.width === 1280 && __game.renderer.ground.quality === 3);
  assert.equal(await page.$eval('#option-terrain-detail', e => e.value), '3');
  const layers = () => page.evaluate(() => {
    const r = __game.renderer;
    return [r.shadow.width, r.shadow.height, r.light.width, r.light.height];
  });
  assert.deepEqual(await layers(), [3840, 2160, 1920, 1080]);
  await page.click('[data-preset=low]');
  assert.deepEqual(await layers(), [1, 1, 640, 360]);
  assert.equal(await page.$eval('#option-terrain-detail', e => e.value), '0');
  await page.click('[data-preset=retro]');
  assert.deepEqual(await size(), [853, 480]);
  assert.deepEqual(await layers(), [1, 1, 1, 1]);
  await page.click('[data-preset=medium]');
  assert.deepEqual(await size(), [1920, 1080]);
  await page.select('#option-terrain-detail', '2');
  assert.equal(await page.$$eval('[data-preset][aria-pressed=true]', e => e.length), 0);
  await page.locator('button::-p-text(Display)').click();
  await page.select('#option-render-resolution', 'qhd');
  assert.deepEqual(await size(), [2560, 1440]);
  await page.select('#option-render-resolution', 'uhd');
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
  await page.waitForFunction(() => document.querySelector('[data-frame-size]').textContent.includes('3840'));
  assert.deepEqual(await size(), [3840, 2160]);
  await page.select('#option-render-resolution', 'native');
  assert.deepEqual(await size(), [3200, 1800]);
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.waitForFunction(() => document.querySelector('#game').width === 3840);
  assert.deepEqual(await size(), [3840, 2160]);
  await page.setViewport({ width: 1200, height: 500, deviceScaleFactor: 2 });
  await page.select('#option-render-resolution', 'uhd');
  assert.deepEqual(await size(), [3840, 1600]);
  // Persisted old settings restore their exact scale at Retina DPR.
  await page.evaluate(() => localStorage.setItem('gtpolly.settings.v1',
    JSON.stringify({ resolutionScale: 0.5, nativeHiDPI: true, preset: 'low', shadows: false })));
  await page.reload();
  await page.waitForFunction(() => window.__game?.player);
  assert.deepEqual(await size(), [1200, 500]);
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource')
    .some(entry => entry.name.includes('/props/crowns/'))), false);
  await page.evaluate(async () => (await import('/src/engine/settings.js')).settings.set('terrainDetail', 2));
  await page.waitForFunction(() => [...__game.assets.crowns.values()].some(entry => entry.sprite));
  assert.equal(await page.evaluate(() => {
    for (const [key, entry] of __game.assets.crowns) {
      if (!entry.sprite) continue;
      const original = __game.assets.props.get(key.replace('-distant', '').replace('_bloom', '')).sprite;
      if (Math.abs(entry.sprite.w * entry.sprite.px - original.w * original.px) > 1e-6 ||
          Math.abs(entry.sprite.h * entry.sprite.px - original.h * original.px) > 1e-6 ||
          Math.abs(entry.sprite.height - original.height) > 1e-6) return false;
    }
    return true;
  }), true);
  await page.evaluate(async () => (await import('/src/engine/settings.js')).settings.set('terrainDetail', 0));
  await page.waitForFunction(() => __game.assets.crowns.size === 0);
  assert.deepEqual(errors, []);
  console.log('4K, 1440p, 1080p, 720p, retro, Retina native, ultrawide, terrain tiers and legacy scale passed.');
} finally {
  await browser.close();
}
