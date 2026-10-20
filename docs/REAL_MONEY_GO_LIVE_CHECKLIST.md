# Real-Money Go-Live Checklist

Real money is **OFF**. Enabling `payments.realMoneyEnabled` calls `goLiveGate()` and fails closed; on staging it is
refused outright. A passing gate never enables money by itself — the owner decides. Automatic seller release: never.

| # | Gate item (code) | Status now |
|---|---|---|
| 1 | Restore drill performed and signed (RESTORE_DRILL) | BLOCKED |
| 2 | Malware scanning for uploads (MALWARE_SCANNING) | BLOCKED — infrastructure not available |
| 3 | Payment/payout provider + statement feeds (PAYMENT_PROVIDER) | NOT YET CONNECTED |
| 4 | Production secrets rotated and documented (SECRETS_ROTATION) | BLOCKED |
| 5 | Production email/SMS providers (PRODUCTION_MESSAGING, MESSAGING_DRIVERS) | NOT ENABLED (by instruction) |
| 6 | `EDMN_ENVIRONMENT=production` (ENVIRONMENT) | staging |
| 7 | Encryption key / session secret configured (ENCRYPTION_KEY, SESSION_SECRET) | check at deploy |
| 8 | Provider webhook signing secret (PROVIDER_SIGNING_SECRET) | not set (endpoint returns 503) |
| 9 | Fee engine: a published pricing version in force for both models (PRICING_MARKETPLACE / PRICING_PROTECTED_DEAL) | owner-approved v1 published on staging via maker/checker |
| 9a | Tax treatment of fees resolved (TAX_TREATMENT) | UNRESOLVED |
| 9b | Refund fee policy published after legal review (REFUND_FEE_POLICY) | DRAFT — LEGAL REVIEW REQUIRED |
| 9c | Payout channel costs/limits verified (PAYOUT_COSTS_UNVERIFIED) | UNVERIFIED placeholders |
| 10 | Policies approved by legal counsel (LEGAL_APPROVAL) | v1.1 drafts — LEGAL REVIEW REQUIRED |
| 11 | Maker/checker threshold = 0 EGP (MAKER_CHECKER) | staging 50,000 EGP |
| 12 | Every active staff account has 2FA (ADMIN_2FA) | check at go-live |
| 13 | A real (non-test) payment destination enabled (REAL_DESTINATION) | none (test destinations only) |
| 14 | Invariants all 0, ledger balanced (INVARIANTS, LEDGER_IMBALANCE) | see finance-control |
| 15 | No open test payments/withdrawals/refunds/deals and zero test balances | enforced at enable time |
| 16 | Production domain + DNS cut-over | out of scope (no production DNS changes) |
