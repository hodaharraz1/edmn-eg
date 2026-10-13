#!/usr/bin/env node
/**
 * EDMN private malware-scanner wrapper (no dependencies, Node ≥ 18).
 *
 * Runs NEXT TO a private clamd (ClamAV daemon) and exposes exactly the contract EDMN's `httpScanner` expects:
 *   POST /scan   Authorization: Bearer <SCANNER_TOKEN>   body = raw file bytes (application/octet-stream)
 *   → 200 {"result":"CLEAN"} | {"result":"INFECTED","signature":"…"} | {"result":"REJECTED","reason":"…"}
 *   → 401 / 413 / 502 / 503 otherwise (EDMN treats every non-200 as a scan FAILURE — never as clean)
 *   GET /health  → 200 {"ok":true} when clamd answers PING, 503 otherwise (no auth, no data)
 *
 * Files stay inside your infrastructure: bytes go only to clamd over INSTREAM. Nothing is stored or logged
 * (no file names, no contents, no hashes). Env: SCANNER_TOKEN (required, ≥ 32 chars), CLAMD_HOST (default
 * 127.0.0.1), CLAMD_PORT (3310), PORT (8080), MAX_BYTES (26214400 = 25 MB), CLAMD_TIMEOUT_MS (30000).
 * Put TLS in front (reverse proxy / platform HTTPS): EDMN production only accepts an https scanner URL.
 */
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

/** clamd INSTREAM: "zINSTREAM\0", then <uint32 BE length><chunk>…, then a zero-length chunk. */
export function scanWithClamd(buffer, { host = '127.0.0.1', port = 3310, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let reply = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('clamd timeout'));
    }, timeoutMs);
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on('data', (d) => (reply += d.toString('utf8')));
    sock.on('end', () => {
      clearTimeout(timer);
      resolve(parseClamdReply(reply));
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += 64 * 1024) {
        const chunk = buffer.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4)); // terminator
    });
  });
}

/** "stream: OK" → CLEAN; "stream: <sig> FOUND" → INFECTED; size limit → REJECTED; anything else throws. */
export function parseClamdReply(raw) {
  const line = raw.replace(/\0/g, '').trim();
  if (/^stream: OK$/.test(line)) return { result: 'CLEAN' };
  const found = line.match(/^stream: (.+) FOUND$/);
  if (found) return { result: 'INFECTED', signature: found[1].slice(0, 120) };
  if (/INSTREAM size limit exceeded/i.test(line)) return { result: 'REJECTED', reason: 'size limit exceeded' };
  throw new Error('clamd error');
}

function ping({ host, port }) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let r = '';
    const t = setTimeout(() => (sock.destroy(), resolve(false)), 3000);
    sock.on('error', () => (clearTimeout(t), resolve(false)));
    sock.on('data', (d) => (r += d));
    sock.on('end', () => (clearTimeout(t), resolve(r.replace(/\0/g, '').trim() === 'PONG')));
    sock.on('connect', () => sock.write('zPING\0'));
  });
}

export function createScannerServer(cfg) {
  const token = Buffer.from(`Bearer ${cfg.token}`);
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const ok = await ping(cfg);
      return json(res, ok ? 200 : 503, { ok });
    }
    if (req.method !== 'POST' || req.url !== '/scan') return json(res, 404, { error: 'not found' });
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== token.length || !timingSafeEqual(given, token)) return json(res, 401, { error: 'unauthorized' });
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > cfg.maxBytes) return json(res, 413, { error: 'too large' });
      chunks.push(c);
    }
    try {
      return json(res, 200, await scanWithClamd(Buffer.concat(chunks), cfg));
    } catch {
      return json(res, 502, { error: 'scanner unavailable' }); // EDMN records SCAN_FAILED (fail closed)
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.SCANNER_TOKEN ?? '';
  if (token.length < 32) {
    console.error('SCANNER_TOKEN (≥ 32 chars) is required');
    process.exit(1);
  }
  const cfg = {
    token,
    host: process.env.CLAMD_HOST ?? '127.0.0.1',
    port: Number(process.env.CLAMD_PORT ?? 3310),
    timeoutMs: Number(process.env.CLAMD_TIMEOUT_MS ?? 30_000),
    maxBytes: Number(process.env.MAX_BYTES ?? 25 * 1024 * 1024),
  };
  createScannerServer(cfg).listen(Number(process.env.PORT ?? 8080), () => console.log('edmn scanner wrapper listening'));
}
