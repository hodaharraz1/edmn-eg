# Admin Dashboard Comparison (+ RBAC, Files, API map)

**Legacy admin menu: NOT INSPECTED** (only the existence of `/adminDashboard/login` is verified).
Legacy modules below are the **owner-reported list**; classification is provisional and must be
re-checked against the real legacy screens (request: admin screenshots + route list).

Classes: KEEP_LEGACY · KEEP_NEW · MERGE · SHARED_INFRASTRUCTURE · REPLACE_UI_ONLY_LATER ·
REQUIRES_REDESIGN · UNKNOWN. **Nothing is removed by any class.**

## 1. Module classification

| Module | Legacy (reported) | B Admin page(s) | Provisional class | Note |
|---|---|---|---|---|
| Dashboard / statistics | Statistics & charts | `/admin` | MERGE (later) | Unified dashboard reading both sources |
| Users | Yes | `/admin/customers`, `/[id]` | MERGE (after identity mapping) | Legacy stays source |
| KYC | Yes | — (seller KYB in `/admin/seller-verification`) | KEEP_LEGACY | B has no customer KYC |
| Sellers / seller approvals | UNKNOWN | `/admin/sellers`, `/admin/seller-verification` | KEEP_NEW | |
| Products / moderation / categories / brands / attributes / policy / inventory | No | yes | KEEP_NEW | |
| Orders / shipping evidence / returns / reviews | No | yes | KEEP_NEW | |
| Financial guarantees | Yes | — | KEEP_LEGACY | Core legacy product |
| External deals | UNKNOWN | `/admin/deals` | KEEP_NEW | Separate product for now |
| Disputes | UNKNOWN (maybe via tickets) | `/admin/disputes` | SHARED_INFRASTRUCTURE (later) | |
| Wallet / top-ups | Yes | — | KEEP_LEGACY | |
| Manual payment verification | UNKNOWN (top-up approval likely similar) | `/admin/payments` | SHARED_INFRASTRUCTURE (later) | One verification engine, separate domains |
| Transactions | Yes | `/admin/ledger` (journal) | KEEP_LEGACY (history) + KEEP_NEW (ledger) | Never merge histories automatically |
| Customer withdrawals | Yes | — | KEEP_LEGACY | |
| Seller withdrawals / balances / settlements / commissions / refunds | No | yes | KEEP_NEW | |
| Payment methods | Yes (meaning unclear) | `/admin/payment-settings` | UNKNOWN | Clarify first |
| Fee settings | Yes | `/admin/settings` (`deals.*`), `/admin/commissions` | REQUIRES_REDESIGN | Per-product versioned fees |
| Tickets / support | Yes | `/admin/support` | MERGE (later) | Map statuses |
| Notifications | Yes | `/admin/notifications` | SHARED_INFRASTRUCTURE | Add push adapter |
| Admins / roles / permissions | Yes | `/admin/roles` | REQUIRES_REDESIGN | Namespaced unified RBAC |
| Activity logs | Yes | `/admin/audit` | KEEP_LEGACY (archive) + KEEP_NEW | Unified viewer later |
| CMS / legal | UNKNOWN | `/admin/cms`, `/admin/legal` | KEEP_NEW | |
| Reports / exports | Statistics | `/admin/reports` | MERGE (later) | |
| Settings | Fee settings | `/admin/settings` | REQUIRES_REDESIGN | Namespaced keys |

## 2. Target concept check — "EDMN Unified Operations & Control Center"

The proposed structure in the brief fits System B's existing grouping (Customers, Marketplace,
Operations, Finance, Content & System) and adds legacy groups (Guarantees, Wallets, Top-ups,
Customer Withdrawals, KYC). Recommended adjustments based on B's actual implementation:
- Put **Manual Payment Verification** and **Top-ups** under one *Money-in Verification* queue with a
  domain filter (shared engine, separate records).
