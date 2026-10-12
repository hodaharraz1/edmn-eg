# Email / SMS Outage

Status today: **EMAIL CODE READY / PROVIDER NOT CONFIGURED** (MAIL_DRIVER=log on staging), **SMS CODE READY / PROVIDER NOT CONFIGURED**. Nothing is ever reported DELIVERED without a provider event.

Outbox (`src/server/modules/notifications/outbox.ts`): PENDING → SENDING (claimed once) → SENT (provider accepted, provider_message_id) → DELIVERED / BOUNCED (provider event only) | FAILED (dead letter after max_attempts, backoff 1→60 min). Codes, reset links and invitation links are sealed with AES-GCM in production and destroyed after hand-off/dead-letter; any stored copy is redacted after 1 hour.

## Steps
1. `/admin/ops` → outbox due / dead letters / delivered.
2. Provider down: nothing to do in the DB — messages retry with backoff. Secret messages that reach dead letter are destroyed; users request a new code/link (never resend old codes).
3. Provider fixed: requeue non-secret dead letters (`requeueDeadLetter`, `notifications.manage`, audited).
4. Never email/SMS National IDs, bank/wallet details, passwords or document links that bypass authorization.
