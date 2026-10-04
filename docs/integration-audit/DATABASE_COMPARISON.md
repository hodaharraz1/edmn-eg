# Database Forensic Comparison

**Legacy schema: NOT INSPECTED** (no schema dump or source available — see
`LEGACY_ARTIFACTS_REQUIRED.md` items 2–3). The mapping below therefore lists System B tables with
full detail and, for each, the *expected* legacy counterpart **as a hypothesis to verify**. Every
relationship that depends on unseen legacy structure is classified `UNKNOWN` (never guessed as a
match). Legacy-reported domains with no B counterpart are listed as `LEGACY_ONLY (reported)`.

Legend — relationship: EXACT_MATCH · PARTIAL_MATCH · SEMANTIC_OVERLAP · LEGACY_ONLY · NEW_ONLY ·
CONFLICTING_MODEL · UNKNOWN. Significance: F = financial, P = PII, H = historical/legal.
Risk: H/M/L for eventual integration.

## 1. System B table register

| B table | Business meaning | PK | Key FKs | Unique / important constraints | Soft delete | Sig. | Risk |
|---|---|---|---|---|---|---|---|
| users | every person: customer, seller owner/staff, admin staff | uuid | — | email unique, phone unique (E.164), status CHECK | status DISABLED | P,H | **H** (identity merge) |
| sessions | login sessions (WEB/ADMIN) | sha256(token) | user | scope CHECK | revoked_at | P | L |
| auth_tokens | reset/verification codes (hashed) | uuid | user | purpose CHECK | used_at | P | L |
| rate_limits | throttling windows | key | — | — | pruned | — | L |
| roles / role_permissions / user_roles | staff RBAC | code / composite | role, user | — | — | H | M |
| governorates | 27 Egyptian governorates | int | — | code unique | is_active | — | L |
| addresses | customer delivery addresses | uuid | user, governorate | — | archived | P | M |
| audit_logs | append-only audit (trigger-protected) | bigserial | actor user | no UPDATE/DELETE | never | H | M |
| status_history | append-only state transitions | uuid | — | no UPDATE/DELETE | never | H | L |
| system_settings | typed runtime config | key | updated_by | — | — | config | M |
| idempotency_keys | reserved, unused in V1 | — | — | — | — | — | L |
| files | every uploaded file (public/private) | uuid | uploader | storage_key unique | deleted_at | P,H | **H** |
| sellers | merchant account (individual/business), KYB, encrypted national ID | uuid | owner user, governorate | status CHECK | status | P,H | **H** |
| seller_members | seller staff | composite | seller, user | role CHECK | is_active | P | M |
| seller_documents | KYB documents | uuid | seller, file | kind CHECK | superseded_at | P,H | **H** |
| seller_payout_methods | encrypted bank/IPA/wallet details | uuid | seller | type/status CHECK | ARCHIVED | F,P | **H** |
| stores | public store profile | uuid | seller | slug unique | — | — | M |
| seller_shipping_rates | fee/ETA per governorate | composite | seller, governorate | fee ≥ 0 | enabled | F | L |
| risk_flags | risk notes on entities | uuid | — | — | resolved | H | L |
| categories … wishlist_items (15 catalog tables) | catalog, moderation, inventory | uuid | seller/product | stock CHECKs | ARCHIVED | M | M |
| carts, cart_items | shopping cart | uuid | user/guest | qty 1..99 | — | — | L |
| commission_rules | versioned commission | uuid | category | bps 0..10000 | is_enabled | F | M |
| orders | customer parent order | uuid | customer | (customer, checkout_key) unique; number seq 100000+ | status | F,P,H | M |
| seller_orders | per-seller sub-order, totals, holds | uuid | order, seller | — | status | F,H | M |
| order_items | snapshots incl. commission | uuid | seller_order | qty CHECK | — | F,H | M |
| payment_methods / payment_destinations | manual methods / EDMN collection accounts | code / uuid | — | — | is_enabled | F | **H** (legacy has "payment methods") |
| payments | money-in record for order or deal | uuid | order / deal | — | status | F,H | **H** |
| payment_submissions | customer proofs | uuid | payment, file | (payment, client_key) unique | SUPERSEDED | F,H | M |
| shipments, shipment_documents, tracking_events | fulfilment evidence | uuid | seller_order, file | — | — | H | L |
| refunds | money owed back to customers | uuid | seller_order / deal | — | CANCELLED | F,H | M |
| external_deals | buyer-initiated protected deal | uuid | buyer, seller user | — | status | F,P,H | **H** (vs legacy guarantees) |
| deal_invitations | hashed invitation tokens | uuid | deal | — | REVOKED/EXPIRED | H | L |
| deal_evidence | deal photos/proofs | uuid | deal, file | — | — | H | M |
| deal_payouts | amount owed to deal seller | uuid | deal | — | status | F | **H** |
| returns, return_items, return_evidence | returns workflow | uuid | seller_order | — | status | F,H | L |
| disputes, dispute_messages, dispute_evidence | disputes for orders/returns/deals | uuid | various | one open per subject | status | F,H | M |
| product_reviews, seller_reviews, review_reports | reviews | uuid | order item / seller order | one per item | status | H | L |
| ledger_accounts | balance projections (platform + per seller) | uuid | seller | (code, seller) unique | — | F | **H** |
| journal_entries, journal_lines | immutable double-entry journal | uuid | account | idempotency_key unique; balanced at commit | never | F,H | **H** |
| settlements | scheduled settlement batches | uuid | — | one per date | — | F | M |
| withdrawal_requests | **seller** payouts | uuid | seller, payout method | (seller, client_key) unique | status | F,H | **H** |
| ledger_adjustments | maker/checker adjustments | uuid | seller | — | status | F,H | M |
| notifications, outbound_messages, notification_templates | in-app + email/SMS outbox | uuid | user | — | — | P | M |
| jobs | queue | uuid | — | dedupe unique | finished | — | L |
| support_tickets, support_messages | support | uuid | requester, file | — | CLOSED | P,H | M |
| cms_blocks, cms_pages | content | uuid | — | slug unique | is_active | — | L |
| legal_documents, legal_acceptances | versioned legal texts and user acceptances | uuid | user | (code, version) | isCurrent | H (legal) | M |

