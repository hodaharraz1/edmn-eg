import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { customerActor, sellerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { conversationMessages, notificationDeliveries, notifications, pushSubscriptions, sellerMembers, systemSettings } from '@/server/db/schema';
import { liveSnapshot } from '@/server/modules/messaging/live';
import {
  listForSeller,
  listForUser,
  loadMessages,
  markRead,
  openDealConversation,
  openSellerOrderConversation,
  participantAccess,
  participantThread,
  sendMessage,
  staffThread,
  unreadForSeller,
  unreadForUser,
} from '@/server/modules/messaging/service';
import { dispatchDeliveries, markDeliveryOpened, prefsFor, savePrefs } from '@/server/modules/notifications/message-alerts';
import { revokeSubscription, saveSubscription, setPushSender } from '@/server/modules/notifications/push';
import { claimInvitation, respondToOffer, submitSellerOffer } from '@/server/modules/deals/service';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

/**
 * Real-time messaging, notification routing and financial isolation (docs/NOTIFICATIONS_REALTIME.md).
 * Numbers refer to the acceptance matrix (§78). Push is exercised against a simulated push service
 * (the network sender is replaced) — the real browser push service is NOT contacted from tests.
 */
let admin: Actor;
const pushed: { endpoint: string; payload: Record<string, unknown> }[] = [];
let pushStatus = 201;

beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
  process.env.PUSH_ALLOW_ANY_ENDPOINT = 'true';
  setPushSender(async (secret, payload) => {
    pushed.push({ endpoint: secret.endpoint, payload: JSON.parse(payload) });
    if (pushStatus >= 400) throw Object.assign(new Error(`push ${pushStatus}`), { statusCode: pushStatus });
    return { statusCode: pushStatus };
  });
});
afterAll(() => {
  setPushSender(null);
  delete process.env.PUSH_ALLOW_ANY_ENDPOINT;
});

const send = (a: Actor, convId: string, body: string, files: { data: Buffer; name: string }[] = [], clientKey = randomUUID()) => sendMessage(a, convId, { body, clientKey }, files);

async function withSettings<T>(values: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const before = await db.select().from(systemSettings);
  for (const [key, value] of Object.entries(values)) {
    await db.insert(systemSettings).values({ key, value }).onConflictDoUpdate({ target: systemSettings.key, set: { value } });
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(values)) {
      const prev = before.find((r) => r.key === key);
      if (prev) await db.update(systemSettings).set({ value: prev.value }).where(eq(systemSettings.key, key));
      else await db.delete(systemSettings).where(eq(systemSettings.key, key));
    }
  }
}

async function paidOrder() {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 400_00 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  const conv = await openSellerOrderConversation(c.actor, so.id);
  return { s, c, order, so, conv };
}

async function member(sellerId: string, role: string) {
  const u = await makeUser({ name: 'موظف متجر' });
  await db.insert(sellerMembers).values({ sellerId, userId: u.id, role: role as never, isActive: true });
  return { user: u, actor: (await sellerActor(u.id))! };
}

const deliveries = (messageId: string) => db.select().from(notificationDeliveries).where(eq(notificationDeliveries.messageId, messageId));
const channelOf = async (messageId: string, userId: string, channel: string) =>
  (await db.select().from(notificationDeliveries).where(and(eq(notificationDeliveries.messageId, messageId), eq(notificationDeliveries.recipientUserId, userId), eq(notificationDeliveries.channel, channel as never))))[0];

/** Everything money/delivery/terms-related for a sub-order (and the global ledger) — must never move because of chat. */
async function fingerprint(soId: string) {
  const r = await db.execute<{ f: unknown }>(sql`select json_build_object(
    'so', (select row_to_json(x) from (select status, receipt_basis, receipt_confirmed_by, delivered_at, completed_at, financial_hold, funds_released_at,
             seller_net, commission_total, buyer_fee_total, seller_fee_total, refunded_total, pricing_snapshot, updated_at from seller_orders where id = ${soId}) x),
    'journals', (select count(*) from journal_entries), 'dr', (select coalesce(sum(debit),0) from journal_lines), 'cr', (select coalesce(sum(credit),0) from journal_lines),
    'balances', (select json_agg(balance order by id) from ledger_accounts),
    'refunds', (select count(*) from refunds), 'disputes', (select count(*) from disputes), 'approvals', (select count(*) from financial_approvals),
    'withdrawals', (select count(*) from withdrawal_requests), 'shipments', (select count(*) from shipments where seller_order_id = ${soId}),
    'payments', (select json_agg(row_to_json(p) order by p.id) from (select id, status, confirmed_amount, updated_at from payments) p)
  ) f`);
  return JSON.stringify(r.rows[0].f);
}