- Keep **Customer Withdrawals** and **Seller Withdrawals** as two queues under *Payouts*, sharing the
  maker/checker engine and payout-proof recording.
- *Guarantees / External Deals* as two tabs, one dispute center.
- *Ledger & Reconciliation* must show the legacy historical ledger (read-only) beside B's journal.
- Final structure is **UNDECIDED** until legacy menus are inspected.

## 3. Roles & permissions

| Aspect | System B | Legacy |
|---|---|---|
| Staff permissions | 43, dotted names (`payments.verify`, `withdrawals.pay`, …) | NOT INSPECTED |
| Staff roles | SUPER_ADMIN, OPERATIONS_MANAGER, SELLER_REVIEWER, CATALOG_REVIEWER, PAYMENT_REVIEWER, FINANCE_OPERATOR, FINANCE_CHECKER, DISPUTE_OFFICER, CUSTOMER_SUPPORT | NOT INSPECTED |
| Seller permissions/roles | 11 / 6 (STORE_OWNER…SUPPORT) | NOT INSPECTED |
| Maker/checker | withdrawals (approve vs pay), adjustments (create vs approve) | UNKNOWN |
| Super admin | fixed, all permissions, cannot be edited | UNKNOWN |

**Expected collisions:** generic names such as `withdrawals.*`, `payments.*`, `users.*`, `settings.*`,
role names like `admin`/`super_admin`. **Recommendation:** unified namespace by product —
`core.*` (users, kyc, admins, audit, settings), `wallet.*` (topups, wallet withdrawals),
`guarantee.*`, `market.*` (catalog, orders, sellers, seller payouts), `finance.*` (ledger,
reconciliation, adjustments). Map legacy roles 1:1 into the new namespace; never broaden a legacy
role's rights during mapping.

## 4. Files & documents

| Category | System B | Legacy |
|---|---|---|
| KYC / national IDs | private, `SELLER_DOCUMENT`, authorized streaming | NOT INSPECTED (location, public/private UNKNOWN) |
| Guarantee evidence | — | NOT INSPECTED |
| Deal evidence | private `DEAL_EVIDENCE` | — |
| Payment / top-up proofs | private `PAYMENT_PROOF` | NOT INSPECTED |
| Withdrawal / refund proofs | private `WITHDRAWAL_PROOF`, `REFUND_PROOF` | NOT INSPECTED |
| Shipping waybills, return/dispute evidence | private | — |
| Product/store/CMS images | public `/media/...` | — |
| Support attachments | private `SUPPORT_ATTACHMENT` | NOT INSPECTED |

Storage: B local disk (`STORAGE_LOCAL_ROOT/public|private`), DB references by `files.id` +
`storage_key`; URL patterns `/media/<key>` (public) and `/api/files/<uuid>` (authorized).
**Integration rule:** legacy files are never moved or renamed; B would reference them through a
`legacy://` URI adapter that enforces the legacy access rules. Full backup + checksum manifest first.

## 5. API & integration map

| Item | System B | Legacy |
|---|---|---|
| Public JSON API | None (Server Actions, HTML) | Host `api.edmneg.com` suggests a JSON API (likely used by the mobile app) — NOT INSPECTED |
| Auth for clients | Cookies | UNKNOWN (likely tokens) |
| Mobile dependency | None | iOS/Android app exists per marketing → **all legacy client APIs: `BACKWARD_COMPATIBILITY_REQUIRED`** (evidence: app existence; endpoint list still needed) |
| Third parties | SMTP (optional), HTTP SMS (optional) | UNKNOWN (marketing names Fawry/ValU/Banque Misr — unverified) |
| Marketing site | — | Separate repo; Formspree + Airtable for leads |
| Overlapping endpoints / naming conflicts | None today (B has no `/api/*` business endpoints) | — |

Recommendation: keep every legacy API contract stable; if B ever serves the app, add a versioned
`/api/v1` façade that reproduces legacy contracts rather than changing the app.
