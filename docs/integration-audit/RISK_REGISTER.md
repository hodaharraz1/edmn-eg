# Integration Risk Register

P0 money/data/security loss · P1 breaks major operation · P2 significant, manageable · P3 low.

| ID | Pri | Description | Affected | Probability | Impact | Detection | Mitigation | Rollback |
|---|---|---|---|---|---|---|---|---|
| R1 | **P0** | Integration designed without the legacy schema/code (current state) → wrong mappings, silent data loss | A, B | High if work starts now | Severe | This audit (legacy NOT INSPECTED) | Obtain artifacts in `LEGACY_ARTIFACTS_REQUIRED.md`; re-run audit; no implementation before approval | n/a (prevented) |
| R2 | **P0** | Treating customer wallet withdrawals and seller payouts as one domain | A, B | Medium | Wrong debits, double payouts | Design review; reconciliation | Separate domains (COLLISION #1) | Restore from backup; reverse via ledger entries |
| R3 | **P0** | Converting legacy transactions/balances into B journal entries automatically | A, B | Medium | Rewritten financial history, irreconcilable books | Reconciliation queries (MIGRATION_PLAN §4) | Opening-balance + parallel historical ledger strategy; no auto-conversion | Delete migration batch only via reversing entries; legacy untouched |
| R4 | **P0** | Legacy balances are mutable columns / single-entry (unknown) → no reliable baseline | A | UNKNOWN | Cannot prove totals | Recompute balances from movements; compare | Freeze & snapshot; explain every drift before cut-over | Snapshot restore |
| R5 | **P0** | Identity auto-merge by phone/email → account takeover of balances/KYC | A, B | Medium | Fraud, data breach | Duplicate report | Verified linking (OTP/admin review) only | Unlink mapping rows; audit trail |
| R6 | **P0** | Breaking legacy APIs used by the mobile app | A | Medium | App outage | Contract tests against recorded API traffic | Keep legacy API host/contracts unchanged; versioned façade if ever needed | Revert deployment |
| R7 | **P0** | KYC/identity documents moved, renamed, or exposed during file integration | A | Low–Medium | Legal breach | Checksum manifest; access tests | Never move files; reference via adapter; private only | Restore from file backup |
| R8 | **P0** | Missing tested backups before any migration | A, B | UNKNOWN | Irrecoverable loss | Restore drill | Mandatory backups + restore test (MIGRATION_PLAN §2) | Restore |
| R9 | P1 | Replacing guarantees with external deals | A, B | Medium | Feature loss (services, in-app counterparty, fee tiers) | Feature preservation matrix | Keep both products | Keep legacy running |
| R10 | P1 | Fee model conflict (5%/3% claimed vs B 0 default / commissions) | A, B | High | Wrong charges | Fee comparison per product | Versioned per-product fees | Refund via ledger |
| R11 | P1 | DNS/host change takes down marketing site or legacy app | marketing, A, B | Medium | Outage, SEO loss | Host plan review | Separate subdomain for marketplace; no DNS change without approval | DNS revert |
| R12 | P1 | Legacy admins without 2FA gain access to new financial functions | A, B | UNKNOWN | Fraud | Admin security review | Require TOTP for every finance admin before linking | Disable access |
| R13 | P1 | Public claims ("insured", "licensed escrow", partner banks) unverified | marketing | UNKNOWN | Regulatory/legal | Counsel review | Verify or remove claims before unified launch | n/a |
| R14 | P1 | Duplicate/invalid phones/emails in legacy violate B uniqueness | A, B | Medium | Import failure / wrong merges | Duplicate report | Normalize copies; manual resolution queue | n/a |
| R15 | P1 | Password hash incompatibility → mass lockout or forced resets | A, B | Medium | Support load, takeover via reset | Login tests | Algorithm-tagged verification + rehash on login | Keep legacy auth path |
| R16 | P1 | Legacy activity logs mutable/incomplete → audit gaps | A | UNKNOWN | Weak evidence | Inspect schema | Export immutable archive with checksums | n/a |
| R17 | P1 | Time-zone / money precision differences distort reconciliation | A, B | Medium | False mismatches or hidden ones | Totals by day/status | Record source TZ & types; reconcile in minor units | n/a |
| R18 | P2 | Reference-number confusion (100000+/500000+ vs legacy numbers) | A, B | Medium | Support errors | UI review | Prefixes per product | n/a |
| R19 | P2 | Legal URL/text duplication between marketing and B | marketing, B | High | Conflicting terms | Content review | Single canonical legal source | Redirect revert |
| R20 | P2 | B has no push notifications / mobile API | B | Certain | Can't serve app users | Inventory | Keep legacy notification path | n/a |
| R21 | P2 | Lead PII in third parties (Formspree, Airtable) without documented retention | marketing | Medium | Privacy compliance | Data map | Document retention/consent | n/a |
| R22 | P3 | B hardening items (CSP inline scripts, PDF AV scanning, proxy rate limits) | B | — | Moderate | Security review | Already listed in B report | n/a |
