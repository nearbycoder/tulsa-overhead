// Smoke-test every story mission: teleport to its start, launch it, skip dialogue, check the
// first objective appears and no script error occurs.   node tools/test_missions.mjs [c3m1,c3m2]
import puppeteer from 'puppeteer-core';
const only = (process.argv[2] || '').split(',').filter(Boolean);
const port = process.env.PORT || 8137;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1000, height: 600 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/404|Failed to load resource/.test(t)) errors.push(t); });
await page.goto(`http://localhost:${port}/index.html?autostart=new&nomission`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 9000));
const ids = await page.evaluate(() => Object.values(__game.missions.story.MISSIONS).sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id, undefined, { numeric: true })).map((m) => m.id));
const results = [];
for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  errors.length = 0;
  const r = await page.evaluate(async (id) => {
    const g = __game, M = g.missions;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    if (M.active) { M.active.abort('test'); await sleep(300); }
    const def = M.story.MISSIONS[id];
    M.chapter = def.chapter;
    for (const m of Object.values(M.story.MISSIONS)) { if (m.chapter < def.chapter || (m.chapter === def.chapter && (def.requires || []).includes(m.id))) M.done.add(m.id); else M.done.delete(m.id); }
    const p = M.place(def.start);
    if (g.player.vehicle) g.exitVehicle(g.player.ped, true);
    g.player.ped.dead = false; g.player.ped.health = 100; g.respawning = false; g.controlsLocked = false;
    g.police.setLevel(0);
    g.player.ped.x = p.x + 1; g.player.ped.y = p.y + 1;
    g.cam.x = p.x; g.cam.y = p.y;
    await g.world.update(p.x, p.y);
    await sleep(1500);
    M.cooldown = 0;
    M.start(def);
    // skip dialogue for up to ~25 s until an objective shows
    let obj = null;
    for (let i = 0; i < 80; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      await sleep(300);
      if (!M.active) break;
      if (g.hud.objective && !g.dialogActive) { obj = g.hud.objective.text; break; }
    }
    const res = { id, title: def.title, chapter: def.chapter, obj, active: !!M.active, last: M.lastResult && M.lastResult.id === id ? M.lastResult : null, entities: M.active ? M.active.entities.size : 0, markers: g.markers.length };
    if (M.active) { M.active.abort('test'); }
    return res;
  }, id).catch((e) => ({ id, err: e.message }));
  r.errors = [...errors];
  const ok = !r.err && r.errors.length === 0 && (r.obj || (r.last && r.last.ok)) && !(r.last && r.last.msg && /script error/.test(r.last.msg));
  results.push({ ...r, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(6)} ch${r.chapter} ${(r.title || '').padEnd(26)} obj="${r.obj || ''}" ents=${r.entities ?? ''}${r.last ? ' last=' + JSON.stringify(r.last) : ''}${r.err ? ' ERR=' + r.err : ''}${r.errors.length ? ' errors=' + JSON.stringify(r.errors.slice(0, 3)) : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} missions passed the smoke test`);
await browser.close();
process.exit(failed.length ? 1 : 0);
