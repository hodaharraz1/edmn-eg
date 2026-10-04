# Database

PostgreSQL 16, accessed through Drizzle ORM with `casing: 'snake_case'` (TypeScript camelCase ↔ SQL
snake_case). The schema source of truth is `src/server/db/schema/*.ts`; SQL migrations are generated
with `npm run db:generate` (drizzle-kit), **reviewed**, and committed in `drizzle/`. Hand-written
integrity SQL lives in its own migration.

| Migration | Content |
|---|---|
| `0000_init.sql` | `pg_trgm` extension, all tables, indexes, foreign keys and CHECK constraints |
| `0001_integrity_triggers.sql` | append-only triggers (audit, status history, journal) and the deferred balanced-entry constraint trigger |
| `0002_totp_replay.sql` | `users.totp_last_step` (single-use TOTP codes) |

Apply with `npm run db:migrate` (idempotent; tracked in the `drizzle` schema).

## Conventions

- Primary keys: `uuid` (`gen_random_uuid()`), except `audit_logs` (bigserial) and lookup tables.
- Human-facing numbers (`orders.number`, `withdrawal_requests.number`, …) come from sequences,
  separate from IDs, so internal IDs are never guessable from what customers see.
- **Money:** `bigint` piasters (1 EGP = 100). **Rates:** integer basis points (1% = 100 bps).
- Timestamps: `timestamptz`; `created_at` / `updated_at` everywhere relevant.
- Status columns are `text` with a CHECK constraint generated from the same TypeScript arrays the
  state machines use (`src/domain/machines.ts`) — one source of truth for allowed values.
- Transactional records are never hard-deleted; they move to terminal statuses (`ARCHIVED`,
  `CANCELLED`, `REJECTED`, …). Historical data needed later is **snapshotted** (see below).

## Tables by bounded context (79 tables)

| Context | Tables |
|---|---|
| Identity & platform | `users`, `sessions`, `auth_tokens`, `rate_limits`, `roles`, `role_permissions`, `user_roles`, `governorates`, `addresses`, `audit_logs`, `status_history`, `system_settings`, `idempotency_keys` |
| Files | `files` |
| Sellers | `sellers`, `seller_members`, `seller_documents`, `seller_payout_methods`, `stores`, `seller_shipping_rates`, `risk_flags` |
| Catalog | `categories`, `brands`, `attributes`, `attribute_options`, `category_attributes`, `products`, `product_variants`, `product_images`, `product_attribute_values`, `product_revisions`, `product_moderation_events`, `listing_policy_rules`, `inventory_reservations`, `inventory_movements`, `wishlist_items` |
| Commerce | `carts`, `cart_items`, `commission_rules`, `orders`, `seller_orders`, `order_items`, `payment_methods`, `payment_destinations`, `payments`, `payment_submissions`, `shipments`, `shipment_documents`, `tracking_events`, `refunds` |
| External deals | `external_deals`, `deal_invitations`, `deal_evidence`, `deal_payouts` |
| Post-purchase | `returns`, `return_items`, `return_evidence`, `disputes`, `dispute_messages`, `dispute_evidence`, `product_reviews`, `seller_reviews`, `review_reports` |
| Finance | `ledger_accounts`, `journal_entries`, `journal_lines`, `settlements`, `withdrawal_requests`, `ledger_adjustments` |
| Operations | `notifications`, `outbound_messages`, `notification_templates`, `jobs`, `support_tickets`, `support_messages`, `cms_blocks`, `cms_pages`, `legal_documents`, `legal_acceptances` |

### Key relationships

```
users 1─* sessions                    users 1─* user_roles *─1 roles 1─* role_permissions
users 1─1 sellers (owner) 1─* seller_members (seller staff)        sellers 1─1 stores
sellers 1─* products 1─* product_variants / product_images / product_attribute_values
orders (customer, parent) 1─* seller_orders (one per seller) 1─* order_items
orders 1─1 payments 1─* payment_submissions (proof uploads)
seller_orders 1─0..1 shipments 1─* shipment_documents (waybills) / tracking_events
seller_orders 1─* returns, refunds, disputes
external_deals 1─* deal_invitations, deal_evidence; 1─1 payments; 1─0..1 deal_payouts
ledger_accounts 1─* journal_lines *─1 journal_entries
sellers 1─* withdrawal_requests, ledger_adjustments; settlements 1─* withdrawal_requests
```

