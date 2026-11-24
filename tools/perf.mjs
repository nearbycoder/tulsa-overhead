import puppeteer from 'puppeteer-core';
const [settingsJson, out, lat, lon, keysSpec] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'], defaultViewport: { width: 1920, height: 1080 } });
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push('[err] ' + m.text()); });
await page.evaluateOnNewDocument((s, rain) => { localStorage.setItem('gtpolly.settings.v1', s); window.__rain = rain; }, settingsJson, process.env.RAIN === '1');
await page.goto('http://localhost:8137/index.html?autostart=new&nomission', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 6000));
const r0 = await page.evaluate(async (lat, lon) => {
  const g = __game;
  const { Vehicle } = await import('/src/entities/vehicle.js');
  const { cum, pointAt, laneOffset } = await import('/src/game/roads.js');
  const [x, y] = g.world.project(lat, lon);
  g.player.ped.x = x; g.player.ped.y = y; await g.world.update(x, y);
  const near = g.world.nearestRoad(x, y, 300, (r) => r.cls <= 4);
  const t = [0,0,0,0]; cum(near.road); pointAt(near.road, 1, near.s, laneOffset(near.road, 0), t);
  const m = g.assets.vehicle('cimarron_thunderhead');
  const v = new Vehicle(g, m, t[0], t[1], Math.atan2(t[3], t[2]), 0); v.persist = true; g.addVehicle(v); g.enterVehicle(g.player.ped, v);
  // autopilot: steer along the road graph so the run is repeatable
  const { DriverAI } = await import('/src/game/traffic.js').catch(() => ({}));
  if (window.__rain) { g.weather.target = 1; g.weather.rain = 1; g.weather.t = 999; }
  window.__frames = []; let last = performance.now();
  const tick = () => { const n = performance.now(); window.__frames.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  return { cls: near.road.cls, hasAI: !!DriverAI };
}, +lat, +lon);
logs.push(JSON.stringify(r0));
for (const step of (keysSpec || 'KeyW:8000').split(',')) { const [k, ms] = step.split(':'); if (k === 'wait') { await new Promise((r) => setTimeout(r, +ms)); continue; } await page.keyboard.down(k); await new Promise((r) => setTimeout(r, +ms)); await page.keyboard.up(k); }
const res = await page.evaluate(() => { const f = __frames.slice(30); f.sort((a, b) => a - b); const avg = f.reduce((a, b) => a + b, 0) / f.length; const g = __game; return { n: f.length, avg: avg.toFixed(1), p95: f[Math.floor(f.length * 0.95)].toFixed(1), max: f[f.length - 1].toFixed(1), canvas: g.renderer.canvas.width + 'x' + g.renderer.canvas.height, blds: g.renderer.stats.blds, veh: g.vehicles.length, peds: g.peds.length }; });
logs.push(JSON.stringify(res));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
