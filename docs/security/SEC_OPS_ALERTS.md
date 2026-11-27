# SEC-OPS Alerts (PKG-SEC-OPS-01)

Five security/operations rules on the existing proactive alert engine (`src/server/modules/alerts/engine.ts`).
They close SEC-142 (security-event alerting) and SEC-144 (operations-health alerting) from
`docs/security/policy-v1/SECURITY_CONTROL_REGISTER.md`, and support SEC-143 (bulk-extraction monitoring).

| Rule | Trigger | Recipients (permission) | Default cooldown | Resolves when |
| --- | --- | --- | --- | --- |
| `SEC_LEDGER_HEALTH` | Latest `ledger_health_checks` row is WARNING/CRITICAL (movements already auto-blocked by `ledger-health.ts`; this is the missing notification) | `finance.view` | 6h | Next check is OK |
| `SEC_JOB_FAILED` | `job_leases.consecutive_failures > 0`, failure within lookback (default 48h) | `settings.manage` | 6h | A success resets the counter |
| `SEC_JOB_STALE` | `job_leases.next_expected_at` missed by more than lookback (default 12h), no live lease | `settings.manage` | 12h | Job runs on schedule again |
| `SEC_LOGIN_FAILURE_SPIKE` | `rate_limits` `login-id:*` / `login-ip:*` count ≥ 20 within lookback (default 2h) | `audit.view` | 2h | Window cools below threshold |
| `SEC_ADMIN_ACTION_BURST` | One ADMIN actor ≥ 100 `audit_logs` rows within lookback (default 1h) | `audit.view` | 3h | Burst ends |

## Properties

- **Read-only.** Candidates are SELECTs only. No rule writes, recomputes or posts anything; the engine
  performs all state transitions and notifications, exactly as for the business rules.
- **Bounded.** Every query is time-windowed and limited to 25 rows. Lookbacks come from the rule's
  `agingHours`, clamped to 1–168 hours, so a settings override cannot widen a scan past 7 days.
- **Configurable.** Same mechanism as all rules: the `alerts.rules` setting, per code
  `{ "SEC_JOB_FAILED": { "enabled": false, "cooldownHours": 12, "agingHours": 24 } }`.
  Count thresholds (20 attempts / 100 actions) are deliberate constants, documented in code.
- **No sensitive data.** Offender sources (phone, IP, actor id) never leave the database: entity ids and
  refs carry a SHA-256 fingerprint plus counts. Bodies use `{{ref}}` only.
- **Dedupe & resolution.** Inherited from the engine: one open alert per (rule, entity, recipient),
  repeat only after cooldown, automatic RESOLVED when the condition clears.

## Operations

Alerts appear in the notification center (`OPS_ALERT` event) and on `/admin/alerts` under category
`SECURITY`. Links point at `/admin/ledger`, `/admin/ops` and `/admin/audit` for triage.
