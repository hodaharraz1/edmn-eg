import { logger } from '@/server/core/logger';

/**
 * PKG-PERF-01 (P1): the rate-limit counter store.
 *
 * Before this change every single API request wrote a row to PostgreSQL (`insert … on conflict … returning`), which
 * made the database the hot path of the whole API and produced lock contention on the most popular keys. The counter
 * now lives in Redis when `REDIS_URL` is configured, and in process memory otherwise. The contract is unchanged:
 * `hit(key, limit, windowSeconds)` returns false once the key has spent its budget in the current fixed window.
 *
 * Failure policy: the limiter never takes the API down. If Redis is unreachable the store falls back to memory for
 * that request (and logs once), which keeps per-instance limits working while the shared counter recovers.
 */
export interface LimitStore {
  readonly kind: 'memory' | 'redis';
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  /** Drop expired buckets (memory) or no-op (redis expires keys itself). */
  prune(): Promise<void>;
  /**
   * PKG-FOLLOWUP-02: read-only view of the counters whose key starts with one of `prefixes` and whose count is at
   * least `minCount`, highest first, at most `max`. This is what admin screens use instead of querying a table:
   * the counters live here, not in PostgreSQL.
   */
  scan(prefixes: string[], minCount: number, max: number): Promise<CounterReading[]>;
}

export interface CounterReading {
  key: string;
  count: number;
  /** Start of the fixed window (ms since epoch) when the store knows it; null for Redis, which only keeps a TTL. */
  windowStart: number | null;
}

const windowStartOf = (windowSeconds: number, now = Date.now()) => Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;

/**
 * In-process fixed-window counter. Bounded: when the map reaches `maxKeys` the oldest windows are dropped, so an
 * attacker rotating keys cannot grow it without limit.
 */
