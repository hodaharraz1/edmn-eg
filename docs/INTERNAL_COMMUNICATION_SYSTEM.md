# Buyer ↔ Seller internal communication

Status: implemented (V1). Code: `src/server/modules/messaging/service.ts`, migration `drizzle/0007_buyer_seller_messaging.sql`,
UI `src/app/_components/conversation*.tsx`, tests `tests/integration/messaging.test.ts` + `tests/e2e/messaging.spec.ts`.

Customer-facing name: never «Chat». The entry point reads **«تواصل مع البائع»** for the buyer and **«تواصل مع المشتري»** for the seller.

## 1. Principles

1. **Context-bound only.** Every conversation belongs to exactly one *seller sub-order* (marketplace) or one *protected deal*.
   There is no API, page or table that allows a free conversation with an arbitrary user (`conversations_binding_chk`).
2. **One conversation per seller sub-order.** A multi-seller order produces one conversation per seller; a seller never sees another seller's thread.
3. **Messages are supporting evidence, not commands.** They never change money, deal terms, payment, shipment, OTP or dispute state.
   The messaging module does not import any payment, ledger, fulfilment, deal or dispute service (asserted by a test).
4. **Append-only.** Messages cannot be edited or deleted (database triggers). Staff moderation hides a message from participants but keeps the original.
5. **Authorization on every call, server-side**, derived from the order/deal — never from the conversation id alone. Denials are uniform “not found”.

## 2. Data model (additive migration 0007)

| table | purpose |
|---|---|
| `conversations` | `context` (`SELLER_ORDER` \| `DEAL`), `order_id` + `seller_order_id` + `seller_id` **or** `deal_id` + `seller_user_id`, `buyer_user_id`, `status` (`ACTIVE` \| `LOCKED`), lock metadata, `last_message_at`. Unique per sub-order / per deal. Binding columns immutable (trigger); never deleted. |
| `conversation_messages` | `sender_user_id`, `sender_role` (`BUYER`\|`SELLER`), `body` (≤ 2000 chars, plain text), `client_key` (idempotency, unique per sender), `created_at`; moderation `hidden_at/by/reason` (settable once). Update of any other column or delete → exception. |
| `conversation_message_attachments` | message ↔ `files` (purpose `MESSAGE_ATTACHMENT`, PRIVATE). Append-only. |
| `conversation_reads` | per-user read position (`last_read_at`); each store member has their own. |
| `conversation_message_reports` | reason (`INAPPROPRIATE`, `FRAUD_ATTEMPT`, `UNNEEDED_DATA_REQUEST`, `OTHER`), note, status (`OPEN`/`ACTIONED`/`DISMISSED`), handler. Never deleted. |

Participants are derived (buyer from the order/deal, store side from the seller account + member permissions), so there is no separate participant table to drift out of sync.
Other changes in 0007: `files_purpose_chk` widened with `MESSAGE_ATTACHMENT`; one-time grant of the new staff permissions to existing default roles.

## 3. Eligibility

**Marketplace sub-order** — a conversation can be opened (by the buyer or an authorized store member) once the sub-order is in
`PAID, SELLER_CONFIRMED, PROCESSING, READY_TO_SHIP, SHIPPED, DELIVERED, COMPLETED` (i.e. payment confirmed and the store is authorized to fulfil),
or `CANCELLED` after having been paid. Before that (`PENDING_PAYMENT`, `PAYMENT_UNDER_REVIEW`) the buyer sees
«التواصل مع البائع بيتفتح بعد تأكيد الدفع» and no channel exists. (So the acceptance order A-100016, while under payment review, has no conversation yet — expected.)

**Protected deal** — available once the seller has securely claimed the invitation (`seller_user_id` and `seller_joined_at` set,
status past `DRAFT/INVITED`), for the whole lifecycle: offer, negotiation, change requests, acceptance, payment, shipping, handover,
receipt confirmation, disputes.

## 4. Authorization

| who | marketplace conversation | deal conversation |
|---|---|---|
| buyer | the order's customer (customer surface `/account/messages`) | the deal buyer |
| store owner | always (`orders.communicate`) | — |
| store member | only roles carrying `orders.communicate`: STORE_MANAGER, ORDER_MANAGER, SUPPORT. **Not** FINANCE, **not** CATALOG_MANAGER | — |
| deal seller | — | the user bound to the deal at claim time (`/account/messages`) |
| staff | `messages.view` (read-only, audited) | same |

Account restrictions: sessions of non-active users are already refused; a store that is not `APPROVED`/`RESTRICTED` cannot send.

## 5. Staff access (RBAC + audit)

New staff permissions: `messages.view` (read conversations, attachments) and `messages.moderate` (hide a message, resolve reports, lock/reopen).
Default grants: SUPER_ADMIN (both), OPERATIONS_MANAGER (both), CUSTOMER_SUPPORT (both), DISPUTE_OFFICER (view).
FINANCE_OPERATOR, FINANCE_CHECKER, PAYMENT_REVIEWER, CATALOG_REVIEWER, SELLER_REVIEWER: **none**.

Entry points: Admin → العمليات → «محادثات المشترين والبائعين» (`/admin/messages`: open reports, handled reports, recent conversations),
and links from the admin order page (per sub-order), deal page and dispute page.

