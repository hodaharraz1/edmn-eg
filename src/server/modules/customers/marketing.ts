import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { addresses, categories, governorates, marketingConsentEvents, marketingExports, orderItems, orders, sellerOrders, users } from '@/server/db/schema';

/**
 * Marketing consent + audience export (owner instruction 2026-11-25, PKG-PRIVACY-01).
 *  - Consent is OFF by default at sign-up, changeable anytime; every change is a dated, append-only event.
 *  - The export lists CONSENTING, ACTIVE customers only: name, phone, email, governorate, purchase categories.
 *    Never exported: national ID data, ID photos, receipts, detailed addresses, locked/disabled/closed accounts.
 *  - Three controls: the dedicated permission `customers.exportMarketing` (both people) + the requester's
 *    explicit confirmation + a DIFFERENT staff member's approval (DB CHECK). The file is encrypted
 *    (AES-256-GCM, scrypt; one-time passphrase shown once) and every step is audit-logged.
 */

/** Grant or withdraw marketing consent. Idempotent: repeating the current state records nothing new. */
export async function setMarketingConsent(actor: Actor, optIn: boolean, channel?: 'WEB' | 'MOBILE') {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ marketingOptIn: users.marketingOptIn }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) throw notFound('الحساب');
    if (u.marketingOptIn === optIn) return { marketingOptIn: u.marketingOptIn, changed: false };
    await tx.update(users).set({ marketingOptIn: optIn }).where(eq(users.id, userId));
    await tx.insert(marketingConsentEvents).values({ userId, action: optIn ? 'GRANT' : 'WITHDRAW', channel: channel ?? null });
    await audit(tx, actor, { action: optIn ? 'account.marketing_consent_granted' : 'account.marketing_consent_withdrawn', entityType: 'user', entityId: userId });
    return { marketingOptIn: optIn, changed: true };
  });
}

/** Step 1 (of the requester's two steps): permission + step-up, then the explicit confirmation (step 2). */
export async function requestMarketingExport(actor: Actor, input: { reason: string; confirmed: boolean }) {
  requirePermission(actor, 'customers.exportMarketing');
  requireStepUp(actor);
  const reason = input.reason?.trim();
  if (!reason || reason.length < 10) throw validation('اكتب سبب التصدير (10 أحرف على الأقل)');
  if (!input.confirmed) throw validation('لازم تأكد إن القائمة هتتستخدم لرسائل تسويق اضمن بس وللعملاء الموافقين فقط');
  return db.transaction(async (tx) => {
    // One open request per requester (a retry returns the same request).
    const [open] = await tx.select().from(marketingExports).where(and(eq(marketingExports.requestedBy, actor.userId!), eq(marketingExports.status, 'REQUESTED'))).for('update');
    if (open) return { export: open, created: false };
    const [row] = await tx.insert(marketingExports).values({ requestedBy: actor.userId!, requestReason: reason }).returning();
    await audit(tx, actor, { action: 'customers.marketing_export_requested', entityType: 'marketing_export', entityId: row.id, newValues: { reason } });
    return { export: row, created: true };
  });
}

export async function rejectMarketingExport(actor: Actor, exportId: string, reason: string) {
  requirePermission(actor, 'customers.exportMarketing');
  requireStepUp(actor);
  const why = reason?.trim();
  if (!why || why.length < 5) throw validation('اكتب سبب الرفض');
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(marketingExports).where(eq(marketingExports.id, exportId)).for('update');
    if (!row) throw notFound('الطلب');
    if (row.status !== 'REQUESTED') throw invalidState('الطلب ده اتقفل خلاص');
    if (row.requestedBy === actor.userId) throw forbidden('لا يمكنك إقفال طلب أنشأته بنفسك — يراجعه شخص آخر');
    await tx.update(marketingExports).set({ status: 'REJECTED', rejectedAt: new Date(), rejectReason: why, approvedBy: actor.userId }).where(eq(marketingExports.id, row.id));
    await audit(tx, actor, { action: 'customers.marketing_export_rejected', entityType: 'marketing_export', entityId: row.id, reason: why });
  });
}

interface AudienceRow {
  fullName: string;
  phone: string | null;
  email: string | null;
  governorate: string | null;
  categories: string;
}

