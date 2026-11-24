// Zero-dependency static file server for Tulsa Overhead.  node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { networkInterfaces } from 'node:os';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8137);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.opus': 'audio/ogg',
  '.gz': 'application/octet-stream', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
};
http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('invalid path'); }
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(root, p);
  if (!fp.startsWith(root + path.sep) || p.split('/').some(part => part.startsWith('.'))) { res.writeHead(403); return res.end(); }
  let file;
  let ext = path.extname(fp);
  try {
    // The terrain builder publishes by rename. Validate and stream the same open file.
    try {
      file = await fs.promises.open(fp, 'r');
    } catch (err) {
      // A tab opened before the terrain upgrade still has JPEG paths in memory.
      if (err.code !== 'ENOENT' || !/^\/assets\/map\/ground\/full\/-?\d+_-?\d+\/(?:overview|[0-9]|1[0-5])\.jpg$/.test(p)) throw err;
      file = await fs.promises.open(fp.slice(0, -4) + '.avif', 'r');
      ext = '.avif';
    }
    const st = await file.stat({ bigint: true });
    // A tab can disconnect while open/stat is pending, before a pipeline exists
    // to observe the response's close event.
    if (res.destroyed || req.socket.destroyed) return;
    if (!st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const tag = '"' + [st.ino, st.size, st.mtimeNs, st.ctimeNs].map(n => n.toString(36)).join('-') + '"';
    const modified = new Date(Number(st.mtimeMs)).toUTCString();
    const headers = { ETag: 'W/' + tag, 'Last-Modified': modified, 'Cache-Control': 'no-cache' };
    const textAsset = st.size >= 1024n && /^(?:\.html|\.css|\.m?js|\.json|\.svg)$/.test(ext);
    const packedMap = p.startsWith('/assets/') && ext === '.gz';
    const accepts = /(?:^|,)\s*gzip(?:\s*;\s*q\s*=\s*([\d.]+))?\s*(?:,|$)/i.exec(req.headers['accept-encoding'] || '');
    const negotiated = accepts && Number(accepts[1] ?? 1) > 0;
    const gzip = textAsset && negotiated;
    if (textAsset || packedMap) headers.Vary = 'Accept-Encoding';
    if ((textAsset || packedMap) && negotiated) headers['Content-Encoding'] = 'gzip';
    if (packedMap && negotiated) ext = path.extname(fp.slice(0, -3));
    const match = req.headers['if-none-match'];
    const unchanged = match !== undefined
      ? match.split(',').some(s => s.trim() === '*' || s.trim().replace(/^W\//, '') === tag)
      : Date.parse(modified) <= Date.parse(req.headers['if-modified-since']);
    if ((req.method === 'GET' || req.method === 'HEAD') && unchanged) {
      res.writeHead(304, headers); return res.end();
    }
    if (!gzip) headers['Content-Length'] = st.size.toString();
    res.writeHead(200, { ...headers, 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    const source = file.createReadStream();
    if (gzip) await pipeline(source, createGzip({ level: 3 }), res);
    else await pipeline(source, res);
  } catch {
    if (!res.destroyed) {
      if (res.headersSent) res.destroy();
      else { res.writeHead(404); res.end('not found'); }
    }
  } finally {
    if (file) await file.close();
  }
}).listen(port, function () {
  const runningPort = this.address().port;
  console.log(`Tulsa Overhead serving ${root} at http://localhost:${runningPort}/`);
  const local = Object.values(networkInterfaces()).flat().find(n => n && !n.internal && n.family === 'IPv4' &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address));
  if (local) console.log(`On the same Wi-Fi, open http://${local.address}:${runningPort}/`);
});
