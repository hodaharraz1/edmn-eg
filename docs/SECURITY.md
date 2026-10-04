# Security

EDMN will hold identities, seller documents, payment proofs, balances and withdrawal requests. All of
it is treated as production-sensitive from the first line of code. This document lists the controls
that exist in the code today and where they live.

## Authentication

| Control | Implementation |
|---|---|
| Password hashing | scrypt (N=2^15, per-password salt), constant-time compare; dummy verify on unknown users to avoid user enumeration by timing (`src/server/auth/password.ts`) |
| Password policy | customers ≥ 8 chars with letters + digits; staff ≥ 12 with letters, digits and a symbol |
| Sessions | random 256-bit tokens; DB stores **SHA-256(token)** only; `HttpOnly`, `SameSite=Lax`, `Secure` in production; new session id on every login (no fixation); revocable; invalidated by password change |
| Separate scopes | customer/seller sessions (`edmn_sid`, scope `WEB`) and admin sessions (`edmn_admin_sid`, scope `ADMIN`) are different cookies and session types; a customer session can never be used as an admin session (tested) |
| Admin 2FA | TOTP (RFC 6238) mandatory for every staff login; enrollment on first login; secrets encrypted at rest; **codes are single-use** (`users.totp_last_step`) |
| Step-up | a fresh TOTP (≤ 10 min) is required for: recording withdrawal payouts, refund/deal payouts, ledger adjustment approval, changing payment destinations/methods, sensitive system settings, role/permission and staff changes, revealing a national ID. The UI redirects to `/admin/step-up` and back |
| Rate limiting | DB-backed fixed windows: login per IP (30/15 min) and per identifier (10/15 min), registration per IP, TOTP attempts per user (8/5 min), password reset, verification codes |
| Password reset | single-use, hashed, 30-minute tokens; responses never reveal whether an account exists; all sessions revoked after reset |
| Contact verification | 6-digit codes, hashed, 15-minute expiry; seller applications require a verified mobile number |

## Authorization

- **Server-side on every operation.** Domain functions receive an `Actor` and call
  `requirePermission`, `requireSeller(actor, permission)` or ownership checks themselves. Pages also
  gate with `adminWith(permission)`; hiding a menu item is never the control.
- **RBAC** (`src/server/rbac/permissions.ts`): 54 granular permissions; default staff roles —
  SUPER_ADMIN, OPERATIONS_MANAGER, SELLER_REVIEWER, CATALOG_REVIEWER, PAYMENT_REVIEWER,
  FINANCE_CHECKER, FINANCE_OPERATOR, DISPUTE_OFFICER, CUSTOMER_SUPPORT —
  editable from Admin → Roles (SUPER_ADMIN is fixed). Seller staff roles: STORE_OWNER, STORE_MANAGER,
  CATALOG_MANAGER, ORDER_MANAGER, FINANCE, SUPPORT.
- **Maker/checker:** withdrawal approval (`withdrawals.approve`) and payment recording
  (`withdrawals.pay`) are different permissions in different default roles; above
  `withdrawals.dualControlThreshold` the payer must differ from the approver. Ledger adjustments
  require an approver different from the creator. Admins cannot change their own roles or disable
  their own account.
- **Ownership boundaries:** seller-owned entities (products, variants, inventory, seller orders,
  shipments, returns, withdrawals, store settings, payout methods) are always filtered by the actor's
  `sellerId`; customer-owned entities (cart, orders, addresses, wishlist, reviews, deals, tickets) by
  `userId`. Cross-account access returns the same not-found response as a non-existent id (no
  existence leak). Covered by EDGE 15/16 tests and E2E.
- **Route protection:** `PUBLIC` storefront; `CUSTOMER` pages call `requireCustomer`/`requireUser`;
  Seller Center calls `requireSellerActor`; Admin console requires a staff session with a completed
  2FA challenge. Layout guards are not relied on alone (pages and layouts render concurrently).

