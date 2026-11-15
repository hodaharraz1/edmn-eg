# Screen inventory — 140 target IDs (B01–B42 · S01–S33 · D01–D35 · C01–C30)

Status: **Implemented** (own route, wired, tested) · **Reused** · **Merged** (covered inside another route — functions/states kept) · **Missing** · **Blocked by API** · **Blocked by Business Decision**.
"Device" = verified on a physical device: none yet (no device/Xcode/APK in this environment). "Shot" = real screenshot exists in `docs/mobile/screenshots/`.

Baseline (Phase 0, commit `999bec7`): Implemented 38, Merged 17, Missing 78, Reused 1, Blocked by API 1, Blocked by Business Decision 5.

After Phase 2 (Protected Deal): Blocked by API 1, Blocked by Business Decision 5, Implemented 67, Merged 32, Missing 33, Reused 2.
After Phase 3 (Messaging & Support): Blocked by API 1, Blocked by Business Decision 5, Implemented 77, Merged 38, Missing 17, Reused 2.

| ID | Screen | Route | Status | API / service | Tests | Shot |
|---|---|---|---|---|---|---|
| B01 | Splash | /splash | Implemented | boot refresh | widget | yes |
| B02 | Onboarding intro | /onboarding p1 | Implemented | — | — | yes |
| B03 | Onboarding protection | /onboarding p2-3 | Merged | — | — | yes |
| B04 | Sign in | /sign-in | Implemented | auth/login | widget+backend | yes |
| B05 | Register | /register | Implemented | auth/register | backend | — |
| B06 | OTP verification | /verify | Implemented | me/verification/* | backend | — |
| B07 | Forgot password | /forgot-password | Implemented | auth/password/forgot | backend | — |
| B08 | Reset password | — | Missing | auth/password/reset (API exists; needs deep-link screen) | backend | — |
| B09 | Marketplace home | / | Implemented | catalog | widget | yes |
| B10 | Location selection | governorate sheet + addresses | Merged | governorates | — | yes |
| B11 | Categories | /categories | Implemented | catalog/categories | — | yes |
| B12 | Subcategories | /categories/:id | Implemented | catalog | — | — |
| B13 | Search | /search | Implemented | catalog/products?q | — | yes |
| B14 | Search filters | /search pills | Merged | sort/condition | — | yes |
| B15 | Search results | /search | Merged | catalog | — | yes |
| B16 | Product listing | /categories/:id, /search | Reused | catalog (paginated) | — | — |
| B17 | Product details | /products/:slug | Implemented | catalog/products/{slug} | widget | yes |
| B18 | Product gallery | gallery in B17 (zoom missing) | Merged | — | — | yes |
| B19 | Product reviews | reviews in B17 | Merged | …/reviews | — | yes |
| B20 | Public seller store | /stores/:slug | Implemented | stores/{slug} | backend | yes |
| B21 | Store products | /stores/:slug | Merged | catalog?storeSlug | backend | yes |
| B22 | Wishlist | — | Blocked by API | no wishlist API | — | — |
| B23 | Cart | /cart | Implemented | cart | widget+backend | yes |
| B24 | Cart validation | /cart issues | Merged | cart, acknowledge-prices | backend | yes |
| B25 | Checkout address | /checkout step 1 | Implemented | checkout, addresses | widget | yes |
| B26 | Checkout shipping | /checkout step 2 | Implemented | checkout | widget | yes |
| B27 | Checkout payment | /checkout step 3 | Implemented | checkout | widget | yes |
| B28 | Checkout review | /checkout step 4 | Implemented | checkout | widget | yes |
| B29 | Order confirmation | /orders/:id?placed=1 | Implemented | POST orders (checkoutKey) | widget+backend | yes |
| B30 | Payment instructions | /payments/:id | Implemented | payments/{id} | widget | yes |
| B31 | Upload receipt | /payments/:id | Implemented | payments/{id}/proof | widget+backend | yes |
| B32 | Payment verification status | /payments/:id, /orders/:id | Merged | payments/{id} | widget | yes |
| B33 | My orders | /orders | Implemented | orders | widget | yes |
| B34 | Order details | /orders/:id | Implemented | orders/{id} | widget+backend | yes |
| B35 | Shipment tracking | /orders/:id timeline | Merged | orders/{id} | — | yes |
| B36 | Delivery confirmation | /orders/:id action | Merged | seller-orders/{id}/confirm-receipt | widget+backend | — |
| B37 | Reorder | /reorder | Implemented | orders + cart | — | yes |
| B38 | Cancel / request cancellation | /orders/:id actions | Merged | orders/{id}/cancel, cancellation-request | backend | — |
| B39 | Return request | — | Missing | service requestReturn (no mobile route) | — | — |
| B40 | Return tracking | — | Missing | returnGraph (no mobile route) | — | — |
| B41 | Buyer rating | — | Missing | createProductReview/createSellerReview (no mobile route) | — | — |
| B42 | Transaction result | inline notices | Merged | — | — | — |
| S01 | Become a seller | /seller (not-a-seller) | Implemented | me/seller | widget | — |
| S02 | Seller registration | /seller/apply | Implemented | startApplication/saveBusiness via /seller/application* | backend flow | yes |
| S03 | Seller KYC | /account/identity + application identity | Implemented | /me/identity, PUT /seller/application/identity | backend flow | yes |
| S04 | Store creation | /seller/apply (store step) | Implemented | POST /seller/application/store | backend flow | — |
| S05 | Store branding | /seller/apply (logo) | Merged | store logo multipart (banner: web only) | — | — |
| S06 | Application status | /seller, /seller/apply | Implemented | /me/seller, /seller/application | widget | yes |
| S07 | Terms acceptance | /seller/apply (submit) | Implemented | POST /seller/application/submit | backend flow | — |
| S08 | Seller dashboard | /seller | Implemented | seller/home | widget+backend | yes |
| S09 | Store profile | /seller/store | Implemented | GET/PUT /seller/store | backend flow | yes |
| S10 | Store settings | /seller/store | Merged | storeSettings | backend flow | yes |
| S11 | Products list | /seller/products | Implemented | seller/products | backend | yes |
| S12 | Add product | /seller/products/new | Implemented | POST /seller/products | backend flow | yes |
| S13 | Product images | /seller/products/:id/edit (photos) | Implemented | POST/DELETE …/images | backend flow | yes |
| S14 | Category selection | /seller/products/new (category) | Implemented | catalog categories + attributes | backend flow | yes |
| S15 | Product details form | /seller/products/:id/edit (details) | Implemented | PUT …/details | backend flow | yes |
| S16 | Pricing | /seller/products/:id/edit (price) | Implemented | PUT …/variants | backend flow | yes |
| S17 | Variants | /seller/products/:id/edit (variants) | Implemented | PUT …/variants | backend flow | yes |
| S18 | Inventory | /seller/products stock | Implemented | seller/variants/{id}/stock | backend | yes |
| S19 | Product preview | editor "عرض كمشتري" + submission problems | Merged | GET /seller/products/{id} | backend flow | yes |
| S20 | Approval status | /seller/products, editor status | Implemented | GET /seller/products/{id} | backend flow | yes |
| S21 | Edit product | /seller/products/:id/edit | Implemented | details/logistics/variants | backend flow | yes |
| S22 | Availability | editor show/hide | Implemented | POST …/visibility | backend flow | yes |
| S23 | Shipping governorates | /seller/shipping | Implemented | GET/PUT /seller/shipping-rates | backend flow | yes |
| S24 | Shipping rates | /seller/shipping | Implemented | PUT /seller/shipping-rates | backend flow | yes |
| S25 | Return policy | /seller/store + editor return policy | Implemented | PUT /seller/store, …/logistics | backend flow | yes |
| S26 | Seller orders | /seller/orders | Implemented | seller/orders | backend | yes |
| S27 | Seller order details | /seller/orders/:id | Implemented | seller/orders/{id} | widget+backend | yes |
| S28 | Fulfilment | /seller/orders/:id steps | Implemented | seller/orders/{id}/steps | widget+backend | yes |
| S29 | Shipping proof | /seller/orders/:id shipment | Implemented | seller/orders/{id}/shipment | backend | — |
| S30 | Returns & disputes | — | Missing | returnsForSeller/disputesAsRespondent | — | — |
| S31 | Earnings | /seller/funds | Implemented | seller/funds | backend | yes |
| S32 | Withdrawal request | /seller/payouts (request sheet) | Implemented | POST /seller/payout-requests(+preview) | backend flow + widget | yes |
| S33 | Withdrawal history | /seller/payouts | Implemented | GET /seller/payout-requests, cancel | backend flow + widget | yes |
| D01 | Deal hub | /deals | Implemented | GET /deals | widget | yes |
| D02 | How it works | /deals (sheet) | Merged | static (server rules in copy) | — | yes |
| D03 | Choose role | /deals: «صفقة جديدة» (buyer) / «معايا رابط دعوة» (seller) | Merged | buyer-initiated domain: seller joins by link | — | yes |
| D04 | Transaction type | /deals/new step 1 (condition NEW/USED) | Merged | PUT /deals/{id}/steps/1 | backend | yes |
| D05 | Counterparty | /deals/new step 4 (seller name/phone) | Merged | PUT /deals/{id}/steps/5 | backend (seeded via HTTP) | — |
| D06 | Invitation | /deals/:id invite + /deals/join | Implemented | POST invitation / refresh / revoke; POST /deal-invitations/claim | widget+backend | yes |
| D07 | Deal details | /deals/new step 1 | Implemented | PUT steps/1; photos: POST /deals/{id}/photos (API only — picker not in wizard yet) | backend | yes |
| D08 | Delivery terms | /deals/new step 3 | Merged | PUT steps/3, steps/4 | backend | yes |
| D09 | Fees | /deals/:id money card | Merged | money.basis INDICATIVE/OFFER/AGREED (server) | widget+backend | yes |
| D10 | Review | /deals/new step 5 → /deals/:id | Merged | GET /deals/{id} | — | — |
| D11 | Pending approval | /deals/:id status + timeline | Merged | GET /deals/{id} | widget | yes |
| D12 | Accept/reject/counter | /deals/:id buyer actions; seller offer sheet | Implemented | POST offer, offer-response | widget+backend | yes |
| D13 | Revision review | /deals/:id terms history + change response | Implemented | terms.history; POST change-response | backend | yes |
| D14 | Deal payment | /deals/:id → /payments/:id | Reused | POST /deals/{id}/payment + payments proof | backend | — |
| D15 | Payment held | /deals/:id status ACTIVE | Merged | GET /deals/{id} | backend | — |
| D16 | Deal timeline | /deals/:id | Implemented | GET /deals/{id} | widget | yes |
| D17 | Delivery evidence | /deals/:id seller ship sheet | Implemented | POST /deals/{id}/shipped (note + proof) | backend | — |
| D18 | Delivery OTP | /deals/:id code sheet (buyer) / verify (seller) | Implemented | GET delivery-code, POST verify, regenerate | widget+backend | — |
| D19 | Inspection & acceptance | /deals/:id confirm receipt | Implemented | POST confirm-receipt | backend | — |
| D20 | Deal dispute | /deals/:id «not received» | Merged | POST not-received; full dispute UI → Phase 5 | backend | — |
| D21 | Settlement status | /deals/:id status/timeline | Merged | GET /deals/{id} (release is staff-only) | backend | — |
| D22 | Completion | /deals/:id COMPLETED | Merged | GET /deals/{id} | — | — |
| D23 | Cancellation/refund | /deals/:id cancel; refund status read-only | Implemented | POST cancel; refund by staff only | backend | — |
| D24 | Wallet home | /wallet stub | Missing | sellerFinancialView / account withdrawals | — | — |
| D25 | Balance breakdown | /seller/funds (seller) | Merged | seller/funds | backend | yes |
| D26 | Transaction history | — | Missing | ledger statement | — | — |
| D27 | Transaction detail | — | Missing | — | — | — |
| D28 | Add funds | — | Blocked by Business Decision | no deposit service | — | — |
| D29 | Deposit method | — | Blocked by Business Decision | no deposit service | — | — |
| D30 | Deposit instructions | — | Blocked by Business Decision | no deposit service | — | — |
| D31 | Deposit proof | — | Blocked by Business Decision | no deposit service | — | — |
| D32 | Withdrawal | — | Missing | requestAccountWithdrawal/requestWithdrawal | — | — |
| D33 | Payout accounts | /seller/apply payout account | Merged | POST /seller/application/payout-account (seller); buyer payout accounts: no API | backend flow | — |
| D34 | Wallet transfer | — | Blocked by Business Decision | no wallet-to-wallet service | — | — |
| D35 | Wallet result | — | Missing | — | — | — |
| C01 | Inbox | /messages, /seller/messages | Implemented | GET /conversations, /seller/conversations | widget+backend | yes |
| C02 | New conversation | «مراسلة البائع/المشتري» on order, seller order, deal | Implemented | POST /seller-orders/{id}/conversation, /seller/orders/{id}/conversation, /deals/{id}/conversation | backend | — |
| C03 | Chat | /messages/:id, /seller/messages/:id | Implemented | GET thread, POST messages (clientKey), POST seen | widget+backend | yes |
| C04 | Attachments | chat composer (≤3, image/PDF) | Merged | POST messages multipart | backend | — |
| C05 | Media viewer | image tap → zoom dialog | Merged | GET /files/{id} (parties only) | backend | — |
| C06 | Chat details | context header (order/deal link) in chat | Merged | thread.link / ref / title | widget | yes |
| C07 | Chat notifications | unread badges in inbox | Merged | unread counts; device push → Phase 6 | backend | yes |
| C08 | Report | long-press a message → sheet | Implemented | POST /conversations/messages/{id}/report | backend | yes |
| C09 | Help center | /support | Implemented | GET /support/tickets | widget | yes |
| C10 | FAQ | /pages/faq | Implemented | GET /content/pages/{slug} (admin CMS; 404 when not published) | backend | — |
| C11 | Tickets list | /support «تذاكري» | Merged | GET /support/tickets | widget | yes |
| C12 | Create ticket | /support/new (prefilled from order/deal) | Implemented | POST /support/tickets (own related id only) | backend | yes |
| C13 | Support chat | /support/:id replies | Implemented | POST /support/tickets/{id}/replies | backend | yes |
| C14 | Support attachments | new ticket / reply (1 file) | Merged | multipart attachment; GET /files/{id} | backend | — |
| C15 | Ticket detail | /support/:id | Implemented | GET /support/tickets/{id} (no internal notes, staff unnamed) | widget+backend | yes |
| C16 | Resolution | /support/:id rate / reopen | Implemented | POST rating, POST reopen | widget+backend | — |
| C17 | Disputes list | — | Missing | disputesForUser | — | — |
| C18 | Open dispute | — | Missing | openDispute | — | — |
| C19 | Dispute evidence | — | Missing | addDisputeMessage | — | — |
| C20 | Dispute conversation | — | Missing | disputeGraph | — | — |
| C21 | Dispute timeline | — | Missing | disputeGraph | — | — |
| C22 | Dispute decision | — | Missing | disputeGraph | — | — |
| C23 | Account home | /account | Implemented | me | widget | yes |
| C24 | Edit profile | /account/profile | Implemented | PATCH me | backend | — |
| C25 | Addresses & contact | /account/addresses | Implemented | me/addresses | backend | yes |
| C26 | Security | /account/security, /account/devices | Implemented | me/password, me/sessions | widget+backend | yes |
| C27 | Notifications center | /notifications stub | Missing | notifications table / markRead | — | — |
| C28 | Preferences & language | language in /account | Merged | prefsFor/savePrefs | widget | yes |
| C29 | Legal & privacy | /legal/:slug | Implemented | content/legal | — | — |
| C30 | Deletion & logout | logout in /account | Merged | logout; deletion API missing | — | — |

The 87-page Figma PDF was not provided to this environment; `FIGMA_87_PAGE_MAPPING.md` holds the page table template.
