// Drive the normal game with real browser touch pointers, including simultaneous thumbs.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.padQueries = 0;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value() {
      padQueries++;
      throw new DOMException('Gamepad disabled by this document', 'SecurityError');
    } });
  });
  page.setDefaultTimeout(12000);
  const viewport = (width, height) => page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await viewport(390, 844);
  const origin = 'http://localhost:' + (process.env.PORT || 8137);
  await page.goto(origin + '/?nomission');
  await page.waitForSelector('.title button.item');
  assert.equal(await page.$eval('.touch-controls', el => el.hidden), true);
  await page.tap('button::-p-text(New Game)');
  const controls = '.touch-controls ';
  const sel = action => controls + '[data-action=' + action + ']';
  const activate = action => page.tap(sel(action));
  const mode = expected => page.waitForFunction(mode => document.querySelector('.touch-controls').dataset.mode === mode &&
      !document.querySelector('.touch-controls').hidden, {}, expected);
  await mode('foot');
  await page.evaluate(async () => { window.controlsInput = (await import('/src/engine/input.js')).input; });
  const center = selector => page.$eval(selector, el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  });
  const cdp = await page.createCDPSession();
  const send = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const finger = (pos, id) => ({ ...pos, id, radiusX: 2, radiusY: 2, force: 1 });

  // Thumbstick reaches both walk and sprint while the other thumb aims independently.
  await page.evaluate(() => __game.player.ped.give('pistol', 100));
  await activate('nextWeapon');
  await page.waitForFunction(() => __game.player.ped.weapon === 'pistol');
  const stick = await center(sel('move')), fire = await center(sel('fire'));
  await send('touchStart', [finger(stick, 1)]);
  const right = finger({ x: stick.x + 50, y: stick.y }, 1);
  await send('touchMove', [right]);
  await page.waitForFunction(() => controlsInput.moveAxis().x > 0.95 && controlsInput.isDown('sprint') && __game.player.ped.moveSpeed > 6);
  await send('touchStart', [right, finger(fire, 2)]);
  await send('touchMove', [right, finger({ x: fire.x, y: fire.y - 35 }, 2)]);
  await page.waitForFunction(() => controlsInput.aimAxis()?.y < -.95 && controlsInput.moveAxis().x > .95 &&
    __game.player.stats.shots > 0 && __game.player.ped.face < -1.4);
  await send('touchCancel');
  assert.equal(await page.evaluate(() => !controlsInput.isDown('fire') && !controlsInput.isDown('sprint') &&
    controlsInput.moveAxis().x === 0 && controlsInput.aimAxis() === null), true);

  // A parked car on a real road. Enter and operate it with the same UI as a player.
  await page.evaluate(async () => {
    const g = __game, p = g.player.ped;
    const { Vehicle } = await import('/src/entities/vehicle.js');
    const { cum, pointAt, laneOffset } = await import('/src/game/roads.js');
    [p.x, p.y] = g.world.project(36.05265, -95.79066);
    g.cam.x = p.x; g.cam.y = p.y;
    await g.world.update(p.x, p.y);
    const near = g.world.nearestRoad(p.x, p.y, 200, road => road.cls <= 4);
    cum(near.road);
    const [x, y, dx, dy] = pointAt(near.road, 1, near.s, laneOffset(near.road, 0), []);
    p.x = x; p.y = y;
    const car = new Vehicle(g, g.assets.vehicle('cimarron_thunderhead'), x + dx, y + dy, Math.atan2(dy, dx), 0);
    car.persist = true; g.addVehicle(car);
  });
  await activate('enter');
  await mode('drive');
  const gas = finger(await center(sel('accel')), 4);
  await send('touchStart', [gas]);
  const steering = finger({ x: stick.x - 18, y: stick.y }, 3);
  await send('touchStart', [gas, steering]);
  await page.waitForFunction(() => __game.player.vehicle.ctrl.throttle === 1 && __game.player.vehicle.ctrl.steer < -.15 &&
    Math.abs(__game.player.vehicle.vf) > 0.15);
  await send('touchCancel');
  const pedal = finger(await center(sel('brake')), 5);
  await send('touchStart', [pedal]);
  await page.waitForFunction(() => __game.player.vehicle.ctrl.brake === 1 && __game.player.vehicle.ctrl.throttle === 0);
  await send('touchEnd');
  await activate('more');
  await page.waitForSelector('#touch-more:not([hidden])');
  await activate('horn');
  await page.waitForSelector('#touch-more[hidden]');
  await activate('map');
  await page.waitForSelector('.mapview');
  assert.equal(await page.$eval('.touch-controls', el => el.hidden), true);
  const closeMap = await page.$('.mapview [data-close]');
  assert.ok(closeMap, 'Map has a touch-accessible close button');
  await closeMap.tap();
  await mode('drive');

  // Rotate and switch to a tablet viewport. Use the pause menu to obtain a helicopter.
  await viewport(844, 390);
  await page.waitForFunction(() => window.innerWidth === 844 && performance.now() - (__game.ui.lastClose || 0) > 150);
  await activate('pause');
  await page.waitForSelector('button::-p-text(Spawn Helicopter)');
  await page.tap('button::-p-text(Spawn Helicopter)');
  await page.waitForSelector('button::-p-text(Sentinel Air Unit)');
  await page.tap('button::-p-text(Sentinel Air Unit)');
  await mode('heli');
  await viewport(1024, 768);
  await page.waitForFunction(() => window.innerWidth === 1024 && performance.now() - (__game.ui.lastClose || 0) > 150);
  // Some aircraft spool up on entry. Land first, then exercise a fresh takeoff.
  if (await page.$eval(sel('handbrake'), el => el.textContent === 'Land')) {
    await activate('handbrake');
    await page.waitForFunction(() => __game.player.vehicle.heliAltTarget === 0 && __game.player.vehicle.alt < .1);
  }
  await activate('handbrake');
  await page.waitForFunction(() => __game.player.vehicle.alt > .5 && document.querySelector('.touch-buttons [data-action=handbrake]').textContent === 'Land');
  await activate('handbrake');
  await page.waitForFunction(() => __game.player.vehicle.heliAltTarget === 0 && __game.player.vehicle.alt < 1);
  await activate('enter');
  await mode('foot');
  assert.equal(await page.evaluate(() => controlsInput.lastDevice), 'touch');
  await page.keyboard.press('KeyW');
  await page.waitForFunction(() => document.querySelector('.touch-controls').hidden && !document.body.classList.contains('touch-input'));
  await page.touchscreen.tap(500, 390);
  await mode('foot');
  assert.ok(await page.evaluate(() => padQueries > 0 && padQueries <= Math.ceil(performance.now() / 1000) + 1));
  await page.evaluate(() => {
    window.pad = { id: 'Xbox', index: 0, connected: true, axes: [0, 0, 0, 0], buttons: [] };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await page.waitForFunction(() => controlsInput.gamepad === pad);
  assert.equal(await page.evaluate(() => controlsInput.lastDevice), 'touch');
  await page.evaluate(() => { pad.axes[0] = .8; });
  await page.waitForFunction(() => controlsInput.usingPad && document.querySelector('.touch-controls').hidden);
  assert.deepEqual(errors, []);
  console.log('Touch-only walking, sprinting, directional fire, car entry, simultaneous gas/steer, braking, map, menus, helicopter flight, input cancellation, rotation and keyboard/gamepad switching passed.');
} finally { await browser.close(); }
