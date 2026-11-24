// With the game server running, check successful and refused helicopter orders through the pause menu.
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
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?autostart=new&nomission');
  await page.waitForFunction(() => window.__game?.player && !__game.paused);

  async function order(model) {
    // Wait for the pause menu's input guard after the previous order closed it.
    await page.waitForFunction(() => !__game.ui.open && performance.now() - (__game.ui.lastClose || 0) > 120);
    await page.keyboard.down('Escape');
    const menu = page.locator('button::-p-text(Spawn Helicopter)');
    await menu.wait();
    await page.keyboard.up('Escape');
    await menu.click();
    await page.locator('button::-p-text(' + model + ')').click();
    await page.waitForFunction(() => !__game.ui.open && !__game.paused);
  }
  const flight = () => page.evaluate(() => {
    const g = __game, v = g.player.vehicle;
    return { id: v.id, model: v.m.id, pilot: v.driver === g.player.ped, x: v.x, y: v.y,
      altitude: v.alt, aircraft: g.vehicles.filter(other => other.isHeli).length };
  });

  await order('Sentinel Air Unit');
  const first = await flight();
  assert.equal(first.model, 'tallgrass_sentinel');
  assert.equal(first.pilot, true);
  await order('Skywatch');
  const second = await flight();
  assert.equal(second.model, 'tallgrass_skywatch');
  assert.notEqual(first.id, second.id);
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) > 10);

  // Both locations exceed the 60 m search radius, one in the Arkansas River
  // and one over the interior of a mapped building.
  for (const location of [[-1845.42, 908.61], [10975.55, 9646.83]]) {
    await page.evaluate(async ([x, y]) => {
      const g = __game, v = g.player.vehicle;
      g.paused = true;
      await g.world.update(x, y);
      Object.assign(v, { x, y, alt: 30, heliAltTarget: 30, vx: 0, vy: 0 });
      g.cam.x = g.player.ped.x = x;
      g.cam.y = g.player.ped.y = y;
      g.paused = false;
    }, location);
    const before = await flight();
    await order('Sentinel Air Unit');
    assert.deepEqual(await flight(), before);
    assert.match(await page.evaluate(() => __game.hud.msgs.at(-1)?.text), /clear landing area/i);
  }
  assert.deepEqual(errors, []);
  console.log('Both helicopter models spawned on land. Orders over water and an obstructed site preserved the flight.');
} finally {
  await browser.close();
}
