# File and Privacy Audit

## 1. Upload pipeline (`storeUpload`)

| Control | Status |
|---|---|
| Magic-byte sniffing (JPEG / PNG / WEBP / PDF only); extension allow-list; SVG/HTML rejected | ✔ |
| Images re-encoded with sharp (strips EXIF **including GPS**, neutralises polyglots) | ✔ |
| Decompression bomb guard (`limitInputPixels` 25M) | ✔ (fixed in this audit) |
| Random UUID storage keys; original names never used as paths | ✔ |
| Visibility derived from purpose (private by default for KYC, proofs, waybills, evidence, payout/refund proofs) | ✔ |
| Size cap = min(setting, deployment cap); staging 4 MB | ✔ |
| Orphan files (uploaded but never attached) are not garbage-collected | OPEN (P3) |

## 2. Private file access

The `/api/files/[id]` rules are listed purpose by purpose in `AUTHORIZATION_MATRIX.md` §3.
- Every purpose is **default-deny**.
- Guessed ids return 404.
- Sensitive purposes are audited when read by staff.
- KYC reads need a step-up within 60 minutes.

## 3. Personal data inventory

| Data | Where | Protection |
|---|---|---|
| National ID number | `sellers` | AES-256-GCM encrypted; masked in UI; reveal = permission + audit |
| KYC scans | private storage | See §2 |
| Payout details (IBAN, wallet, InstaPay) | sellers, external deals | AES-256-GCM; masked display; reveal audited |
| Phone / e-mail | `users` | Visible only to the owner and to staff with customer permissions; never exposed to the other deal party before agreement |
| **Deal locations (address + optional GPS)** | `external_deals.buyer_location_enc` / `seller_location_enc` | AES-256-GCM. GPS rounded to 5 dp (~1 m). Never in URLs, logs or the invitation page. Counterparty sees it only from ACTIVE (payment confirmed). Staff need `deals.view`. Only the governorate is stored in clear (for shipping rates) |
| Customer addresses | `addresses` (+ optional `location_enc`) | Owner and order staff only |
| Payment proofs | private storage | Payer + `payments.view` |
| One-time codes / reset links | `outbound_messages` | HMAC-hashed codes; message bodies redacted after a real send and after 1h |
| Logs | stdout | PII keys redacted (extended in this audit); request id validated |

## 4. Geolocation privacy design

- The browser asks for permission only when the user clicks "استخدام موقعي الحالي". The code calls `getCurrentPosition` once and never `watchPosition`, so there is no tracking.
- `Permissions-Policy: geolocation=(self)`. Third-party frames cannot request location.
- If permission is denied, unsupported, times out, or accuracy is worse than 1 km, the user sees a clear message. The manual address works on its own; GPS never replaces the written address.
- Coordinates travel only in POST bodies of the same-origin form. They are not placed in query strings, analytics or logs.
- **Map provider.** `src/ui/map/provider.ts` is an abstraction; no provider or paid API key is configured or hard-coded. A future provider must load from the CSP allow-list and must not receive coordinates server-side without a DPA.

## 5. Invitation link privacy

- **Invitation page.** It shows only: product, price, fee, delivery expectation, inspection days, special terms, and the buyer's **governorate**. It never shows the buyer's name, phone, e-mail, address or coordinates.
- **Headers.** `Referrer-Policy: no-referrer` and `robots: noindex` on invite and deal pages; `/deal/` is disallowed in `robots.txt`.
- **Token exposure.** The raw token is shown once on the buyer's share screen. It reaches that screen through a short-lived httpOnly cookie, not the URL, so it does not appear in history or server logs as a query parameter.

## 6. Open privacy items

| Item | Severity |
|---|---|
| CSP still allows `'unsafe-inline'` scripts (Next.js runtime); move to nonces | P3 |
| No AAD / key id in the encryption envelope (rotation tooling) | P2 |
| Orphan file cleanup job | P3 |
| Data-retention schedule for closed deals' locations (delete after the dispute window) | P3 — recommended before production |
