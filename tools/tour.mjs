// Screenshot tour: starts a game, teleports to a list of spots and captures each.
// node tools/tour.mjs outdir [--size 1280x720] [--spots "name@lat,lon@hour@zoom@car|..."] [--settings '{"preset":"high"}']
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const args = process.argv.slice(2);
const outDir = args[0] || 'tour';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const settings = opt('--settings', '');
const DEFAULT = [
  'downtown@36.1540,-95.9915@13@1@car',
  'arts_district@36.1590,-95.9925@15@1@foot',
  'golden_driller@36.1345,-95.9311@11@1@foot',
  'rose_district@36.0526,-95.7905@17@1@car',
  'ba_suburbs@36.0350,-95.7700@10@1@car',
  'blue_whale@36.1940,-95.7325@12@1@foot',
  'riverside@36.1300,-95.9950@16@1@car',
  'highway_i44@36.0980,-95.9250@14@1@car',
  'utica@36.1361,-95.9604@19@1@car',
  'downtown_night@36.1530,-95.9900@22@1@car',
  'rural_creek@36.0000,-95.6800@9@1@car',
  'glenpool@35.9833,-96.0181@12@1@car',
  'port_catoosa@36.2320,-95.7308@15@1@car',
  'praying_hands@36.0480,-95.9536@8@1@foot',
];
const spots = (opt('--spots', '') ? opt('--spots', '').split('|') : DEFAULT).map((s) => {
  const [name, ll, hour, zoom, mode] = s.split('@');
  const [lat, lon] = ll.split(',').map(Number);
  return { name, lat, lon, hour: +hour, zoom: +(zoom || 1), mode: mode || 'car' };
});
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
if (settings) await page.evaluateOnNewDocument((s) => { try { const cur = JSON.parse(localStorage.getItem('gtpolly.settings.v1') || '{}'); localStorage.setItem('gtpolly.settings.v1', JSON.stringify({ ...cur, ...JSON.parse(s) })); } catch (e) { } }, settings);
await page.goto(`http://localhost:8137/index.html?autostart=new&nomission`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 7000));
for (const s of spots) {
  const r = await page.evaluate(async (s) => {
    const g = window.__game;
    const [x, y] = g.world.project(s.lat, s.lon);
    const pl = g.player;
    if (pl.vehicle) g.exitVehicle(pl.ped, true);
    pl.ped.x = x; pl.ped.y = y; g.cam.x = x; g.cam.y = y;
    await g.world.update(x, y);
    g.clock = s.hour * 60;
    if (s.mode === 'car') {
      const { Vehicle } = await import('/src/entities/vehicle.js');
      const { cum, pointAt, laneOffset } = await import('/src/game/roads.js');
      const near = g.world.nearestRoad(x, y, 300);
      let px = x, py = y, h = 0;
      if (near) { const t = [0, 0, 0, 0]; cum(near.road); pointAt(near.road, 1, near.s, laneOffset(near.road, 0), t); px = t[0]; py = t[1]; h = Math.atan2(t[3], t[2]); }
      const m = g.assets.vehicle(s.car || 'okie_sedan') || g.assets.pickVehicle?.(Math.random) || Object.values(g.assets.catalog || {})[0];
      const v = new Vehicle(g, m, px, py, h, 0);
      v.persist = true; g.addVehicle(v); g.enterVehicle(pl.ped, v);
      g.cam.x = px; g.cam.y = py;
    }
    return { x: Math.round(x), y: Math.round(y), veh: g.vehicles.length, peds: g.peds.length };
  }, s);
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: `${outDir}/${s.name}.png` });
  console.log(s.name, JSON.stringify(r));
}
console.log(logs.slice(-30).join('\n'));
await browser.close();
