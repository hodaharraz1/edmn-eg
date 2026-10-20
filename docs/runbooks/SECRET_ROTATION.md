# Secret Rotation

## Inventory (names only — values never written anywhere)
| Id | Secret | Where | Status |
|---|---|---|---|
| S7 | Vercel deploy token | pasted in chat during setup | **ROTATE** (exposed outside Git) |
| S8 | Neon API key / connection credentials | pasted in chat | **ROTATE** |
| S9 | Render API key | pasted in chat | **ROTATE** |
| S10 | Hugging Face token | pasted in chat | **ROTATE** |
| S6 | SESSION_SECRET, DATA_ENCRYPTION_KEY, CRON_SECRET, STAGING_* (staging) | Vercel env (encrypted) | never reuse in production |
| — | SMTP_PASSWORD, SMS_HTTP_TOKEN, VAPID_PRIVATE_KEY, PAYMENT_WEBHOOK_SECRET, ERROR_TRACKING_DSN, MALWARE_SCANNER_TOKEN | future providers | create fresh per environment |

Batch 2 leak scan: `npx tsx scripts/secret-scan.ts` (tree) and `--history` (all commits) → 0 findings; the exact S7–S10 values, the staging DB URL and CRON_SECRET were also checked against full history: 0 occurrences. History is never rewritten automatically.

## S7–S10 (OWNER ACTION)
Revoke in each provider console → issue new → update only where needed (Vercel env / CI secret store) → confirm the old token returns 401.

## Application secrets
- SESSION_SECRET / CRON_SECRET: replace; all sessions and one-time codes become invalid (acceptable during a maintenance window).
- DATA_ENCRYPTION_KEY (versioned key ring, `src/server/core/crypto.ts`):
  1. Generate a new 32-byte key (`openssl rand -base64 32`) with a new id (e.g. `k2026a`).
  2. Deploy: `DATA_ENCRYPTION_KEY=<new>`, `DATA_ENCRYPTION_KEY_ID=k2026a`, `DATA_ENCRYPTION_KEYS_PREVIOUS=<oldid>:<old>` (v1 data without id is tried against previous keys automatically).
  3. New ciphertexts are written `v2.k2026a.…`; historical KYC/payout data stays readable.
  4. Optional re-wrap: `npx tsx scripts/reencrypt.ts` (dry run) → `--apply` (row by row, round-trip verified; immutable versioned rows are reported, they stay readable via the previous key).
  5. Only after re-wrap shows 0 stale rows may the old key be removed.
- **Never change DATA_ENCRYPTION_KEY in place under the same id**: the runtime fingerprint (`secret_fingerprints`) detects it and blocks money movements (VIOLATION).
