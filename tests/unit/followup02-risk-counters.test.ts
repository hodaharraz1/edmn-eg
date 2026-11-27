import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryLimitStore, parseResp, RedisLimitStore, setLimitStore } from '@/server/api/limit-store';
import { enforce, hit, scanCounters } from '@/server/auth/rate-limit';
import { counterSourceNote, LOGIN_FLAG_MIN } from '@/server/modules/risk/counter-source';

/**
 * PKG-FOLLOWUP-02: /admin/risk and the login-spike alert read the SAME store the limiter writes to. Both paths are
 * covered: server memory (no REDIS_URL) and Redis (a small in-process RESP server that speaks INCR, PEXPIRE, SCAN, GET).
 */
afterEach(() => setLimitStore(null));

describe('memory path (no REDIS_URL)', () => {
  beforeEach(() => setLimitStore(new MemoryLimitStore()));

  it('counts attempts made through the limiter and reports them, highest first', async () => {
    for (let i = 0; i < 12; i++) await hit('login-id:01000000001', 100, 900);
    for (let i = 0; i < 3; i++) await hit('login-id:01000000002', 100, 900);
    for (let i = 0; i < 9; i++) await hit('totp:user-1', 100, 300);
    await hit('api:read:u:someone', 100, 60);
    const scan = await scanCounters(['login-id:', 'totp:'], 5);
    expect(scan.source).toBe('memory');
    expect(scan.shared).toBe(false);
    expect(scan.counters.map((c) => [c.key, c.count])).toEqual([['login-id:01000000001', 12], ['totp:user-1', 9]]);
    expect(scan.counters[0].windowStart).toEqual(expect.any(Number));
  });

  it('uses the same threshold as the page: 10 for sign-in, 8 for 2FA', async () => {
    expect(LOGIN_FLAG_MIN).toBe(10);
    for (let i = 0; i < 9; i++) await hit('login-id:x', 100, 900);
    const scan = await scanCounters(['login-id:'], 8);
    expect(scan.counters.filter((c) => c.count >= LOGIN_FLAG_MIN)).toEqual([]);
    await hit('login-id:x', 100, 900);
    expect((await scanCounters(['login-id:'], 8)).counters.filter((c) => c.count >= LOGIN_FLAG_MIN)).toHaveLength(1);
  });

  it('enforce() attempts show up too (the real caller path)', async () => {
    for (let i = 0; i < 4; i++) await enforce('login-id:viaenforce', 10, 900);
    expect((await scanCounters(['login-id:'], 1)).counters[0]).toMatchObject({ key: 'login-id:viaenforce', count: 4 });
  });

  it('says on the page that the numbers are for this server only', () => {
    expect(counterSourceNote({ source: 'memory', shared: false, degraded: false })).toContain('لسيرفر التطبيق الحالي فقط');
  });
});

describe('RESP parser', () => {
  it('reads simple, integer, bulk, null and nested array replies, and waits for partial ones', () => {
    expect(parseResp(Buffer.from('+OK\r\n'), 0)).toEqual({ value: 'OK', next: 5 });
    expect(parseResp(Buffer.from(':42\r\n'), 0)?.value).toBe('42');
    expect(parseResp(Buffer.from('$3\r\nabc\r\n'), 0)?.value).toBe('abc');
    expect(parseResp(Buffer.from('$-1\r\n'), 0)?.value).toBeNull();
    const scan = parseResp(Buffer.from('*2\r\n$1\r\n0\r\n*2\r\n$3\r\nk:1\r\n$3\r\nk:2\r\n'), 0);
    expect(scan?.value).toEqual(['0', ['k:1', 'k:2']]);
    expect(parseResp(Buffer.from('*2\r\n$1\r\n0\r\n*2\r\n$3\r\nk:1\r\n'), 0)).toBeNull();
    expect(parseResp(Buffer.from('$5\r\nab'), 0)).toBeNull();
    expect(parseResp(Buffer.from('-ERR boom\r\n'), 0)?.value).toBeInstanceOf(Error);
  });
});

