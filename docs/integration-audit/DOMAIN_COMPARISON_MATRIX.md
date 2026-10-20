# Domain-by-Domain Comparison Matrix

"Legacy" columns reflect **owner-reported** capabilities and public marketing claims only; legacy
code was **not inspected** (`NOT INSPECTED`). "Stronger implementation" is only judged where both
sides are known; otherwise `UNDECIDED`.

| # | Domain | In legacy? | In marketplace (B)? | Legacy does | B does | Same concept? | Stronger | Historical data | Integration risk | Recommended future architecture |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Users | Reported | Yes | UNKNOWN | One `users` table (UUID, unique email & phone) | Same concept (person) | UNDECIDED | Legacy: yes | **P0** duplicates/ID mapping | Unified identity via mapping table; legacy remains source until cut-over |
| 2 | Authentication | Reported (admin login seen; mobile tokens likely) | Yes (web sessions, admin TOTP) | UNKNOWN | scrypt, DB sessions, admin TOTP + step-up | Same concept, different clients | UNDECIDED | credentials | **P0** (lockout / weak hash migration) | Single identity, multiple credential types; keep legacy token auth for mobile |
| 3 | KYC (customers) | Reported | **No** | UNKNOWN | — | — | Legacy (only one) | Legacy docs | **P0** legal | Keep legacy KYC as source; B reads status via adapter |
| 4 | Seller / KYB | UNKNOWN ("merchants" fee tier exists publicly) | Yes (full onboarding) | UNKNOWN | Individual/business KYB, docs, approval | Partial | B (only known one) | — | M | B for marketplace sellers; link to legacy merchant/KYC records |
| 5 | Wallet | Reported | **No** | UNKNOWN | — | — | Legacy | balances | **P0** financial | Keep in legacy; future: wallet accounts in a unified ledger only after design |
| 6 | Top-ups | Reported | **No** (B has order/deal payments) | UNKNOWN | — | Mechanics similar to manual payment proof; purpose different | UNDECIDED | requests + proofs | P1 | Separate domain; may share verification UI/engine |
| 7 | Payment methods | Reported (meaning unclear) | Yes (EDMN collection methods/destinations; seller payout methods) | UNKNOWN | Manual bank/InstaPay/Vodafone Cash + destinations | UNKNOWN | UNDECIDED | config | P1 | Clarify; keep per-product config |
| 8 | Manual payment verification | UNKNOWN | Yes (queue, proof, confirm/reject, exactly-once) | UNKNOWN | Strong (locked, idempotent, audited) | UNKNOWN | B (known) | — | M | Candidate shared engine for top-ups + orders + deals |
| 9 | Transactions | Reported | Ledger + payments | UNKNOWN | Journal entries | UNKNOWN | UNDECIDED | Legacy: yes | **P0** | Preserve as historical; never convert automatically |
| 10 | Financial guarantees | Reported (core product per marketing) | **No direct equivalent** | Escrow deal between two app users; 5%/3% fees (claimed) | — | — | Legacy | Legacy: core business data | **P0** | Keep as its own product (see FINANCIAL_COMPARISON §5) |
| 11 | External protected deals | UNKNOWN | Yes | — | Buyer-initiated deal with external seller invited by link; manual payment; delivery; confirmation; dispute; payout | Overlaps with guarantees conceptually | UNDECIDED | — | P1 | Separate product now; candidate for shared escrow engine later |
| 12 | Customer withdrawals | Reported | **No** | UNKNOWN | — | — | Legacy | Legacy: yes | **P0** | Keep in legacy; never merged with seller payouts |
| 13 | Seller withdrawals | UNKNOWN | Yes (maker/checker, SLA, ledger) | — | Strong | Different payee/domain | B | — | M | B |
| 14 | Seller balances | UNKNOWN | Yes (pending/available/reserved) | — | Ledger projections | Not = wallet | B | — | M | B |
| 15 | Ledger | UNKNOWN whether exists | Yes (double-entry, immutable) | UNKNOWN | Strong | UNKNOWN | B (for new flows) | — | **P0** if legacy balances are mutable columns | B ledger for new flows; legacy history kept separately (see FINANCIAL_COMPARISON §4) |
| 16 | Fees | Reported (fee settings; 5%/3% claimed) | Deal fee setting (default 0) + commissions | UNKNOWN | Configurable bps | Different products | UNDECIDED | historical fee values | P1 | Product-specific fee configs, versioned |
| 17 | Marketplace commissions | No (reported) | Yes (versioned, snapshotted) | — | — | NEW_ONLY | B | — | L | B |
| 18 | Orders | No (reported) | Yes | — | parent + seller orders | NEW_ONLY | B | — | L | B |
| 19 | Products | No | Yes | — | — | NEW_ONLY | B | — | L | B |
| 20 | Inventory | No | Yes | — | reservations | NEW_ONLY | B | — | L | B |
| 21 | Shipping | UNKNOWN (guarantees say "without interfering with shipping") | Yes (waybill evidence) | — | — | NEW_ONLY (likely) | B | — | L | B |
| 22 | Returns | UNKNOWN | Yes | — | — | NEW_ONLY (likely) | B | — | L | B |
| 23 | Refunds | Refund policy exists publicly | Yes (liability + recorded payout) | UNKNOWN | — | UNKNOWN | UNDECIDED | Legacy refunds history | P1 | Keep legacy refunds; B for marketplace |
| 24 | Disputes | Claimed (support reviews evidence) | Yes (structured) | UNKNOWN (possibly via tickets) | Structured disputes with decisions → ledger | UNKNOWN | UNDECIDED | Legacy | P1 | Shared dispute engine later |
| 25 | Tickets / support | Reported | Yes | UNKNOWN | Tickets, priorities, internal notes | Likely same | UNDECIDED | Legacy tickets | M | Unify later after status mapping |
| 26 | Notifications | Reported | Yes (in-app, email/SMS outbox) | UNKNOWN (push likely for mobile) | No push | Partial | UNDECIDED | low value | M | Shared notification service with push adapter |
| 27 | Admin users | Reported | Yes | UNKNOWN | staff users | Same concept | UNDECIDED | Legacy admin IDs in logs | M | Map; single SSO later |
| 28 | Roles | Reported | Yes (9 staff + 6 seller roles) | UNKNOWN | — | UNKNOWN | UNDECIDED | config | M | Namespaced roles |
| 29 | Permissions | Reported | Yes (43 + 11) | UNKNOWN | — | UNKNOWN | UNDECIDED | config | M | Namespaced (`legacy.*`, `market.*`) |
| 30 | Activity logs | Reported | audit_logs | UNKNOWN | append-only (DB triggers) | Partial | B (if legacy logs are mutable) | Legacy logs | **P1** audit | Legacy logs archived read-only |
| 31 | Audit logs | UNKNOWN | Yes | — | — | — | B | — | — | Shared audit service |
| 32 | Reports | Reported (statistics/charts) | Yes (dashboard + CSV) | UNKNOWN | — | Different data | UNDECIDED | — | L | Unified dashboard later |
| 33 | CMS | UNKNOWN (marketing site is separate) | Yes | — | — | — | — | — | L | B CMS for marketplace; marketing site separate |
| 34 | Settings | Reported (fee settings) | Yes (typed, audited) | UNKNOWN | — | Partial | UNDECIDED | config | M | Namespaced settings |
| 35 | Files / documents | Reported (KYC docs, evidence) | Yes (private/public, authorized) | UNKNOWN | — | — | UNDECIDED | **critical** | **P0** | Never move; reference via URI adapter |
| 36 | Security controls | UNKNOWN | Strong baseline (see SECURITY_COMPARISON) | UNKNOWN | — | — | UNDECIDED | — | P1 | Raise legacy to B's baseline before linking |
| 37 | 2FA | UNKNOWN | Admin TOTP mandatory | UNKNOWN | — | — | B (known) | — | P1 | Enforce for all finance admins |
| 38 | Idempotency | UNKNOWN | Yes (unique keys everywhere money moves) | UNKNOWN | — | — | B (known) | — | **P0** if absent in legacy withdrawals | Verify legacy |
| 39 | Concurrency controls | UNKNOWN | Row locks, conditional updates | UNKNOWN | — | — | B (known) | — | **P0** if absent | Verify legacy |
| 40 | Reconciliation | UNKNOWN | Built-in (UI + CLI) | UNKNOWN | — | — | B (known) | — | **P0** baseline needed | Build legacy reconciliation queries first |
