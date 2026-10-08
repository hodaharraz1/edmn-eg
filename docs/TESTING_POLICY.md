# EDMN — Test execution policy (where and when tests run)

This policy changes **where and when** tests run, never **what** they guarantee. Every safety test stays in the
suite; nothing is skipped or weakened.

## Why
Staging runs on Vercel Hobby (shared account allowance: 4 h Active CPU / month). Measured on 2026-10-08:
one full E2E run against staging ≈ **25,900 requests** (≈ 6 CPU-minutes), and on 5–8 October repeated full
staging runs (4–5 per day) produced ≈ **98 %** of the account's function invocations.

## Rules
| Where | What | When |
|---|---|---|
| **Local** (`npm run test`, `npm run test:e2e`) | unit + integration + **full** E2E | every change, as often as needed (no cloud cost) |
| **Staging — targeted** | only the spec(s) of the changed subsystem (`npm run test:e2e:staging -- tests/e2e/<spec>.spec.ts …`) | after each staging deploy during development |
| **Staging — full** | the whole E2E suite (`npm run test:e2e:staging`) | ONLY for: a release candidate, a major milestone, an explicit owner request, or a final acceptance gate — **and only if the resource budget allows** |

- Never run the full staging suite repeatedly after small fixes. Fix → full **local** run → deploy once →
  targeted staging specs.
- If a full staging run would materially risk the remaining allowance, record
  `FULL STAGING REGRESSION: DEFERRED — RESOURCE BUDGET PROTECTION` (acceptable when the full local regression
  passed, the targeted staging specs passed and the financial state was verified read-only).
- A staging failure caused by the test runner's own network (e.g. outbound proxy «upstream request failed»,
  no `server: Vercel` header) is documented and re-checked with the **targeted** spec, not by re-running everything.
- Read-only staging checks (A-100016 snapshot, ledger balance, pricing versions) are cheap SQL queries and
  are always run after a deploy.

## Commands
```bash
# targeted staging verification (credentials come from the private staging env file, never from the repo)
E2E_BASE_URL=https://edmn-staging.vercel.app E2E_DB_HTTP=neon E2E_DATABASE_URL=… \
  npm run test:e2e:staging -- tests/e2e/category-menu.spec.ts tests/e2e/live-efficiency.spec.ts

# full staging run (release candidate / owner request only)
E2E_BASE_URL=… npm run test:e2e:staging
```

## Runtime efficiency built into the app (keep it that way)
- Links prefetch on **intent** (hover / focus / touch) via `@/ui/link`, not on viewport entry.
- The live channel uses **one polling leader per account per browser** and a **change token**
  (`live_versions`, maintained by DB triggers): unchanged polls cost one query and return 204.
- The header category tree is cached (tag `nav-categories`, ≤ 5 min, invalidated on Admin category edits).
