// Run against a local GTPolly server. The mission fails through the real courier destruction condition.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = 'http://localhost:' + (process.env.PORT || 8137) + '/?nomission&autostart=';
  await page.goto(base + 'new&chapter=2');
  await page.waitForFunction(() => window.__game?.player && !__game.ui.open);

  async function moveTo(where) {
    await page.evaluate(async where => {
      const g = __game;
      const p = where === 'contact' ? g.missions.place(g.missions.story.MISSIONS.c2m1.start)
        : g.services.find(s => s.type === 'safehouse' && g.isSafehouseUnlocked(s));
      await g.world.update(p.x, p.y);
      g.player.ped.x = g.cam.x = p.x;
      g.player.ped.y = g.cam.y = p.y;
    }, where);
  }
  async function wreckCourier() {
    await page.waitForFunction(() => {
      __game.ui.dialog.hide();
      return [...(__game.missions.active?.entities || [])].some(e => e.blip === '#e8b030');
    });
    await page.evaluate(() => {
      const g = __game, entities = [...g.missions.active.entities];
      window.attemptCast = entities;
      g.combat.explodeVehicle(entities.find(e => e.blip === '#e8b030'));
    });
    await page.waitForFunction(() => __game.missions.quickRetry && /wrecked the courier/.test(__game.missions.lastResult.msg));
  }
  async function checkRestart() {
    await page.waitForFunction(() => __game.missions.active?.def.id === 'c2m1' && !__game.missions.retryOffer);
    assert.equal(await page.evaluate(() => {
      const g = __game, p = g.missions.place(g.missions.active.def.start);
      return !g.ui.open && !g.paused && Math.hypot(g.player.x-p.x, g.player.y-p.y) < 4 &&
        !(window.attemptCast || []).some(e => g.vehicles.includes(e) || g.peds.includes(e));
    }), true);
  }

  await moveTo('contact');
  await wreckCourier();
  // Waiting inside the start marker used to reopen the dialogue automatically.
  await page.waitForFunction(() => __game.missions.cooldown <= 0);
  assert.equal(await page.evaluate(() => __game.missions.active), null);
  await moveTo('safehouse');
  await page.waitForFunction(() => __game.prompt?.includes('save game'));
  assert.ok(!await page.evaluate(() => __game.prompt.includes('catch a ride')));
  await page.keyboard.press('t');
  await checkRestart();

  // The shortcut expires during play, while the pause-menu choice survives save and load.
  await wreckCourier();
  await page.evaluate(() => { __game.missions.retryOffer.t = 0.03; });
  await page.waitForFunction(() => __game.missions.canRetry && !__game.missions.quickRetry);
  await page.evaluate(() => __game.save('slot1'));
  await page.goto(base + 'continue');
  await page.waitForFunction(() => window.__game?.missions?.canRetry && !__game.ui.open);
  assert.equal(await page.evaluate(() => __game.missions.quickRetry), false);
  await page.keyboard.press('Escape');
  await page.locator('button::-p-text(Story)').click();
  await page.locator('button::-p-text(Retry)').click();
  await checkRestart();
  assert.deepEqual(errors, []);
  console.log('Jenks failure waited at the contact, T retried from a safehouse, and Story retried after saving and loading.');
} finally {
  await browser.close();
}
