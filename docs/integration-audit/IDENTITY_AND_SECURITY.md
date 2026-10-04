# Users & Identity Analysis + Security Comparison

## Part 1 — Identity

| Question | System B (verified) | Legacy |
|---|---|---|
| Primary identifier | `users.id` UUID v4 | NOT INSPECTED (integer auto-increment is common — verify) |
| Login identifiers | email **or** Egyptian mobile; both unique; mobile normalized to E.164 `+201…` | NOT INSPECTED |
| Password hashing | scrypt N=32768, salted, parameters in the stored value | NOT INSPECTED (request hash *prefix* only) |
| Sessions | DB sessions (hashed tokens), web cookies; admin separate scope + TOTP | NOT INSPECTED (mobile app likely uses API tokens) |
| KYC link | sellers → owner user; national ID encrypted on `sellers` | NOT INSPECTED |
| Staff | same `users` table with `is_staff` | NOT INSPECTED (separate admin table possible) |

### Can one real person exist in both? — **Yes, certainly** once B launches

A legacy user who also shops or sells on the marketplace would register again in B unless identity
is shared. Risks:

| Risk | Detail | Severity |
|---|---|---|
| Duplicate accounts | Same phone/email registered in both systems with different passwords | P1 |
| Uniqueness conflict | B enforces unique email and unique phone; legacy may allow duplicates, missing emails, or different phone formats (`010…` vs `+2010…`) | P1 |
| ID collision | UUID (B) vs likely integer (legacy) cannot collide as values, but any code that assumes one ID space will break; reference numbers shown to customers (B: 100000+/500000+) may visually collide with legacy reference numbers | P2 |
| Hash incompatibility | B verifies scrypt only; importing legacy hashes requires algorithm-aware verification | P0 if handled by password reset en masse (account takeover via reset flows / lockouts) |
| KYC detachment | Legacy KYC tied to legacy user ID; B seller KYB tied to B user | P1 |
| Account takeover through merge | Auto-merging by phone/email without proof of control lets an attacker claim another person's account/balance | **P0** |

### Recommended future identity strategy (design only)

1. Add (later, additively) an `identity_links` mapping: `unified_user_id`, `legacy_user_id`,
   `marketplace_user_id`, `linked_at`, `link_method` (verified OTP to phone, verified email,
   admin-reviewed), `linked_by`.
2. **Never auto-merge.** Link only after the person proves control of the shared phone/email (OTP)
   in both systems, or after admin review with evidence.
3. Preserve legacy credentials: import hash + algorithm tag; verify with the legacy algorithm; rehash
   to scrypt on successful login. No forced global password reset.
4. Legacy remains source of truth for legacy identities and KYC until cut-over is approved.
5. Duplicate report before any link: count of phones/emails present in both systems (normalized).

## Part 2 — Security comparison

Legacy column: NOT INSPECTED unless stated. Findings are documented only (no fixes in this task).

| Control | System B | Legacy | Finding |
|---|---|---|---|
| Password hashing | scrypt | UNKNOWN | — |
| Session / token strategy | DB sessions, hashed tokens, HttpOnly/SameSite/Secure | UNKNOWN | — |
| Admin 2FA | Mandatory TOTP, single-use, step-up for high-risk actions | UNKNOWN | **P1 (provisional):** if legacy admins handling money lack 2FA, linking systems widens blast radius |
| Authorization / RBAC | Server-side in every domain function; 43 staff permissions; maker/checker | Roles/permissions reported | UNKNOWN |
| IDOR protection | Ownership checks, uniform not-found (tested) | UNKNOWN | — |
| CSRF | Server Actions origin checks + SameSite | UNKNOWN | — |
| XSS | React escaping, CSP | UNKNOWN | — |
| Rate limiting | DB fixed windows on auth | Admin login page is behind Cloudflare (verified); app-level limits UNKNOWN | — |
| File security | Private storage, authorization per file purpose | UNKNOWN | **P0 (provisional):** KYC documents must be verified as non-public in legacy storage |
| Encryption at rest | AES-256-GCM for national ID, payout details, TOTP | UNKNOWN | — |
| Audit logging | Append-only (DB triggers) | "Activity logs" reported; mutability UNKNOWN | P1 if logs are editable |
| Secret management | env validation, refuses placeholders in prod | UNKNOWN | — |
| Financial action protection | exactly-once, locks, dual control | UNKNOWN | P0 checks required (idempotency, concurrency) |
| Admin exposure | Planned `admin.` host + optional IP allow-list | Admin dashboard publicly reachable at `api.edmneg.com/adminDashboard/login` on the same host name as the API (verified) | **P2:** recommend separating admin from the public API host and restricting by IP/VPN |
| Public product/legal claims | Legal pages are drafts, clearly marked | Marketing site claims "insured", "officially licensed escrow account", "bank-grade encryption", named bank/fintech partners | **P1 legal/compliance:** claims must be verified by counsel before being carried into the unified platform |

### System B self-findings carried into the risk register
- CSP allows inline scripts (P3); no PDF malware scanning (P2); app-level rate limiting only (P3);
  no mobile/API authentication (integration P1).
