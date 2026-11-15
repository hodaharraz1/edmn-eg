# Messaging and support — mobile architecture

The app reuses the platform's existing communication system (`src/server/modules/messaging/service.ts`, documented for
the web in `docs/INTERNAL_COMMUNICATION_SYSTEM.md`) and support desk (`src/server/modules/support/service.ts`). The
mobile layer is `src/server/modules/mobile/messages.ts` (projections) plus `src/server/api/routes/messages.ts` (contract).
It adds no messaging tables or rules of its own.

## Who can talk to whom

| Context | Opened by | Becomes available | Parties |
|---|---|---|---|
| Seller order | Buyer (`POST /seller-orders/{id}/conversation`) or store (`POST /seller/orders/{id}/conversation`) | Payment confirmed (`PAID` … `COMPLETED`, or cancelled after payment) | Buyer ↔ store owner + members with `orders.communicate` |
| Protected deal | Either party (`POST /deals/{id}/conversation`) | Seller has joined (after `INVITED`) | Deal buyer ↔ the joined deal seller |

- No route accepts a recipient. The counterparty always comes from the order or deal (the contract guard rejects any
  `recipient`, `to`, `userId`, `sellerId`… body field on these writes).
- A conversation id grants nothing by itself. Every read and write re-derives the caller's side from the order or deal;
  everything else is a uniform 404, so the API cannot be used to probe whether a conversation exists.
- Store routes (`/api/v1/seller/conversations/**`) run as the session user's store membership. A member without
  `orders.communicate` (for example `CATALOG_MANAGER` or `FINANCE`) gets 403 on the inbox and 404 on a thread.
- Whether to show «مراسلة البائع / المشتري / محادثة الصفقة» comes from the server: `MESSAGE_SELLER` (buyer order view),
  `MESSAGE_BUYER` (seller order view, needs `orders.communicate`) and `MESSAGE` (deal view). These use the same rule
  as the messaging service.

## Message lifecycle

1. **Send:** `POST …/messages` (multipart: `body`, `clientKey`, up to 3 `attachments`, images or PDF). The `clientKey`
   is the de-duplication key. The app keeps one key per message the user is trying to send, and reuses it when a send
   is retried after a network, rate-limit or 5xx failure, so the server returns the original message instead of a
   duplicate. A new key is made only after a success. Rate limits are 20 messages per minute and 120 per hour per
   conversation, enforced server-side.
2. **Read:** fetching a thread never marks it read. The app calls `POST …/seen {upToMessageId}` with the newest message
   that was actually on screen, and only while the app is in the foreground. That clears the matching in-app
   notifications as well.
3. **Sync:** the app polls the open thread every 10 seconds while it is visible, and refreshes when the app returns to
   the foreground. A server push channel for the app (FCM/APNs) is Phase 6.
4. **Write window:** after the order or deal is final, writing stays open for `messaging.postCloseWriteDays`, or while
   a dispute is open. After that the thread is read-only, and the server's reason is shown in place of the composer.
   Staff can lock a conversation.
5. **Moderation:** a participant can report one message from the other side (four reasons, optional note). This
   creates a review record for staff and penalises nobody automatically. A message hidden by staff keeps its place in
   the thread, but its text and attachments are never sent to the app.

## Evidence, not actions

Messages never change an order, a deal, a payment, a ledger entry or a balance. The service does not even import those
modules, and the integration test checks that no journal entry appears after a «استلمت، حوّل الفلوس» message. The app
shows a standing note that confirming receipt or changing a price is done only with the order or deal buttons.

## Attachments

Files are stored with purpose `MESSAGE_ATTACHMENT` or `SUPPORT_ATTACHMENT` and downloaded through the existing
`GET /api/v1/files/{fileId}`. The storage layer's `readPrivateFile` lets in the conversation's parties only. Staff need an
active, purpose-bound access grant. Anyone else gets the same 404 as for a missing file. The app previews images
in-line with a zoom dialog and shows PDFs as a labelled file.

## Support desk

| Screen | API | Rules |
|---|---|---|
| My tickets | `GET /support/tickets` | requester only |
| New ticket | `POST /support/tickets` (multipart, idempotency key) | `relatedId` must be the requester's own order, seller order, deal, payment or withdrawal |
| Thread | `GET /support/tickets/{id}` | internal notes excluded; staff shown as «فريق أضمن», never by name |
| Reply | `POST …/replies` | a reply to a resolved or closed ticket reopens it (new SLA cycle) |
| Reopen | `POST …/reopen {reason}` | resolved or closed only |
| Rate | `POST …/rating {1–5}` | once per resolution |

`allowedActions` (`REPLY`, `REOPEN`, `RATE`) is computed on the server. Help pages (FAQ) come from the admin CMS
(`GET /content/pages/{slug}`). If no page is published, the app shows "not found" and never shows invented questions.

## Tests

- `tests/integration/mobile-messaging-api.test.ts`:
  - **Flow D (chat):** messaging stays unavailable until payment and appears in the order actions after it; stranger
    gets 404; clientKey de-duplication; fetching does not mark read, `seen` does; read ticks; attachment access;
    report rules; store role without `orders.communicate`; no ledger effect.
  - **Flow E (support):** another customer's order is refused as a related item; an idempotent open; internal notes
    hidden; staff unnamed; rate once; reopen; another customer is refused.
  - **CMS help pages:** published page served, missing page 404.
- Widget tests (`apps/customer_mobile/test/customer_app_test.dart`): a retry reuses the same key and the next message
  gets a new one; `seen` reports the last rendered message; read-only state; inbox unread badge; staff label; rating only
  when allowed.
