// Run with the game server up. Each route uses real simulation, world streaming,
// Canvas rendering and HUD on a fresh page. Frame work excludes waiting for vsync.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const base = process.env.BASE_URL || 'http://localhost:8137';
const preset = process.env.PRESET || 'low';
const rate = Number(process.env.CPU_RATE || 4);
const frames = Number(process.env.FRAMES || 480);
const profile = process.env.PROFILE || 'desktop';
const routes = process.argv.slice(2);
if (!routes.length) routes.push('drive', 'flight');
assert.ok(routes.every(route => ['drive', 'flight'].includes(route)));
assert.ok(['desktop', 'phone-software'].includes(profile));
assert.ok(Number.isInteger(frames) && frames >= 60 && Number.isFinite(rate) && rate >= 1);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: profile === 'desktop' ? { width: 1280, height: 720 }
    : { width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  args: ['--mute-audio', ...(profile === 'desktop' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
    : ['--disable-gpu', '--disable-accelerated-2d-canvas'])],
});
try {
  for (const route of routes) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/package.json');
    await page.evaluate(async ({ route, preset }) => {
      const viewport = document.createElement('meta');
      viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1';
      document.head.append(viewport);
      Date.now = () => 1722555000000;
      let seed = 122345;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const [{ World }, { Assets }, { Camera }, { Renderer }, { Game }, { Vehicle },
        { settings, PRESETS }, { pointAt, cum, laneOffset }, { input }] = await Promise.all([
        import('/src/world/world.js'), import('/src/game/assets.js'), import('/src/engine/camera.js'),
        import('/src/engine/renderer.js'), import('/src/game/game.js'), import('/src/entities/vehicle.js'),
        import('/src/engine/settings.js'), import('/src/game/roads.js'), import('/src/engine/input.js'),
      ]);
      if (!PRESETS[preset] || preset === 'auto') throw new Error('Choose a fixed graphics preset for comparison.');
      settings.applyPreset(preset);
      const canvas = document.createElement('canvas'), hudCanvas = document.createElement('canvas');
      document.body.replaceChildren(canvas, hudCanvas);
      for (const c of [canvas, hudCanvas]) c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
      const world = new World('assets/map'), assets = new Assets();
      await Promise.all([world.init(), assets.load()]);
      const [x, y] = route === 'drive' ? world.project(36.1531, -95.9905) : world.project(36.0526, -95.7905);
      await world.update(x, y);
      const cam = new Camera(), renderer = new Renderer(canvas, world, cam);
      const noop = () => {};
      const audio = { ready: false, play: () => ({ stop: noop, setPos: noop, setState: noop }),
        stopVoice: noop, setVoicePaused: noop, createLoop: () => null, createEngine: () => null, createSiren: () => null,
        playMusic: noop, stopMusic: noop, setMusicIntensity: noop };
      const game = new Game({ world, cam, assets, renderer, hudCanvas, ui: {}, audio });
      const near = world.nearestRoad(x, y, 120, road => road.cls <= 4);
      cum(near.road);
      const [sx, sy, dx, dy] = pointAt(near.road, 1, near.s, laneOffset(near.road, 0), []);
      game.spawnPlayer(sx, sy, 0);
      const model = assets.vehicle(route === 'drive' ? 'cimarron_thunderhead' : 'tallgrass_skywatch');
      const vehicle = new Vehicle(game, model, sx, sy, route === 'drive' ? Math.atan2(dy, dx) : -2.5, 0);
      if (route === 'flight') vehicle.alt = vehicle.heliAltTarget = 38;
      game.addVehicle(vehicle);
      game.enterVehicle(game.player.ped, vehicle);
      for (let i = 0; i < 300; i++) game.update(1 / 30);
      if (route === 'drive') game.setWaypoint(world.project(36.159, -95.993));
      for (let i = 0; i < 65; i++) {
        await new Promise(requestAnimationFrame);
        game.render(1 / 60);
        game.hud.draw();
      }
      input.down.add('KeyW');
      window.routeGame = game;
    }, { route, preset });
    const client = await page.createCDPSession();
    await client.send('Emulation.setCPUThrottlingRate', { rate });
    const result = await page.evaluate(async count => {
      const g = window.routeGame, tick = [], scene = [], hud = [], work = [], intervals = [];
      const startDistance = g.player.stats.distance;
      let previous, buildings = 0;
      for (let i = 0; i < count; i++) {
        const now = await new Promise(requestAnimationFrame);
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        const start = performance.now();
        g.update(1 / 30);
        const simDone = performance.now();
        g.render(1 / 30);
        const drawDone = performance.now();
        g.hud.draw();
        const end = performance.now();
        tick.push(simDone - start); scene.push(drawDone - simDone);
        hud.push(end - drawDone); work.push(end - start);
        buildings += g.renderer.stats.blds;
      }
      function stats(series) {
        series.sort((a, b) => a - b);
        const ms = n => Math.round(n * 100) / 100;
        return { mean: ms(series.reduce((s, t) => s + t, 0) / series.length),
          p95: ms(series[Math.floor(series.length * 0.95)]) };
      }
      return { frame: [g.cam.W, g.cam.H], distanceM: Math.round(g.player.stats.distance - startDistance),
        vehicles: g.vehicles.length, peds: g.peds.length, buildingsPerFrame: Math.round(buildings / count),
        updateMs: stats(tick), sceneMs: stats(scene), hudMs: stats(hud), frameWorkMs: stats(work),
        rafIntervalMs: stats(intervals), intervalsOver25ms: intervals.filter(ms => ms > 25).length };
    }, frames);
    assert.deepEqual(errors, []);
    assert.ok(result.distanceM > 1, 'The vehicle must travel during the benchmark');
    console.log(JSON.stringify({ route, preset, profile, rate, frames, ...result }));
    await page.close();
  }
} finally {
  await browser.close();
}
