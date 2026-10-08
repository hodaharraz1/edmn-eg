import { z } from 'zod';

/**
 * Typed, validated environment configuration.
 * Business configuration (commissions, payment destinations, settlement rules…) does NOT live here:
 * it lives in the database (system_settings, commission_rules, payment_destinations) so that
 * authorized admins can change it at runtime with an audit trail.
 */
const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Deployment kind. Required whenever NODE_ENV=production so staging/production behaviour is never implied by a missing variable. */
  EDMN_ENVIRONMENT: z.enum(['development', 'staging', 'production']).optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SELLER_APP_URL: z.string().url().default('http://localhost:3000/seller'),
  ADMIN_APP_URL: z.string().url().default('http://localhost:3000/admin'),
  ENFORCE_HOSTS: bool,
  SELLER_HOST: z.string().default('seller.edmneg.com'),
  ADMIN_HOST: z.string().default('admin.edmneg.com'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  SESSION_SECRET: z.string().min(32),
  DATA_ENCRYPTION_KEY: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: bool,
  STORAGE_DRIVER: z.enum(['local', 'database']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  UPLOAD_MAX_IMAGE_MB: z.coerce.number().positive().default(8),
  UPLOAD_MAX_DOCUMENT_MB: z.coerce.number().positive().default(10),
  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().default('EDMN <no-reply@example.com>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Web Push (VAPID). Push is reported as NOT CONFIGURED (never faked) while these are absent. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  SMS_DRIVER: z.enum(['log', 'http']).default('log'),
  SMS_HTTP_URL: z.string().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
  SMS_SENDER_ID: z.string().default('EDMN'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (e.SESSION_SECRET.startsWith('replace-with')) problems.push('SESSION_SECRET is a placeholder');
    if (e.DATA_ENCRYPTION_KEY.startsWith('replace-with')) problems.push('DATA_ENCRYPTION_KEY is a placeholder');
    if (!e.APP_URL.startsWith('https://')) problems.push('APP_URL must be https in production');
    if (e.MAIL_DRIVER === 'smtp' && !e.SMTP_HOST) problems.push('SMTP_HOST required for smtp mail driver');
    if (e.SMS_DRIVER === 'http' && !e.SMS_HTTP_URL) problems.push('SMS_HTTP_URL required for http sms driver');
    if (!e.EDMN_ENVIRONMENT) problems.push('EDMN_ENVIRONMENT must be set to "staging" or "production" for a production build');
    if (e.EDMN_ENVIRONMENT === 'production') {
      // Real customers must receive verification codes and delivery OTPs.
      if (e.SMS_DRIVER !== 'http') problems.push('SMS_DRIVER=http is required in production (delivery OTP and phone verification)');
      if (e.MAIL_DRIVER !== 'smtp') problems.push('MAIL_DRIVER=smtp is required in production');
    }
    if (problems.length) throw new Error(`Unsafe production configuration:\n${problems.join('\n')}`);
  }
  cached = e;
  return e;
}

export const isProd = () => env().NODE_ENV === 'production';
export const cookieSecure = () => env().COOKIE_SECURE || isProd();
