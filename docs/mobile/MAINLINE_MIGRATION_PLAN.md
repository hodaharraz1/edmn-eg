# Mainline migration plan (Marketplace → `main`)

Status: **PLAN ONLY — not executed.** Decision 1: the Marketplace branch is the baseline; nothing merges to `main`
and nothing touches production until every gate below passes and the owner approves the specific step.

## 1. Branches and recovery points

| Item | Value |
|---|---|
| Marketplace baseline | `claude/great-tesla-nor0wt` @ `48ae40c` |
| Recovery point (remote) | branch `backup/marketplace-baseline-48ae40c` → `48ae40c` (the proxy refuses tag pushes; a local tag `recovery/marketplace-baseline-48ae40c` exists) |
| Phase 1 development branch | `claude/awesome-davinci-ojxuul` = baseline + Phase 0 docs (merge `9ad58d0`) + Phase 1 commits |
| Current `main` | marketing site lineage (audited in Phase 0 v1); **not** an ancestor of the Marketplace branch |

Before any mainline step, create a second recovery point of `main` itself: `backup/main-<sha>` (branch, via the
GitHub API).

## 2. Pre-merge gates (all must be green, evidence attached)

1. **Full local regression** on the candidate commit: `npm run typecheck`, `npm run lint`, `npm test` (Vitest unit +
   integration), `npx tsx scripts/openapi.ts --check`, `npx tsx scripts/generate-dart-api.ts --check`,
   `flutter analyze && flutter test` in each of `packages/*` and `apps/*`.
2. **Migration verification**
   - fresh database: all migrations from zero (the Vitest global setup does this);
   - forward migration of a copy of the **current staging data** (0019 → 0020) with `scripts/migrate.ts --preflight`
     first (destructive-statement scan), then apply, then `npm run ledger:check`;
   - verified in Phase 1 on the pristine baseline test database: preflight OK, 0020 applied in 172 ms, users,
     sessions and existing delivery OTPs preserved (existing OTP rows default to hash version 1 = verify-only).
3. **Secrets provisioned before deploy** (new in Phase 1): `DELIVERY_OTP_KEY` and `MOBILE_TOKEN_KEY` — each ≥ 32
   random characters, different from each other and from `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`.
   Without them a hosted deployment fails closed when issuing a delivery code or a mobile token (production boot
   validation refuses to start; staging reports a warning).
4. **Staging verification** (only when the owner authorizes a staging deploy — `docs/TESTING_POLICY.md`): deploy the
   candidate, run the targeted E2E specs for checkout, Protected Deal delivery OTP, admin risk flags and admin queues;
   smoke the mobile API with both apps pointed at staging (`EDMN_ENV=staging`).
5. **Financial invariants**: `npm run ledger:check` on staging after the deploy; Real Money remains OFF
   (`payments.realMoneyEnabled = false`; staging can never enable it).

## 3. Merge strategy

`main` and the Marketplace branch do not share the Marketplace history, so a plain fast-forward is impossible.
Recommended, in this order:

1. Open a PR **Marketplace (dev branch) → `main`** with merge strategy *merge commit* (never squash: it would erase the
   audited history and the migration lineage).
2. Resolve conflicts by taking the Marketplace side for all application code, migrations, `package.json` and lockfile;
   carry over only marketing-site content the owner explicitly wants (listed in the PR), re-applied as a follow-up
   commit on top.
3. Re-run every gate in §2 on the merge result, not on the branch alone.
4. Owner approval → merge. Production deploy is a separate, later decision.

Alternative if the owner prefers: repoint the production deploy to the Marketplace branch and archive the old `main` as
`archive/marketing-main` — fewer conflicts, same gates.

## 4. Rollback

- Code: redeploy the previous production build / revert the merge commit (history kept, no force-push).
- Database: migration 0020 is additive (two new tables, new nullable/defaulted columns, a widened check constraint and
  a stricter OTP trigger). Rolling back the code does not require rolling back the schema: old code ignores the new
  columns and tables. A restore from the pre-deploy backup is needed only if data corruption is found.
- Secrets: removing `DELIVERY_OTP_KEY` would make active v2 delivery codes unverifiable — never rotate or remove it
  while delivery codes are active (they expire within `deals.deliveryOtpTtlHours`).

## 5. Explicitly out of scope until approved

Production deploy, enabling Real Money, publishing the apps to stores, any System A change.
