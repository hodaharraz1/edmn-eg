# Visual audit — approved board vs. Flutter app

Evidence: `docs/mobile/screenshots/compare/*.webp` (board crop | real Flutter screen talking to the real backend)
and the full buyer run in `docs/mobile/screenshots/buyer/`. Screenshots were taken from a Flutter **web** build of the
same app code at 390×844 (iPhone-class) with Chromium, against a local Next.js backend seeded with demo data —
not from a physical iOS/Android device (see QA_REPORT). No numeric "match %" is claimed.

## Matches (implemented as on the board)

Header gradient + centered white title + white rounded sheet; home header layout (logo + "ماركت", cart and account
circles, "توصيل سريع وآمن", governorate selector, guarantee pill, dark pill search, category icon row with underline);
Protected Deal banner with cyan tag and white "تسوق الآن" pill; "منتجات مميزة" header with diamond icon and "عرض الكل";
product card (image, title, price, outlined "أضف"); 4-item bottom navigation with active light-blue pill; categories
grid tiles; product page (large gallery + dots, title, brand, price, "متوفر" chip, quantity pill, description,
pinned "أضف إلى السلة"); cart (thumbnail, title, price, stepper, delete, subtotal / delivery / highlighted total,
"إتمام الشراء"); checkout stepper العنوان/التوصيل/الدفع/تأكيد, payment-method radio card, order summary, "تأكيد الطلب";
"طلباتي" search, status pills, order cards with thumbnails; vertical tracking (green ✓ done, blue current, gray
pending) and "تفاصيل الطلب"; account profile header + grouped menu with soft icon circles; login (blue curved header
with logo, rounded fields with icons, forgot link, pill button, "أو" divider, create-account link); onboarding (blue,
logo, two-line headline, dots, white "ابدأ الآن", sign-in link).

## Deviations — each one recorded, none decided by preference

| # | Board shows | App does | Why | Decision needed from owner |
|---|---|---|---|---|
| V-01 | "أضمن" wordmark + "ماركت EDMN" | Original logo file (kufic "إضمن" + EDMN) + text "ماركت" in cyan | Only the original logo was supplied; directive forbids redrawing | Supply the official "أضمن ماركت" lockup files if it should differ |
| V-02 | 3D cart/shield illustration in the Protected Deal banner and deal hero | Original emblem | Illustration not among supplied assets | Supply the illustration (would be listed in BRAND doc) |
| V-03 | Colorful 3D category illustrations | Line icons in brand blue mapped from the category's icon field | Not supplied; categories come from the database | Supply per-category artwork or keep icons |
| V-04 | Heart (wishlist) on product cards / product page, share icon | Not shown | No wishlist / share API — a button that does nothing is forbidden | Approve a wishlist API, or remove from the design |
| V-05 | Apple / Google sign-in buttons | Not shown; "تصفح بدون تسجيل" in their place | Backend has no social login | Approve adding OAuth (needs provider keys) |
| V-06 | Mic icon in search | Not shown | No voice search | Remove or approve |
| V-07 | "توصيل مجاني لطلبات القادم عند الشراء بقيمة 499 ج.م أو أكثر" strip | Not shown | Would be a hardcoded promise; free-shipping thresholds are per seller on the server | Approve a server-driven promo strip |
| V-08 | Cart "إضافة كوبون خصم" | Not shown | No coupon API | Approve coupons (backend first) |
| V-09 | Checkout methods: الدفع عند الاستلام / بطاقة بنكية / المحفظة | Only server-enabled methods (InstaPay, Vodafone Cash, bank transfer) with a TEST notice | COD/card/wallet do not exist in the backend; Real Money is OFF | Business decision on COD / card / wallet payments |
| V-10 | "أضمن صفقة" screen styled as a flash-sale (countdown, "أضف إلى السلة") | Screen not built yet (honest "not available yet") | Protected Deal is an escrow flow between two parties, not a flash sale; the board mixes it with marketplace deals | Confirm: deal hub per directive §11, or a marketplace offers page |
| V-11 | Seller stat tiles: المبيعات اليوم 12,430 / الطلبات اليوم 58 / المنتجات 4.8 / التقييم 124 | Tiles: sales today (finance.view only, else orders 30 days) / orders to handle / live products / rating | Board labels/values look swapped (rating 124, products 4.8); "orders today" is not a server metric — the server provides orders awaiting action | Confirm the four tiles |
| V-12 | Back chevron "<" at the left of RTL headers | Back at the start (right) pointing right | Platform RTL convention and iOS back gesture | Confirm |
| V-13 | No TEST banner | Thin amber "وضع تجريبي" strip on top | Mandatory while Real Money is OFF (server flag) | None — disappears when the server enables real money |
| V-14 | Order numbers "#EDMN-45892" | "#100014" | The server's order number format | Change server format if desired |
| V-15 | Header logo larger relative to the header | Slightly smaller logo (48 px) | Fits long Arabic tagline + badge at 360-px widths | Can be enlarged after on-device review |
| V-16 | Wallet quick actions «شحن الرصيد / تحويل رصيد / سجل المعاملات» | «طلب سحب / حسابات الاستلام / سجل المعاملات» on the same blue card + white quick-action card | No top-up or wallet-to-wallet service exists (D28–D31, D34 blocked; owner deferred D34); showing them would be inactive buttons | Restore the two actions if the owner approves a deposit / transfer service |
| V-17 | Yellow TEST strip above every screen | Removed app-wide (owner request, Phase 4); header starts at the status bar as on the board | The TEST state is shown only inside money steps (checkout, payment, deal money, wallet, payout requests) via `EdmnTestMoneyNotice` | — |

## Not yet compared (screens not built)

Protected Deal (all steps), wallet, disputes/returns screens, notifications, support. Seller Center is compared in `compare/seller.webp`. Their
components exist in the design system; screens follow when their APIs exist (HANDOVER).
