# User flows (Customer App — buyer phase)

All decisions (price, fees, shipping, stock, allowed actions, payment state) are the server's. The app shows them.

1. **First run** — splash restores the session (refresh token) → onboarding (once) → home. Signed-in users skip onboarding.
2. **Browse** — home (categories row, Protected Deal banner, featured + latest from the API) · categories grid →
   category products (sort, new/used, pagination) · search (recent searches on device only) · product (variants,
   condition details, return policy notice, seller → public store page, reviews).
3. **Sign in / up** — phone or email + password; register with full name, Egyptian mobile, email, password →
   verify phone code; forgot password never reveals whether the account exists; guests can browse.
4. **Cart** — "أضف" (guest → sign-in, then back) · one group per seller · quantity / delete (with confirmation) ·
   price-changed lines block checkout until "موافق على الأسعار الجديدة" · governorate prices delivery.
5. **Checkout** — address (or add one) → delivery per seller (ETA, fee, "doesn't deliver here") → payment method
   (server list; TEST notice) → confirm (rights notice) → `POST /orders` with ONE checkout key and the total shown.
   If the server's total changed the order is refused, the quote refreshes and the next attempt is a new intent.
6. **Pay** — order screen → "ادفع وارفع الإيصال" → destination (copy) → pick receipt + amount (+ reference) →
   submitted = **under review** (not paid) until EDMN staff confirm on the admin side.
7. **Track** — per-seller vertical timeline from server status/timestamps; delivery, buyer confirmation and money
   release are separate. Actions appear only when the server lists them: cancel unpaid, request cancellation,
   confirm receipt (with confirmation), report problem (not received / product problem).
8. **Reorder** — completed orders → "اطلب تاني" adds the same variants at today's price; unavailable items are reported.
9. **Account** — profile name, phone/email verification, addresses CRUD, payment methods (read-only), change
   password (others signed out), devices (remote sign-out), language AR/EN, legal, sign out.
10. **Not in the app yet** — wallet, Protected Deal, seller center, notifications, support: honest screens.
