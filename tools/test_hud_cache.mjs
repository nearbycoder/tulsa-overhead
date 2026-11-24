// Compare a retained HUD with a fresh full paint on each visual transition.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--disable-gpu', '--mute-audio']
});
try {
  const page = await browser.newPage();
  await page.goto((process.argv[2] || 'http://localhost:8137') + '/package.json');
  for (const [width, height, touch] of [[1280,720,false], [320,568,true], [390,844,true], [844,390,true], [820,1180,true]]) {
    await page.setViewport({ width, height, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1 });
    const result = await page.evaluate(async touch => {
      const { Hud } = await import('/src/game/hud.js');
      const { GPS } = await import('/src/game/gps.js');
      const { input } = await import('/src/engine/input.js');
      input.lastDevice = touch ? 'touch' : 'keyboard';
      const world = {regionRevision: 1, names:['East Martin Luther King Junior Boulevard'], forEachInRect() {}};
      const car = {h:0, vf:16, speed:16, health:99, maxHealth:100};
      const ped = {h:0, weapon:'pistol', clip:{pistol:12}, ammo:{pistol:45}, health:94, maxHealth:100, armor:70};
      const pl = {x:0, y:0, ped, vehicle:null, displayMoney:1450, money:1450};
      const blips = [
        {x:0, y:40, col:'#ff0', shape:'letter', letter:'H'},
        {x:9000, y:5000, col:'#fff', size:5},
        {x:1200, y:50, col:'#345', size:4, edge:true, shape:'triangle'}
      ];
      const g = {world, player:pl, time:0, cam:{W:innerWidth}, police:{level:0}, collectBlips:()=>blips.map(b=>({...b}))};
      const gps = g.gps = new GPS(g);
      gps.target = [1500,50];
      gps.accept({points:[0,0, 50,0, 1000,0, 1200,500], turns:[{i:1,action:'Turn right',name:0}]}, false);
      gps.nextTurn = gps.turns[0];
      const canvas = () => {
        const el = document.createElement('canvas');
        if (touch) {
          el.style.setProperty('--safe-left', '8px');
          el.style.setProperty('--safe-top', '11px');
        }
        document.body.append(el);
        return el;
      };
      const retained = new Hud(g, canvas());
      const full = new Hud(g, canvas());
      let clearCalls = 0, retainedStatus = 0, fullStatus = 0, frames = 0;
      const clear = retained.ctx.clearRect.bind(retained.ctx);
      retained.ctx.clearRect = (...args) => { clearCalls++; return clear(...args); };
      for (const [hud,count] of [[retained,()=>retainedStatus++],[full,()=>fullStatus++]]) {
        const paint = hud.drawStatus.bind(hud);
        hud.drawStatus = (...args) => {count();return paint(...args);};
      }
      let clock = 0;
      Object.defineProperty(performance,'now',{value:()=>clock,configurable:true});
      function frame(label) {
        const money = pl.displayMoney;
        retained.draw();
        pl.displayMoney = money;
        full.lastFrame = null;
        full.draw();
        const image = hud => new Uint32Array(hud.ctx.getImageData(0,0,hud.canvas.width,hud.canvas.height).data.buffer);
        const a = image(retained), b = image(full);
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) throw Error(label + ' differs at ' + (i % retained.canvas.width) + ',' + Math.floor(i / retained.canvas.width));
        }
        frames++;
      }
      frame('new scene');
      blips[1].x += 2;
      frame('distant train moves');
      const idleClears = clearCalls;
      pl.x = 24; pl.y = 6; ped.h = 0.3; frame('walk');
      g.player.vehicle = car; frame('enter car');
      for (let i = 0; i < 5; i++) {
        pl.x += 45; pl.y += 8; car.h += 0.32; car.speed += 3;
        gps.track(pl.x,pl.y); frame('drive with guidance ' + i);
      }
      car.isHeli = true; car.alt = 32; frame('flight');
      car.alt = 60; frame('climb');
      g.police.level = 3; g.police.searching = true; g.time = 0.5; frame('police searching');
      g.time = 1; frame('wanted flash');
      ped.health = 15; ped.armor = 0; ped.drown = 4; frame('health and breath');
      ped.weapon = 'fists'; frame('switch weapon');
      pl.money = 98654321; frame('money animation');
      pl.displayMoney = pl.money; frame('money settled');
      blips[0].letter = 'P'; frame('blip letter');
      blips[0].flash = true; frame('flashing marker');
      clock = 320; frame('marker flash phase');
      blips[0].x += 8; frame('visible marker moves');
      blips.splice(0,1); frame('remove marker');
      blips[0].x = pl.x + 1; blips[0].y = pl.y; frame('newly visible marker');
      world.regionRevision++; frame('streamed geography');
      retained.showArea('Tulsa'); full.showArea('Tulsa'); frame('area overlay');
      retained.update(5); full.update(5); frame('area dismissed');
      retained.setObjective('Walk to the station'); full.setObjective('Walk to the station'); frame('objective');
      g.dialogActive = true; frame('dialogue covers objective');
      g.prompt = '{enter} to get out'; frame('context prompt');
      pl.displayMoney = pl.money;
      frame('unchanged prompt');
      pl.x += 1; frame('walk with prompt');
      g.dialogActive = false;
      g.prompt = null; gps.target = gps.route = null;
      g.missions = {active:true};
      retained.setObjective('Find the warehouse',0.01); full.setObjective('Find the warehouse',0.01);
      retained.update(1); full.update(1); frame('mission reminder');
      pl.x += 1; frame('walk with mission reminder');
      frame('unchanged mission reminder');
      g.missions.active = false; frame('clear mission reminder');
      retained.hidden = full.hidden = true; frame('cinematic');
      retained.hidden = full.hidden = false; frame('resume');
      retained.destroy(); full.destroy();
      retained.canvas.remove(); full.canvas.remove();
      delete performance.now;
      return {frames, idleClears, retainedStatus, fullStatus};
    }, touch);
    assert.equal(result.idleClears,1);
    assert.ok(result.retainedStatus < result.fullStatus);
    console.log(width+'×'+height, result);
  }
} finally { await browser.close(); }