## Integrity enforced by the database

| Rule | Mechanism |
|---|---|
| Stock never negative; reserved ≤ on hand | `variants_stock_chk` CHECK |
| Variant price > 0; compare-at > price | `variants_price_chk`, `variants_compare_chk` |
| Used products need a grade before submission | `products_used_grade_chk` |
| Returned quantity ≤ ordered quantity | `order_items_qty_chk` |
| Commission bps in 0..10000 | `commission_rules_bps_chk` |
| Shipping fee ≥ 0, ETA min ≤ max | `ssr_fee_chk`, `ssr_eta_chk` |
| Every status is a known value | `*_status_chk` CHECKs (generated) |
| One order per checkout attempt | unique `(customer_id, checkout_key)` |
| One proof per client submission | unique `(payment_id, client_key)` |
| One withdrawal per client request | unique `(seller_id, client_key)` |
| A ledger posting happens once | unique `journal_entries.idempotency_key` |
| Journal, audit log and status history are append-only | `BEFORE UPDATE OR DELETE` + `BEFORE TRUNCATE` triggers raising exceptions |
| Every journal entry balances (Σdebit = Σcredit, ≥ 2 lines) | `DEFERRABLE INITIALLY DEFERRED` constraint trigger checked at COMMIT |
| One storage object per file row | unique `files.storage_key` |
| Job de-duplication | partial unique index on `jobs.dedupe_key` |

## Snapshots (historical integrity)

`order_items` stores, at purchase time: product title, variant label, SKU, condition, image,
category, unit price, line total and the **commission rule id, bps and amount** applied (the seller is
fixed on the parent `seller_orders` row). `seller_orders`
stores the shipping fee and ETA quoted, merchandise subtotal, commission total and seller net.
`orders.shipping_address` is a JSON snapshot of the address. `payments.destination_snapshot` keeps
the destination shown to the customer. Editing or archiving a product, changing a commission rule or a
payment destination therefore never alters a past order.

## Concurrency patterns

- Inventory reservation: single conditional `UPDATE product_variants SET reserved = reserved + q
  WHERE id = $1 AND stock_on_hand - reserved >= q` — zero rows updated means "sold out"; no
  read-then-write race.
- Payment confirmation, buyer receipt, withdrawals, refunds, adjustments: `SELECT … FOR UPDATE` on the
  aggregate row, state check, then mutation in the same transaction.
- Ledger balances: account rows locked `FOR UPDATE` in a deterministic order inside `postEntry()`.
- Job queue: `FOR UPDATE SKIP LOCKED`.

## Sensitive data at rest

National ID numbers, payout account details (bank account/IBAN/wallet/InstaPay), TOTP secrets and
external-deal payout details are encrypted with AES-256-GCM (`src/server/core/crypto.ts`) using
`DATA_ENCRYPTION_KEY`. Only masked values (e.g. last 4 digits) are stored in clear for display.
Passwords are scrypt hashes; session and reset tokens are stored as SHA-256 hashes only.

## Search

`products.search_text` holds an Arabic-normalized (alef/yaa/taa-marbuta/diacritics) concatenation of
title, brand, category and attribute values, indexed with a `pg_trgm` GIN index. Queries combine
`ILIKE` on normalized tokens with `word_similarity()` for typo tolerance.

## Notes

- `idempotency_keys` is created but not used in V1: idempotency is enforced by the domain-specific
  unique keys listed above. It is reserved for a future public HTTP API (`Idempotency-Key` header).
- Seed data: `npm run db:seed` creates reference data only (safe in production). `npm run
  db:seed:demo` refuses to run when `NODE_ENV=production`.
