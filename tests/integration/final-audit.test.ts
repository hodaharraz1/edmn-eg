import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { adminActor } from '@/server/auth/actors';
import { sendVerificationCode } from '@/server/auth/service';
import { smsAvailable, validateEnvironment } from '@/server/core/runtime-env';
import { absoluteUrl } from '@/server/core/urls';
import { db } from '@/server/db/client';
import { outboundMessages, systemSettings, userRoles, users } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { providerFor } from '@/server/modules/notifications/providers';
import { reportReview } from '@/server/modules/reviews/service';
import { openTicket } from '@/server/modules/support/service';
import { assertTransactionsOpen, transactionsState } from '@/server/ops/commerce-gate';
import { createStaffUser, isPrivilegedRole, setStaffRole } from '@/server/rbac/staff';
import { makeAdmin, makeCustomer, makeUser } from '../helpers/factory';

/** Final product audit: regression tests for the code-controlled launch blockers fixed in this pass. */

async function setSetting(key: string, value: unknown) {
  await db.insert(systemSettings).values({ key, value: value as object }).onConflictDoUpdate({ target: systemSettings.key, set: { value: value as object } });
}
const ENV_KEYS = ['EDMN_ENVIRONMENT', 'SMS_DRIVER', 'ENFORCE_ADMIN_HOST', 'ENFORCE_HOSTS', 'ADMIN_HOST'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await db.execute(sql`delete from system_settings where key = 'marketplace.maintenanceMode'`);
});

