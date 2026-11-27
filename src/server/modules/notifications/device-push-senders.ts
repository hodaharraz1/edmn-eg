import { createSign, generateKeyPairSync } from 'node:crypto';
import http2 from 'node:http2';
import type { DevicePushMessage, DevicePushSender } from './device-push';

/**
 * REAL device-push senders (PKG-PUSH-02): Firebase Cloud Messaging (HTTP v1) and Apple APNs (HTTP/2).
 * Both are constructed from credentials stored ENCRYPTED in device_push_credentials (never from code or env),
 * and both are used only while notifications.devicePushDriver = 'live' AND notifications.devicePushEnabled = true
 * (both OFF by default). Node.js stdlib only — no new dependencies. Tokens and key material are never logged;
 * error text is reduced to a short classification.
 */

export interface SendOutcome {
  ok: boolean;
  /** The provider says this token is gone for good — the caller deletes the stored token. */
  invalidToken?: boolean;
  /** Short, secret-free classification for logs/counters (no provider payloads, no tokens). */
  error?: string;
}

/** Injectable HTTP pieces so tests never touch the network. */
export interface SenderDeps {
  fetchImpl?: typeof fetch;
  http2Connect?: typeof http2.connect;
  now?: () => number;
}

const TIMEOUT_MS = 10_000;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

// ── Firebase Cloud Messaging (HTTP v1) ──────────────────────────────────────────────────────────────────────

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  /** PEM PKCS#8 private key of the service account. */
  privateKeyPem: string;
  tokenUri?: string;
}

/** Accepts the Google service-account JSON verbatim (snake_case) or the camelCase shape. */
export function parseFcmCredentials(raw: unknown): FcmCredentials {
  const o = raw as Record<string, unknown>;
  const projectId = (typeof o?.projectId === 'string' ? o.projectId : typeof o?.project_id === 'string' ? (o.project_id as string) : '').trim();
  const clientEmail = (typeof o?.clientEmail === 'string' ? o.clientEmail : typeof o?.client_email === 'string' ? (o.client_email as string) : '').trim();
  const privateKeyPem = typeof o?.privateKeyPem === 'string' ? o.privateKeyPem : typeof o?.private_key === 'string' ? (o.private_key as string) : '';
  if (!projectId || !clientEmail || !privateKeyPem.includes('PRIVATE KEY')) throw new Error('بيانات Firebase غير مكتملة');
  const tokenUriRaw = typeof o?.tokenUri === 'string' ? o.tokenUri : typeof o?.token_uri === 'string' ? (o.token_uri as string) : '';
  const tokenUri = tokenUriRaw.trim() || undefined;
  return { projectId, clientEmail, privateKeyPem, tokenUri };
}

function rsaJwt(claims: Record<string, unknown>, privateKeyPem: string, header: Record<string, unknown> = {}): string {
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header }));
  const p = b64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  return `${h}.${p}.${signer.sign(privateKeyPem, 'base64url')}`;
}

export class FcmDevicePushSender implements DevicePushSender {
  readonly driver = 'fcm';
  private accessToken: { value: string; expiresAtMs: number } | null = null;
  constructor(
    private readonly creds: FcmCredentials,
    private readonly deps: SenderDeps = {},
  ) {}

  private async oauthToken(): Promise<string> {
    const now = (this.deps.now ?? Date.now)();
    if (this.accessToken && now < this.accessToken.expiresAtMs) return this.accessToken.value;
    const tokenUri = this.creds.tokenUri ?? 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(now / 1000);
    const jwt = rsaJwt(
      { iss: this.creds.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat, exp: iat + 3600 },
      this.creds.privateKeyPem,
    );
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const res = await fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`fcm-auth-${res.status}`);
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string' || !json.access_token) throw new Error('fcm-auth-empty');
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    this.accessToken = { value: json.access_token, expiresAtMs: now + (ttl - 60) * 1000 };
    return json.access_token;
  }

  /** FCM outcome. Throws on transient/provider failures (the caller counts a failure and may retry later). */
  async sendOutcome(target: { token: string; platform: string }, message: DevicePushMessage): Promise<SendOutcome> {
    const bearer = await this.oauthToken();
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.creds.projectId}/messages:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ message: { token: target.token, notification: { title: message.title, body: message.body }, ...(message.data ? { data: message.data } : {}) } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    if (res.status === 404) return { ok: false, invalidToken: true, error: 'fcm-unregistered' };
    if (res.status === 400) {
      const json = (await res.json().catch(() => null)) as { error?: { details?: { errorCode?: unknown }[] } } | null;
      const code = json?.error?.details?.find((d) => typeof d?.errorCode === 'string')?.errorCode;
      if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') return { ok: false, invalidToken: true, error: `fcm-${String(code).toLowerCase()}` };
      return { ok: false, error: 'fcm-bad-request' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'fcm-auth-rejected' };
    throw new Error(`fcm-${res.status}`); // 429 / 5xx: transient
  }

  async send(target: { token: string; platform: string }, message: DevicePushMessage): Promise<void> {
    const out = await this.sendOutcome(target, message);
    if (!out.ok && !out.invalidToken) throw new Error(out.error ?? 'fcm-failed');
    if (out.invalidToken) {
      const err = new Error(out.error ?? 'fcm-invalid-token') as Error & { invalidToken?: boolean };
      err.invalidToken = true;
      throw err;
    }
  }
}

// ── Apple Push Notification service (HTTP/2) ────────────────────────────────────────────────────────────────

