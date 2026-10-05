# Secret Exposure Register

Rule applied: **any real secret that has ever been committed is treated as compromised.** This register lists the type, location, status and whether rotation is required. **Values are never printed here.**

## 1. Method

- Full Git history scan (all commits, all branches pushed). It used pattern matching for:
  - provider token prefixes (Vercel, Neon, GitHub, Render, Hugging Face, AWS, Stripe-like `sk_`);
  - PEM blocks and `postgres://user:pass@` URLs;
  - high-entropy strings in `.env*`, configs, seeds and tests.
- A review of `.gitignore`, `.env.example`, seed files, E2E helpers and CI config.
- Production dependency audit: `npm audit --omit=dev` → 0 vulnerabilities. Nine dev-only advisories (eslint-config-next, drizzle-kit/esbuild) do not ship.

## 2. Register

| # | Type | Location | Status | Rotation required |
|---|---|---|---|---|
| S1 | Demo customer/seller password | `src/server/db/seed/demo.ts`, `tests/e2e/helpers.ts` (history: since the first commit) | Public by design for local development. **Treated as compromised.** Staging refuses repository defaults; staging uses env-provided values | YES — never use on staging/production (enforced) |
| S2 | Demo admin password | same files | As S1 | YES — enforced |
| S3 | Demo admin TOTP secret | same files | As S1. Staging TOTP secrets come from env | YES — enforced |
| S4 | `.env.example` placeholders | repository root | Placeholders only (no real values) | NO |
| S5 | Staging `DATABASE_URL` (Neon) | Vercel encrypted env only; **never committed** | Not in Git | NO (not exposed via Git). See S8 |
| S6 | `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, `STAGING_*` credentials (staging) | Vercel encrypted env only; **never committed** | Not in Git | NO (Git); rotate before production per §3 |
| S7 | Vercel deploy token | **Pasted in chat during setup; never committed** | Exposed outside Git | **YES** |
| S8 | Neon API key / connection credentials | **Pasted in chat during setup; never committed** | Exposed outside Git | **YES** |
| S9 | Render API key | **Pasted in chat during setup; never committed** | Exposed outside Git | **YES** |
| S10 | Hugging Face token | **Pasted in chat during setup; never committed** | Exposed outside Git | **YES** |

**Git history result: no real secret has ever been committed.** S1–S3 are intentionally public development defaults; the application refuses them on staging.

## 3. Rotation procedure (before any production launch)

1. Revoke and re-issue S7–S10 in each provider's console. Update the Vercel / CI environment.
2. Generate new production `SESSION_SECRET` and `CRON_SECRET`. Rotating `SESSION_SECRET` invalidates all sessions and one-time codes, which is acceptable at launch.
3. Use a **new** `DATA_ENCRYPTION_KEY` for production; never reuse the staging key. Staging data is never copied to production. Re-encryption tooling with a key id is tracked as FP-F5.
4. Create production admin accounts fresh, with in-person TOTP enrollment (AUTH-03).
5. Re-run the history scan before making the repository or a fork public.