## 2. Legacy ↔ B mapping (hypotheses until legacy schema is provided)

| Reported legacy domain | Likely legacy table(s) | Candidate B table(s) | Relationship | Semantic match? | Data overlap? | Conflict? | Proposed future strategy |
|---|---|---|---|---|---|---|---|
| Users | UNKNOWN | users | UNKNOWN | Probably same *concept* (a person) | Real people may exist in both only after B launches | ID type, uniqueness, hash algorithm, phone format | Identity mapping table; legacy stays source until verified (see IDENTITY_ANALYSIS) |
| KYC | UNKNOWN | sellers + seller_documents (seller KYB only) | UNKNOWN (B covers sellers only) | Partial at best | — | B has no customer KYC | Keep legacy KYC as source; reference from B |
| Wallet / balances | UNKNOWN | none (ledger_accounts are seller/platform only) | LEGACY_ONLY (reported) | No | — | Legacy balance semantics unknown | Preserve in legacy; future wallet ledger accounts must be designed, not mapped |
| Top-up requests | UNKNOWN | payments + payment_submissions (similar *manual proof* mechanics, different purpose) | UNKNOWN / SEMANTIC_OVERLAP (mechanics only) | No (wallet funding ≠ order payment) | — | Status names likely overlap | Share verification *infrastructure* later; keep separate domain |
| Withdrawals (customer wallet) | UNKNOWN | withdrawal_requests (seller payouts) | CONFLICTING_MODEL (same word, different payee/domain) | **No** | — | Name and status collision | Separate tables/namespaces; optional shared approval engine |
| Payment methods | UNKNOWN | payment_methods / payment_destinations / seller_payout_methods | UNKNOWN | Ambiguous (could be user's payout methods, or EDMN's collection methods, or gateways) | — | Name collision | Clarify meaning first |
| Transactions | UNKNOWN | journal_entries/lines (ledger), payments | UNKNOWN | Unknown whether legacy "transactions" are ledger rows, guarantee deals, or wallet movements | — | Likely | Never auto-convert; import as referenced historical records |
| Guarantees | UNKNOWN | external_deals (+ payments, deal_payouts, disputes) | UNKNOWN / SEMANTIC_OVERLAP | Closest analogue; not proven equivalent | — | Fees, initiator, statuses, money flow | Keep as separate product until compared (see FINANCIAL_COMPARISON §5) |
| Tickets | UNKNOWN | support_tickets, support_messages | UNKNOWN (likely PARTIAL_MATCH) | Probably similar | — | Status enums | Candidate for unification after mapping statuses |
| Admins | UNKNOWN | users (is_staff) + user_roles | UNKNOWN | Likely | — | Separate admin table in legacy? | Map, do not merge accounts automatically |
| Roles / permissions | UNKNOWN | roles, role_permissions | UNKNOWN | Unknown naming | — | Permission namespace collision | Prefixed namespaces (see ADMIN_COMPARISON §RBAC) |
| Activity logs | UNKNOWN | audit_logs | UNKNOWN | Likely partial | — | B audit table is append-only; importing must not edit it | Keep legacy logs read-only; optionally import into a separate `legacy_activity_logs` |
| Fee settings | UNKNOWN | system_settings (`deals.feeBps`, `deals.feePayer`), commission_rules | CONFLICTING_MODEL (likely) | Guarantee fees vs marketplace commissions | — | 5%/3% (marketing) vs 0 default | Separate fee configs per product |
| Notifications | UNKNOWN | notifications, outbound_messages | UNKNOWN | Possibly push-based in legacy | — | Channel differences | Keep both; unify later |
| Statistics | UNKNOWN (likely computed) | reports service | — | — | — | — | Recompute; no migration needed |
| Files / KYC documents / guarantee evidence | UNKNOWN | files | UNKNOWN | — | — | Storage paths & permissions | Never move files; reference by URI (see FILES section in FINAL) |

## 3. NEW_ONLY in System B (no legacy counterpart reported)

Marketplace catalog (categories, brands, attributes, products, variants, inventory), carts, orders,
seller orders, order items, commissions, shipping (rates, shipments, waybills, tracking), returns,
reviews, CMS, legal versions/acceptances, double-entry ledger, settlements, seller payouts,
maker/checker adjustments, step-up/TOTP, risk flags.

## 4. Structural differences to expect (verify)

| Topic | System B | Legacy | Risk |
|---|---|---|---|
| Primary keys | UUID | UNKNOWN (often auto-increment integers) | ID collision impossible across types, but references must be mapped explicitly |
| Money type | bigint piasters | UNKNOWN (decimal? float?) | Rounding/precision during reconciliation |
| Phone format | E.164 `+201…`, unique | UNKNOWN | Duplicate detection |
| Timestamps | timestamptz (UTC) | UNKNOWN (DB-local time?) | Time-zone shift in history |
| Soft delete | status-based, journal/audit immutable | UNKNOWN | Hidden deleted rows must still be migrated/preserved |
| Engine | PostgreSQL 16 | UNKNOWN (MySQL common) | Cross-engine migration tooling |
