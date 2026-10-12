# Real-Money Enablement

Real money is **OFF**. It can only be enabled through `payments.realMoneyEnabled` (settings, fresh 2FA), which re-runs the **master gate** (`goLiveGate` in `src/server/modules/finance/controls.ts`) and refuses unless every gate passes, then still needs the owner's decision. Staging can never enable it.

## Gates (all mandatory)
| Gate code | Evidence required | Type |
|---|---|---|
| ENVIRONMENT / CONFIG_POLICY / ENV_FINGERPRINT | EDMN_ENVIRONMENT=production, env policy clean, fingerprint OK | computed |
| RESTORE_DRILL, BACKUP_VERIFIED | A real provider restore drill of PRODUCTION backups into an isolated target, verified with the post-restore financial list (DATABASE_RESTORE.md) | evidence → reviewed code change |
| MALWARE_SCANNING / MALWARE_SCANNER_INACTIVE | Scanner configured (MALWARE_SCANNER_URL) and an EICAR test file rejected | provider + evidence |
| PAYMENT_PROVIDER | Contracted payment/payout provider + statement reconciliation | provider |
| SECRETS_ROTATION | S7–S10 revoked; production secrets new (SECRET_ROTATION.md) | owner action |
| PRODUCTION_MESSAGING / MESSAGING_DRIVERS / EMAIL_DELIVERY_EVIDENCE | SMTP + SMS providers live; at least one provider-confirmed DELIVERED email | provider + evidence |
| ERROR_TRACKING / MONITORING_ALERT_TEST | External error tracking configured; a test alert reached on-call | provider + evidence |
| PUSH_DEVICE_TEST | Owner manual real-device test (not required for money, but listed) | owner |
| SCHEDULER | ledger.health, outbound.flush, alerts.sweep succeeded within 2 h (needs a real scheduler/worker, not Hobby daily cron) | infrastructure |
| LEDGER_HEALTH / INVARIANTS / LEDGER_IMBALANCE | Fresh non-critical snapshot, zero invariants, debit = credit | computed |
| GLOBAL_KILL_SWITCH | Not engaged | computed |
| PRICING_* / FEES_OWNER_APPROVAL / TAX_TREATMENT / REFUND_FEE_POLICY / PAYOUT_COSTS_UNVERIFIED | Fee engine frozen (7475ffe): owner + accountant decisions — engineering never sets values | owner / legal |
| LEGAL_APPROVAL | Counsel-approved terms/policies | legal |
| MAKER_CHECKER / ADMIN_2FA | Threshold 0, all staff with 2FA | computed |
| REAL_DESTINATION | Real (non-test) payment destination | owner |

Documentation is not evidence; an adapter is not a verified provider; config is not a restore.
