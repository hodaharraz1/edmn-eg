# EDMN — Real-time messaging, notifications & navigation

## Realtime transport: HYBRID (cursor polling + Web Push)
- **In the app:** one small JSON endpoint `GET /api/live?surface=account|seller&since=&conv=&after=&visible=`
  polled by `LiveProvider` (`src/app/_components/live/live-provider.tsx`):
  ≈6 s while the tab is visible, 30 s in the background, immediately on focus / `online` / after the user sends or
  reads, exponential back-off on errors (max 60 s). First poll ~1.2 s after mount (streamed content hydrates first).
- **Why not WebSocket/SSE:** the deployment is serverless (Vercel functions; no long-lived connections). Polling
  one indexed, cursor-based query is reliable there; no extra infrastructure. Web Push covers closed/background tabs.
- **Cursors:** PostgreSQL timestamp text (microseconds) + id. Each query re-reads a 15 s overlap window and the
  client de-duplicates by id → a message committed slightly out of order is never lost; reconnect = next poll.
- **Ordering:** `(created_at, id)` — server-authoritative and deterministic.
- **Multi-tab:** every tab reconciles from the server; tabs use `BroadcastChannel('edmn-live')` only to poke each
  other after a read/send and to avoid duplicate toasts (plus a localStorage claim per message id).

## Read / unread (server-authoritative)
- Unread = messages of the other side newer than the user's `conversation_reads.last_read_at`. Global badge,
  per-conversation counts and the store's badge (per member) are computed in SQL; inbox is a single query (no N+1).
- A message is read ONLY when the participant's client reports the conversation on screen (visible tab, scrolled to
  the end) via `POST /api/live/read {upTo}`. Page render, polling, push, toast, email, opening a notification and
  staff viewing never mark anything read. Replying marks the replier's side read.
- Read receipts («اتبعتت» / «اتشافت») come from the same read positions (any member of the other side counts).

## Notification routing (`notifications/message-alerts.ts`)
Message persisted first (its own transaction); fan-out rows are written in the same transaction; providers are only
contacted after commit (`after()` for push, the worker for retries and email). Per (event, message, recipient, channel)
one row in `notification_deliveries`, key `MESSAGE_RECEIVED:{message}:{recipient}:{channel}` (idempotent).

| Channel | Rule |
|---|---|
| IN_APP | one notification-center entry per unread burst (category MESSAGE); live toast + optional chime in a visible tab (not for the conversation on screen) |
| PUSH | opted-in devices only; SUPPRESSED if the user is active in a visible tab (presence ≤ `messaging.presenceActiveSeconds`), cooldown `messaging.pushCooldownSeconds` per conversation, preference off, no subscription, or VAPID not configured. Default payload: «لديك رسالة جديدة بخصوص الطلب …» — text only if the user enabled previews; attachments never |
| EMAIL | burst start only, after `messaging.emailFallbackDelayMinutes` (default 15); re-checks read state (SUPPRESSED READ), preference and `messaging.emailCooldownMinutes` (default 60) before sending; never the thread or attachment links |
| SMS / WHATSAPP / MOBILE_PUSH | enumerated, provider-agnostic; no provider connected → never reported as sent |

Statuses: QUEUED → SENT / FAILED (retries with back-off) / SUPPRESSED (reason) / OPENED (telemetry only).
Admin: `/admin/notifications?tab=health` (counts by channel/status, reasons, failures, queue, subscriptions; read-only).

**Bell vs Messages:** the bell counts unread GENERAL notifications (orders, payments, deals…); the Messages badge
counts unread messages. Message alerts appear in the notification center («الرسائل» filter) but never in the bell count.

## Web Push
Standard Push API + VAPID (`web-push`). `public/sw.js` handles only `push`, `notificationclick` and
`pushsubscriptionchange` — no fetch handler, no caching (cannot serve stale code or affect auth/deploys); served
`no-cache`. Permission is requested only after the user clicks «تفعيل الإشعارات» (EDMN explanation shown first);
denied/unsupported/not-configured states are explained, never re-prompted. Subscriptions: multiple devices,
encrypted at rest (endpoint + keys), endpoint allow-list (known browser push services, HTTPS), 404/410 → revoked
EXPIRED, 5 consecutive failures → revoked FAILING, user can remove devices. A push URL is a path only; the page
re-checks login and authorization.

## Preferences (`notification_preferences`)
إشعارات داخل الموقع · الإشعارات الصوتية · إشعارات المتصفح · معاينة النص في إشعار المتصفح (off by default) · تنبيهات
البريد الإلكتروني. Badges always show. Security/account alerts are outside these preferences.

## Isolation (unchanged hard rules)
Chat, notifications, presence and read state never touch payments, ledger, balances, receipts, delivery evidence,
OTP, disputes, refunds, withdrawals or protected-deal terms. A message «استلمت» / «تم التسليم» changes nothing.

## Migration
`drizzle/0011_messaging_realtime.sql` — additive only: `notification_deliveries`, `notification_preferences`,
`push_subscriptions`, `user_presence`; `notifications.category / conversation_id / message_id`. No backfill, no
update of existing rows.

## Known limits
- Polling cost grows with concurrent visible tabs (one light query set per tab every 6 s).
- On serverless without a long-running worker, the delayed email is sent by the next background tick
  (after-response trigger, once per instance per minute, or the daily cron).
- Real email delivery requires an SMTP provider (`MAIL_DRIVER=smtp`); with the log driver, emails are only logged.
- Real push delivery depends on the browser vendor's push service and the device; verified on real devices manually.
