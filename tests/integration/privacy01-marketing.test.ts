import { createDecipheriv, randomUUID, scryptSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { register } from '@/server/auth/service';
import { db } from '@/server/db/client';
import { auditLogs, marketingConsentEvents, marketingExports, users } from '@/server/db/schema';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import {
  downloadMarketingExport,
  encryptExport,
  executeMarketingExport,
  rejectMarketingExport,
  requestMarketingExport,
  setMarketingConsent,
} from '@/server/modules/customers/marketing';
import { updateSetting } from '@/server/modules/settings';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller } from '../helpers/factory';

let admin: ReturnType<typeof makeAdmin> extends Promise<infer T> ? T : never;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

const META = { ip: '10.0.0.1', userAgent: 'vitest' };

let phoneSeq = 50_000_000;
/** A unique, valid Egyptian mobile for registrations (010/011/012/015 + 8 digits). */
function testPhone(prefix: '010' | '011' | '012' | '015' = '010') {
  phoneSeq += 1;
  return `${prefix}${String(phoneSeq).slice(-8)}`;
}

function decryptExport(encBase64: string, passphrase: string): string {
  const env = JSON.parse(Buffer.from(encBase64, 'base64').toString('utf8')) as { salt: string; iv: string; tag: string; data: string };
  const key = scryptSync(passphrase, Buffer.from(env.salt, 'base64'), 32);
  const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  dec.setAuthTag(Buffer.from(env.tag, 'base64'));
  return Buffer.concat([dec.update(Buffer.from(env.data, 'base64')), dec.final()]).toString('utf8');
}

describe('PRIVACY-01 — marketing consent', () => {
  it('sign-up defaults consent OFF and records no consent event', async () => {
    const r = await register({ fullName: 'عميل افتراضي', email: `priv-def-${randomUUID()}@test.local`, phone: testPhone('010'), password: 'Test@12345' }, META);
    const [u] = await db.select().from(users).where(eq(users.id, r.user.id));
    expect(u.marketingOptIn).toBe(false);
    const events = await db.select().from(marketingConsentEvents).where(eq(marketingConsentEvents.userId, u.id));
    expect(events).toHaveLength(0);
  });

  it('sign-up with consent stores the opt-in AND a dated GRANT event', async () => {
    const r = await register({ fullName: 'عميل موافق', email: `priv-yes-${randomUUID()}@test.local`, phone: testPhone('011'), password: 'Test@12345', marketingConsent: true }, META);
    const [u] = await db.select().from(users).where(eq(users.id, r.user.id));
    expect(u.marketingOptIn).toBe(true);
    const [ev] = await db.select().from(marketingConsentEvents).where(eq(marketingConsentEvents.userId, u.id));
    expect(ev.action).toBe('GRANT');
    expect(ev.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('consent is withdrawable anytime; the dated log is append-only; repeating the state records nothing', async () => {
    const c = await makeCustomer();
    expect((await setMarketingConsent(c.actor, true, 'WEB')).changed).toBe(true);
    expect((await setMarketingConsent(c.actor, true, 'WEB')).changed).toBe(false); // idempotent
    expect((await setMarketingConsent(c.actor, false, 'WEB')).changed).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, c.user.id));
    expect(u.marketingOptIn).toBe(false);
    const events = await db.select().from(marketingConsentEvents).where(eq(marketingConsentEvents.userId, c.user.id));
    expect(events.map((e) => e.action)).toEqual(['GRANT', 'WITHDRAW']);
    const [auditRow] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, c.user.id), eq(auditLogs.action, 'account.marketing_consent_withdrawn')));
    expect(auditRow).toBeTruthy();
  });
});

