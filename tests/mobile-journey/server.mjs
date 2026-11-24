// Local-only static Flutter host with a same-origin proxy to the isolated Next.js test server.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
const root = resolve('apps/customer_mobile/build/web');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.otf': 'font/otf' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const upstream = http.request({ host: '127.0.0.1', port: 3000, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3000' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
    return;
  }
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(8099, '127.0.0.1');
