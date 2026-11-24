// Use node --expose-gc to exercise finalization as well as descriptor closure.
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

test('game asset handles close on completion and when a browser leaves during open', { timeout: 10000 }, async t => {
  const tmp = await fs.promises.realpath(tmpdir());
  const directory = await fs.promises.mkdtemp(path.join(tmp, 'gtpolly-server-lifetime-'));
  const asset = path.join(directory, 'map-labels.js'), events = new EventEmitter();
  const source = await fs.promises.readFile(new URL('../src/ui/map-labels.js', import.meta.url));
  const serverModule = path.join(directory, 'tools', 'serve.mjs');
  const createServer = http.createServer, open = fs.promises.open;
  const argv = process.argv;
  const waitFor = event => once(events, event, { signal: t.signal });
  let server, listening, holdOpen = false, descriptor, remainingBody;
  try {
    await fs.promises.mkdir(path.dirname(serverModule));
    await fs.promises.copyFile(process.argv[2] || fileURLToPath(new URL('./serve.mjs', import.meta.url)), serverModule);
    await fs.promises.writeFile(asset, source);
    const stat = await fs.promises.stat(asset);

    // Pause immediately after the real OS open. The close event below confirms
    // the browser's socket has gone away before the request handler continues.
    fs.promises.open = async function (file, ...args) {
      const handle = await open(file, ...args);
      if (file === asset) {
        descriptor = handle.fd;
        if (holdOpen) {
          const resume = waitFor('resume');
          events.emit('opened');
          await resume;
        }
        if (remainingBody) {
          const read = handle.read.bind(handle);
          let first = true;
          handle.read = async (buffer, offset, length, position) => {
            if (!first) await remainingBody;
            first = false;
            return read(buffer, offset, Math.min(512, length), position);
          };
        }
      }
      return handle;
    };
    http.createServer = handler => {
      server = createServer(async (req, res) => {
        res.once('close', () => events.emit('closed'));
        await handler(req, res);
        events.emit('handled');
      });
      const listen = server.listen;
      server.listen = (port, ready) => listen.call(server, port, '127.0.0.1', ready);
      listening = once(server, 'listening');
      return server;
    };
    process.argv = [...argv.slice(0, 2), '0'];
    await import(pathToFileURL(serverModule));
    await listening;
    const url = new URL('map-labels.js', 'http://127.0.0.1:' + server.address().port);

    async function checkClosed() {
      assert.ok(Number.isInteger(descriptor), 'Expected an actual file open');
      await nextTurn();
      let leaked = false;
      try {
        const current = fs.fstatSync(descriptor);
        leaked = current.dev === stat.dev && current.ino === stat.ino;
      } catch (error) {
        if (error.code !== 'EBADF') throw error;
      }
      // A leaked FileHandle can also terminate Node 26 on finalization.
      global.gc?.();
      await nextTurn();
      assert.equal(leaked, false, 'Request left its game asset open');
    }

    // Abort before streaming begins, once for each encoding path.
    holdOpen = true;
    for (const encoding of ['gzip', 'identity']) {
      const opened = waitFor('opened'), closed = waitFor('closed'), handled = waitFor('handled');
      const req = http.get(url, { headers: { 'Accept-Encoding': encoding } });
      req.on('error', err => assert.equal(err.code, 'ECONNRESET'));
      await opened;
      req.destroy();
      await closed;
      events.emit('resume');
      await handled;
      await checkClosed();
    }

    holdOpen = false;
    // Drop a real connection between two reads while the stream is in flight.
    let resumeBody;
    remainingBody = new Promise(resolve => { resumeBody = resolve; });
    const closed = waitFor('closed'), handled = waitFor('handled');
    const partial = http.get(url, { headers: { 'Accept-Encoding': 'identity' } });
    try {
      const [response] = await once(partial, 'response', { signal: t.signal });
      const [chunk] = await once(response, 'data', { signal: t.signal });
      assert.ok(chunk.length > 0 && chunk.length < source.length);
      partial.destroy();
      await closed;
    } finally {
      resumeBody();
    }
    await handled;
    remainingBody = null;
    await checkClosed();

    let tag;
    for (const [method, status, encoding] of [['GET', 200, 'gzip'], ['GET', 200, 'identity'], ['HEAD', 200, 'identity'], ['GET', 304, 'identity']]) {
      descriptor = undefined;
      const handled = waitFor('handled');
      const headers = { 'Accept-Encoding': encoding };
      if (status === 304) headers['If-None-Match'] = tag;
      const req = http.get(url, { method, headers });
      const [res] = await once(req, 'response');
      assert.equal(res.statusCode, status);
      tag = res.headers.etag;
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (method === 'GET' && status === 200) assert.deepEqual(encoding === 'gzip' ? gunzipSync(body) : body, source);
      else assert.equal(body.length, 0);
      await handled;
      await checkClosed();
    }
  } finally {
    events.emit('resume');
    process.argv = argv;
    fs.promises.open = open;
    http.createServer = createServer;
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