/** The export audience: consenting, ACTIVE customers only. Nothing else — by construction of this query. */
async function marketingAudience(tx: DbOrTx): Promise<AudienceRow[]> {
  const rows = await tx
    .select({ id: users.id, fullName: users.fullName, phone: users.phone, email: users.email })
    .from(users)
    .where(and(eq(users.marketingOptIn, true), eq(users.status, 'ACTIVE'), eq(users.isStaff, false)))
    .orderBy(users.createdAt);
  const out: AudienceRow[] = [];
  for (const u of rows) {
    // Governorate of the most recent address (governorate only — never the detailed address).
    const [addr] = await tx
      .select({ nameAr: governorates.nameAr })
      .from(addresses)
      .innerJoin(governorates, eq(governorates.id, addresses.governorateId))
      .where(and(eq(addresses.userId, u.id), sql`${addresses.archivedAt} is null`))
      .orderBy(desc(addresses.createdAt))
      .limit(1);
    // Purchase categories (Arabic names, distinct) from non-cancelled orders.
    const cats = await tx
      .selectDistinct({ nameAr: categories.nameAr })
      .from(orderItems)
      .innerJoin(sellerOrders, eq(sellerOrders.id, orderItems.sellerOrderId))
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .innerJoin(categories, eq(categories.id, orderItems.categoryIdSnapshot))
      .where(and(eq(orders.customerId, u.id), ne(orders.status, 'CANCELLED')));
    out.push({ fullName: u.fullName, phone: u.phone, email: u.email, governorate: addr?.nameAr ?? null, categories: cats.map((c) => c.nameAr).join('، ') });
  }
  return out;
}

function toCsv(rows: AudienceRow[]): string {
  const esc = (v: string | null) => `"${(v ?? '').replaceAll('"', '""')}"`;
  const header = 'الاسم,الموبايل,البريد الإلكتروني,المحافظة,فئات المشتريات';
  return '\uFEFF' + [header, ...rows.map((r) => [r.fullName, r.phone, r.email, r.governorate, r.categories].map(esc).join(','))].join('\n');
}

/** AES-256-GCM with a one-time passphrase (scrypt). Envelope format documented in scripts/decrypt-marketing-export.mjs. */
export function encryptExport(plain: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const envelope = { v: 1, alg: 'AES-256-GCM', kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

/** Step 3: a DIFFERENT staff member (same permission + step-up) approves and executes. The passphrase is returned once, to them. */
export async function executeMarketingExport(actor: Actor, exportId: string) {
  requirePermission(actor, 'customers.exportMarketing');
  requireStepUp(actor);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(marketingExports).where(eq(marketingExports.id, exportId)).for('update');
    if (!row) throw notFound('الطلب');
    if (row.status === 'EXECUTED') return { alreadyExecuted: true as const, rowCount: row.rowCount ?? 0, fileName: row.fileName!, passphrase: null };
    if (row.status !== 'REQUESTED') throw invalidState('الطلب ده اتقفل خلاص');
    if (row.requestedBy === actor.userId) throw forbidden('التصدير يتطلب شخصين: لا يمكنك تنفيذ طلب أنشأته بنفسك');
    const audience = await marketingAudience(tx);
    const csv = toCsv(audience);
    const passphrase = randomBytes(18).toString('base64url'); // shown ONCE to the approver, never stored
    const fileName = `edmn-marketing-audience-${new Date().toISOString().slice(0, 10)}-${row.id.slice(0, 8)}.enc`;
    await tx
      .update(marketingExports)
      .set({ status: 'EXECUTED', approvedBy: actor.userId, executedAt: new Date(), rowCount: audience.length, fileEnc: encryptExport(csv, passphrase), fileName })
      .where(eq(marketingExports.id, row.id));
    await audit(tx, actor, { action: 'customers.marketing_export_executed', entityType: 'marketing_export', entityId: row.id, newValues: { rowCount: audience.length, fileName } });
    return { alreadyExecuted: false as const, rowCount: audience.length, fileName, passphrase };
  });
}

/** Encrypted file download (audited). Only the one-time passphrase opens it. */
export async function downloadMarketingExport(actor: Actor, exportId: string) {
  requirePermission(actor, 'customers.exportMarketing');
  const [row] = await db.select().from(marketingExports).where(eq(marketingExports.id, exportId));
  if (!row || row.status !== 'EXECUTED' || !row.fileEnc || !row.fileName) throw notFound('الملف');
  await db.transaction(async (tx) => {
    await audit(tx, actor, { action: 'customers.marketing_export_downloaded', entityType: 'marketing_export', entityId: row.id });
  });
  return { fileName: row.fileName, contentBase64: row.fileEnc };
}

export async function listMarketingExports(actor: Actor) {
  requirePermission(actor, 'customers.exportMarketing');
  const rows = await db
    .select({
      e: marketingExports,
      requesterName: users.fullName,
      approverName: sql<string | null>`(select full_name from users where id = ${marketingExports.approvedBy})`,
    })
    .from(marketingExports)
    .innerJoin(users, eq(users.id, marketingExports.requestedBy))
    .orderBy(desc(marketingExports.requestedAt))
    .limit(50);
  return rows;
}