/** A tiny Redis stand-in: INCR / PEXPIRE / SCAN (two pages) / GET over RESP. */
function fakeRedis(initial: Record<string, number>) {
  const data = new Map(Object.entries(initial));
  const commands: string[][] = [];
  const bulk = (s: string) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const args = parseCommand(buf);
        if (!args) return;
        buf = buf.subarray(args.used);
        commands.push(args.args);
        socket.write(reply(args.args));
      }
    });
  });
  function parseCommand(b: Buffer): { args: string[]; used: number } | null {
    if (b.length === 0 || b[0] !== 0x2a) return null;
    let at = b.indexOf('\r\n');
    if (at < 0) return null;
    const n = Number(b.toString('utf8', 1, at));
    at += 2;
    const args: string[] = [];
    for (let i = 0; i < n; i++) {
      const eol = b.indexOf('\r\n', at);
      if (eol < 0) return null;
      const len = Number(b.toString('utf8', at + 1, eol));
      if (b.length < eol + 2 + len + 2) return null;
      args.push(b.toString('utf8', eol + 2, eol + 2 + len));
      at = eol + 2 + len + 2;
    }
    return { args, used: at };
  }
  function reply(a: string[]): string {
    const cmd = a[0].toUpperCase();
    if (cmd === 'INCR') {
      const v = (data.get(a[1]) ?? 0) + 1;
      data.set(a[1], v);
      return `:${v}\r\n`;
    }
    if (cmd === 'PEXPIRE') return ':1\r\n';
    if (cmd === 'GET') return data.has(a[1]) ? bulk(String(data.get(a[1]))) : '$-1\r\n';
    if (cmd === 'SCAN') {
      const prefix = a[3].replace(/\*$/, '');
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix));
      const page = a[1] === '0' ? keys.slice(0, 1) : keys.slice(1);
      const next = a[1] === '0' && keys.length > 1 ? '7' : '0';
      return `*2\r\n${bulk(next)}*${page.length}\r\n${page.map(bulk).join('')}`;
    }
    return '-ERR unknown\r\n';
  }
  return new Promise<{ url: URL; commands: string[][]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ url: new URL(`redis://127.0.0.1:${port}`), commands, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }) });
    });
  });
}

describe('Redis path (REDIS_URL set)', () => {
  it('reads the counters the limiter wrote to Redis, across SCAN pages, never with KEYS', async () => {
    const redis = await fakeRedis({});
    setLimitStore(new RedisLimitStore(redis.url));
    for (let i = 0; i < 12; i++) await hit('login-id:01000000009', 100, 900);
    for (let i = 0; i < 9; i++) await hit('totp:staff-1', 100, 300);
    for (let i = 0; i < 2; i++) await hit('login-id:low', 100, 900);
    const scan = await scanCounters(['login-id:', 'totp:'], 5);
    expect(scan).toMatchObject({ source: 'redis', shared: true, degraded: false });
    expect(scan.counters.map((c) => [c.key, c.count])).toEqual([['login-id:01000000009', 12], ['totp:staff-1', 9]]);
    expect(scan.counters[0].windowStart).toBeNull();
    expect(redis.commands.some((c) => c[0].toUpperCase() === 'KEYS')).toBe(false);
    expect(counterSourceNote(scan)).toContain('Redis المشتركة');
    await redis.close();
  });

  it('follows the SCAN cursor to the last page', async () => {
    const redis = await fakeRedis({ 'edmn:rl:login-id:a': 11, 'edmn:rl:login-id:b': 15 });
    const store = new RedisLimitStore(redis.url);
    const found = await store.scan(['login-id:'], 10, 10);
    expect(found.map((f) => f.key).sort()).toEqual(['login-id:a', 'login-id:b']);
    expect(redis.commands.filter((c) => c[0] === 'SCAN').length).toBe(2);
    await redis.close();
  });

  it('a Redis outage degrades to this server\'s own counters and says so (never a silent empty page)', async () => {
    const redis = await fakeRedis({});
    const url = redis.url;
    await redis.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLimitStore(new RedisLimitStore(url));
    const scan = await scanCounters(['login-id:'], 1);
    expect(scan).toMatchObject({ source: 'redis', degraded: true });
    expect(counterSourceNote(scan)).toContain('تعذّرت قراءة Redis');
    warn.mockRestore();
  });
});
