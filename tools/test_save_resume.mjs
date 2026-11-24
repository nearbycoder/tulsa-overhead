// Exercise Quick Save, title-screen Continue and safehouse rest in a disposable browser profile.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const url = 'http://localhost:' + (process.env.PORT || 8137);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.waitForFunction(() => window.__game?.player && !__game.ui.open);
  async function resume() {
    await page.goto(url + '/?nomission');
    await page.locator('button::-p-text(Continue)').click();
    await ready();
  }
  await page.goto(url + '/?autostart=new&nomission');
  await ready();
  await page.click('#game');
  await page.waitForFunction(() => __game.audio.ready);
  await page.evaluate(async () => {
    const g = __game, p = g.player.ped;
    const v = g.spawnHelicopter('tallgrass_skywatch');
    // Hover over the Arkansas River. Continuing on foot here would drown the pilot.
    g.paused = true;
    const [x, y] = [-1845.42, 908.61];
    await g.world.update(x, y);
    Object.assign(v, {x, y, h: 1.2, alt: 30, heliAltTarget: 30, health: 493});
    g.cam.x = p.x = x; g.cam.y = p.y = y;
    p.give('bat'); p.give('knife'); p.give('pistol', 51);
    p.clip.pistol = 3; p.weapon = 'pistol';
    g.setRadio(2);
    g.paused = false;
  });
  await page.keyboard.down('Escape');
  await page.locator('button::-p-text(Quick Save)').wait();
  await page.keyboard.up('Escape');
  await page.locator('button::-p-text(Quick Save)').click();
  await page.waitForFunction(() => !!localStorage.getItem('gtpolly.save.slot1'));
  const read = () => page.evaluate(() => {
    const g = __game, p = g.player.ped, v = g.player.vehicle;
    return {
      ride: v && {id: v.m.id, x: v.x, y: v.y, h: +v.h.toFixed(6), z: +v.z.toFixed(3), alt: v.alt, health: v.health, paint: v.paint, pilot: v.driver === p},
      stolen: g.player.stats.carsStolen, bat: p.hasWeapon('bat'), knife: p.hasWeapon('knife'),
      weapon: p.weapon, rounds: p.ammo.pistol, loaded: p.clip.pistol
    };
  });
  const before = await read();
  await resume();
  await page.waitForFunction(() => __game.audio.radio?.current === 2);
  assert.deepEqual(await read(), before);

  // Continue in a boat on the river, then in a repainted car on a real raised road.
  for (const kind of ['boat', 'car']) {
    await page.evaluate(kind => {
      const g = __game, pl = g.player, Vehicle = pl.vehicle.constructor;
      const model = kind === 'boat' ? g.assets.vehicles.find(v => v.kind === 'boat') : g.assets.vehicle('osage_homestead');
      let x = pl.x, y = pl.y, z = 0, h = pl.vehicle.h;
      if (kind === 'car') {
        const road = [...g.world.regions.values()].flatMap(r => r.roads || [])
          .find(r => r.z?.some((height, i) => i > 0 && height === r.z[i - 1] && height > 4));
        const i = road.z.findIndex((height, i) => i > 0 && height === road.z[i - 1] && height > 4);
        const [ax, ay, bx, by] = road.pts.slice(i * 2 - 2, i * 2 + 2);
        x = (ax + bx) / 2; y = (ay + by) / 2; z = road.z[i]; h = Math.atan2(by - ay, bx - ax);
      }
      g.exitVehicle(pl.ped, true);
      const v = new Vehicle(g, model, x, y, h, kind === 'car' ? 3 : -1);
      v.z = z; v.health = 423; g.addVehicle(v); g.enterVehicle(pl.ped, v);
      g.cam.x = x; g.cam.y = y;
      if (!g.save('slot1')) throw new Error('Vehicle save failed');
      g.paused = true;
    }, kind);
    const parked = await read();
    await resume();
    assert.deepEqual(await read(), parked);
  }

  // Version 1 saves recorded infinite melee ammo as JSON null and had no vehicle or magazine.
  await page.evaluate(() => {
    const slot = 'gtpolly.save.slot1', old = JSON.parse(localStorage.getItem(slot));
    Object.assign(old, {v: 1, x: -1845.42, y: 908.61, weapon: 'knife'});
    old.ammo.bat = old.ammo.knife = null;
    delete old.vehicle; delete old.clip;
    localStorage.setItem(slot, JSON.stringify(old));
  });
  await resume();
  const legacy = await read();
  assert.equal(legacy.ride, null);
  assert.ok(legacy.bat && legacy.knife);
  assert.equal(legacy.weapon, 'knife');
  assert.equal(legacy.loaded, 15);
  assert.ok(await page.evaluate(() => {
    const g = __game, p = g.player.ped;
    return Math.hypot(p.x + 1845.42, p.y - 908.61) < 1000 && g.world.surfaceAt(p.x, p.y) !== 1 && p.drown === 0;
  }));

  await page.evaluate(async () => {
    const g = __game, p = g.player.ped;
    const home = g.services.find(s => s.type === 'safehouse' && g.isSafehouseUnlocked(s));
    await g.world.update(home.x, home.y);
    p.x = g.cam.x = home.x; p.y = g.cam.y = home.y;
    p.health = 27; g.clock = 21 * 60; g.day = 5; g.clockFrozen = true;
  });
  await page.waitForFunction(() => __game.prompt?.includes('save'));
  await page.keyboard.down('f');
  await page.waitForFunction(() => __game.player.ped.health === 100);
  await page.keyboard.up('f');
  const rested = await page.evaluate(() => JSON.parse(localStorage.getItem('gtpolly.save.slot1')));
  assert.deepEqual([rested.day, rested.clock, rested.health], [6, 180, 100]);
  await resume();
  assert.equal(await page.evaluate(() => __game.day === 6 && __game.clock >= 180 && __game.clock < 181 && __game.player.ped.health === 100), true);

  await page.evaluate(() => {
    __game.clockFrozen = true;
    __game.clock = 1234;
    __game.player.ped.health = 44;
    Storage.prototype.setItem = () => { throw new DOMException('simulated quota', 'QuotaExceededError'); };
  });
  await page.keyboard.down('f');
  await page.waitForFunction(() => __game.hud.msgs.some(m => m.text.includes('save failed') || m.text.includes('Save failed')));
  await page.keyboard.up('f');
  assert.deepEqual(await page.evaluate(() => [__game.day, __game.clock, __game.player.ped.health]), [6, 1234, 44]);
  // The safehouse cannot replace the last good save while a mission is in progress.
  const missionPrompt = await page.evaluate(async () => {
    const g = __game, save = localStorage.getItem('gtpolly.save.slot1');
    g.missions.start(g.missions.story.MISSIONS.c1m1);
    g.updateServices(0);
    const prompt = g.prompt, active = !!g.missions.active;
    return {active, prompt, saved: save === localStorage.getItem('gtpolly.save.slot1')};
  });
  assert.ok(missionPrompt.active && missionPrompt.saved && !missionPrompt.prompt?.includes('save'));
  assert.deepEqual(errors, []);
  console.log('Restored flight, boat, painted car on a bridge, inventory and magazine. Legacy shoreline recovery, overnight rest, mission gating and failed save passed.');
} finally {
  await browser.close();
}
