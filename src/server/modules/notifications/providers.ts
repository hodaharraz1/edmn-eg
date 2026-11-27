import { env } from '@/server/core/env';
import { logger } from '@/server/core/logger';

export interface OutboundProvider {
  name: string;
  /** `reference` = outbox id (idempotency reference for the provider). Returns the provider's message id when it gives one. */
  send(msg: { recipient: string; subject?: string | null; body: string; secret?: boolean; reference?: string }): Promise<{ providerMessageId?: string } | void>;
}

const logProvider = (channel: string): OutboundProvider => ({
  name: `log-${channel.toLowerCase()}`,
  async send(msg) {
    // Development adapter: messages are persisted in outbound_messages and logged (recipient masked).
    logger.info('outbound.dev_delivery', {
      channel,
      to: msg.recipient.replace(/.(?=.{4})/g, '•'),
      subject: msg.subject,
      // Bodies are only echoed outside production, and messages carrying a code or secret link are
      // never echoed anywhere (they live only in outbound_messages until redacted).
      ...(process.env.NODE_ENV !== 'production' && !msg.secret ? { text: msg.body } : {}),
    });
  },
});

let smtp: OutboundProvider | null = null;
async function smtpProvider(): Promise<OutboundProvider> {
  if (smtp) return smtp;
  const e = env();
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT ?? 587,
    secure: (e.SMTP_PORT ?? 587) === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  smtp = {
    name: 'smtp',
    async send(msg) {
      // Stable Message-ID per outbox row: a retried send is recognisable as the same message by the provider.
      const domain = (e.MAIL_FROM.match(/@([^>\s]+)/)?.[1] ?? 'edmn.local').toLowerCase();
      const info = await transport.sendMail({ from: e.MAIL_FROM, to: msg.recipient, subject: msg.subject ?? 'اضمن', text: msg.body, ...(msg.reference ? { messageId: `<${msg.reference}@${domain}>` } : {}) });
      return { providerMessageId: info.messageId };
    },
  };
  return smtp;
}

/** Generic HTTP SMS adapter: POST {to, from, text} with bearer token. Map to the contracted provider's API. */
const httpSms = (): OutboundProvider => ({
  name: 'http-sms',
  async send(msg) {
    const e = env();
    const res = await fetch(e.SMS_HTTP_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${e.SMS_HTTP_TOKEN ?? ''}` },
      body: JSON.stringify({ to: msg.recipient, from: e.SMS_SENDER_ID, text: msg.body, reference: msg.reference }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
    const json = (await res.json().catch(() => null)) as { id?: unknown; messageId?: unknown } | null;
    const id = json?.messageId ?? json?.id;
    return typeof id === 'string' || typeof id === 'number' ? { providerMessageId: String(id) } : {};
  },
});


// ── NOTIFY-01: SMS Misr (مزوّد مصري) ─────────────────────────────────────────────────────────────────────────
// POST {base}/api/SMS/ (form fields per the provider's API docs). The base URL is configurable so a provider
// endpoint change is a config change, not a deploy. لم يتم التحقق: لم تُجرَ مكالمة فعلية للمزوّد.
const smsMisr = (): OutboundProvider => ({
  name: 'smsmisr',
  async send(msg) {
    const e = env();
    const form = new URLSearchParams({
      environment: '1', // live (2 = test)
      username: e.SMS_MISR_USERNAME!,
      password: e.SMS_MISR_PASSWORD!,
      sender: e.SMS_SENDER_ID,
      mobile: msg.recipient.replace(/\+/g, ''),
      message: msg.body,
      language: '2', // unicode (Arabic)
      ...(msg.reference ? { reference: msg.reference } : {}),
    });
    const res = await fetch(`${e.SMS_MISR_BASE_URL}/api/SMS/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS Misr responded ${res.status}`);
    const json = (await res.json().catch(() => null)) as { SMSID?: unknown; id?: unknown } | null;
    const id = json?.SMSID ?? json?.id;
    return id != null ? { providerMessageId: String(id) } : {};
  },
});

/** NOTIFY-01: per-process token bucket. Limits THIS process only; the provider's own limits still apply. */
function rateLimited(inner: OutboundProvider, perMinute: number): OutboundProvider {
  let tokens = perMinute;
  let last = Date.now();
  let chain: Promise<unknown> = Promise.resolve();
  return {
    name: inner.name,
    send(msg) {
      const run = async () => {
        for (;;) {
          const now = Date.now();
          tokens = Math.min(perMinute, tokens + ((now - last) / 60_000) * perMinute);
          last = now;
          if (tokens >= 1) {
            tokens -= 1;
            break;
          }
          await new Promise((r) => setTimeout(r, Math.ceil(((1 - tokens) / perMinute) * 60_000)));
        }
        return inner.send(msg);
      };
      // Serialize so two concurrent sends cannot spend the same token.
      const out = chain.then(run, run);
      chain = out.catch(() => {});
      return out;
    },
  };
}

/** NOTIFY-01: primary driver with an optional one-shot fallback driver when the primary fails. */
function smsProvider(): OutboundProvider {
  const e = env();
  const primary = e.SMS_DRIVER === 'smsmisr' ? smsMisr() : e.SMS_DRIVER === 'http' ? httpSms() : logProvider('SMS');
  if (primary.name === 'log-SMS') return primary;
  const limited = rateLimited(primary, e.SMS_RATE_LIMIT_PER_MINUTE);
  if (e.SMS_FALLBACK_DRIVER === 'none') return limited;
  const fallback = e.SMS_FALLBACK_DRIVER === 'http' ? httpSms() : logProvider('SMS');
  return {
    name: `${limited.name}+${fallback.name}`,
    async send(msg) {
      try {
        return await limited.send(msg);
      } catch (err) {
        logger.warn('outbound.sms_fallback', { primary: limited.name, fallback: fallback.name, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
        return fallback.send(msg);
      }
    },
  };
}

let override: ((channel: string) => OutboundProvider) | null = null;
/** Tests only: replace the delivery adapters (failure injection, capture). */
export function setProviderOverride(fn: ((channel: string) => OutboundProvider) | null) {
  override = fn;
}

export async function providerFor(channel: string): Promise<OutboundProvider> {
  if (override) return override(channel);
  const e = env();
  if (channel === 'EMAIL') return e.MAIL_DRIVER === 'smtp' ? smtpProvider() : logProvider('EMAIL');
  // Production never "delivers" through the log driver: the message fails visibly instead of being faked as SENT.
  if (process.env.EDMN_ENVIRONMENT === 'production' && ((channel === 'SMS' && e.SMS_DRIVER !== 'http' && e.SMS_DRIVER !== 'smsmisr') || (channel === 'EMAIL' && e.MAIL_DRIVER !== 'smtp'))) {
    throw new Error(`${channel} provider not configured in production`);
  }
  if (channel === 'SMS') return e.SMS_DRIVER === 'log' ? logProvider('SMS') : smsProvider();
  throw new Error(`unknown channel ${channel}`);
}
