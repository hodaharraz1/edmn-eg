import { env } from '@/server/core/env';
import { logger } from '@/server/core/logger';

export interface OutboundProvider {
  name: string;
  send(msg: { recipient: string; subject?: string | null; body: string; secret?: boolean }): Promise<void>;
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
      await transport.sendMail({ from: e.MAIL_FROM, to: msg.recipient, subject: msg.subject ?? 'EDMN', text: msg.body });
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
      body: JSON.stringify({ to: msg.recipient, from: e.SMS_SENDER_ID, text: msg.body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
  },
});

export async function providerFor(channel: string): Promise<OutboundProvider> {
  const e = env();
  if (channel === 'EMAIL') return e.MAIL_DRIVER === 'smtp' ? smtpProvider() : logProvider('EMAIL');
  if (channel === 'SMS') return e.SMS_DRIVER === 'http' ? httpSms() : logProvider('SMS');
  throw new Error(`unknown channel ${channel}`);
}
