#!/usr/bin/env node
// Zero-dependency headless check for the GTPolly audio system.
// Drives tools/audio_test.html?selftest=1 in headless Chrome through the DevTools
// protocol, prints the PASS/FAIL report, and can save rendered WAVs for listening.
//
//   node tools/audio_offline_check.mjs                 # run self-test, print report
//   node tools/audio_offline_check.mjs --wav build/audio_wav   # also write WAV files
//   node tools/audio_offline_check.mjs --eval "audio.stats"     # evaluate JS after the test
//
// Options: --port <n> (static server port, default 8141; started if not running)
//          --chrome <path> (or env CHROME)   --timeout <sec> (default 240)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', 8141));
const wavDir = opt('wav', null);
const evalExpr = opt('eval', null);
const timeoutS = Number(opt('timeout', 240));
const chromePath = opt('chrome', process.env.CHROME) || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
if (!chromePath) { console.error('Chrome not found; pass --chrome <path>'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
const cleanup = () => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', cleanup);

async function ensureServer() {
  try { await fetch(`http://localhost:${port}/tools/audio_test.html`); return; } catch { /* start it */ }
  const s = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
  kids.push(s);
  for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(`http://localhost:${port}/`); return; } catch { /* wait */ } }
  throw new Error('static server did not start');
}

async function launchChrome() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gtpolly-audio-'));
  const c = spawn(chromePath, ['--headless=new', '--mute-audio', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0', `--user-data-dir=${prof}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  kids.push(c);
  const ws = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('Chrome did not expose DevTools')), 20000);
    c.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(to); res(m[1]); } });
    c.on('exit', (code) => rej(new Error('Chrome exited ' + code)));
  });
  return { ws, prof };
}

function cdp(wsUrl) {
  const sock = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(), listeners = [];
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else for (const l of listeners) l(msg);
  };
  const ready = new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return { ready, send, on: (f) => listeners.push(f), close: () => sock.close() };
}

async function main() {
  await ensureServer();
  const { ws } = await launchChrome();
  const B = cdp(ws); await B.ready;
  const { targetId } = await B.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await B.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => B.send(m, p, sessionId);
  const logs = [];
  B.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) logs.push(`[console.${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  });
  await S('Runtime.enable');
  await S('Page.enable');
  const ev = async (expr) => { const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const page = `http://localhost:${port}/tools/audio_test.html?selftest=1${wavDir ? '&wav=1' : ''}`;
  const t0 = Date.now();
  await S('Page.navigate', { url: page });
  let done = false;
  while (!done && Date.now() - t0 < timeoutS * 1000) { await sleep(500); try { done = await ev('!!(window.__selftest && window.__selftest.done)'); } catch { /* navigating */ } }
  if (!done) { console.error('selftest timed out'); console.error(await ev('document.getElementById("report")?.textContent').catch(() => '')); process.exit(1); }
  const report = await ev('document.getElementById("report").textContent');
  console.log(report);
  console.log(`(wall time ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (logs.length) console.log('\nConsole warnings/errors:\n' + logs.join('\n'));
  if (wavDir) {
    fs.mkdirSync(wavDir, { recursive: true });
    const keys = await ev('Object.keys(window.__wavs || {})');
    for (const k of keys) { const b64 = await ev(`window.__wavs[${JSON.stringify(k)}]`); fs.writeFileSync(path.join(wavDir, k + '.wav'), Buffer.from(b64, 'base64')); }
    console.log(`wrote ${keys.length} WAV files to ${path.resolve(wavDir)}`);
  }
  if (evalExpr) console.log('eval:', JSON.stringify(await ev(evalExpr), null, 2));
  const pass = await ev('window.__selftest.pass');
  B.close(); cleanup();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