/* ───────────────────────── live delivery, unread, read receipts ───────────────────────── */

describe('live sync (no refresh)', () => {
  it('1-3, 7-10 — buyer→seller and seller→buyer arrive through the live channel; global and per-conversation unread; sender never counts', async () => {
    const { s, c, conv } = await paidOrder();
    const sellerStart = await liveSnapshot(s.actor, 'seller', { visible: true });
    const buyerStart = await liveSnapshot(c.actor, 'account', { visible: true });
    expect(sellerStart.incoming).toEqual([]); // first call: cursor only, no backlog toasts

    const m1 = await send(c.actor, conv.id, 'هل المقاس متاح؟');
    const sellerNext = await liveSnapshot(s.actor, 'seller', { since: sellerStart.cursor, visible: true });
    expect(sellerNext.incoming.map((i) => i.id)).toContain(m1.id);
    const item = sellerNext.incoming.find((i) => i.id === m1.id)!;
    expect(item.href).toBe(`/seller/messages/${conv.id}`);
    expect(item.from).toBe('المشتري');
    expect(sellerNext.unreadMessages).toBe(1);
    expect(await unreadForUser(c.user.id)).toBe(0); // 10 — own message never counts

    const m2 = await send(s.actor, conv.id, 'أيوه متاح');
    const buyerNext = await liveSnapshot(c.actor, 'account', { since: buyerStart.cursor, visible: true });
    const toBuyer = buyerNext.incoming.find((i) => i.id === m2.id)!;
    expect(toBuyer.href).toBe(`/account/messages/${conv.id}`);
    expect(toBuyer.ref).toMatch(/^الطلب \u2066#\d+-\w+\u2069$/);
    expect(buyerNext.unreadMessages).toBe(1);
    expect((await listForUser(c.actor)).find((x) => x.id === conv.id)?.unread).toBe(1); // 9
    expect(await unreadForSeller(s.actor)).toBe(0); // replying means the seller had the conversation open
  });

  it('4-6 — open conversation delta, background poll and reconnect after missed messages (no loss, no duplicates)', async () => {
    const { s, c, conv } = await paidOrder();
    const open = await participantThread(c.actor, conv.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await send(s.actor, conv.id, `رسالة ${i}`)).id);
    // background tab (visible=false) still reconciles counts
    const bg = await liveSnapshot(c.actor, 'account', { visible: false });
    expect(bg.unreadMessages).toBe(3);
    // the open conversation receives everything after its cursor
    const delta = await liveSnapshot(c.actor, 'account', { conv: conv.id, after: open.cursor ?? undefined, visible: true });
    expect(delta.thread?.messages.map((m) => m.id)).toEqual(ids);
    // reconnect from an old cursor: the overlap window re-sends, client de-duplicates by id → union has no dupes
    const again = await liveSnapshot(c.actor, 'account', { conv: conv.id, after: open.cursor ?? undefined, visible: true });
    expect(new Set([...delta.thread!.messages, ...again.thread!.messages].map((m) => m.id)).size).toBe(3);
  });

  it('11-13 — reading conversation A never clears B; multi-tab reconciles from the server; staff viewing never marks read', async () => {
    const a = await paidOrder();
    const s2 = await makeSeller(admin);
    const p2 = await makeProduct(s2.actor, admin, { price: 200_00 });
    const order2 = await checkout(a.c, [{ variantId: p2.variantId, qty: 1 }]);
    await submitAndConfirm(a.c, order2.id, admin);
    const [so2] = await sellerOrdersOf(order2.id);
    const convB = await openSellerOrderConversation(a.c.actor, so2.id);
    await send(a.s.actor, a.conv.id, 'من المتجر الأول');
    await send(s2.actor, convB.id, 'من المتجر التاني');
    expect(await unreadForUser(a.c.user.id)).toBe(2);
    const staffUser = await makeAdmin(['SUPER_ADMIN']);
    await staffThread(staffUser, a.conv.id, { via: 'test' });
    expect(await unreadForUser(a.c.user.id)).toBe(2); // 13
    // tab 1 reads A; tab 2's next poll sees the authoritative count
    await markRead(a.c.actor, a.conv.id);
    const tab2 = await liveSnapshot(a.c.actor, 'account', { visible: false });
    expect(tab2.unreadMessages).toBe(1); // 11 + 12
    expect((await listForUser(a.c.actor)).find((x) => x.id === convB.id)?.unread).toBe(1);
    // unread never negative: reading twice is idempotent
    await markRead(a.c.actor, a.conv.id);
    expect(await unreadForUser(a.c.user.id)).toBe(1);
  });

  it('14 — read receipts are real: «seen» only after the other side actually viewed, never because it was fetched', async () => {
    const { s, c, conv } = await paidOrder();
    const m = await send(c.actor, conv.id, 'شوفت رسالتي؟');
    await participantThread(s.actor, conv.id); // fetched (e.g. page render / poll)
    let snap = await liveSnapshot(c.actor, 'account', { conv: conv.id, visible: true });
    expect(snap.thread?.readIds).not.toContain(m.id);
    await markRead(s.actor, conv.id); // seller had it on screen
    snap = await liveSnapshot(c.actor, 'account', { conv: conv.id, visible: true });
    expect(snap.thread?.readIds).toContain(m.id);
  });

  it('32 — deterministic order for messages with the same server timestamp (timestamp, then id)', async () => {
    const { s, c, conv } = await paidOrder();
    const ts = new Date('2030-01-01T00:00:00Z');
    const rows = await db
      .insert(conversationMessages)
      .values([
        { conversationId: conv.id, senderUserId: c.user.id, senderRole: 'BUYER', body: 'a', clientKey: `k-${randomUUID()}`, createdAt: ts },
        { conversationId: conv.id, senderUserId: s.user.id, senderRole: 'SELLER', body: 'b', clientKey: `k-${randomUUID()}`, createdAt: ts },
      ])
      .returning({ id: conversationMessages.id });
    const list = await loadMessages(db, conv, { userId: c.user.id, side: 'BUYER' });
    const pos = rows.map((r) => r.id).sort();
    expect(list.slice(-2).map((m) => m.id)).toEqual(pos);
    expect((await loadMessages(db, conv, { userId: c.user.id, side: 'BUYER' })).map((m) => m.id)).toEqual(list.map((m) => m.id));
  });
});

