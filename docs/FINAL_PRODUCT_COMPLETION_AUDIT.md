# EDMN Marketplace — Final Product Completion & Launch Closure Audit

Audit of the whole product as one system, after Batch 1, 1.5 and 2. Every code-controlled launch blocker found was fixed in this pass (tests added). Nothing external was created, no DNS was touched, real money stays OFF, the Fee Engine, pricing, A-100016 and history were not changed.

## 1. How the audit was done (evidence, not opinion)
| Method | Coverage | Result |
|---|---|---|
| Route inventory (static) | 165 routes: 150 pages + 15 route handlers | 156 COMPLETE · 6 PARTIAL (fixed or documented below) · 2 legacy/redirect · 1 placeholder (payment webhook, no provider) · 0 BROKEN |
| Automated crawler (`tests/e2e/_audit-crawl.spec.ts`, explicit tool) | Anonymous, customer, seller, admin; BFS over real links; 229 pages / 151 route patterns; every pattern at 1440 / 1024 / 390 / 360 px | 0 non-2xx pages · 0 broken internal links · 1 hydration error (fixed) · 3 overflow spots on 2 admin pages (fixed) |
| Security review of every server action + route handler | ~170 actions / handlers | 0 P0 · 0 P1 · 2 P2 · 16 P3 — all code-controlled items fixed (§6) |
| Arabic copy review | All customer / seller screens, status labels, notification templates, validation messages | 7 raw-code leaks + 17 misleading-money wordings fixed; terminology standardized |
| SEO / domain / legal / email review | metadata, sitemap, JSON-LD, cookies, links, 13 legal documents, 57 email events | Fixed: relative email links, structured data, canonicals, sitemap cap, legal rendering, contact page |

## 2. Fixed in this pass (code-controlled)
**Security**
- F-1 (P2) Maker/Checker bypass via staff creation: the creator no longer sets the password (random password + 72 h invitation link, the person enrolls their own 2FA); any role carrying a money permission is now privileged (SUPER_ADMIN only, explicit confirmation + reason).
- F-2 (P2) Admin isolation: new `ENFORCE_ADMIN_HOST` (admin console on admin.edmneg.com, Seller Center stays on www/seller); PRODUCTION refuses to boot unless admin is on its own host.
- F-3 revoking a financial approval needs `finance.controls`, a 10-char reason, and never your own approval. F-4 declining a Maker request needs the Checker permission of that movement kind.
- F-5 staff accounts cannot enroll 2FA from a seller/web session. F-6 store members: staff accounts refused, one active store per member, deterministic store selection, the added person is notified.
- F-7 support tickets may reference only the requester's own order / deal / payment / withdrawal; a SUPPORT message-access grant also requires the ticket to come from a conversation party.
- F-8 staff need an active purpose-bound grant to download message attachments. F-9 store members need an order/returns role for evidence and disputes.
- F-10 Delivery OTP: lifetime budget of 30 guesses per deal across all codes. F-11 step-up to record a carrier delivery event / establish delivery. F-12 step-up + self-dealing guard on "refund transfer failed".
- F-13 per-user limits on uploads, ticket creation, deal creation, review reports (and the review must exist). F-14 manual settlement run: step-up + the triggering admin audited. F-15 withdrawal request requires its idempotency key. F-16 CSV export of personal data: step-up + per-admin limit. F-18 narrower push endpoint allow-list, stricter internal-link check.

**Product / launch**
- Public website vs transactions: production with real money OFF (or maintenance mode ON) refuses new orders, deal invitations and deal payments with a clear banner; browsing, registration, identity, seller onboarding, support, existing orders/deals and history keep working (`src/server/ops/commerce-gate.ts`). The "maintenance mode" setting now actually works.
- SMS no longer blocks boot: without a real SMS provider in production, mobile verification and Protected Deals are refused with a clear message, and no SMS/email is ever marked SENT through the log driver in production.
- Emails: every link is absolute (APP_URL), every notification email has a footer (notification settings + help); password-reset / verification / staff-invite emails have their own subjects; production refuses a placeholder `MAIL_FROM`.
- Public contact page `/contact` and footer: contact details come only from owner-filled settings (nothing invented); all customer policies linked; company legal details shown when the owner fills them.
- Legal pages: the draft note renders as a note (no literal `>`); the seed never replaces a version an admin published.
- SEO: Organization + WebSite (SearchAction) JSON-LD, canonicals on home / sell / legal / CMS pages, descriptions, product Open Graph keeps site name + locale, sitemap capped below 50,000 URLs and includes /legal and /contact.
- `/sell` no longer shows the legacy commission table (it priced nothing); it links to the fees policy. Display only — pricing untouched.
- Product page hydration error (invalid `<p>` nesting) fixed; admin shipping / reconciliation overflow fixed.
- Ops page: dead-letter messages listed with an audited "requeue" (non-secret only). Withdrawal confirmation reads the SLA setting (no hardcoded 48 h). No unverifiable "thousands of products" claim.
- Arabic: Zod validation messages in Arabic; raw enum codes no longer shown (seller status, shipment problems, moderation history, payout channel, refund statuses, statement references); misleading money wording corrected everywhere (receipt ≠ payout, approved refund ≠ paid refund, settlement creates a request, not a transfer); terminology standardized (إرجاع / استرداد / مستحقات / بيانات استلام الأموال).

