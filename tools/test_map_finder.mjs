// With the local game server running, exercise destination search, route ownership,
// footprint arrival and resume through the map controls a player uses.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const url = `http://localhost:${process.env.PORT || 8137}/?nomission&autostart=`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 760 }
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url + 'new');
  await page.waitForFunction(() => window.__game?.player && !__game.ui.open);
  await page.keyboard.down('m');
  await page.waitForSelector('.mapview');
  await page.keyboard.up('m');
  const search = '.map-search input';
  const input = await page.$(search);
  await page.waitForFunction(() => document.activeElement?.className === 'mapview');
  assert.equal(await input.evaluate((el) => el.getAttribute('aria-expanded')), 'false');

  await page.keyboard.press('/');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.map-search input'));
  await page.keyboard.type('BOK Center');
  await page.waitForFunction(
    () => document.querySelector('.map-matches strong')?.textContent === 'BOK Center'
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => __game.gps.route?.length && !__game.gps.pending && __game.waypointLabel === 'BOK Center'
  );
  assert.equal(await page.evaluate(() => __game.gps.source === __game.waypoint && !__game.gps.partial), true);
  await page.waitForFunction(() => document.querySelector('.map-route small')?.textContent.includes('Walking route'));
  assert.equal(await page.evaluate(() => __game.gps.turns.some(t => t.action === 'Take exit')), false);

  await page.waitForFunction(() => document.querySelector('[data-fit]').textContent === 'Zoom to pin');
  const streamed = await page.evaluate(() => [...__game.world.regions.keys()].sort());
  // The map paints street names from worker tiles, without moving the player.
  await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype,
      fill = proto.fillText;
    window.mapStreetLabels = new Set();
    proto.fillText = function (text, ...args) {
      if (this.canvas.parentElement?.className === 'mapview' && /\b(St|Ave|Dr|Blvd|Rd)\b/.test(text)) {
        window.mapStreetLabels.add(text);
      }
      return fill.call(this, text, ...args);
    };
  });
  await page.click('[data-fit]');
  await page.waitForFunction(() => document.querySelector('[data-fit]').textContent === 'Show route');
  await page.waitForFunction(() => mapStreetLabels.size > 2);
  assert.deepEqual(await page.evaluate(() => [...__game.world.regions.keys()].sort()), streamed);
  await page.click('[data-player]');
  await page.evaluate(() =>
    __game.markers.push({ x: __game.player.x + 1000, y: __game.player.y, label: 'Meet the crew' })
  );
  await page.click('[data-clear]');
  await page.waitForFunction(
    () => document.querySelector('.map-route strong')?.textContent === 'Meet the crew'
  );

  await page.click(search);
  await page.keyboard.type('Catoosa');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => __game.gps.source === __game.waypoint && __game.waypointLabel === 'Catoosa'
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !__game.ui.open && !__game.paused);
  await page.evaluate(() => __game.save('slot1'));
  // The BOK Center's pin is 64 metres inside the arena. The south wall
  // counts as arrival even though the player cannot reach the center pin.
  await page.evaluate(async () => {
    const g = __game,
      arena = g.places.bok_center;
    g.paused = true;
    g.setWaypoint([arena.x, arena.y], arena.name);
    const x = -314.3,
      y = 215;
    await g.world.update(x, y);
    g.player.ped.x = g.cam.x = x;
    g.player.ped.y = g.cam.y = y;
    g.paused = false;
  });
  await page.waitForFunction(
    () => !__game.waypoint && __game.hud.msgs.some((m) => m.text === 'Arrived at BOK Center')
  );
  await page.goto(url + 'continue');
  await page.waitForFunction(() => window.__game?.waypointLabel === 'Catoosa' && __game.gps.route?.length);

  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 2 });
  await page.keyboard.down('m');
  await page.waitForSelector('.mapview');
  await page.keyboard.up('m');
  await page.click(search);
  await page.keyboard.type('not-a-real-name-123');
  await page.waitForFunction(
    () => document.querySelector('.map-paging span').textContent === 'No matching destinations'
  );
  assert.ok(await page.$eval('.map-panel', (el) => el.getBoundingClientRect().right <= innerWidth));
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval(search, (el) => el.getAttribute('aria-expanded')), 'false');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !__game.ui.open && !__game.paused);
  await page.waitForFunction(() => performance.now() - __game.ui.lastClose > 120);
  // Put a car within boarding distance then enter and leave using the actual controls.
  await page.evaluate(() => {
    const g = __game;
    g.cheats.spawnCar('motherroad_jetfin');
    const car = g.vehicles.at(-1);
    car.x = g.player.x + 3;
    car.y = g.player.y;
  });
  await page.waitForFunction(() => __game.nearbyVehicles(__game.player.x, __game.player.y, 6).some(v => v.m.id === 'motherroad_jetfin'));
  await page.keyboard.press('f');
  await page.waitForFunction(() => __game.player.vehicle && __game.gps.mode === 'road' && __game.gps.route?.length && !__game.gps.pending);
  assert.equal(await page.evaluate(() => __game.waypointLabel), 'Catoosa');
  await page.keyboard.press('f');
  await page.waitForFunction(() => !__game.player.vehicle && __game.gps.mode === 'walk' && __game.gps.route?.length && !__game.gps.pending);
  assert.equal(await page.evaluate(() => __game.waypointLabel), 'Catoosa');
  assert.deepEqual(errors, []);
  console.log(
    'Destination search, street labels, mission routing, arena arrival, saved waypoints, walking/driving transfers and compact map controls passed.'
  );
} finally {
  await browser.close();
}
