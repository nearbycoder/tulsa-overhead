// Headless screenshot + console capture for GTPolly.
// node tools/shot.mjs "<url path+query>" out.png [--wait ms] [--size WxH] [--keys "KeyW:2000,KeyD:500"] [--eval "js"]
import puppeteer from 'puppeteer-core';
const args = process.argv.slice(2);
const url = args[0];
const out = args[1] || 'shot.png';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const wait = +opt('--wait', 4000);
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const keys = opt('--keys', '');
const evalJs = opt('--eval', '');
const preJs = opt('--pre', '');
const shots = opt('--shots', '');
const port = opt('--port', '8137');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const logs = [];
page.on('console', async (m) => {
  let t = m.text();
  if (t.includes('JSHandle@')) { try { const parts = await Promise.all(m.args().map((a) => a.evaluate((e) => e instanceof Error ? (e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')) : typeof e === 'object' ? JSON.stringify(e) : String(e)).catch(() => '?'))); t = parts.join(' '); } catch (e) { } }
  logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure() && r.failure().errorText}`));
await page.goto(`http://localhost:${port}/${url}`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, wait));
if (preJs) { try { const r = await page.evaluate(preJs); logs.push('[pre] ' + JSON.stringify(r)); } catch (e) { logs.push('[preerr] ' + e.message); } await new Promise((r) => setTimeout(r, 500)); }
if (keys) {
  for (const step of keys.split(',')) {
    const [k, ms] = step.split(':');
    if (k === 'wait') { await new Promise((r) => setTimeout(r, +ms)); continue; }
    if (k.startsWith('click')) { await page.mouse.click(W / 2, H / 2); continue; }
    if (/^e\d$/.test(k)) { const code = opt('--' + k, ''); try { const r = await page.evaluate(code); logs.push(`[${k}] ` + JSON.stringify(r)); } catch (e) { logs.push(`[${k}err] ` + e.message); } continue; }
    if (k === 'shot') { await page.screenshot({ path: out.replace('.png', `_${ms}.png`) }); continue; }
    await page.keyboard.down(k);
    await new Promise((r) => setTimeout(r, +(ms || 100)));
    await page.keyboard.up(k);
  }
}
if (evalJs) { try { const r = await page.evaluate(evalJs); logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[evalerr] ' + e.message); } }
await page.screenshot({ path: out });
console.log(logs.filter((l) => !/status of 404|reqfail.*ch[2-8]\.js/.test(l)).slice(-40).join("\n"));
await browser.close();