## Private files

- Two storage roots: **public** (product images, logos, CMS images — served from `/media/...`) and
  **private** (national IDs, business documents, payment proofs, waybills, return/dispute/deal
  evidence, payout proofs).
- Private files are only served by `/api/files/[id]`, which loads the file row and checks a
  **purpose-specific policy** (`src/server/storage/access.ts`): e.g. a payment proof is readable by its
  submitter or `payments.view` staff; a waybill by the seller, the order's customer or `shipping.view`
  staff. Denials are uniform 404s. Responses are `Cache-Control: private, no-store`,
  `X-Content-Type-Options: nosniff`, and `Content-Disposition` is set safely.
- Knowing or guessing a file id grants nothing (EDGE 18 test + E2E).

## Uploads

- Type detection by **magic bytes**, never by extension or client MIME (JPEG, PNG, WebP, PDF).
- Size limits from settings (`uploads.maxImageMb`, `uploads.maxDocumentMb`).
- Images are decoded and **re-encoded with sharp** to WebP (strips EXIF/GPS metadata and any
  polyglot payload), minimum 50×50 px, and stored with `_thumb`/`_md` renditions.
- Storage keys are random and validated against path traversal (`isSafeKey`).

## Input, output and transport

- All inputs validated with zod schemas inside domain services (not only in forms).
- Prices, totals, commissions and shipping fees are always computed server-side; the client's
  expected total is only used to detect price changes (EDGE 5).
- React escapes output; no `dangerouslySetInnerHTML` with user content. CMS/legal bodies are rendered
  as text paragraphs.
- CSV exports neutralize spreadsheet formula injection and never include national ID data.
- Security headers (`next.config.ts`): HSTS (2 years, preload), CSP (`default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`;
  `X-Powered-By` removed.
- Server Actions are POST-only and protected by Next.js origin checks (CSRF); cookies are `SameSite=Lax`.
- Production refuses to start with placeholder secrets, a non-HTTPS `APP_URL`, or incomplete
  mail/SMS driver configuration (`src/server/core/env.ts`).

## Sensitive data

- AES-256-GCM field encryption (`DATA_ENCRYPTION_KEY`) for national IDs, payout details, TOTP secrets,
  external-deal seller payout details. Only masked values are displayed.
- Revealing a full national ID requires `sellers.documents.view`, a fresh step-up, and is audit-logged.
- The structured logger redacts well-known sensitive keys (passwords, tokens, secrets, national ids,
  account numbers) before writing.
- External-deal invitation tokens are stored as SHA-256 hashes; the link is shown once to the buyer.

## Audit trail

`audit_logs` (append-only, enforced by database triggers) records actor, actor type, action, entity,
old/new values, reason, IP and user agent for: authentication events, seller decisions, document and
national-ID access, product moderation, payment confirmation/rejection, shipping, receipt
confirmations (including on-behalf), refunds, disputes, commission changes, withdrawals, adjustments,
settings, roles, CMS/legal publishing and data exports. `status_history` records every state
transition. Admin → سجل التدقيق provides filtering.

## Financial safety

See [FINANCIAL_LEDGER.md](FINANCIAL_LEDGER.md): double-entry, append-only journal, DB-enforced
balance at commit, idempotency keys, row locks, maker/checker, reconciliation.

## Known gaps / production hardening still recommended

- Rate limiting is per application database; put a reverse proxy/WAF rate limit in front as well.
- CSP allows `'unsafe-inline'` scripts (required by Next.js inline bootstrap without a nonce
  pipeline). Moving to nonce-based CSP is recommended.
- Malware scanning of uploaded PDFs is not implemented (images are re-encoded; PDFs are type-checked
  and served only privately with `nosniff`). Add an AV scanning step (e.g. ClamAV) before go-live.
- No WebAuthn/passkeys yet; TOTP is the admin second factor.