/* ───────────────────────── notification routing ───────────────────────── */

describe('notification routing (in-app / push / email)', () => {
  it('15-16, 28 — alerts carry context and a deep link, never attachment links or (by default) the message text', async () => {
    const { s, c, conv } = await paidOrder();
    const start = await liveSnapshot(c.actor, 'account', { visible: true });
    const m = await send(s.actor, conv.id, '', [{ data: await png('att'), name: 'secret-doc.png' }]);
    const snap = await liveSnapshot(c.actor, 'account', { since: start.cursor, visible: true });
    const it1 = snap.incoming.find((i) => i.id === m.id)!;
    expect(it1.attachment).toBe(true);
    expect(it1.preview).toBe('');
    expect(JSON.stringify(snap)).not.toMatch(/\/api\/files|secret-doc/);
    const [n] = await db.select().from(notifications).where(and(eq(notifications.userId, c.user.id), eq(notifications.messageId, m.id)));
    expect(n.event).toBe('MESSAGE_ATTACHMENT_RECEIVED');
    expect(`${n.title} ${n.body}`).not.toMatch(/\/api\/files|secret-doc/);
    expect(n.link).toBe(`/account/messages/${conv.id}`);
  });

  it('17-18 — sound / in-app preferences are stored per user and default ON; push preview defaults OFF', async () => {
    const u = await makeUser();
    expect(await prefsFor(db, u.id)).toMatchObject({ messagesInApp: true, messagesSound: true, messagesPush: true, messagesEmail: true, pushPreview: false });
    await savePrefs(u.id, { messagesSound: false });
    expect((await prefsFor(db, u.id)).messagesSound).toBe(false);
    await savePrefs(u.id, { messagesSound: true });
    expect((await prefsFor(db, u.id)).messagesSound).toBe(true);
  });

  it('19, 31 — push needs an explicit subscription; multiple devices; generic lock-screen text; deep link is a path only', async () => {
    const { s, c, conv } = await paidOrder();
    let m = await send(s.actor, conv.id, 'بدون اشتراك');
    expect((await channelOf(m.id, c.user.id, 'PUSH')).reason).toBe('NO_SUBSCRIPTION');
    await saveSubscription(c.user.id, { endpoint: `https://push.example.test/${randomUUID()}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, 'Mozilla/5.0 (Android) Chrome/120');
    await saveSubscription(c.user.id, { endpoint: `https://push.example.test/${randomUUID()}`, keys: { p256dh: 'C'.repeat(87), auth: 'b'.repeat(22) } }, 'Mozilla/5.0 (Windows) Firefox/120');
    await markRead(c.actor, conv.id);
    pushed.length = 0;
    m = await send(s.actor, conv.id, 'سر: العنوان بالتفصيل');
    const d = await channelOf(m.id, c.user.id, 'PUSH');
    expect(d.status).toBe('QUEUED');
    await dispatchDeliveries({ ids: [d.id] });
    expect((await channelOf(m.id, c.user.id, 'PUSH')).status).toBe('SENT');
    expect(pushed).toHaveLength(2); // both devices
    for (const p of pushed) {
      expect(p.payload.url).toBe(`/account/messages/${conv.id}`);
      expect(String(p.payload.body)).not.toContain('سر'); // no text on the lock screen by default
    }
    // the stored subscription secrets are encrypted at rest
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, c.user.id));
    expect(subs.every((x) => !x.secretEnc.includes('push.example.test'))).toBe(true);
    // a URL is never authorization: another user opening the deep link gets not-found
    const other = await makeCustomer();
    await expect(participantAccess(other.actor, conv.id)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // 22
  });

  it('20-21 — invalid / non-HTTPS / unknown push endpoints are refused (no SSRF through push)', async () => {
    const u = await makeUser();
    process.env.PUSH_ALLOW_ANY_ENDPOINT = 'false';
    try {
      await expect(saveSubscription(u.id, { endpoint: 'http://169.254.169.254/latest', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, null)).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(saveSubscription(u.id, { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, null)).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(await saveSubscription(u.id, { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }, null)).toBeTruthy();
    } finally {
      process.env.PUSH_ALLOW_ANY_ENDPOINT = 'true';
    }
  });

  it('23-24 — expired subscription is revoked; a failing push service never loses the message and is retried', async () => {
    const { s, c, conv } = await paidOrder();
    const endpoint = `https://push.example.test/${randomUUID()}`;
    await saveSubscription(c.user.id, { endpoint, keys: { p256dh: 'D'.repeat(87), auth: 'c'.repeat(22) } }, null);
    pushStatus = 500;
    const m = await send(s.actor, conv.id, 'push service down');
    const d = await channelOf(m.id, c.user.id, 'PUSH');
    await dispatchDeliveries({ ids: [d.id] });
    const after500 = await channelOf(m.id, c.user.id, 'PUSH');
    expect(after500.status).toBe('QUEUED'); // will be retried
    expect(after500.reason).toBe('HTTP_500');
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.id, m.id))).toHaveLength(1); // 24
    pushStatus = 410;
    await db.update(notificationDeliveries).set({ runAfter: new Date(0) }).where(eq(notificationDeliveries.id, d.id));
    await dispatchDeliveries({ ids: [d.id] });
    const [sub] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, c.user.id));
    expect(sub.revokedReason).toBe('EXPIRED'); // 23
    pushStatus = 201;
    await revokeSubscription(c.user.id, { endpoint }).catch(() => undefined);
  });

  it('25-27 — email fallback after the delay, one per conversation per cooldown, suppressed once read', async () => {
    await withSettings({ 'messaging.emailFallbackDelayMinutes': 0, 'messaging.emailCooldownMinutes': 60 }, async () => {
      const { s, c, conv } = await paidOrder();
      const m1 = await send(s.actor, conv.id, 'رسالة 1');
      for (let i = 2; i <= 8; i++) await send(s.actor, conv.id, `رسالة ${i}`); // 8 messages in a burst
      const emails = await db.select().from(notificationDeliveries).where(and(eq(notificationDeliveries.conversationId, conv.id), eq(notificationDeliveries.recipientUserId, c.user.id), eq(notificationDeliveries.channel, 'EMAIL')));
      expect(emails).toHaveLength(8);
      expect(emails.filter((e) => e.status === 'QUEUED')).toHaveLength(1); // 26 — not 8 emails
      expect(emails.filter((e) => e.reason === 'BURST')).toHaveLength(7);
      await dispatchDeliveries();
      const e1 = await channelOf(m1.id, c.user.id, 'EMAIL');
      expect(e1.status).toBe('SENT'); // 25
      expect(e1.provider).toBe('log-email'); // no real email provider in tests
      // read, then a new burst inside the cooldown → suppressed
      await markRead(c.actor, conv.id);
      const m9 = await send(s.actor, conv.id, 'رسالة بعد القراءة');
      expect((await channelOf(m9.id, c.user.id, 'EMAIL')).reason).toBe('COOLDOWN');
    });
    await withSettings({ 'messaging.emailFallbackDelayMinutes': 0, 'messaging.emailCooldownMinutes': 0 }, async () => {
      const { s, c, conv } = await paidOrder();
      const m = await send(s.actor, conv.id, 'هتقراها قبل الإيميل');
      expect((await channelOf(m.id, c.user.id, 'EMAIL')).status).toBe('QUEUED');
      await markRead(c.actor, conv.id);
      await dispatchDeliveries();
      const e = await channelOf(m.id, c.user.id, 'EMAIL');
      expect(e.status).toBe('SUPPRESSED'); // 27
      expect(e.reason).toBe('READ');
    });
  });

  it('email/push preference OFF is honoured; an active (visible) recipient gets the in-app alert instead of push', async () => {
    const { s, c, conv } = await paidOrder();
    await saveSubscription(c.user.id, { endpoint: `https://push.example.test/${randomUUID()}`, keys: { p256dh: 'E'.repeat(87), auth: 'd'.repeat(22) } }, null);
    await liveSnapshot(c.actor, 'account', { visible: true }); // buyer is looking at EDMN right now
    const m = await send(s.actor, conv.id, 'وانت فاتح الموقع');
    expect((await channelOf(m.id, c.user.id, 'PUSH')).reason).toBe('ACTIVE_IN_APP');
    expect((await channelOf(m.id, c.user.id, 'IN_APP')).status).toBe('SENT');
    await markRead(c.actor, conv.id);
    await savePrefs(c.user.id, { messagesEmail: false, messagesPush: false });
    const m2 = await send(s.actor, conv.id, 'بعد إيقاف التنبيهات');
    expect((await channelOf(m2.id, c.user.id, 'EMAIL')).reason).toBe('PREFERENCE_OFF');
    expect((await channelOf(m2.id, c.user.id, 'PUSH')).reason).toBe('PREFERENCE_OFF');
  });

  it('29-30 — a retried send (same client key) creates neither a second message nor a second notification', async () => {
    const { s, c, conv } = await paidOrder();
    const key = randomUUID();
    const a = await send(c.actor, conv.id, 'مرة واحدة بس', [], key);
    const b = await send(c.actor, conv.id, 'مرة واحدة بس', [], key);
    expect(b.id).toBe(a.id);
    expect(await db.select().from(conversationMessages).where(and(eq(conversationMessages.conversationId, conv.id), eq(conversationMessages.clientKey, key)))).toHaveLength(1);
    const d = await deliveries(a.id);
    expect(d.filter((x) => x.recipientUserId === s.user.id && x.channel === 'IN_APP')).toHaveLength(1);
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, s.user.id), eq(notifications.messageId, a.id)))).toHaveLength(1);
    // re-running the dispatcher (worker retry) never re-sends a settled delivery
    await dispatchDeliveries();
    await dispatchDeliveries();
    expect((await deliveries(a.id)).length).toBe(d.length);
  });
});

