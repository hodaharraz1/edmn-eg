# Financial Drift / Ledger Health CRITICAL — always SEV-1

Trigger: `ledger_health_checks.status = CRITICAL` (scheduler `ledger.health` every 30 min, or manual), alert «سلامة دفتر الأستاذ: مخالفة حرجة» on `/admin/ops`, or `npm run ledger:check` failing.

**While the latest snapshot is CRITICAL, every NEW money movement is refused automatically** (`assertFinancialSafety` in `src/server/modules/finance/controls.ts`). Nothing is auto-fixed — ever.

Critical invariants (`CRITICAL_INVARIANTS` in `ledger-health.ts`): TRIAL_BALANCE, PROJECTION_DRIFT, UNBALANCED_ENTRY, DUPLICATE_BUSINESS_EVENT, REFUND_OVERAGE, WITHDRAWAL_OVERAGE, WITHDRAWAL_ALLOCATION_SUM, DEAL_PAYABLE_ATTRIBUTION, DEAL_RESERVED_ATTRIBUTION.

## Steps
1. Engage the emergency kill switch (REAL_MONEY_EMERGENCY_DISABLE) — belt and braces.
2. `/admin/finance-control` → invariants list shows the offending rows (sample) with source ids.
3. Classify: projection drift (stored `ledger_accounts.balance` ≠ Σ lines) vs. journal problem (unbalanced / duplicate entry) vs. sub-ledger attribution (allocations, deal payables).
4. **Corrections are new, approved, reversing/adjusting entries** through the normal Maker/Checker paths — never UPDATE/DELETE on `journal_entries` / `journal_lines` (blocked by triggers), never rewrite historical pricing, never touch A-100016.
5. After the correction: run a manual health check; it must be OK/WARNING. Then release the kill switch (two people).
6. Post-incident: attach the CRITICAL and the clean snapshot ids (append-only evidence).

## Verification queries (read-only)
```sql
select sum(debit) dr, sum(credit) cr, sum(debit)-sum(credit) diff from journal_lines;
select entry_id from journal_lines group by entry_id having sum(debit) <> sum(credit);
select w.id from withdrawal_requests w where exists (select 1 from withdrawal_allocations a where a.withdrawal_id = w.id)
  and w.amount <> (select sum(amount) from withdrawal_allocations a where a.withdrawal_id = w.id);
```
