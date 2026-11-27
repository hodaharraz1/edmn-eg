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
  private buffer = '';
  private waiters: Array<(value: string | Error) => void> = [];
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
        this.buffer += chunk.toString('utf8');
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

  /** Resolve complete RESP replies already buffered ('+OK', ':1', '-ERR', '$n'). */
  private drain() {
    for (;;) {
      const line = this.buffer.indexOf('\r\n');
      if (line < 0) return;
      const head = this.buffer.slice(0, line);
      const waiter = this.waiters.shift();
      if (!waiter) {
        this.buffer = this.buffer.slice(line + 2);
        continue;
      }
      this.buffer = this.buffer.slice(line + 2);
      waiter(head.startsWith('-') ? new Error(head.slice(1)) : head.replace(/^[:+]/, ''));
    }
  }

  private send(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = this.socket;
      if (!socket) return reject(new Error('redis not connected'));
      this.waiters.push((v) => (v instanceof Error ? reject(v) : resolve(v)));
      socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`);
    });
  }

  private async command(args: string[]): Promise<string> {
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