Every staff view writes `audit_logs` `conversation.staff_viewed` with admin id, conversation id, sub-order/order or deal id, entry path (`via`) and time.
Moderation writes `conversation.message_hidden`, `conversation.report_resolved`, `conversation.locked/unlocked` (with reason).
Staff attachment downloads are audited as `file.sensitive_viewed`. Staff never post as a buyer or seller.

## 6. Disputes

Dispute staff open the conversation from the dispute page («محادثة الطرفين (دليل مساعد)»). Messages are **supporting evidence only** and never
override the authoritative records: payment confirmation, formal offer versions and the agreed-terms snapshot, shipment records,
Delivery OTP verification, buyer receipt confirmation, ledger entries. An open dispute keeps the conversation writable even after the
normal communication window.

## 7. Protected-deal term isolation

Messages never modify deal terms. A price («خليه 5000 بدل 5500») or a delivery promise («هوصله خلال يومين») in a message changes nothing;
only OFFER / COUNTER-OFFER / REQUEST CHANGE / ACCEPTANCE create terms, and only the accepted version becomes `agreed_terms`.
The conversation shows: «أي تغيير في السعر أو الشحن أو شروط الصفقة لازم يتأكد من خلال العرض الرسمي.»
A message saying «استلمت» or containing the delivery code does not verify the handover, confirm receipt or pay anything (tested).

## 8. Attachments

Up to 3 per message; JPG/PNG/WEBP/PDF, detected by magic bytes (declared MIME and filename ignored; extension allow-list).
Images are re-encoded (EXIF/GPS stripped, polyglots neutralised); size caps from settings/env (8 MB image / 10 MB PDF by default).
Stored PRIVATE under generated keys; served only by `/api/files/[id]` after `canReadPrivateFile` checks that the caller is a participant of the
conversation the file was sent in (and that the message is not hidden), or staff with `messages.view`. Responses: `no-store`, `nosniff`, sandbox CSP.
Rate limit: 20 attachments per user per hour.

## 9. Notifications & unread

New events `MESSAGE_FROM_SELLER` / `MESSAGE_FROM_BUYER` (in-app + email through the existing outbox; **no SMS**). The text never contains the message body.
One notification per unread burst: a recipient is notified only for the first message they have not yet read.
Recipients on the store side: the owner and members with `orders.communicate`. On staging the email/SMS drivers stay `log` (unchanged).

Unread counts: account nav «الرسائل» (buyer + deal-seller messages), Seller Center nav «الرسائل» (per member), and the CTA badge on the order/deal page.
Opening the conversation view marks it read for that user (position computed in PostgreSQL to avoid ms/µs precision gaps).
Own messages show «اتبعتت» / «اتشافت» (text + icon, not colour only).

## 10. Lifecycle / retention

- `ACTIVE` while the order/deal is in progress.
- After a final state (sub-order `COMPLETED`/`CANCELLED`; deal `COMPLETED`/`CANCELLED`/`REFUNDED`) participants can still write for
  **`messaging.postCloseWriteDays` = 30 days** (configurable system setting, 0–365), or while a dispute is open; then the conversation is read-only.
- Staff can `LOCK` a conversation (read-only for both parties) and reopen it; audited.
- **Retention:** nothing is deleted automatically. No legal retention period has been decided, so none is implemented; conversations, messages,
  attachments and reports are preserved as evidence. The 30-day value is a product default for *writing*, not a legal retention period.

## 11. Security controls

- Server-side authorization per call; uniform not-found for wrong ids/users (IDOR tests for conversations and attachments).
- Plain-text rendering only (React escaping; no HTML, no link auto-rendering); control/zero-width characters stripped; 2000-char cap.
- Rate limits (PostgreSQL fixed windows): 20 messages/min per user, 120/hour per user per conversation, 20 attachments/hour, 20 reports/hour.
- Idempotent sends (`client_key`): retries never duplicate.
- Server actions (Next.js CSRF protection: same-origin action ids); 12 MB request cap.
- Reports never punish automatically; they create a reviewable record.
- Safety hint in every conversation: «خلي تفاصيل الطلب والاتفاق هنا علشان نقدر نرجع لها لو حصلت مشكلة.» (no claim about losing rights).

## 12. Real-time

Reliable polling: the conversation view refreshes every 7 seconds while the tab is visible (`router.refresh()`), no extra infrastructure.

## 13. Routes

Customer: `/account/messages`, `/account/messages/[id]`, `/account/messages/open?so=…|deal=…`.
Seller Center: `/seller/messages`, `/seller/messages/[id]`, `/seller/messages/open?so=…`.
Admin: `/admin/messages`, `/admin/messages/[id]`.
Server actions: `sendMessageAction`, `reportMessageAction`, `hideMessageAction`, `resolveReportAction`, `lockConversationAction` (`src/app/_actions/messaging.ts`).

## 14. Known limitations (V1)

- Polling, not push; a new message appears within ~7 s.
- The Seller Center sidebar unread badge may still show the conversation being opened until the next refresh (layout and page render in parallel).
- No per-message delivery receipts for each store member; «اتشافت» means any authorized store member (or the buyer) has opened it.
- No full-text search of conversations for staff (deliberately; access is per order/deal/dispute and audited).
- Attachments are images/PDF only.