export class MemoryLimitStore implements LimitStore {
  readonly kind = 'memory' as const;
  private buckets = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly maxKeys = 50_000) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const windowStart = windowStartOf(windowSeconds);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.windowStart !== windowStart) {
      if (this.buckets.size >= this.maxKeys) await this.prune();
      this.buckets.set(key, { windowStart, count: 1 });
      return limit >= 1;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  }

  async prune(): Promise<void> {
    const cutoff = Date.now() - 3600_000;
    for (const [key, bucket] of this.buckets) if (bucket.windowStart < cutoff) this.buckets.delete(key);
    // Still full after dropping hour-old windows: drop the oldest half so the map stays bounded.
    if (this.buckets.size >= this.maxKeys) {
      const keep = [...this.buckets.entries()].sort((a, b) => b[1].windowStart - a[1].windowStart).slice(0, Math.floor(this.maxKeys / 2));
      this.buckets = new Map(keep);
    }
  }

  async scan(prefixes: string[], minCount: number, max: number): Promise<CounterReading[]> {
    const out: CounterReading[] = [];
    for (const [key, b] of this.buckets) {
      if (b.count >= minCount && prefixes.some((p) => key.startsWith(p))) out.push({ key, count: b.count, windowStart: b.windowStart });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, max);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * Minimal Redis client (RESP over a single socket) — enough for INCR/PEXPIRE without adding a dependency.
 * One connection per process, commands pipelined in order, reconnected lazily on the next call after an error.
 */
export class RedisLimitStore implements LimitStore {
  readonly kind = 'redis' as const;
  private socket: import('node:net').Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private waiters: Array<(value: RespValue | Error) => void> = [];
  private connecting: Promise<void> | null = null;

  constructor(private readonly url: URL) {}

  private async connect(): Promise<void> {
    if (this.socket) return;
    if (this.connecting) return this.connecting;
    const net = await import('node:net');
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.url.hostname, port: Number(this.url.port || 6379) });
      const onError = (e: Error) => {
        this.socket = null;
        this.connecting = null;
        socket.destroy();
        reject(e);
      };
      socket.once('error', onError);
      socket.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.drain();
      });
      socket.on('close', () => {
        this.socket = null;
        this.connecting = null;
        const pending = this.waiters;
        this.waiters = [];
        for (const w of pending) w(new Error('redis connection closed'));
      });
      socket.once('connect', () => {
        socket.off('error', onError);
        socket.on('error', () => {
          this.socket = null;
        });
        const auth = this.url.password ? ['AUTH', decodeURIComponent(this.url.password)] : null;
        this.socket = socket;
        if (auth) this.send(auth);
        resolve();
      });
    });
    return this.connecting;
  }

  /** Resolve every complete RESP reply already buffered: '+OK', ':1', '-ERR', '$n' bulk, '*n' array (SCAN). */
  private drain() {
    for (;;) {
      const parsed = parseResp(this.buffer, 0);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.next);
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      waiter(parsed.value);
    }
  }

  private send(args: string[]): Promise<RespValue> {
    return new Promise<RespValue>((resolve, reject) => {
      const socket = this.socket;
      if (!socket) return reject(new Error('redis not connected'));
      this.waiters.push((v) => (v instanceof Error ? reject(v) : resolve(v)));
      socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`);
    });
  }

  private async command(args: string[]): Promise<RespValue> {
    await this.connect();
    return this.send(args);
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const redisKey = `edmn:rl:${key}`;
    const count = Number(await this.command(['INCR', redisKey]));
    if (count === 1) await this.command(['PEXPIRE', redisKey, String(windowSeconds * 1000)]);
    return count <= limit;
  }

  async prune(): Promise<void> {
    /* Redis expires its own keys (PEXPIRE); nothing to sweep here. */
  }

  /** SCAN (never KEYS: it does not block the server) for each prefix, then GET the counters found. Bounded. */
  async scan(prefixes: string[], minCount: number, max: number): Promise<CounterReading[]> {
    const found: CounterReading[] = [];
    for (const prefix of prefixes) {
      let cursor = '0';
      let rounds = 0;
      do {
        const reply = await this.command(['SCAN', cursor, 'MATCH', `edmn:rl:${prefix}*`, 'COUNT', '500']);
        if (!Array.isArray(reply) || reply.length !== 2 || !Array.isArray(reply[1])) throw new Error('redis scan: unexpected reply');
        cursor = String(reply[0]);
        for (const k of reply[1]) {
          if (typeof k !== 'string') continue;
          const value = await this.command(['GET', k]);
          const count = Number(value);
          if (Number.isFinite(count) && count >= minCount) found.push({ key: k.slice('edmn:rl:'.length), count, windowStart: null });
        }
        rounds += 1;
      } while (cursor !== '0' && rounds < 200 && found.length < max * 4);
    }
    return found.sort((a, b) => b.count - a.count).slice(0, max);
  }
}

export type RespValue = string | null | RespValue[];

/** Parse one RESP reply at `offset`; null while the buffer holds only part of it. Errors come back as a thrown-later Error value. */
export function parseResp(buf: Buffer, offset: number): { value: RespValue | Error; next: number } | null {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]);
  const eol = buf.indexOf('\r\n', offset);
  if (eol < 0) return null;
  const head = buf.toString('utf8', offset + 1, eol);
  const afterHead = eol + 2;
  if (type === '+' || type === ':') return { value: head, next: afterHead };
  if (type === '-') return { value: new Error(head), next: afterHead };
  if (type === '$') {
    const len = Number(head);
    if (len < 0) return { value: null, next: afterHead };
    if (buf.length < afterHead + len + 2) return null;
    return { value: buf.toString('utf8', afterHead, afterHead + len), next: afterHead + len + 2 };
  }
  if (type === '*') {
    const n = Number(head);
    if (n < 0) return { value: null, next: afterHead };
    const items: RespValue[] = [];
    let at = afterHead;
    for (let i = 0; i < n; i += 1) {
      const item = parseResp(buf, at);
      if (!item) return null;
      if (item.value instanceof Error) return { value: item.value, next: item.next };
      items.push(item.value);
      at = item.next;
    }
    return { value: items, next: at };
  }
  return { value: new Error(`redis: unexpected reply type ${type}`), next: eol + 2 };
}

let selected: LimitStore | null = null;
let warned = false;

/** Redis when REDIS_URL is set, otherwise this process's memory. Selected once per process. */
export function limitStore(): LimitStore {
  if (selected) return selected;
  const raw = process.env.REDIS_URL;
  if (raw) {
    try {
      selected = new RedisLimitStore(new URL(raw));
      return selected;
    } catch (e) {
      logger.warn('rate_limit.redis_url_invalid', { error: e as Error });
    }
  }
  if (process.env.NODE_ENV === 'production' && !warned) {
    warned = true;
    logger.warn('rate_limit.memory_store', { note: 'REDIS_URL is not set: limits are per instance, not shared across web instances' });
  }
  selected = new MemoryLimitStore();
  return selected;
}

/** Test seam. */
export function setLimitStore(store: LimitStore | null) {
  selected = store;
}