## 3. Upload inventory
| Upload | Allowed | Max | Visibility / class | Download authorization | Scanner (production) |
|---|---|---|---|---|---|
| Product / used-product photos, store logo/banner, CMS, review photos | JPG/PNG/WEBP (re-encoded to WEBP, EXIF stripped) | admin setting ≤ `UPLOAD_MAX_IMAGE_MB` (8) | PUBLIC | `/media` (public) | not gated (re-encoded raster) |
| National ID front/back | images only | 8 MB | HIGHLY_SENSITIVE | owner, or identity reviewer + 2FA ≤ 1 h; audited | required (quarantine until CLEAN) |
| Seller documents (legacy) | images / PDF | 8 / 10 MB | HIGHLY_SENSITIVE | owner, or `sellers.documents.view` + 2FA ≤ 1 h; audited | required |
| Payment proof | images / PDF | 8 / 10 MB | HIGHLY_SENSITIVE | submitter, `payments.view`; audited | required |
| Withdrawal / refund proof | images / PDF | 8 / 10 MB | HIGHLY_SENSITIVE | owner, finance permissions; audited | required |
| Shipping waybill, delivery evidence | images / PDF | 8 / 10 MB | PRIVATE | parties (store order/returns roles), `shipping.view` | required |
| Dispute / return / deal evidence | images / PDF | 8 / 10 MB | PRIVATE | parties, dispute/return/deal staff | required |
| Support attachment | images / PDF | 8 / 10 MB | PRIVATE | requester, `support.manage` | required |
| Message attachment | images | 8 MB | PRIVATE | conversation parties; staff only with an active purpose grant | required |
All: magic-byte type detection (never the client MIME), extension allow-list, original filename display-only, path-traversal-safe keys, private files only via `/api/files/[id]` (uniform 404, `no-store`, sandbox CSP), per-user upload limits. **MALWARE SCANNER ACTIVE: NO.** Retention classes: `src/server/ops/retention.ts`.

## 4. SMS dependency (verified in code)
| Flow | Needs SMS? |
|---|---|
| Browsing, search, product/store pages, legal | No |
| Registration / login / password reset (email) | No (email) |
| Buyer identity verification (National ID upload) | No |
| Buyer checkout (Marketplace) | No |
| Mobile verification → Marketplace seller onboarding | **Yes** |
| Protected Deal (seller mobile verification + Delivery OTP) | **Yes** |
**Conclusion:** SMS does not block the public website or a buyer-only pilot; it blocks new sellers and Protected Deals.

## 5. English
**NOT IMPLEMENTED.** A 19-key header dictionary exists but no locale switch, no `en` routes, `<html lang="ar" dir="rtl">` fixed. Arabic V1 is complete; English is a separate project.

## 6. Legal pages
| Document | Code | Content |
|---|---|---|
| Terms of use, Privacy (incl. KYC disclosure), Cookies, Prohibited products, Review policy | CODE COMPLETE | v1.0 owner-approved — **NEEDS LAWYER REVIEW** |
| Buyer terms, Seller agreement, Returns & refunds, Shipping, Disputes, Protected Deal terms, Fees, Data deletion | CODE COMPLETE (versioned, acceptance recorded) | v1.1/1.2 **DRAFT** shown with a review notice — **NEEDS LAWYER REVIEW** |
| Contact | CODE COMPLETE (`/contact`) | details = OWNER INPUT |
| Separate refund policy | combined in Returns & refunds | lawyer decides |
| Cookie banner | not needed today (strictly necessary cookies only) | lawyer confirms |

## 7. Domain readiness
Recommended launch: `https://www.edmneg.com` for buyers and the Seller Center (`/seller`), `https://admin.edmneg.com` for the admin console (`ENFORCE_ADMIN_HOST=true`). Code is ready for it (cookies host-only per surface, nonce CSP on admin, absolute links from APP_URL, shared assets served on every host). A separate seller.edmneg.com is supported but means a second login; not recommended for launch. DNS not touched.

## 8. Owner input required (exact)
Company legal name · commercial registration number · tax registration number · registered address · support email · support phone · WhatsApp number · business hours · social profile links · `MAIL_FROM` sender name/address on the real domain · VAPID contact (`VAPID_SUBJECT`) · SMS sender ID (NTRA registration) · real payment/payout destinations · pilot allow-list and caps (if a pilot) · incident severity sign-off + on-call roster · retention periods (with counsel).

## 9. Manual tests required
Real-device push (Chrome/Edge desktop, Android Chrome) · Safari/iPhone, Firefox, Edge rendering · real email delivery + spam placement once SMTP is live · real SMS delivery once SMS is live · provider restore drill (Neon branch) · malware scanner EICAR test · admin host login after DNS · screen-reader pass (NVDA/VoiceOver) on checkout and identity.
