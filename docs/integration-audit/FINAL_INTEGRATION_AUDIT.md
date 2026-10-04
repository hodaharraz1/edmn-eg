# EDMN — Legacy vs Marketplace: Final Integration Audit

Date: 2026-10-04 · Audit type: **read-only forensic comparison** · No merge, no code or data changes.

# 1 Executive Summary

- **System B (new marketplace)** was fully inspected: Next.js 16 + PostgreSQL, 79 tables, 110 pages,
  double-entry ledger, seller payouts, external protected deals. It is **not deployed and contains
  no production data**.
- **System A (legacy production)** could **not** be inspected: no legacy source repository, schema,
  dump or documentation was available to this session. Only the existence of
  `https://api.edmneg.com/adminDashboard/login` (Cloudflare-fronted) was verified. Further probing
  was stopped by safety controls, as required by the brief's access rule.
- An adjacent **marketing website** (`hodaharraz1/edmn-eg-nextjs`) was inspected; it describes the
  legacy product as an **escrow/guarantee app** (two app users, 5% individuals / 3% merchants,
  goods and services, mobile app on iOS/Android).
- Main conclusion: the two systems are **largely complementary, not duplicates**. B adds a
  marketplace; A (reportedly) runs wallets, top-ups, customer withdrawals, KYC and guarantees,
  none of which exist in B. Shared words ("withdrawal", "balance", "payment methods",
  "transactions", "escrow") hide **different domain objects**.
- **Verdict: NOT_READY_FOR_INTEGRATION_PLANNING** (see §24) until the legacy artifacts are provided.

# 2 Systems Inspected

| System | Source | Depth |
|---|---|---|
| B — `hodaharraz1/edmn-eg` @ `claude/great-tesla-nor0wt` | full repository | Complete |
| Marketing site — `hodaharraz1/edmn-eg-nextjs` @ `4a87884` | read-only clone | Complete (small repo) |
| A — legacy admin/API | one unauthenticated GET of the login URL | Existence only |

# 3 Access Limitations

Missing: legacy source code, schema/migrations, row counts, route/API list, env-var names, hashing
config, storage config, roles/permissions seed, financial totals, admin screenshots. Exact request:
`LEGACY_ARTIFACTS_REQUIRED.md`. No credentials were requested or used; no secrets appear in reports.

# 4 Legacy System Architecture

**NOT INSPECTED.** Verifiable: admin at `api.edmneg.com/adminDashboard`, Cloudflare in front; a
product app at `app.edmneg.com` and mobile apps are referenced publicly. Everything else is
`UNKNOWN` — see `SYSTEM_A_INVENTORY.md`.

# 5 Marketplace Architecture

See `SYSTEM_B_INVENTORY.md` and `docs/ARCHITECTURE.md`. Key integration-relevant facts: UUID users
with unique email/phone; scrypt; cookie sessions (no mobile API); admin TOTP + step-up; 43 staff +
11 seller permissions; ledger with 11 account codes; no wallet/top-up/customer-withdrawal/customer-KYC.

# 6 Feature Comparison

`DOMAIN_COMPARISON_MATRIX.md` (40 domains). Overlaps: users, auth, manual payment verification
mechanics, tickets, notifications, admins/roles/permissions, audit, settings, files, disputes,
escrow concept. Legacy-only (reported): wallet, top-ups, customer withdrawals, customer KYC,
guarantees, fee tiers. New-only: catalog, orders, shipping, returns, reviews, commissions, seller
payouts, ledger, CMS/legal versions.

# 7 Database Comparison

`DATABASE_COMPARISON.md`: full B register; every legacy mapping is `UNKNOWN` or a labeled
hypothesis. No table is classified EXACT_MATCH without evidence.

# 8 Identity Comparison

`IDENTITY_AND_SECURITY.md` Part 1. One person can exist in both systems; risks: duplicates, hash
incompatibility, auto-merge takeover (P0). Recommendation: `identity_links` mapping, verified
linking only, algorithm-tagged credentials with rehash-on-login.

# 9 Financial Comparison

`FINANCIAL_COMPARISON.md`. B double-entry is correct and tested. Legacy ledger nature UNKNOWN.
Never auto-convert legacy transactions; provisional strategy = parallel historical ledger +
source-referenced opening balances (UNDECIDED until evidence).

# 10 Guarantee / External Deal Comparison

Different initiation (in-app counterparty vs invited external seller), scope (services vs goods),
fees (5%/3% claimed vs configurable 0%), settlement (wallet? vs payout payable). Recommendation:
**keep as separate products now; shared escrow engine as long-term option** (UNDECIDED).

# 11 Withdrawal Comparison

Customer wallet withdrawal ≠ seller payout. May share approval engine, payout execution, proof
recording, audit and encrypted destination model; must keep separate records, balances,
permissions and queues.

# 12 Admin Comparison

`ADMIN_COMPARISON.md`: provisional KEEP_LEGACY for KYC, guarantees, wallets, top-ups, customer
withdrawals, transactions history; KEEP_NEW for marketplace modules; SHARED_INFRASTRUCTURE for
payment verification, notifications, disputes; REQUIRES_REDESIGN for fees, roles/permissions,
settings. Namespaced RBAC proposed (`core.*`, `wallet.*`, `guarantee.*`, `market.*`, `finance.*`).

# 13 Security Comparison

`IDENTITY_AND_SECURITY.md` Part 2. Legacy controls UNKNOWN. Observed: legacy admin exposed on the
public API host (P2 recommendation to isolate). Provisional P0/P1 checks: legacy KYC file privacy,
admin 2FA, withdrawal idempotency/concurrency. Marketing legal claims need counsel review (P1).

