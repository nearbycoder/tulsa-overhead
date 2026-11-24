// Exercise mobile menu and map navigation through Chrome's real touch event pipeline.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist']
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const viewport = (width, height, dpr = 3) => page.setViewport({
    width, height, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, isLandscape: width > height
  });
  async function tapText(label, selector = 'button') {
    const handle = await page.waitForFunction((name, sel) => [...document.querySelectorAll(sel)]
      .find(el => el.offsetHeight && el.textContent.trim() === name), {}, label, selector);
    await handle.asElement().tap();
    await handle.dispose();
  }
  await viewport(390,844);
  await page.goto('http://localhost:' + (process.env.PORT || 8137) + '/?nomission');
  await tapText('Settings');
  await tapText('Graphics');
  await page.tap('[data-preset=low]');
  await tapText('Controls');
  assert.ok(await page.$eval('.touch-help', panel => panel.scrollWidth <= panel.clientWidth));
  await page.tap('[data-a=close]');
  await tapText('New Game');
  await page.waitForFunction(() => window.__game?.player && document.body.classList.contains('touch-playing'));
  const hud = await page.evaluate(() => ({ radius: __game.hud.radarR/__game.hud.pixelRatio, height: __game.hud.canvas.height,
    scale: __game.hud.s/__game.hud.pixelRatio, touch: __game.hud.touch }));
  assert.ok(hud.touch && hud.radius >= 31 && hud.scale >= 0.7 && hud.height <= 844*1.5);
  await page.evaluate(async () => {
    const {MapView} = await import('/src/ui/mapview.js');
    const start = MapView.prototype.start;
    MapView.prototype.start = function() { window.probeMap = this; return start.call(this); };
  });
  await page.tap('.touch-tools [data-action=map]');
  await page.waitForSelector('.mapview');
  const cdp = await page.createCDPSession();
  const send = (type, points = []) => cdp.send('Input.dispatchTouchEvent', {type,
    touchPoints: points.map(([id,x,y])=>({id,x,y,radiusX:5,radiusY:5,force:0.6}))});
  const state = () => page.evaluate(() => [probeMap.cx, probeMap.cy, probeMap.mpp]);
  const before = await state();
  await send('touchStart', [[1,100,380]]);
  await send('touchMove', [[1,138,402]]);
  await send('touchEnd');
  let [x,y,mpp] = await state();
  assert.ok(Math.abs(x - before[0] + 38*mpp) < mpp && Math.abs(y - before[1] + 22*mpp) < mpp);
  await send('touchStart', [[1,100,360]]);
  await send('touchStart', [[1,100,360],[2,220,360]]);
  await send('touchMove', [[1,70,370],[2,250,370]]);
  await send('touchEnd');
  const after = await state();
  assert.ok(Math.abs(after[2] - mpp*2/3) < 0.01);
  // The same ground point stays under the midpoint as both fingers move.
  assert.ok(Math.abs((x + (160-195)*mpp) - (after[0] + (160-195)*after[2])) < 1);
  assert.ok(Math.abs((y + (360-422)*mpp) - (after[1] + (370-422)*after[2])) < 1);
  assert.equal(await page.evaluate(() => !!__game.waypoint), false);
  await send('touchStart', [[1,180,422]]);
  await send('touchCancel');
  assert.equal(await page.evaluate(() => probeMap.pointers.size),0);
  await page.touchscreen.tap(195,422);
  await page.waitForFunction(()=>__game.waypoint && Math.hypot(__game.waypoint[0]-probeMap.cx,__game.waypoint[1]-probeMap.cy)<1);
  await page.tap('[data-clear]');
  await page.tap('.map-search input');
  await page.keyboard.type('BOK Center'); // soft keyboards deliver equivalent text input
  await page.waitForFunction(()=>document.querySelector('.map-matches strong')?.textContent==='BOK Center');
  await page.tap('#map-place-0');
  await page.waitForFunction(()=>__game.waypointLabel==='BOK Center' && !!__game.gps.route);
  await page.tap('[data-fit]');
  for (const [w,h] of [[844,390],[820,1180]]) {
    await viewport(w,h,2);
    await page.waitForFunction(()=>Math.abs(document.querySelector('.mapview').clientHeight - innerHeight)<2);
    assert.ok(await page.$eval('.mapview canvas',el=> el.width*el.height < 1604000));
    await page.tap('.map-search input');
    assert.ok(await page.$eval('.map-panel',el=> {const r=el.getBoundingClientRect();return r.bottom <= innerHeight+1 && r.right <= innerWidth}));
    await page.tap('[data-dismiss-search]');
  }
  await page.tap('[data-close]');
  await page.waitForFunction(()=>!__game.paused && !__game.ui.open && performance.now() - __game.ui.lastClose > 120);
  await page.tap('.touch-tools [data-action=pause]');
  await tapText('Story');
  assert.ok(await page.$eval('.story-journal',el=>el.scrollWidth <= el.clientWidth));
  await tapText('Back');
  await tapText('Spawn Helicopter');
  await page.tap('.touch-back');
  await tapText('Resume');
  await page.waitForFunction(()=>!__game.paused && !__game.ui.open);
  await viewport(390,844);
  await page.evaluate(()=>{void __game.ui.dialog.say('Inez','Meet me at the river.');});
  await page.waitForFunction(()=> __game.ui.dialog.active && __game.ui.dialog.remaining < 1.8);
  await page.tap('.dialog-next');
  await page.waitForFunction(()=>!__game.ui.dialog.active);
  assert.deepEqual(errors,[]);
  console.log('Phone and tablet menus, touch HUD, anchored pinch/pan, cancellation, map search, scene resume and dialogue skip passed.');
} finally {
  await browser.close();
}
