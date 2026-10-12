# Database & Private Storage Backup

## Current reality (staging)
- Database: Neon Postgres. Neon point-in-time restore (history retention depends on the Neon plan — OWNER to confirm the plan's window). **Not drilled on Neon yet.**
- Files: `STORAGE_DRIVER=database` on staging → every object (incl. National ID scans, payment proofs, dispute/shipping evidence) lives in `stored_objects` inside the same database, so database backups include private storage. With a future object store, the bucket needs its own versioned backup.

## Objectives — PROPOSED, NOT OWNER-APPROVED
| Objective | Proposal | Evaluation |
|---|---|---|
| RPO database | ≤ 15 min | Achievable with provider WAL-based PITR (Neon). Not achievable with nightly dumps alone. |
| RTO database | ≤ 2 h | Local drill measured dump+restore ≈ 4 s for the E2E dataset (drill record); a production-size provider branch restore + verification + DNS/env switch must be timed by the owner drill. |
| RPO private files | = DB RPO while files live in the DB; with an object store: versioned bucket + daily copy (≤ 24 h) | |
| Retention | PITR ≥ 7 days (prod 30 days PROPOSED); monthly logical dump kept 12 months PROPOSED (legal input) | |

## Backup set
1. Provider PITR (continuous).
2. Logical dump before every schema-changing deploy: `pg_dump --format=custom --no-owner "$DATABASE_URL_UNPOOLED" > edmn-<env>-<date>.dump` — stored encrypted, off-platform, access-limited (contains encrypted KYC data; the key is NOT stored with it).
3. Encryption keys are backed up separately (password manager / KMS) — a dump without its key cannot decrypt National IDs, which is intended.

## Never
Never store a dump in the repository, CI artifacts or chat. Never restore over staging or production.