export interface ApnsCredentials {
  teamId: string;
  keyId: string;
  /** The app's bundle id (apns-topic). */
  bundleId: string;
  /** PEM PKCS#8 (.p8) private key from Apple Developer. */
  privateKeyP8: string;
  sandbox: boolean;
}

export function parseApnsCredentials(raw: unknown): ApnsCredentials {
  const o = raw as Record<string, unknown>;
  const teamId = typeof o?.teamId === 'string' ? o.teamId.trim() : '';
  const keyId = typeof o?.keyId === 'string' ? o.keyId.trim() : '';
  const bundleId = typeof o?.bundleId === 'string' ? o.bundleId.trim() : '';
  const privateKeyP8 = typeof o?.privateKeyP8 === 'string' ? o.privateKeyP8 : '';
  const sandbox = o?.sandbox === true;
  if (!teamId || !keyId || !bundleId || !privateKeyP8.includes('PRIVATE KEY')) throw new Error('بيانات Apple غير مكتملة');
  return { teamId, keyId, bundleId, privateKeyP8, sandbox };
}

/** DER (ASN.1) ECDSA signature → JOSE raw R||S (64 bytes for P-256). */
function derToRaw(der: Buffer): Buffer {
    // Minimal DER walk: 0x30 len, 0x02 lenR R, 0x02 lenS S — enough for a well-formed ECDSA signature.
  let off = 0;
  if (der[off++] !== 0x30) throw new Error('der-seq');
  const len = der[off++];
  if (len & 0x80) off += len & 0x7f;
  if (der[off++] !== 0x02) throw new Error('der-r');
  const lenR = der[off++];
  const r = der.subarray(off, off + lenR);
  off += lenR;
  if (der[off++] !== 0x02) throw new Error('der-s');
  const lenS = der[off++];
  const s = der.subarray(off, off + lenS);
  const pad = (b: Buffer) => (b.length > 32 ? b.subarray(b.length - 32) : Buffer.concat([Buffer.alloc(32 - b.length), b]));
  return Buffer.concat([pad(r), pad(s)]);
}

function es256Jwt(claims: Record<string, unknown>, privateKeyPem: string, header: Record<string, unknown>): string {
  const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', ...header }));
  const p = b64url(JSON.stringify(claims));
  const signer = createSign('SHA256');
  signer.update(`${h}.${p}`);
  const der = signer.sign(privateKeyPem) as unknown as Buffer; // EC signatures come back DER-encoded; JWS needs raw R||S
  return `${h}.${p}.${b64url(derToRaw(der))}`;
}

export class ApnsDevicePushSender implements DevicePushSender {
  readonly driver = 'apns';
  private jwt: { value: string; issuedAtMs: number } | null = null;
  constructor(
    private readonly creds: ApnsCredentials,
    private readonly deps: SenderDeps = {},
  ) {}

  private bearer(): string {
    const now = (this.deps.now ?? Date.now)();
    // APNs provider tokens are valid for one hour; refresh well before that.
    if (this.jwt && now - this.jwt.issuedAtMs < 50 * 60 * 1000) return this.jwt.value;
    const iat = Math.floor(now / 1000);
    const value = es256Jwt({ iss: this.creds.teamId, iat }, this.creds.privateKeyP8, { kid: this.creds.keyId });
    this.jwt = { value, issuedAtMs: now };
    return value;
  }

  async sendOutcome(target: { token: string; platform: string }, message: DevicePushMessage): Promise<SendOutcome> {
    const connect = this.deps.http2Connect ?? http2.connect;
    const origin = this.creds.sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const client = connect(origin);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', () => resolve());
        client.once('error', reject);
        setTimeout(() => reject(new Error('apns-connect-timeout')), TIMEOUT_MS).unref();
      });
      const status = await new Promise<number>((resolve, reject) => {
        const req = client.request({
          ':method': 'POST',
          ':path': `/3/device/${target.token}`,
          authorization: `bearer ${this.bearer()}`,
          'apns-topic': this.creds.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
        });
        let status = 0;
        req.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0);
        });
        req.on('data', () => undefined); // drain the response body
        req.on('end', () => resolve(status));
        req.on('error', reject);
        req.setTimeout(TIMEOUT_MS, () => reject(new Error('apns-timeout')));
        req.end(JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default' }, ...(message.data ?? {}) }));
      });
      if (status === 200) return { ok: true };
      if (status === 410) return { ok: false, invalidToken: true, error: 'apns-unregistered' };
      if (status === 400) return { ok: false, invalidToken: true, error: 'apns-bad-device-token' };
      if (status === 403) return { ok: false, error: 'apns-auth-rejected' };
      if (status === 429 || status >= 500) throw new Error(`apns-${status}`);
      return { ok: false, error: `apns-${status}` };
    } finally {
      client.close();
    }
  }

  async send(target: { token: string; platform: string }, message: DevicePushMessage): Promise<void> {
    const out = await this.sendOutcome(target, message);
    if (!out.ok && !out.invalidToken) throw new Error(out.error ?? 'apns-failed');
    if (out.invalidToken) {
      const err = new Error(out.error ?? 'apns-invalid-token') as Error & { invalidToken?: boolean };
      err.invalidToken = true;
      throw err;
    }
  }
}

/** Test helper: generate throwaway credential pairs (never used in production paths). */
export function generateTestKeys() {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    rsaPrivatePem: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    rsaPublicPem: rsa.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    ecPrivatePem: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ecPublicPem: ec.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