describe('F-1 staff creation never yields a creator-known password; money roles are privileged', () => {
  it('a new staff account gets a random password and a 72-hour invitation link (absolute URL) to set it', async () => {
    const sa = await makeAdmin();
    const email = `inv-${randomUUID().slice(0, 8)}@test.local`;
    const u = await createStaffUser(sa, { email, phone: `+2011${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, fullName: 'موظف جديد', role: 'CATALOG_REVIEWER' });
    const { verifyPassword } = await import('@/server/auth/password');
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    // No password the creator could have typed is accepted.
    for (const guess of ['Strong#Pass2026x', 'Test@12345', '']) expect(await verifyPassword(guess, row.passwordHash).catch(() => false)).toBe(false);
    const [msg] = await db.select().from(outboundMessages).where(and(eq(outboundMessages.recipient, email), eq(outboundMessages.event, 'ACCOUNT_SECURITY')));
    expect(msg.subject).toBe('دعوة للانضمام لفريق عمل اضمن');
    expect(msg.body).toContain(absoluteUrl('/reset-password?token='));
  });

  it('a roles.manage holder who is not SUPER_ADMIN cannot grant (or create staff with) a money role', async () => {
    expect(await isPrivilegedRole(db, 'FINANCE_CHECKER')).toBe(true);
    expect(await isPrivilegedRole(db, 'CATALOG_REVIEWER')).toBe(false);
    const code = `ROLES_MGR_${randomUUID().slice(0, 6).toUpperCase()}`;
    await db.execute(sql`insert into roles (code, name_ar, name_en, is_system) values (${code}, 'مدير صلاحيات اختبار', 'Roles manager (test)', false)`);
    await db.execute(sql`insert into role_permissions (role_code, permission) values (${code}, 'roles.manage'), (${code}, 'dashboard.view')`);
    const mgrUser = await makeUser({ staff: true });
    await db.insert(userRoles).values({ userId: mgrUser.id, roleCode: code });
    const manager = await adminActor(mgrUser.id, { stepUpAt: new Date() });
    const target = await makeUser({ staff: true });
    await expect(setStaffRole(manager, 'grant', { userId: target.id, role: 'FINANCE_CHECKER', reason: 'منح صلاحية مالية', confirmPrivileged: true })).rejects.toThrow(/للمدير العام فقط/);
    await expect(createStaffUser(manager, { email: `x-${randomUUID().slice(0, 6)}@test.local`, phone: '+201199999999', fullName: 'محاولة', role: 'FINANCE_OPERATOR', reason: 'محاولة إنشاء مالي', confirmPrivileged: true })).rejects.toThrow(/للمدير العام فقط/);
  });
});

describe('F-7 support tickets can only reference the requester’s own records', () => {
  it('a foreign order id is refused; a malformed id is refused', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const [o] = await db.execute<{ id: string }>(sql`insert into orders (number, customer_id, status, merchandise_total, shipping_total, grand_total, currency)
      values (nextval('orders_number_seq'), ${b.user.id}, 'PENDING_PAYMENT', 100, 0, 100, 'EGP') returning id`).then((r) => r.rows).catch(() => [] as { id: string }[]);
    if (o) await expect(openTicket(a.actor, { type: 'ORDER', subject: 'استفسار عن طلب', body: 'عندي استفسار عن الطلب ده من فضلكم', relatedType: 'order', relatedId: o.id })).rejects.toThrow(/مش تابعة لحسابك/);
    await expect(openTicket(a.actor, { type: 'ORDER', subject: 'استفسار عن طلب', body: 'عندي استفسار عن الطلب ده من فضلكم', relatedType: 'order', relatedId: randomUUID() })).rejects.toThrow(/مش تابعة لحسابك/);
    await expect(openTicket(a.actor, { type: 'ORDER', subject: 'استفسار عن طلب', body: 'عندي استفسار عن الطلب ده من فضلكم', relatedType: 'order', relatedId: 'not-an-id' })).rejects.toThrow(/غير صحيح/);
    // No reference at all is fine.
    await expect(openTicket(a.actor, { type: 'TECHNICAL', subject: 'استفسار عام عن المنصة', body: 'عندي سؤال عام عن طريقة الشراء من فضلكم' })).resolves.toBeTruthy();
  });
});

describe('F-13 abuse limits', () => {
  it('reporting a review that does not exist is refused', async () => {
    const c = await makeCustomer();
    await expect(reportReview(c.actor, 'PRODUCT', randomUUID(), 'سبب الإبلاغ عن التقييم')).rejects.toThrow();
  });
});

describe('SMS is optional to boot but never faked', () => {
  it('production without an SMS provider: boot policy only warns, SMS flows are refused, nothing is marked sent', async () => {
    const r = validateEnvironment({ EDMN_ENVIRONMENT: 'production', MAIL_DRIVER: 'smtp', MAIL_FROM: 'اضمن <no-reply@edmneg.com>', ENFORCE_ADMIN_HOST: 'true', DATABASE_URL: 'x', SESSION_SECRET: 'a'.repeat(44), DATA_ENCRYPTION_KEY: 'b'.repeat(44) });
    expect(r.errors.join()).not.toMatch(/SMS/);
    expect(r.warnings.join()).toMatch(/SMS not configured/);
    expect(smsAvailable({ EDMN_ENVIRONMENT: 'production', SMS_DRIVER: 'log' })).toBe(false);
    expect(smsAvailable({ EDMN_ENVIRONMENT: 'staging', SMS_DRIVER: 'log' })).toBe(true);
    const u = await makeUser();
    process.env.EDMN_ENVIRONMENT = 'production';
    process.env.SMS_DRIVER = 'log';
    await expect(sendVerificationCode(u.id, 'PHONE')).rejects.toThrow(/SMS/);
    await expect(providerFor('SMS')).rejects.toThrow(/not configured in production/);
    const { createDeal } = await import('@/server/modules/deals/service');
    await expect(createDeal((await makeCustomer()).actor, { title: 'صفقة اختبار', quantity: 1, condition: 'NEW' } as never)).rejects.toThrow(/SMS/);
  });

  it('production requires the admin console on its own host and a real sender address', () => {
    const r = validateEnvironment({ EDMN_ENVIRONMENT: 'production', MAIL_DRIVER: 'smtp', MAIL_FROM: 'EDMN <no-reply@example.com>', DATABASE_URL: 'x', SESSION_SECRET: 'a'.repeat(44), DATA_ENCRYPTION_KEY: 'b'.repeat(44) });
    expect(r.errors.join()).toMatch(/ENFORCE_ADMIN_HOST/);
    expect(r.errors.join()).toMatch(/MAIL_FROM/);
  });
});

describe('Public website vs transactions', () => {
  it('maintenance mode closes new commerce; production stays closed until real money is enabled; staging/test open', async () => {
    expect((await transactionsState()).open).toBe(true);
    await setSetting('marketplace.maintenanceMode', true);
    expect(await transactionsState()).toEqual({ open: false, reason: 'MAINTENANCE' });
    await expect(assertTransactionsOpen()).rejects.toThrow(/صيانة/);
    await db.execute(sql`delete from system_settings where key = 'marketplace.maintenanceMode'`);
    process.env.EDMN_ENVIRONMENT = 'production';
    expect(await transactionsState()).toEqual({ open: false, reason: 'NOT_LAUNCHED' });
    const { placeOrder } = await import('@/server/modules/commerce/orders');
    const c = await makeCustomer();
    await expect(placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'BANK_TRANSFER', expectedTotal: 1, clientKey: randomUUID() } as never)).rejects.toThrow(/هيبدأوا قريبًا/);
  });
});

describe('Email links are absolute and every notification email carries a footer', () => {
  it('relative in-app links become APP_URL links in the email body', async () => {
    const u = await makeUser();
    await notify(db, { event: 'SELLER_STATUS_CHANGED', userIds: [u.id], vars: { status: 'موقوف' }, link: '/account/orders/abc' });
    const [m] = await db.select().from(outboundMessages).where(and(eq(outboundMessages.recipient, u.email!), eq(outboundMessages.channel, 'EMAIL'), eq(outboundMessages.event, 'SELLER_STATUS_CHANGED')));
    expect(m.body).toContain(absoluteUrl('/account/orders/abc'));
    expect(m.body).toContain(absoluteUrl('/account/notifications/settings'));
    expect(m.body).not.toMatch(/(^|\s)\/account\/orders\/abc/m);
  });
});

describe('Admin console on its own host (ENFORCE_ADMIN_HOST) without forcing the seller subdomain', () => {
  it('www/admin redirects to the admin host; www/seller stays on www; the admin host serves /admin under a nonce CSP', async () => {
    process.env.ENFORCE_ADMIN_HOST = 'true';
    delete process.env.ENFORCE_HOSTS;
    process.env.ADMIN_HOST = 'admin.edmneg.com';
    const { proxy } = await import('@/proxy');
    const r1 = proxy(new NextRequest('https://www.edmneg.com/admin/withdrawals', { headers: { host: 'www.edmneg.com' } }));
    expect(r1.status).toBe(307);
    expect(r1.headers.get('location')).toBe('https://admin.edmneg.com/withdrawals');
    const r2 = proxy(new NextRequest('https://www.edmneg.com/seller/orders', { headers: { host: 'www.edmneg.com' } }));
    expect(r2.headers.get('location')).toBeNull();
    const r3 = proxy(new NextRequest('https://admin.edmneg.com/withdrawals', { headers: { host: 'admin.edmneg.com' } }));
    expect(r3.headers.get('x-middleware-rewrite')).toContain('/admin/withdrawals');
    expect(r3.headers.get('content-security-policy')).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
    // Shared assets (service worker, robots, sitemap) are never rewritten into /admin.
    const r4 = proxy(new NextRequest('https://admin.edmneg.com/sw.js', { headers: { host: 'admin.edmneg.com' } }));
    expect(r4.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
