// Bot playthrough: plays story missions with the in-page autopilot (tools/bot.js), using real
// driving/walking/shooting, and reports pass/fail, game time, damage a player would take and assists.
//   node tools/playtest.mjs [c1m1,c1m2 | ch3] [--speed 3] [--retries 1] [--shots dir] [--full-damage]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const sel = args[0] && !args[0].startsWith('--') ? args[0] : '';
const speed = +opt('--speed', 6);
const retries = +opt('--retries', 1);
const shots = opt('--shots', '');
const limit = +opt('--limit', 900); // game seconds per attempt
if (shots) fs.mkdirSync(shots, { recursive: true });
const botSrc = fs.readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'], defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
page.on('console', async (m) => {
  let t = m.text();
  if (m.type() !== 'error' || /404|Failed to load resource|voice/.test(t)) return;
  if (t.includes('JSHandle@')) { try { t = (await Promise.all(m.args().map((a) => a.evaluate((e) => e instanceof Error ? e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' | ') : String(e)).catch(() => '?')))).join(' '); } catch (e) { } }
  errors.push(t.slice(0, 400));
});
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gtpolly.settings.v1', JSON.stringify({ resolutionScale: 0.5, shadows: false, buildingDetail: 1, masterVolume: 0 })); } catch (e) { } });
await page.goto('http://localhost:8137/index.html?autostart=new&nomission', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && __game.player, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
console.log(await page.evaluate(botSrc));
if (args.includes('--full-damage')) await page.evaluate(() => { __bot.dmgScale = 1; __bot.vehicleDamageScale = 1; });
await page.evaluate((speed) => {
  const g = __game;
  const up = g.update.bind(g);
  g.update = (dt) => { for (let i = 0; i < speed; i++) up(1 / 30); };
  // draw only every 4th frame: the bot doesn't need to see, and the game clock runs on update steps
  const rd = g.render.bind(g), hd = g.hud.draw.bind(g.hud);
  let fr = 0;
  g.render = (dt) => { if (++fr % 4 === 0) rd(dt); };
  g.hud.draw = () => { if (fr % 4 === 0) hd(); };
  window.__skip = setInterval(() => { if (g.ui.dialog && g.ui.dialog.cancel) g.ui.dialog.cancel(); }, 150);
}, speed);
const all = await page.evaluate(() => Object.values(__game.missions.story.MISSIONS).sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id, undefined, { numeric: true })).map((m) => ({ id: m.id, chapter: m.chapter, title: m.title })));
let list = all;
if (/^ch\d+-\d+$/.test(sel)) { const [a, b] = sel.slice(2).split('-').map(Number); list = all.filter((m) => m.chapter >= a && m.chapter <= b); } else if (sel.startsWith('ch')) list = all.filter((m) => m.chapter === +sel.slice(2));
else if (sel) list = all.filter((m) => sel.split(',').includes(m.id));
const report = [];
for (const mdef of list) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    errors.length = 0;
    const start = await page.evaluate(async (id) => {
      const g = __game, M = g.missions, B = __bot;
      if (M.active) { M.active.abort('test'); await new Promise((r) => setTimeout(r, 300)); }
      const def = M.story.MISSIONS[id];
      M.chapter = def.chapter;
      const num = (m) => +m.id.replace(/^c\d+m/, '');
      for (const m of Object.values(M.story.MISSIONS)) if (m.chapter < def.chapter || (m.chapter === def.chapter && num(m) < num(def)) || (def.requires || []).includes(m.id)) M.done.add(m.id);
      M.cooldown = 1e9;
      const pl = g.player;
      if (pl.vehicle) g.exitVehicle(pl.ped, true);
      if (pl.ped.dead || g.respawning) { await new Promise((r) => setTimeout(r, 6000)); }
      g.police.setLevel(0); g.police.clearUnits && g.police.clearUnits(true);
      const p = M.place(def.start);
      const ped = g.player.ped;
      ped.health = 100; ped.armor = 0; ped.x = p.x + 2; ped.y = p.y + 2; g.cam.x = p.x; g.cam.y = p.y;
      await g.world.update(p.x, p.y);
      await new Promise((r) => setTimeout(r, 800));
      Object.assign(B, { dmg: 0, vdmg: 0, assists: [], route: null, err: null, goal: null, dmgBy: {}, blasts: [], impacts: [], castHits: [] });
      B.dist0 = g.player.stats.distance;
      M.cooldown = 0;
      M.lastResult = null;
      M.start(def);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    }, mdef.id);
    let res = null, last = null, t0 = Date.now(), shotN = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = await page.evaluate((id) => {
        const g = __game, M = g.missions, a = M.active, B = __bot;
        return { active: !!a && a.def.id === id, t: a ? a.t : null, res: M.lastResult && M.lastResult.id === id ? M.lastResult : null, obj: g.hud.objText || (g.hud.objective && g.hud.objective.text), goal: B.note, pos: [Math.round(g.player.x), Math.round(g.player.y)], veh: g.player.vehicle && g.player.vehicle.m.id, wanted: g.police.level, timer: g.hud.timer && Math.round(g.hud.timer.value), err: B.err, dead: g.player.ped.dead };
      }, mdef.id);
      if (st.t != null) last = st;
      if (st.res || !st.active) { res = st.res || { ok: false, msg: 'ended without result' }; break; }
      if (shots && (Date.now() - t0) / 1000 > shotN * (+opt("--every", 20))) { await page.screenshot({ path: `${shots}/${mdef.id}_${attempt}_${shotN}.png` }); shotN++; }
      if (st.t > limit) { res = { ok: false, msg: `bot timeout at "${st.obj}" (${st.goal})` }; await page.evaluate(() => __game.missions.active && __game.missions.active.abort('timeout')); break; }
    }
    const fin = await page.evaluate(() => { const B = __bot, g = __game; return { dmgBy: Object.fromEntries(Object.entries(B.dmgBy).map(([k, v]) => [k, Math.round(v)])), dmg: Math.round(B.dmg), vdmg: Math.round(B.vdmg), assists: B.assists.slice(), blasts: B.blasts.slice(0, 4), impacts: B.impacts.slice(), castHits: B.castHits.slice(), dist: Math.round(g.player.stats.distance - B.dist0), err: B.err }; });
    const row = { id: mdef.id, title: mdef.title, attempt, ok: !!res.ok, msg: res.msg || '', gameT: last ? Math.round(last.t) : null, lastObj: last && last.obj, ...fin, errors: [...errors] };
    report.push(row);
    console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.id.padEnd(6)} ${String(row.title).padEnd(26)} t=${row.gameT}s dist=${row.dist}m dmg=${row.dmg} ${JSON.stringify(row.dmgBy)} vdmg=${row.vdmg}${row.msg ? ' msg="' + row.msg + '"' : ''}${!row.ok && row.lastObj ? ' at="' + row.lastObj + '"' : ''}${row.assists.length ? ' assists=' + JSON.stringify(row.assists) : ''}${row.blasts && row.blasts.length ? ' blasts=' + JSON.stringify(row.blasts) : ''}${row.impacts && row.impacts.length ? ' impacts=' + JSON.stringify(row.impacts) : ''}${row.castHits && row.castHits.length ? ' cast=' + JSON.stringify(row.castHits) : ''}${row.err ? ' boterr=' + row.err : ''}${row.errors.length ? ' errors=' + JSON.stringify(row.errors.slice(0, 3)) : ''}`);
    if (row.ok) break;
  }
}
fs.writeFileSync(opt('--out', 'build/playtest.json'), JSON.stringify(report, null, 1));
const passed = new Set(report.filter((r) => r.ok).map((r) => r.id));
console.log(`\n${passed.size}/${list.length} missions completed by the bot`);
await browser.close();
