import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?autostart=new&nomission');
  await page.waitForFunction(() => window.__game?.player && !__game.ui.open);
  const listeners = () => page.evaluate(() => Object.values(window.testWorld.listeners).map(group => group.length));
  await page.evaluate(() => { window.testWorld = __game.world; });
  const playingListeners = await listeners();
  const button = label => page.locator('button::-p-text(' + label + ')');
  async function pause() {
    await page.waitForFunction(() => !__game.ui.open && performance.now() - (__game.ui.lastClose || 0) > 120);
    await page.keyboard.press('Escape');
    await button('Quit to Title').wait();
  }

  await pause();
  await button('Quick Save').click();
  const manual = await page.evaluate(() => JSON.parse(localStorage.getItem('gtpolly.save.slot1')));
  await pause();
  await button('Story').click();
  await page.waitForSelector('.story-journal');
  assert.match(await page.$eval('.story-journal', el => el.textContent), /After Homecoming/);
  await button('Route to contact').click();
  await page.waitForFunction(() => __game.waypointLabel === 'Homecoming' && !__game.paused);
  await page.evaluate(() => {
    const g = __game, start = g.missions.place('mama_june_house');
    g.flags.journalFixture = { beforeMission: true };
    g.player.money = 327;
    g.player.ped.x = start.x;
    g.player.ped.y = start.y;
  });
  await page.waitForFunction(() => __game.missions.active?.transcript?.length);
  await pause();
  await button('Story').click();
  await page.click('.journal-transcript summary');
  assert.equal(await page.$eval('.dialog', el => getComputedStyle(el).visibility), 'hidden');
  assert.match(await page.$eval('.journal-transcript dd', el => el.textContent), /parole board/);
  assert.equal(await page.evaluate(() => __game.ui.stack.at(-2).inert), true);
  assert.equal(await page.$$eval('.journal-mission button', els => els.length), 0);
  await button('Back').click();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Story');
  // Exercise write failure in this isolated browser context, then retry normally.
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
    __game.player.money = 17;
    __game.flags.journalFixture.beforeMission = false;
  });
  await button('Quit to Title').click();
  await page.waitForFunction(() => __game.paused && document.querySelector('.toast').textContent.includes('Save failed'));
  assert.equal(await page.evaluate(() => __game.missions.active.def.id), 'c1m1');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; window.testPreviousHud = __game.hud; });
  await button('Quit to Title').click();
  await button('Continue').wait();
  assert.equal(await page.evaluate(() => window.__game), null);
  const oldHud = await page.evaluate(() => {
    const hud = window.testPreviousHud;
    delete window.testPreviousHud;
    hud.radarScale = 7;
    hud.canvas.dispatchEvent(new Event('contextrestored'));
    return [hud.radar.width, hud.radarScale];
  });
  assert.deepEqual(oldHud, [0, 7], 'Disposed HUD released its radar and detached its canvas listener');
  const titleListeners = await listeners();
  assert.ok(titleListeners[0] < playingListeners[0], 'Session map listeners should detach on quit');
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('gtpolly.save.auto')));
  assert.equal(snapshot.money, 327);
  assert.equal(snapshot.restartMission, 'c1m1');
  assert.deepEqual(snapshot.flags.journalFixture, { beforeMission: true });
  await button('Continue').click();
  await page.waitForFunction(() => window.__game?.ui.game === __game && __game.missions.active?.def.id === 'c1m1'
    && __game.player.money === 327 && __game.missions.active.transcript?.length);
  await pause();
  assert.deepEqual(await listeners(), playingListeners);
  await button('Quit to Title').click();
  await button('Load Game').click();
  assert.deepEqual(await listeners(), titleListeners);
  assert.match(await page.$eval('.menu button.item small', el => el.textContent), /Restart Homecoming/);
  await button('Manual save').click();
  await page.waitForFunction(money => window.__game?.ui.game === __game && __game.player.money === money
    && !__game.missions.active && !__game.flags.journalFixture, {}, manual.money);
  assert.deepEqual(await listeners(), playingListeners);
  assert.deepEqual(errors, []);
  console.log('Story routing, transcript, failed save recovery, mission restart and manual slot selection passed.');
} finally {
  await browser.close();
}