# 14 Data Preservation Requirements

`DATA_PRESERVATION_REGISTER.md` (37 families). All identity, KYC, wallet, top-up, withdrawal,
guarantee, transaction, audit and file data is CRITICAL; nothing may be deleted or rewritten; legacy
IDs, reference numbers, statuses and timestamps preserved verbatim.

# 15 Source of Truth Recommendations

| Domain | Proposed source |
|---|---|
| Users (existing), customer KYC, wallet, top-ups, customer withdrawals, guarantees, guarantee fees, legacy transaction history | **Legacy** |
| Seller KYB, products, orders, marketplace payments, commissions, shipping, returns, seller payouts, external deals, ledger for new activity | **New** |
| Unified identity, disputes, tickets, roles/permissions, notifications | **UNDECIDED** |
| Audit logs, files, settings | **Owning system per record** |

Full table: `SOURCE_OF_TRUTH_MATRIX.md`.

# 16 Collision Register Summary

20 collisions (`COLLISION_REGISTER.md`). Top: "withdrawal" and "balance" semantics (P0), guarantee vs
deal (P1), payment methods & transactions meaning (P1), unique phone/email (P1), domains — B plans
`edmneg.com` which currently hosts the marketing site (P1), fee configuration (P1), reference numbers
100000+/500000+ (P2).

# 17 P0 Risks

R1 integrating without legacy evidence · R2 merging wallet withdrawals with seller payouts · R3
auto-converting legacy transactions into the new ledger · R4 unknown/mutable legacy balances · R5
identity auto-merge takeover · R6 breaking mobile-app APIs · R7 exposing/moving KYC documents ·
R8 no tested backups. Details: `RISK_REGISTER.md`.

# 18 P1 Risks

R9 replacing guarantees with deals · R10 fee conflict · R11 DNS/host change outages · R12 legacy
admins without 2FA · R13 unverified public legal claims · R14 duplicate phones/emails · R15 hash
incompatibility · R16 mutable legacy logs · R17 time-zone/precision distortion.

# 19 Proposed Integration Architecture

Two back ends behind one **Unified Operations & Control Center**: legacy remains system of record for
wallet/guarantee/KYC domains and keeps its API for the mobile app; B remains system of record for
marketplace domains; integration through (a) a verified identity-mapping layer, (b) read adapters
(legacy KYC status, profiles, files by URI), (c) shared infrastructure services introduced per
domain (payment-proof verification engine, maker/checker payout engine, notifications with push
adapter, dispute center, audit viewer), (d) namespaced RBAC. A shared escrow engine and a unified
ledger are **later, owner-approved** options.

# 20 Proposed Non-Destructive Migration Sequence

Stage 0 evidence & tested backups → 1 additive schema → 2 identity mapping → 3 adapters → 4 read
paths → 5 write paths per domain → 6 financial reconciliation → 7 unified admin UI → 8 legacy
compatibility period → 9 optional retirement of code only, with explicit approval; history always
preserved. Details: `MIGRATION_PLAN.md`.

# 21 Backup / Rollback Requirements

Full + schema dumps, PITR, file backup with SHA-256 manifest, repo tags, config inventory (names
only), deployment & DNS snapshot, **verified restore drill before any production step**; every
stage reversible; financial imports only as tagged, reversible batches.

# 22 Reconciliation Requirements

Counts by status for every preserved family and DB-vs-storage file counts; financial totals in
minor units by day/status (wallet balances vs movements, top-ups, withdrawals, guarantee funds held/
released/refunded, fees); B trial balance and drift; clearing account nets to zero; every mismatch
explained and signed off. Details: `MIGRATION_PLAN.md` §4.

# 23 Information Still Needed

From `LEGACY_ARTIFACTS_REQUIRED.md`: legacy repository access; schema-only dump; row counts; route/API
list (and which endpoints the mobile app calls); env-var names; hashing config prefix; user
uniqueness rules; financial code paths and status lists; aggregate financial totals; storage config;
roles/permissions; admin screenshots; payment/SMS/push providers; deployment description; the fee
policy actually applied; host/domain plan decision.

# 24 GO / NO-GO Recommendation for Starting Integration

## **NOT_READY_FOR_INTEGRATION_PLANNING**

Reasons:
1. The legacy system — which holds all production data and money — has not been inspected; every
   legacy mapping is UNKNOWN.
2. Legacy ledger/balance semantics, withdrawal safety and KYC file privacy are unverified (P0).
3. No baseline totals or tested backup/restore exist to measure zero data loss against.

The audit becomes **READY_FOR_INTEGRATION_PLANNING** when the Priority 1 and 2 artifacts are provided
and this audit is re-run with no `NOT INSPECTED` entries in P0 domains. This report does **not**
authorize any implementation.

## Generated documents

`docs/integration-audit/`: SYSTEM_A_INVENTORY.md, SYSTEM_B_INVENTORY.md, DATABASE_COMPARISON.md,
DATA_PRESERVATION_REGISTER.md, DOMAIN_COMPARISON_MATRIX.md, FINANCIAL_COMPARISON.md,
ADMIN_COMPARISON.md, SOURCE_OF_TRUTH_MATRIX.md, COLLISION_REGISTER.md,
FEATURE_PRESERVATION_MATRIX.md, RISK_REGISTER.md, FINAL_INTEGRATION_AUDIT.md, plus
IDENTITY_AND_SECURITY.md, MIGRATION_PLAN.md, LEGACY_ARTIFACTS_REQUIRED.md.