/* ───────────────────────── authorization ───────────────────────── */

describe('authorization (IDOR) on the live channel', () => {
  it('33-36 — other buyer, other store and a store member without «communicate» see nothing; markup is plain text', async () => {
    const { s, c, conv } = await paidOrder();
    const fin = await member(s.actor.sellerId!, 'FINANCE');
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const otherBuyer = await makeCustomer();
    const otherSeller = await makeSeller(admin);
    const starts = await Promise.all([
      liveSnapshot(otherBuyer.actor, 'account', { visible: true }),
      liveSnapshot(otherSeller.actor, 'seller', { visible: true }),
      liveSnapshot(fin.actor, 'seller', { visible: true }),
      liveSnapshot(s.actor, 'seller', { visible: true }),
    ]);
    await send(c.actor, conv.id, xss);
    const [ob, os, f, owner] = await Promise.all([
      liveSnapshot(otherBuyer.actor, 'account', { since: starts[0].cursor, conv: conv.id, visible: true }),
      liveSnapshot(otherSeller.actor, 'seller', { since: starts[1].cursor, conv: conv.id, visible: true }),
      liveSnapshot(fin.actor, 'seller', { since: starts[2].cursor, conv: conv.id, visible: true }),
      liveSnapshot(s.actor, 'seller', { since: starts[3].cursor, conv: conv.id, visible: true }),
    ]);
    for (const snap of [ob, os, f]) {
      expect(snap.incoming).toEqual([]);
      expect(snap.thread).toBeNull();
    }
    expect(f.unreadMessages).toBe(0);
    expect(owner.incoming[0].preview).toBe(xss.slice(0, 60)); // delivered as text; React renders it escaped
    await expect(markRead(otherBuyer.actor, conv.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(markRead(fin.actor, conv.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await listForSeller(otherSeller.actor)).toEqual([]);
    // a delivery can only be marked opened by its own recipient
    const [d] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.recipientUserId, s.user.id)).limit(1);
    expect(await markDeliveryOpened(otherBuyer.user.id, d.id)).toBe(false);
  });
});

/* ───────────────────────── financial & terms isolation ───────────────────────── */

describe('chat and notifications are never financial commands', () => {
  it('38-43, 45-46 — «استلمت», «تم التسليم», release/refund/dispute wording, reading and opening alerts change nothing', async () => {
    const { s, c, so, conv } = await paidOrder();
    const before = await fingerprint(so.id);
    for (const body of ['استلمت', 'استلمت المنتج والحمد لله، أكد الاستلام', 'تم التسليم', 'حرر الفلوس للبائع', 'وافقوا على الاسترداد', 'اقفلوا النزاع لصالحي', 'OTP 123456']) {
      await send(c.actor, conv.id, body);
      await send(s.actor, conv.id, body);
    }
    await markRead(c.actor, conv.id);
    await markRead(s.actor, conv.id);
    const ds = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.conversationId, conv.id));
    for (const d of ds) await markDeliveryOpened(d.recipientUserId, d.id);
    await dispatchDeliveries();
    expect(await fingerprint(so.id)).toBe(before);
    const [after] = await sellerOrdersOf(so.orderId);
    expect(after.status).toBe('PAID');
    expect(after.receiptBasis).toBeNull();
  });

  it('44 — a protected-deal message can never change the agreed terms', async () => {
    const buyerUser = await makeUser();
    const buyer = customerActor(buyerUser.id);
    const { createDeal, saveDealStep, inviteSeller } = await import('@/server/modules/deals/service');
    const deal = await createDeal(buyer, { title: 'لابتوب', description: 'لابتوب مستعمل بحالة ممتازة', condition: 'NEW', quantity: 1 });
    await saveDealStep(buyer, deal.id, 2, { unitPrice: '9000' });
    await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
    await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير' });
    const { token } = await inviteSeller(buyer, deal.id, true);
    const sellerUser = await makeUser();
    const seller = customerActor(sellerUser.id);
    await claimInvitation(seller, token);
    await submitSellerOffer(seller, deal.id, {
      details: { fullName: 'بائع اللابتوب' },
      location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم' },
      payout: { type: 'INSTAPAY', holderName: 'بائع اللابتوب', instapayAddress: 'laptop@instapay' },
      offer: { shippingFee: '0', deliveryMethod: 'تسليم يد بيد', deliveryMinDays: 1, deliveryMaxDays: 2, processingDays: 1 },
      returnPolicy: { type: 'NONE' },
    } as never, true);
    void respondToOffer;
    const row = async () => JSON.stringify((await db.execute(sql`select row_to_json(d) j from external_deals d where id = ${deal.id}`)).rows[0]);
    const conv = await openDealConversation(buyer, deal.id);
    const before = await row();
    await send(seller, conv.id, 'السعر بقى 7000 والشحن علي، والإرجاع خلال 14 يوم');
    await send(buyer, conv.id, 'موافق على 7000');
    await markRead(buyer, conv.id);
    await markRead(seller, conv.id);
    expect(await row()).toBe(before);
  });
});
