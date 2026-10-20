# REAL MONEY activation gate (separate from the production deployment)

**Default: REAL MONEY OFF.**
- Deploying production, opening the public website and running pilots **do not** enable real money.
- There is no environment variable for it. `check-production-env.ts` refuses any variable that looks like one.
- The only switch is the database setting `payments.realMoneyEnabled`, changed from the admin console:
  - with a fresh 2FA step-up and Maker/Checker,
  - after the code gate `goLiveGate()` (`src/server/modules/finance/controls.ts`) passes **and** the owner decides.
- A passing gate never enables anything by itself.
- Staging refuses it outright.

Code-level gate items: [REAL_MONEY_ENABLEMENT.md](REAL_MONEY_ENABLEMENT.md). Historical status: `docs/REAL_MONEY_GO_LIVE_CHECKLIST.md`.

This checklist is the **evidence** the owner reviews **before** the request is made. **Documentation is not evidence; configuration is not evidence.**

| # | Gate | Required evidence (attach to the go-live log) | Who | Code gate |
|---|---|---|---|---|
| 1 | **Credential rotation** | S7–S10 revoked (provider shows the old token rejected). Every production secret is new and recorded in the manifest (names only). | Owner | `SECRETS_ROTATION`, `ENV_FINGERPRINT` |
| 2 | **Backup off-server** | `backup-status.json` = `OFF-SERVER COPY UPLOADED` for ≥ 7 consecutive days. The object is visible in the destination account. | Operator + owner | `BACKUP_VERIFIED` |
| 3 | **Restore drill** | `restore-drill.sh` PASS on a backup **downloaded from the off-server destination**, ≤ 30 days old. Output attached: schema, counts, ledger, critical snapshots, acceptance `--drill`. | Operator | `RESTORE_DRILL` |
| 4 | **Ledger health** | `prod-acceptance --db-only` PASS. `ledger.health` OK within 2 h. All invariants 0. Debits = credits. | Computed | `LEDGER_HEALTH`, `INVARIANTS`, `LEDGER_IMBALANCE` |
| 5 | **Maker/Checker** | Withdrawal dual-control threshold = 0 EGP. At least two distinct staff (maker ≠ checker) with the finance roles. | Owner | `MAKER_CHECKER` |
| 6 | **2FA** | Every active staff account has `totp_enabled_at` (roles page shows the 2FA badge for all). | Computed | `ADMIN_2FA` |
| 7 | **Malware scanning** | Scanner configured. EICAR uploaded as a production proof → `INFECTED`, unopenable. A normal PDF → `CLEAN`. `MALWARE_SCANNER` is `HEALTHY`. | Operator | `MALWARE_SCANNING`, `MALWARE_SCANNER_INACTIVE` |
| 8 | **Email delivery** | At least one provider-confirmed `DELIVERED` message (signed webhook). `EMAIL_WEBHOOK` is `HEALTHY`. | Operator | `EMAIL_DELIVERY_EVIDENCE`, `PRODUCTION_MESSAGING` |
| 9 | **SMS** | `SMS_DRIVER=http` with a real provider. A real OTP received on an owner phone. | Owner | `MESSAGING_DRIVERS` |
| 10 | **Financial provider** | Contracted payment/payout provider. Signing secret configured. Statement reconciliation tested. A real (non-test) payment destination enabled through Maker/Checker. | Owner | `PAYMENT_PROVIDER`, `PROVIDER_SIGNING_SECRET`, `REAL_DESTINATION` |
| 11 | **Monitoring** | External uptime monitor on `/api/ready`. Heartbeat monitors for backup and watch. Error tracking `HEALTHY`. | Operator | `ERROR_TRACKING`, `SCHEDULER` |
| 12 | **Human alert test** | A deliberately triggered alert (e.g. stopping the worker in a window) reached the on-call human. The time-to-acknowledge is recorded. | Owner | `MONITORING_ALERT_TEST` |
| 13 | **Fee Engine** | Published pricing versions in force for both models, approved by the owner (Maker/Checker). Payout costs verified. | Owner | `PRICING_*`, `FEES_OWNER_APPROVAL`, `PAYOUT_COSTS_UNVERIFIED` |
| 14 | **Legal / accounting** | Counsel approval of terms and policies (v1.1/v1.2 drafts). Tax treatment of fees decided. Refund-fee policy published. Commercial register / tax registration as required. | Legal / accountant / owner | `LEGAL_APPROVAL`, `TAX_TREATMENT`, `REFUND_FEE_POLICY` |
| 15 | **No test residue** | No open test payments, withdrawals, refunds or deals; zero test balances (checked at enable time). | Computed | enable-time check |
| 16 | **Kill switch** | Global kill switch not engaged, and its use rehearsed ([REAL_MONEY_EMERGENCY_DISABLE.md](REAL_MONEY_EMERGENCY_DISABLE.md)). | Owner | `GLOBAL_KILL_SWITCH` |

**Procedure:**
1. All 16 rows carry evidence.
2. The owner signs the go-live log.
3. A finance maker requests `payments.realMoneyEnabled = true`.
4. A different checker approves with a fresh 2FA.
5. The gate re-runs and refuses on any failing item.
6. The first real transactions are monitored live.
7. The disable path is the kill switch, which works instantly.

There is **no automatic activation** anywhere: no job, script, deploy step or environment variable.