describe('PRIVACY-01 — marketing export', () => {
  it('the dedicated permission is required (a plain support agent cannot even request)', async () => {
    const support = await makeAdmin(['FINANCE_CHECKER']);
    await expect(requestMarketingExport(support, { reason: 'سبب طويل كفاية للاختبار', confirmed: true })).rejects.toThrow();
  });

  it('a request needs the explicit confirmation; one open request per requester', async () => {
    const requester = await makeAdmin();
    await expect(requestMarketingExport(requester, { reason: 'سبب طويل كفاية للاختبار', confirmed: false })).rejects.toThrow(/تأكد/);
    const a = await requestMarketingExport(requester, { reason: 'حملة عروض للعملاء الموافقين فقط', confirmed: true });
    const b = await requestMarketingExport(requester, { reason: 'محاولة ثانية لنفس الطلب', confirmed: true });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.export.id).toBe(a.export.id);
  });

  it('two-person rule: the requester cannot execute their own request; another approver can', async () => {
    const requester = await makeAdmin();
    const approver = await makeAdmin();
    const { export: req } = await requestMarketingExport(requester, { reason: 'تصدير شهري للقائمة التسويقية', confirmed: true });
    await expect(executeMarketingExport(requester, req.id)).rejects.toThrow(/شخصين/);
    // The DB CHECK constraint backs the service rule.
    await expect(db.update(marketingExports).set({ approvedBy: requester.userId }).where(eq(marketingExports.id, req.id))).rejects.toThrow();
    const res = await executeMarketingExport(approver, req.id);
    expect(res.alreadyExecuted).toBe(false);
    expect(res.passphrase).toBeTruthy();
    const [row] = await db.select().from(marketingExports).where(eq(marketingExports.id, req.id));
    expect(row.status).toBe('EXECUTED');
    expect(row.approvedBy).toBe(approver.userId);
    expect(row.fileEnc).toBeTruthy();
    expect(row.fileEnc).not.toContain('@'); // nothing readable inside — it is encrypted
    const [auditRow] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, req.id), eq(auditLogs.action, 'customers.marketing_export_executed')));
    expect(auditRow).toBeTruthy();
  });

  it('the export contains ONLY consenting ACTIVE customers with exactly the 5 allowed fields; encrypted file round-trips with the one-time passphrase', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    const consenting = await makeCustomer();
    await setMarketingConsent(consenting.actor, true, 'WEB');
    // An order so a purchase category appears.
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 2 });
    await addToCart({ userId: consenting.user.id }, p.variantId, 1);
    const lines = await cartLines(db, { userId: consenting.user.id });
    const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), consenting.address.governorateId);
    await placeOrder(consenting.actor, { addressId: consenting.address.id, paymentMethod: 'COD', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
    // Not in the audience: a non-consenting customer, a consenting STAFF user, a consenting LOCKED customer.
    await makeCustomer();
    const staff = await makeAdmin();
    await db.update(users).set({ marketingOptIn: true }).where(eq(users.id, staff.userId!));
    const [staffRow] = await db.select().from(users).where(eq(users.id, staff.userId!));
    const locked = await makeCustomer();
    await setMarketingConsent(locked.actor, true, 'WEB');
    await db.update(users).set({ status: 'LOCKED' }).where(eq(users.id, locked.user.id));

    const requester = await makeAdmin();
    const approver = await makeAdmin();
    const { export: req } = await requestMarketingExport(requester, { reason: 'اختبار محتوى الملف المصدَّر', confirmed: true });
    const res = await executeMarketingExport(approver, req.id);
    const csv = decryptExport((await downloadMarketingExport(approver, req.id)).contentBase64, res.passphrase!);
    const csvLines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    expect(csvLines[0]).toBe('الاسم,الموبايل,البريد الإلكتروني,المحافظة,فئات المشتريات');
    const dataLines = csvLines.slice(1);
    expect(dataLines.some((l) => l.includes(consenting.user.phone!))).toBe(true);
    expect(dataLines.some((l) => l.includes(locked.user.phone ?? 'no-such'))).toBe(false);
    expect(dataLines.some((l) => staffRow.email && l.includes(staffRow.email))).toBe(false);
    const me = dataLines.find((l) => l.includes(consenting.user.phone!))!;
    expect(me.split(',')).toHaveLength(5);
    expect(me).toContain('القاهرة'); // governorate only — never the detailed street
    expect(me).not.toContain('شارع الاختبار');
    expect(res.rowCount).toBe(dataLines.length);
    // A wrong passphrase never opens the file.
    expect(() => {
      const env = JSON.parse(Buffer.from(encryptExport('secret', 'right'), 'base64').toString('utf8'));
      const key = scryptSync('wrong', Buffer.from(env.salt, 'base64'), 32);
      const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
      dec.setAuthTag(Buffer.from(env.tag, 'base64'));
      Buffer.concat([dec.update(Buffer.from(env.data, 'base64')), dec.final()]);
    }).toThrow();
  });

  it('rejection also needs a second person, with a reason', async () => {
    const requester = await makeAdmin();
    const other = await makeAdmin();
    const { export: req } = await requestMarketingExport(requester, { reason: 'طلب سيُرفض من شخص آخر', confirmed: true });
    await expect(rejectMarketingExport(requester, req.id, 'غير مناسب')).rejects.toThrow();
    await expect(rejectMarketingExport(other, req.id, 'قصير')).rejects.toThrow(); // reason too short
    await rejectMarketingExport(other, req.id, 'السبب غير مقنع حاليًا');
    const [row] = await db.select().from(marketingExports).where(eq(marketingExports.id, req.id));
    expect(row.status).toBe('REJECTED');
    await expect(executeMarketingExport(other, req.id)).rejects.toThrow();
    await expect(downloadMarketingExport(other, req.id)).rejects.toThrow();
  });
  it('SEC-175: downloading the encrypted export needs a fresh step-up', async () => {
    const requester = await makeAdmin();
    const approver = await makeAdmin();
    const { export: req } = await requestMarketingExport(requester, { reason: 'اختبار خطوة التحقق الإضافية', confirmed: true });
    await executeMarketingExport(approver, req.id);
    await expect(downloadMarketingExport({ ...approver, stepUpAt: null }, req.id)).rejects.toThrow();
    await expect(downloadMarketingExport({ ...approver, stepUpAt: new Date(Date.now() - 24 * 3600_000) }, req.id)).rejects.toThrow();
    const ok = await downloadMarketingExport(approver, req.id);
    expect(ok.fileName).toBeTruthy();
  });
});
