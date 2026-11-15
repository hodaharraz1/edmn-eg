# Screen inventory — 140 target IDs (B01–B42 · S01–S33 · D01–D35 · C01–C30)

Status: **Implemented** (own route, wired, tested) · **Reused** · **Merged** (covered inside another route — functions/states kept) · **Missing** · **Blocked by API** · **Blocked by Business Decision**.
"Device" = verified on a physical device: none yet (no device/Xcode/APK in this environment). "Shot" = real screenshot exists in `docs/mobile/screenshots/`.

Baseline (Phase 0, commit `999bec7`): Implemented 38, Merged 17, Missing 78, Reused 1, Blocked by API 1, Blocked by Business Decision 5.

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
| S02 | Seller registration | — | Missing | startApplication/saveBusiness (no mobile route) | — | — |
| S03 | Seller KYC | — | Missing | saveIdentity/uploadSellerDocument | — | — |
| S04 | Store creation | — | Missing | saveStore | — | — |
| S05 | Store branding | — | Missing | saveStore logo | — | — |
| S06 | Application status | /seller (status) | Implemented | me/seller | — | — |
| S07 | Terms acceptance | — | Missing | submitApplication | — | — |
| S08 | Seller dashboard | /seller | Implemented | seller/home | widget+backend | yes |
| S09 | Store profile | — | Missing | updateStoreSettings | — | — |
| S10 | Store settings | — | Missing | updateStoreSettings | — | — |
| S11 | Products list | /seller/products | Implemented | seller/products | backend | yes |
| S12 | Add product | — | Missing | createDraft | — | — |
| S13 | Product images | — | Missing | addImages/removeImage | — | — |
| S14 | Category selection | — | Missing | categories | — | — |
| S15 | Product details form | — | Missing | updateDetails | — | — |
| S16 | Pricing | — | Missing | saveVariants | — | — |
| S17 | Variants | — | Missing | saveVariants | — | — |
| S18 | Inventory | /seller/products stock | Implemented | seller/variants/{id}/stock | backend | yes |
| S19 | Product preview | — | Missing | productForSellerEdit | — | — |
| S20 | Approval status | /seller/products chips | Merged | seller/products | — | yes |
| S21 | Edit product | — | Missing | updateDetails/logistics | — | — |
| S22 | Availability | — | Missing | setListingActive | — | — |
| S23 | Shipping governorates | — | Missing | setShippingRates | — | — |
| S24 | Shipping rates | — | Missing | setShippingRates | — | — |
| S25 | Return policy | — | Missing | updateStoreSettings/logistics | — | — |
| S26 | Seller orders | /seller/orders | Implemented | seller/orders | backend | yes |
| S27 | Seller order details | /seller/orders/:id | Implemented | seller/orders/{id} | widget+backend | yes |
| S28 | Fulfilment | /seller/orders/:id steps | Implemented | seller/orders/{id}/steps | widget+backend | yes |
| S29 | Shipping proof | /seller/orders/:id shipment | Implemented | seller/orders/{id}/shipment | backend | — |
| S30 | Returns & disputes | — | Missing | returnsForSeller/disputesAsRespondent | — | — |
| S31 | Earnings | /seller/funds | Implemented | seller/funds | backend | yes |
| S32 | Withdrawal request | — | Missing | requestWithdrawal (owner approved request-only in §20) | — | — |
| S33 | Withdrawal history | — | Missing | sellerWithdrawals | — | — |
| D01 | Deal hub | /deals stub | Missing | dealsForUser | — | — |
| D02 | How it works | — | Missing | static | — | — |
| D03 | Choose role | — | Missing | createDeal | — | — |
| D04 | Transaction type | — | Missing | createDeal | — | — |
| D05 | Counterparty | — | Missing | saveDealStep | — | — |
| D06 | Invitation | — | Missing | inviteSeller/claimInvitation | — | — |
| D07 | Deal details | — | Missing | saveDealStep/addDealPhotos | — | — |
| D08 | Delivery terms | — | Missing | saveDealStep | — | — |
| D09 | Fees | — | Missing | deal quote (server) | — | — |
| D10 | Review | — | Missing | dealGraph | — | — |
| D11 | Pending approval | — | Missing | dealGraph | — | — |
| D12 | Accept/reject/counter | — | Missing | respondToOffer/submitSellerOffer | — | — |
| D13 | Revision review | — | Missing | termsHistory/respondToChangeRequest | — | — |
| D14 | Deal payment | — | Missing | startDealPayment + proof | — | — |
| D15 | Payment held | — | Missing | dealGraph | — | — |
| D16 | Deal timeline | — | Missing | dealGraph | — | — |
| D17 | Delivery evidence | — | Missing | markDealDelivered | — | — |
| D18 | Delivery OTP | — | Missing | verifyDeliveryOtp/deliveryOtpForBuyer | — | — |
| D19 | Inspection & acceptance | — | Missing | confirmDealReceipt | — | — |
| D20 | Deal dispute | — | Missing | openDispute | — | — |
| D21 | Settlement status | — | Missing | dealGraph | — | — |
| D22 | Completion | — | Missing | dealGraph | — | — |
| D23 | Cancellation/refund | — | Missing | cancelDeal | — | — |
| D24 | Wallet home | /wallet stub | Missing | sellerFinancialView / account withdrawals | — | — |
| D25 | Balance breakdown | /seller/funds (seller) | Merged | seller/funds | backend | yes |
| D26 | Transaction history | — | Missing | ledger statement | — | — |
| D27 | Transaction detail | — | Missing | — | — | — |
| D28 | Add funds | — | Blocked by Business Decision | no deposit service | — | — |
| D29 | Deposit method | — | Blocked by Business Decision | no deposit service | — | — |
| D30 | Deposit instructions | — | Blocked by Business Decision | no deposit service | — | — |
| D31 | Deposit proof | — | Blocked by Business Decision | no deposit service | — | — |
| D32 | Withdrawal | — | Missing | requestAccountWithdrawal/requestWithdrawal | — | — |
| D33 | Payout accounts | — | Missing | addPayoutMethod | — | — |
| D34 | Wallet transfer | — | Blocked by Business Decision | no wallet-to-wallet service | — | — |
| D35 | Wallet result | — | Missing | — | — | — |
| C01 | Inbox | — | Missing | listForUser/listForSeller | — | — |
| C02 | New conversation | — | Missing | openSellerOrderConversation/openDealConversation | — | — |
| C03 | Chat | — | Missing | participantThread/sendMessage | — | — |
| C04 | Attachments | — | Missing | sendMessage attachment | — | — |
| C05 | Media viewer | — | Missing | files/{id} | — | — |
| C06 | Chat details | — | Missing | participantThread | — | — |
| C07 | Chat notifications | — | Missing | unreadForUser | — | — |
| C08 | Report | — | Missing | reportMessage | — | — |
| C09 | Help center | /support stub | Missing | — | — | — |
| C10 | FAQ | — | Missing | CMS content | — | — |
| C11 | Tickets list | — | Missing | myTickets | — | — |
| C12 | Create ticket | — | Missing | openTicket | — | — |
| C13 | Support chat | — | Missing | replyToTicket | — | — |
| C14 | Support attachments | — | Missing | openTicket/replyToTicket | — | — |
| C15 | Ticket detail | — | Missing | ticketThread | — | — |
| C16 | Resolution | — | Missing | rateTicket/reopenTicket | — | — |
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
