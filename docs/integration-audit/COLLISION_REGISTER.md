# Collision Register

Legacy names/values are NOT INSPECTED; collisions below are confirmed on the B side and **probable**
on the legacy side (owner-reported domains, public URLs). Each must be re-checked with the legacy
schema/route list.

| # | Collision | Systems | Severity | Risk | Mitigation |
|---|---|---|---|---|---|
| 1 | Word **"withdrawal"**: customer wallet withdrawal (legacy) vs seller payout (B `withdrawal_requests`) | A, B | **P0** | Wrong balance debited, wrong approval rules, merged reports | Distinct names/tables (`wallet_withdrawals` vs `seller_payouts`), separate permissions and queues |
| 2 | **Balance**: legacy wallet balance vs B seller pending/available | A, B | **P0** | Treating seller earnings as wallet money or vice-versa | Separate ledger accounts; never sum across |
| 3 | **Guarantee vs External deal** (both "escrow") | A, B | P1 | Replacing one with the other loses features/data | Keep separate products; shared engine only by design |
| 4 | **"Payment methods"** (legacy meaning unknown) vs B `payment_methods` (EDMN collection methods) and `seller_payout_methods` | A, B | P1 | Account details mapped into the wrong table | Clarify semantics before any mapping |
| 5 | **"Transactions"** vs B journal entries/payments | A, B | P1 | Auto-conversion rewriting history | Import only as source-referenced history (FINANCIAL_COMPARISON §4) |
| 6 | **User IDs**: UUID (B) vs likely integer (legacy) | A, B | P2 | Code assuming one ID space; foreign keys | Mapping table; never reuse IDs across systems |
| 7 | **Human reference numbers**: B orders start 100000, B documents (payments, deals, withdrawals, tickets, refunds…) start 500000 | A, B | P2 | Customers/support confusing a legacy reference with a B reference | Prefix in UI (e.g. `M-100123`, `G-…`); keep legacy numbers searchable |
| 8 | **Unique phone/email** (B) vs possibly duplicated/missing in legacy | A, B | P1 | Import failures or account takeover via auto-merge | Duplicate report; verified linking only |
| 9 | **Phone formats**: B stores `+201…`; legacy format UNKNOWN | A, B | P2 | Duplicates not detected | Normalize copies for matching; keep originals |
| 10 | **Status enums**: B uses `REQUESTED/APPROVED/PROCESSING/PAID/REJECTED/CANCELLED` (withdrawals), `PENDING/PAID/CANCELLED` (refunds), `OPEN/IN_PROGRESS/...` (tickets) | A, B | P2 | Same label, different meaning | Never remap historical statuses; translation table per domain |
| 11 | **Permission names** (`withdrawals.*`, `payments.*`, `settings.*`) | A, B | P2 | Granting broader rights after merge | Namespaces (`wallet.*`, `market.*`, …) |
| 12 | **Role names** (e.g. SUPER_ADMIN vs legacy "admin") | A, B | P2 | Privilege confusion | Explicit 1:1 role mapping approved by owner |
| 13 | **Domains**: B plans storefront on `edmneg.com`, Seller on `seller.edmneg.com`, Admin on `admin.edmneg.com`; `edmneg.com` currently serves the **marketing site**; legacy uses `api.edmneg.com` (+ `app.edmneg.com`) | A, B, marketing | **P1** | DNS change could take the marketing site or legacy app offline / break SEO | Decide host plan first (e.g. `market.edmneg.com` or `shop.`); no DNS change without approval |
| 14 | **Legal/policy URLs**: marketing `/terms`, `/privacy-policy`, `/refund-policy` vs B `/legal/terms`, `/legal/privacy`, `/legal/returns` | marketing, B | P2 | Conflicting legal texts; SEO duplicates | One canonical legal source; redirects later |
| 15 | **Fee configuration**: legacy 5%/3% (claimed) vs B `deals.feeBps` default 0 | A, B | P1 | Charging wrong fees | Product-specific versioned fee configs |
| 16 | **Storage paths**: B `STORAGE_LOCAL_ROOT/{public,private}/…`; legacy UNKNOWN | A, B | P2 | Overwrites if same bucket/folder is shared | Separate roots/buckets; never write into legacy storage |
| 17 | **Configuration keys**: B `system_settings` keys (`withdrawals.minimumAmount`, …) vs legacy fee settings | A, B | P3 | Ambiguous settings | Namespaced keys |
| 18 | **Admin accounts**: same staff member in both systems | A, B | P2 | Audit attribution split | Map staff identities; keep both IDs in audit views |
| 19 | **Cookie names / sessions** if served under the same parent domain (`edmn_sid`, `edmn_admin_sid` vs legacy cookies) | A, B | P3 | Cookie clobbering across subdomains | Host-only cookies (B already host-only); verify legacy |
| 20 | **API paths** if B ever exposes `/api/*` on a shared host | A, B | P2 | Breaking mobile app | Keep legacy API host untouched; versioned façade only |
