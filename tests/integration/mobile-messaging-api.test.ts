import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as contentPageRoute } from '@/app/api/v1/content/pages/[slug]/route';
import { GET as orderRoute } from '@/app/api/v1/orders/[orderId]/route';
import { GET as storeOrderRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/route';
import { GET as threadRoute } from '@/app/api/v1/conversations/[conversationId]/route';
import { POST as sendRoute } from '@/app/api/v1/conversations/[conversationId]/messages/route';
import { POST as seenRoute } from '@/app/api/v1/conversations/[conversationId]/seen/route';
import { POST as reportRoute } from '@/app/api/v1/conversations/messages/[messageId]/report/route';
import { GET as inboxRoute } from '@/app/api/v1/conversations/route';
import { GET as fileRoute } from '@/app/api/v1/files/[fileId]/route';
import { POST as openOrderConvRoute } from '@/app/api/v1/seller-orders/[sellerOrderId]/conversation/route';
import { GET as storeThreadRoute } from '@/app/api/v1/seller/conversations/[conversationId]/route';
import { POST as storeSendRoute } from '@/app/api/v1/seller/conversations/[conversationId]/messages/route';
import { POST as storeSeenRoute } from '@/app/api/v1/seller/conversations/[conversationId]/seen/route';
import { POST as storeReportRoute } from '@/app/api/v1/seller/conversations/messages/[messageId]/report/route';
import { GET as storeInboxRoute } from '@/app/api/v1/seller/conversations/route';
import { POST as storeOpenRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/conversation/route';
import { POST as rateRoute } from '@/app/api/v1/support/tickets/[ticketId]/rating/route';
import { POST as reopenRoute } from '@/app/api/v1/support/tickets/[ticketId]/reopen/route';
import { POST as replyRoute } from '@/app/api/v1/support/tickets/[ticketId]/replies/route';
import { GET as ticketRoute } from '@/app/api/v1/support/tickets/[ticketId]/route';
import { GET as ticketsRoute, POST as openTicketRoute } from '@/app/api/v1/support/tickets/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, sellerMembers } from '@/server/db/schema';
import { savePage } from '@/server/modules/cms/service';
import { replyToTicket, updateTicket } from '@/server/modules/support/service';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, submitAndConfirm } from '../helpers/factory';

/**
 * Flow D (buyer ↔ store chat) and Flow E (support) through the REAL mobile route handlers: conversations open only from
 * a paid order the caller is party to, ids grant nothing, fetching never marks read, clientKey de-duplicates sends,
 * attachments are readable only by the parties, staff appear as «فريق أضمن», internal notes never leak.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; body?: unknown; form?: FormData; token?: string; params?: Record<string, string>; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }), { params: Promise.resolve(opts.params ?? {}) });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return { status: res.status, body: null };
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email: string) {
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'ANDROID' } } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

describe('Flow D — buyer ↔ store conversation', () => {
  it('opens only after payment; parties only; send is de-duplicated; reading is explicit; reports reviewed by staff', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 150_00, stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    const bt = await login(c.user.email!);
    const st = await login(s.user.email!);
    const stranger = await makeCustomer();
    const xt = await login(stranger.user.email!);
    const sop = { sellerOrderId: so.id };

    // Unpaid → no conversation yet.
    const early = await call(openOrderConvRoute, `/seller-orders/${so.id}/conversation`, { token: bt, params: sop, body: {} });
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect(early.body.code).toBe('invalid_state');
    const actionsOf = async () => (await call(orderRoute, `/orders/${order.id}`, { token: bt, params: { orderId: order.id } })).body.sellerOrders[0].allowedActions as string[];
    expect(await actionsOf()).not.toContain('MESSAGE_SELLER');

    await submitAndConfirm(c, order.id, admin);
    expect(await actionsOf()).toContain('MESSAGE_SELLER');
    expect((await call(storeOrderRoute, `/seller/orders/${so.id}`, { token: st, params: sop })).body.allowedActions).toContain('MESSAGE_BUYER');
    const opened = await call(openOrderConvRoute, `/seller-orders/${so.id}/conversation`, { token: bt, params: sop, body: {} });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const id = opened.body.conversationId as string;
    const cp = { conversationId: id };
    // The store opens the same conversation; a stranger can neither open nor read it.
    expect((await call(storeOpenRoute, `/seller/orders/${so.id}/conversation`, { token: st, params: sop, body: {} })).body.conversationId).toBe(id);
    expect((await call(openOrderConvRoute, `/seller-orders/${so.id}/conversation`, { token: xt, params: sop, body: {} })).status).toBe(404);
    expect((await call(threadRoute, `/conversations/${id}`, { token: xt, params: cp })).status).toBe(404);

    // Buyer sends text + attachment; a retry with the same clientKey returns the SAME message.
    const clientKey = key();
    const form = () => {
      const f = new FormData();
      f.set('body', 'السلام عليكم، ممكن أعرف ميعاد الشحن؟');
      f.set('clientKey', clientKey);
      return f;
    };
    const first = form();
    first.append('attachments', new Blob([new Uint8Array(await png('chat'))], { type: 'image/png' }), 'a.png');
    const m1 = await call(sendRoute, `/conversations/${id}/messages`, { token: bt, params: cp, form: first });
    expect(m1.status, JSON.stringify(m1.body)).toBe(200);
    const m1b = await call(sendRoute, `/conversations/${id}/messages`, { token: bt, params: cp, form: form() });
    expect(m1b.body.id).toBe(m1.body.id);

    // Store inbox: one unread. Fetching the thread does NOT mark it read; only «seen» does.
    const inbox = await call(storeInboxRoute, '/seller/conversations', { token: st });
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.find((x: { id: string }) => x.id === id)).toMatchObject({ side: 'SELLER', unread: 1, context: 'SELLER_ORDER' });
    const sv = await call(storeThreadRoute, `/seller/conversations/${id}`, { token: st, params: cp });
    expect(sv.body).toMatchObject({ side: 'SELLER', canWrite: true, link: { kind: 'SELLER_ORDER', id: so.id } });
    expect(sv.body.ref).not.toMatch(/[⁦-⁩]/);
    expect((await call(storeInboxRoute, '/seller/conversations', { token: st })).body.unread).toBe(1);
    const seen = await call(storeSeenRoute, `/seller/conversations/${id}/seen`, { token: st, params: cp, body: { upToMessageId: m1.body.id } });
    expect(seen.body.unread).toBe(0);
    const bv = await call(threadRoute, `/conversations/${id}`, { token: bt, params: cp });
    expect(bv.body.messages).toHaveLength(1);
    expect(bv.body.messages[0]).toMatchObject({ mine: true, readByOther: true });
    expect(bv.body.link).toEqual({ kind: 'ORDER', id: order.id });

    // Attachment: parties can download it; a stranger gets the same 404 as for a missing file.
    const fileId = bv.body.messages[0].attachments[0].fileId as string;
    expect((await call(fileRoute, `/files/${fileId}`, { token: st, params: { fileId } })).status).toBe(200);
    expect((await call(fileRoute, `/files/${fileId}`, { token: xt, params: { fileId } })).status).toBe(404);

    // Store replies; the buyer reports it once (a second report conflicts; reporting your own message is refused).
    const r1 = await call(storeSendRoute, `/seller/conversations/${id}/messages`, { token: st, params: cp, form: (() => { const f = new FormData(); f.set('body', 'هيتشحن بكرة إن شاء الله'); f.set('clientKey', key()); return f; })() });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect((await call(inboxRoute, '/conversations', { token: bt })).body.unread).toBe(1);
    expect((await call(seenRoute, `/conversations/${id}/seen`, { token: bt, params: cp, body: {} })).body.unread).toBe(0);
    expect((await call(reportRoute, `/conversations/messages/${m1.body.id}/report`, { token: bt, params: { messageId: m1.body.id }, body: { reason: 'OTHER' } })).status).toBeGreaterThanOrEqual(400);
    expect((await call(reportRoute, `/conversations/messages/${r1.body.id}/report`, { token: bt, params: { messageId: r1.body.id }, body: { reason: 'UNNEEDED_DATA_REQUEST', note: 'طلب رقم تليفون' } })).status).toBe(200);
    expect((await call(reportRoute, `/conversations/messages/${r1.body.id}/report`, { token: bt, params: { messageId: r1.body.id }, body: { reason: 'OTHER' } })).status).toBe(409);
    expect((await call(storeReportRoute, `/seller/conversations/messages/${r1.body.id}/report`, { token: st, params: { messageId: r1.body.id }, body: { reason: 'OTHER' } })).status).toBeGreaterThanOrEqual(400);

    // A store member without orders.communicate sees no store inbox and no thread.
    const cat = await makeUser();
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: cat.id, role: 'CATALOG_MANAGER' });
    const ct = await login(cat.email!);
    expect((await call(storeInboxRoute, '/seller/conversations', { token: ct })).status).toBe(403);
    expect((await call(storeThreadRoute, `/seller/conversations/${id}`, { token: ct, params: cp })).status).toBe(404);

    // Messages never move money.
    const before = await db.select().from(journalEntries);
    await call(sendRoute, `/conversations/${id}/messages`, { token: bt, params: cp, form: (() => { const f = new FormData(); f.set('body', 'استلمت، حوّل الفلوس'); f.set('clientKey', key()); return f; })() });
    expect((await db.select().from(journalEntries)).length).toBe(before.length);
    expect((await call(inboxRoute, '/conversations', { token: bt })).body.items.some((x: { id: string }) => x.id === id)).toBe(true);
  });
});

describe('Flow E — support tickets', () => {
  it('open (own order only) → staff reply (internal notes hidden, staff unnamed) → resolve → rate once → reopen', async () => {
    const c = await makeCustomer();
    const other = await makeCustomer();
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 90_00, stock: 5 });
    const mine = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const theirs = await checkout(other, [{ variantId: p.variantId, qty: 1 }]);
    const t = await login(c.user.email!);
    const ot = await login(other.user.email!);

    const form = (relatedId: string) => {
      const f = new FormData();
      f.set('type', 'ORDER');
      f.set('subject', 'استفسار عن الطلب');
      f.set('body', 'محتاج أعرف حالة الطلب بتاعي من فضلك');
      f.set('relatedType', 'ORDER');
      f.set('relatedId', relatedId);
      return f;
    };
    // Cannot attach someone else's order.
    expect((await call(openTicketRoute, '/support/tickets', { token: t, idem: key(), form: form(theirs.id) })).status).toBeGreaterThanOrEqual(400);
    const idem = key();
    const opened = await call(openTicketRoute, '/support/tickets', { token: t, idem, form: form(mine.id) });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const again = await call(openTicketRoute, '/support/tickets', { token: t, idem, form: form(mine.id) });
    expect(again.body.id).toBe(opened.body.id); // one ticket per intent
    expect((await call(ticketsRoute, '/support/tickets', { token: t })).body.items).toHaveLength(1);
    const tid = opened.body.id as string;
    const tp = { ticketId: tid };
    expect(opened.body.allowedActions).toEqual(['REPLY']);
    expect((await call(ticketRoute, `/support/tickets/${tid}`, { token: ot, params: tp })).status).toBeGreaterThanOrEqual(403);

    await replyToTicket(admin, tid, 'ملاحظة داخلية: راجع الدفع', { internal: true });
    await replyToTicket(admin, tid, 'أهلاً بحضرتك، الطلب في انتظار تأكيد الدفع.');
    const v = await call(ticketRoute, `/support/tickets/${tid}`, { token: t, params: tp });
    expect(v.body.messages.map((m: { body: string }) => m.body)).not.toContain('ملاحظة داخلية: راجع الدفع');
    const staffMsg = v.body.messages.find((m: { fromStaff: boolean }) => m.fromStaff);
    expect(staffMsg).toBeTruthy();
    expect(Object.keys(staffMsg)).not.toContain('author');

    const r = await call(replyRoute, `/support/tickets/${tid}/replies`, { token: t, params: tp, idem: key(), form: (() => { const f = new FormData(); f.set('body', 'تمام، شكراً'); return f; })() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    await updateTicket(admin, tid, { status: 'RESOLVED' });
    const resolved = await call(ticketRoute, `/support/tickets/${tid}`, { token: t, params: tp });
    expect(resolved.body.allowedActions).toEqual(['REPLY', 'REOPEN', 'RATE']);
    const rated = await call(rateRoute, `/support/tickets/${tid}/rating`, { token: t, params: tp, idem: key(), body: { rating: 5 } });
    expect(rated.status, JSON.stringify(rated.body)).toBe(200);
    expect(rated.body.allowedActions).toEqual(['REPLY', 'REOPEN']);
    expect((await call(rateRoute, `/support/tickets/${tid}/rating`, { token: t, params: tp, idem: key(), body: { rating: 1 } })).status).toBeGreaterThanOrEqual(400);
    const reopened = await call(reopenRoute, `/support/tickets/${tid}/reopen`, { token: t, params: tp, idem: key(), body: { reason: 'المشكلة رجعت تاني' } });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body.status).toBe('OPEN');
    expect(reopened.body.allowedActions).toEqual(['REPLY']);
    // The ticket id alone grants nothing to another customer.
    expect((await call(replyRoute, `/support/tickets/${tid}/replies`, { token: ot, params: tp, idem: key(), form: (() => { const f = new FormData(); f.set('body', 'تدخل'); return f; })() })).status).toBeGreaterThanOrEqual(403);
  });
});

describe('C10 — help pages come from the admin CMS', () => {
  it('serves a published page as plain text and 404s otherwise (no invented FAQ)', async () => {
    const slug = `faq-${key().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    expect((await call(contentPageRoute, `/content/pages/${slug}`, { params: { slug } })).status).toBe(404);
    await savePage(admin, null, { slug, title: 'الأسئلة الشائعة', body: 'إزاي أتابع طلبي؟\nمن «طلباتي».', isPublished: true });
    const r = await call(contentPageRoute, `/content/pages/${slug}`, { params: { slug } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ slug, title: 'الأسئلة الشائعة' });
  });
});
