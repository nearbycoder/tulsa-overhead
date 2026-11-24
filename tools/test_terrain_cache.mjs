// Confirm that revisiting a terrain image validates cheaply and newly built assets appear immediately.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(path.join(root, 'build', 'terrain-cache-test-'));
const file = path.join(dir, 'overview.jpg');
const server = spawn(process.execPath, ['tools/serve.mjs', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const finished = once(server, 'exit');
try {
  const lines = createInterface({ input: server.stdout });
  const [banner] = await once(lines, 'line');
  lines.close();
  const base = banner.match(/http:\/\/localhost:\d+\//)[0];
  const target = new URL(path.relative(root, file), base);
  await writeFile(file, 'old');
  const first = await fetch(target);
  assert.equal(first.status, 200);
  const tag = first.headers.get('etag');
  const date = first.headers.get('last-modified');
  assert.equal(await first.text(), 'old');

  const head = await fetch(target, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '3');
  assert.equal(head.headers.get('etag'), tag);
  assert.equal(await head.text(), '');
  for (const method of ['GET', 'HEAD']) {
    for (const headers of [{ 'If-None-Match': tag }, { 'If-Modified-Since': date }]) {
      const cached = await fetch(target, { method, headers });
      assert.equal(cached.status, 304);
      assert.equal(cached.headers.get('etag'), tag);
      assert.equal(await cached.text(), '');
    }
  }
  // Use an equal-length, atomically published replacement in the same second.
  await writeFile(file + '.tmp', 'new');
  await rename(file + '.tmp', file);
  const fresh = await fetch(target, { headers: { 'If-None-Match': tag, 'If-Modified-Since': date } });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.headers.get('etag'), tag);
  assert.equal(await fresh.text(), 'new');
  const art = new URL('assets/vehicles/sprites.json', base);
  const packed = await fetch(art, { headers: { 'Accept-Encoding': 'gzip' } });
  const identity = await fetch(art, { headers: { 'Accept-Encoding': 'gzip;q=0' } });
  assert.equal(packed.headers.get('content-encoding'), 'gzip');
  assert.equal(packed.headers.get('vary'), 'Accept-Encoding');
  assert.equal(identity.headers.get('content-encoding'), null);
  assert.deepEqual(await packed.json(), await identity.json());
  const region = new URL('assets/map/r/0_0.json.gz', base);
  const raw = await fetch(region, { headers: { 'Accept-Encoding': 'identity' } });
  const decoded = await fetch(region, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(decoded.headers.get('content-encoding'), 'gzip');
  assert.ok(decoded.headers.get('content-type').startsWith('application/json'));
  assert.equal(await decoded.text(), gunzipSync(Buffer.from(await raw.arrayBuffer())).toString());
  console.log('Asset requests, cache validation, text compression and precompressed region negotiation passed.');
} finally {
  server.kill();
  await finished;
  await rm(dir, { recursive: true, force: true });
}
