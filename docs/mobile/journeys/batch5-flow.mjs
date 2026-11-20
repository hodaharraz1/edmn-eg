// Batch 5 journeys on the Customer App's Flutter web build against the LOCAL server (edmn_device demo DB, Real Money OFF).
// Buyer and seller act ONLY through the real UI. EDMN staff steps (payment confirmation) run through staff-step.ts, which
// calls the same service as the web console; refunds and releases stay with EDMN and are only checked to NOT happen.
//   F   seller shipping rates: list, add, modify, validation, persistence, ownership, error handling
//   BA  buyer creates an order and views it (list + details)          BC  buyer cancels: unpaid order, then a paid one
//   BB  buyer tracks the shipment and confirms delivery (seller fulfils through the UI)
//   G   seller inbox: buyer writes from the order, seller reads and replies, buyer sees the reply
//   BD  buyer return request → BE seller rejects → buyer escalates to EDMN
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { apiAs, check, results, session, sql, staff } from './harness.mjs';

const OUT = process.env.OUT ?? 'docs/mobile/screenshots/batch5';
const ONLY = (process.env.JOURNEYS ?? 'F,BA,BC,BB,G,BD').split(',');
const BUYER = process.env.JOURNEY_BUYER ?? 'mona@demo.edmn.local';
const OTHER_BUYER = 'omar@demo.edmn.local';
const SELLER = 'techzone@demo.edmn.local';
const OTHER_SELLER = 'homestyle@demo.edmn.local';
const PW = 'Demo@12345';
const st = {};

(async () => {
  mkdirSync(OUT, { recursive: true });
  const img = `${OUT}/photo.jpg`;
  writeFileSync(img, await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f6f8b' } }).jpeg().toBuffer());
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const buyerId = sql(`select id from users where email='${BUYER}'`);
  const sellerUid = sql(`select id from users where email='${SELLER}'`);
  const sellerId = sql(`select id from sellers where owner_user_id='${sellerUid}'`);
  const pickProduct = () => {
    const r = sql(
      `select p.slug || '|' || p.title_ar || '|' || v.id from products p join product_variants v on v.product_id = p.id where p.seller_id='${sellerId}' and p.status='LIVE' and v.stock_on_hand - v.reserved >= 1 and not exists (select 1 from product_variants w where w.product_id = p.id and w.stock_on_hand - w.reserved < 1) order by p.created_at limit 1`,
    ).split('|');
    return { slug: r[0], title: r[1], variant: r[2] };
  };
  // Buyer UI: product page → cart → checkout (default address, standard delivery, InstaPay) → order.
  const placeOrder = async ({ p, go, tap, sem, calls }, tag) => {
    sql(`delete from cart_items where cart_id in (select id from carts where user_id='${buyerId}')`);
    const prod = pickProduct();
    await go('/products/' + encodeURIComponent(prod.slug));
    await tap('أضف إلى السلة');
    await go('/checkout');
    await tap('متابعة');
    await tap('متابعة');
    await p.getByRole('radio', { name: /إنستاباي/ }).first().click();
    await p.waitForTimeout(800);
    await sem();
    await tap('متابعة');
    await tap('تأكيد الطلب');
    await p.waitForTimeout(2000);
    const o = sql(`select id || '|' || number || '|' || grand_total from orders where customer_id='${buyerId}' order by placed_at desc limit 1`).split('|');
    check(`${tag} buyer: order placed through the UI`, calls.some((c) => /POST \/api\/v1\/orders 201/.test(c)), `#${o[1]}`);
    return { id: o[0], number: o[1], total: Number(o[2]), product: prod };
  };
  const payReceipt = async ({ p, go, type, tap, sem }, order, tag) => {
    const payment = sql(`select id from payments where order_id='${order.id}'`);
    await go(`/payments/${payment}`);
    const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.getByRole('button', { name: /للإيصال/ }).first().click()]);
    await chooser.setFiles(img);
    await p.waitForTimeout(1500);
    await sem();
    await type(p.getByRole('textbox', { name: /المبلغ/ }).first(), String(order.total / 100));
    await tap('إرسال الإيصال للمراجعة');
    check(`${tag} buyer: receipt submitted; the payment waits for EDMN`, sql(`select status from payments where id='${payment}'`) === 'PAYMENT_SUBMITTED', 'PAYMENT_SUBMITTED');
  };
  const staffConfirm = (order, tag) => {
    staff('ledger-health', '-');
    staff('confirm-payment', order.number);
    order.so = sql(`select id from seller_orders where order_id='${order.id}'`);
    check(`${tag} staff: payment confirmed in the console service → PAID`, sql(`select status from seller_orders where id='${order.so}'`) === 'PAID', 'PAID');
  };

  /* ───────────── F. Shipping rates ───────────── */
  if (ONLY.includes('F')) {
    const aswan = sql(`select id from governorates where name_en='Aswan'`);
    sql(`update seller_shipping_rates set enabled=false, fee=0, eta_min_days=2, eta_max_days=5 where seller_id='${sellerId}' and governorate_id=${aswan}`); // known start
    await session(b, OUT, SELLER, PW, async ({ p, go, shot, tap, reveal, has, unnamedButtons, sem, calls, dump }) => {
      await go('/seller/shipping');
      await shot('f1-shipping-rates');
      const named = Number(sql(`select count(*) from governorates where is_active`));
      check('F1 seller: governorates listed by name from the database (no raw ids)', (await has('القاهرة')) && !(await has('#1')), `${named} active governorates`);
      check('F1 a11y: no unnamed buttons on the shipping screen', (await unnamedButtons()) === 0, 'all named');
      const sw = p.getByRole('switch', { name: 'أسوان' });
      await reveal(sw, 30);
      check('F1 a11y: each switch is named after its governorate', (await sw.count()) === 1, 'switch «أسوان»');
      await sw.click();
      await p.waitForTimeout(800);
      await sem();
      if (process.env.JOURNEY_DEBUG) await dump('after aswan on');
      // The fields that appeared under «أسوان»: the nearest «الرسوم/من/إلى» boxes below its switch.
      const near = async (label) => {
        const swl = p.getByRole('switch', { name: 'أسوان' });
        await reveal(swl, 30);
        // Keep the switch and the fields below it in the middle of the screen.
        for (let i = 0; i < 10; i++) {
          const y = (await swl.boundingBox())?.y ?? 0;
          if (y > 150 && y < 450) break;
          await p.mouse.wheel(0, y >= 450 ? 200 : -200);
          await p.waitForTimeout(500);
          await sem();
        }
        const y0 = (await p.getByRole('switch', { name: 'أسوان' }).boundingBox()).y;
        const boxes = p.getByRole('textbox', { name: label, exact: true });
        let best = null;
        for (let i = 0; i < (await boxes.count()); i++) {
          const bb = await boxes.nth(i).boundingBox();
          if (bb && bb.y > y0 && (!best || bb.y < best.y)) best = { y: bb.y, loc: boxes.nth(i) };
        }
        if (process.env.JOURNEY_DEBUG) console.log(`near ${label}: switch y=${y0} field y=${best?.y}`);
        return best.loc;
      };
      const setField = async (label, value) => {
        const box = await near(label);
        await box.click();
        await p.waitForTimeout(400);
        await p.keyboard.press('Control+A');
        await p.keyboard.type(value, { delay: 25 });
      };
      await setField('الرسوم', '85');
      await setField('من', '3');
      await setField('إلى', '6');
      await shot('f2-add-rate');
      await tap('حفظ', { wait: 3500 });
      const row = () => sql(`select enabled || '|' || fee || '|' || eta_min_days || '|' || eta_max_days from seller_shipping_rates where seller_id='${sellerId}' and governorate_id=${aswan}`);
      check('F2 add: Aswan enabled at 85 EGP, 3–6 days, saved through the UI', calls.some((c) => c.startsWith('PUT /api/v1/seller/shipping-rates 200')) && row() === 'true|8500|3|6', row());
      await p.waitForTimeout(1500);
      await sem();
      await reveal(p.getByRole('switch', { name: 'أسوان' }), 30);
      await setField('الرسوم', '92.5');
      await tap('حفظ', { wait: 3500 });
      check('F3 modify: fee changed to 92.50 EGP (9250 piastres, no floating point)', row() === 'true|9250|3|6', row());
      // Validation: min above max is caught before any request; nothing changes.
      const puts = calls.filter((c) => c.startsWith('PUT /api/v1/seller/shipping-rates')).length;
      await p.waitForTimeout(1500);
      await sem();
      await reveal(p.getByRole('switch', { name: 'أسوان' }), 30);
      await setField('من', '7');
      await setField('إلى', '2');
      await tap('حفظ', { wait: 1500 });
      await shot('f4-validation');
      check('F4 validation: min > max is refused on the device; no request sent, row unchanged', calls.filter((c) => c.startsWith('PUT /api/v1/seller/shipping-rates')).length === puts && (await has('راجع الأرقام قبل الحفظ')) && row() === 'true|9250|3|6', row());
      // Error handling: the network drops the save; the app says so and nothing is stored.
      await go('/seller'); // leave and come back: a fresh screen, no edits left over from the refused attempt
      await go('/seller/shipping');
      await p.route('**/api/v1/seller/shipping-rates', (r) => (r.request().method() === 'PUT' ? r.abort('internetdisconnected') : r.continue()));
      await reveal(p.getByRole('switch', { name: 'أسوان' }), 30);
      await setField('الرسوم', '120');
      await tap('حفظ', { wait: 3000 });
      await shot('f5-network-error');
      const snack = await p.locator('flt-semantics').evaluateAll((els) => els.map((e) => e.textContent || '').filter((t) => /اتصال|الإنترنت|حاول/.test(t)).length);
      check('F5 error handling: a failed save shows an error and stores nothing', snack > 0 && row() === 'true|9250|3|6', `error shown=${snack > 0} row=${row()}`);
      await p.unroute('**/api/v1/seller/shipping-rates');
      // Persistence: a fresh load shows the stored state.
      await go('/seller');
      await go('/seller/shipping');
      const feeBox = await near('الرسوم');
      await feeBox.click(); // Flutter web creates the real <input> (with its value) when the field takes focus
      await p.waitForTimeout(600);
      const shown = await p.evaluate(() => document.activeElement?.value ?? '');
      await shot('f6-persisted');
      check('F6 persistence: after reload «أسوان» is on and shows 92.50', (await p.getByRole('switch', { name: 'أسوان', checked: true }).count()) === 1 && /^92\.50?$/.test(shown), `fee field=${shown}`);
    });
    // Ownership: rates are the session's store's. Another seller sees only its own; a buyer gets none (API checks).
    const other = await apiAs(OTHER_SELLER, PW, '/seller/shipping-rates');
    const otherAswan = JSON.parse(other.text).items?.find((r) => r.governorateId === Number(aswan));
    check('F7 ownership (API): another seller reads only its own rates', other.status === 200 && otherAswan?.feePiastres !== 9250, `status=${other.status} otherFee=${otherAswan?.feePiastres}`);
    const buyerTry = await apiAs(BUYER, PW, '/seller/shipping-rates', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ governorateId: Number(aswan), enabled: true, feePiastres: 1, etaMinDays: 1, etaMaxDays: 2 }] }) });
    check('F7 ownership (API): a buyer cannot change seller rates', buyerTry.status === 403 && sql(`select fee from seller_shipping_rates where seller_id='${sellerId}' and governorate_id=${aswan}`) === '9250', `status=${buyerTry.status}`);
  }

  /* ───────────── BA + BC1. Create, view, cancel an unpaid order ───────────── */
  if (ONLY.includes('BA') || ONLY.includes('BC')) {
    await session(b, OUT, BUYER, PW, async (s) => {
      const { p, go, shot, has, confirmDialog, unnamedButtons, calls } = s;
      const o = await placeOrder(s, 'BA1');
      const reserved = () => Number(sql(`select reserved from product_variants where id='${o.product.variant}'`));
      const resBefore = reserved();
      const held = () => sql(`select coalesce(string_agg(r.status, ','), '') from inventory_reservations r join order_items i on i.id = r.order_item_id join seller_orders so on so.id = i.seller_order_id where so.order_id='${o.id}'`);
      check('BA1 DB: one order PENDING_PAYMENT, stock reserved for it', sql(`select status from orders where id='${o.id}'`) === 'PENDING_PAYMENT' && held() !== '', `reservations=[${held()}] variant reserved=${resBefore}`);
      await go('/orders');
      await shot('ba2-orders-list');
      check('BA2 buyer: the order is in «طلباتي»', await has(o.number), `#${o.number}`);
      await go(`/orders/${o.id}`);
      await shot('ba3-order-details');
      check('BA3 buyer: details show the product and «في انتظار الدفع»', (await has(o.product.title)) && (await has('في انتظار الدفع')), o.product.title);
      check('BA3 a11y: no unnamed buttons on the order screen', (await unnamedButtons()) === 0, 'all named');
      // BC1. An unpaid order can be cancelled by the buyer: the reservation is released, no money involved.
      const cancel = p.getByRole('button', { name: 'إلغاء الطلب' }).last();
      await s.reveal(cancel);
      await cancel.click();
      await p.waitForTimeout(1200);
      await confirmDialog();
      await shot('bc1-cancelled');
      const after = sql(`select status from orders where id='${o.id}'`);
      check('BC1 buyer: unpaid order cancelled through the UI', calls.some((c) => c.includes(`/orders/${o.id}/cancel 200`)) && after === 'CANCELLED' && (await has('ملغي')), `status=${after}`);
      check('BC1 stock: the reservation is released', reserved() === resBefore - 1, `reservations=[${held()}] variant reserved ${resBefore} → ${reserved()}`);
      check('BC1 money: no payment was confirmed and no refund created', sql(`select count(*) from refunds where customer_id='${buyerId}' and seller_order_id in (select id from seller_orders where order_id='${o.id}')`) === '0' && sql(`select status from payments where order_id='${o.id}'`) !== 'CONFIRMED', 'none');
    });
  }

  /* ───────────── BC2/BC3. Paid orders: cancellation; any refund is EDMN's to approve and pay ───────────── */
  if (ONLY.includes('BC')) {
    // Ask for a cancellation from the order screen (reason sheet → «تأكيد»).
    const askCancel = async ({ p, type, sem }, reason) => {
      await p.getByRole('button', { name: 'طلب إلغاء' }).last().click();
      await p.waitForTimeout(1500);
      await sem();
      await type(p.getByRole('textbox').last(), reason);
      await p.getByRole('button', { name: 'تأكيد' }).last().click();
      await p.waitForTimeout(3500);
      await sem();
    };
    const refundsOf = (so) => sql(`select coalesce(string_agg(status, ','), '') from refunds where seller_order_id='${so}'`);
    // BC2. Paid, the seller has not confirmed yet: the buyer's request cancels at once.
    const o2 = {};
    await session(b, OUT, BUYER, PW, async (s) => {
      Object.assign(o2, await placeOrder(s, 'BC2'));
      await payReceipt(s, o2, 'BC2');
    });
    staffConfirm(o2, 'BC2');
    await session(b, OUT, BUYER, PW, async (s) => {
      const { p, go, shot, has, calls } = s;
      await go(`/orders/${o2.id}`);
      check('BC2 buyer: a paid order offers no direct cancel, only a cancellation request', (await p.getByRole('button', { name: 'إلغاء الطلب' }).count()) === 0 && (await p.getByRole('button', { name: 'طلب إلغاء' }).count()) === 1, 'request only');
      await askCancel(s, 'طلبت نفس المنتج من فرع قريب');
      await shot('bc2-cancelled-before-confirmation');
      const st2 = sql(`select status from seller_orders where id='${o2.so}'`);
      check('BC2 buyer: before the seller confirms, the request cancels the seller order at once', calls.some((c) => c.includes(`/seller-orders/${o2.so}/`) && / 20\d$/.test(c)) && st2 === 'CANCELLED' && (await has('ملغي')), `status=${st2}`);
    });
    check('BC2 money: a refund is REQUESTED for EDMN, nothing paid from the app', /^REQUESTED$/.test(refundsOf(o2.so)), `refunds=[${refundsOf(o2.so)}]`);
    // BC3. The seller already confirmed: the buyer's request waits for the seller, who accepts it in the app.
    const o3 = {};
    await session(b, OUT, BUYER, PW, async (s) => {
      Object.assign(o3, await placeOrder(s, 'BC3'));
      await payReceipt(s, o3, 'BC3');
    });
    staffConfirm(o3, 'BC3');
    await session(b, OUT, SELLER, PW, async ({ p, go, tap, sem }) => {
      await go(`/seller/orders/${o3.so}`);
      await tap('قبول الطلب', { wait: 1500 });
      await p.getByRole('alertdialog').getByRole('button', { name: 'قبول الطلب' }).click();
      await p.waitForTimeout(3500);
      await sem();
      check('BC3 seller: order confirmed through the UI', sql(`select status from seller_orders where id='${o3.so}'`) === 'SELLER_CONFIRMED', 'SELLER_CONFIRMED');
    });
    await session(b, OUT, BUYER, PW, async (s) => {
      const { go, shot, has } = s;
      await go(`/orders/${o3.id}`);
      await askCancel(s, 'العنوان هيتغير الأسبوع ده');
      await shot('bc3-cancel-requested');
      const cr = sql(`select status from cancellation_requests where seller_order_id='${o3.so}' order by created_at desc limit 1`);
      check('BC3 buyer: request recorded (PENDING); the order stays with the seller', cr === 'PENDING' && sql(`select status from seller_orders where id='${o3.so}'`) === 'SELLER_CONFIRMED' && (await has('طلب الإلغاء')), `request=${cr}`);
    });
    await session(b, OUT, SELLER, PW, async ({ p, go, shot, has, calls, sem }) => {
      await go(`/seller/orders/${o3.so}`);
      await shot('bc3-seller-cancel-request');
      check('BC3 seller: sees the buyer’s cancellation request and its reason', await has('العنوان هيتغير'), 'reason on screen');
      await p.getByRole('button', { name: 'الموافقة على الإلغاء' }).last().click();
      await p.waitForTimeout(1200);
      await p.getByRole('alertdialog').getByRole('button', { name: 'الموافقة على الإلغاء' }).click();
      await p.waitForTimeout(3500);
      await sem();
      await shot('bc3-seller-cancelled');
      const s3 = sql(`select status from seller_orders where id='${o3.so}'`);
      check('BC3 seller: accepts → seller order CANCELLED, label «ملغي» with «do not ship»', calls.some((c) => c.startsWith(`POST /api/v1/seller/orders/${o3.so}/steps 200`)) && s3 === 'CANCELLED' && (await has('ملغي')) && (await has('لا تقم بشحنه')), `status=${s3}`);
    });
    check('BC3 money: refund REQUESTED for EDMN approval, nothing paid from the app', /^REQUESTED$/.test(refundsOf(o3.so)), `refunds=[${refundsOf(o3.so)}]`);
    check('BC3 buyer: notified of the cancellation', Number(sql(`select count(*) from notifications where user_id='${buyerId}' and event='SELLER_ORDER_CANCELLED' and created_at > now() - interval '20 minutes'`)) >= 2, 'SELLER_ORDER_CANCELLED');
  }

  /* ───────────── BB. Track the shipment and confirm delivery ───────────── */
  if (process.env.JOURNEY_O3) {
    // Re-run BD alone on an order a previous BB run delivered: JOURNEY_O3=<order number>.
    const r = sql(`select o.id || '|' || so.id from orders o join seller_orders so on so.order_id = o.id where o.number=${Number(process.env.JOURNEY_O3)}`).split('|');
    st.o3 = { id: r[0], number: process.env.JOURNEY_O3, so: r[1] };
  } else if (ONLY.includes('BB') || ONLY.includes('G') || ONLY.includes('BD')) {
    st.o3 = {};
    await session(b, OUT, BUYER, PW, async (s) => {
      Object.assign(st.o3, await placeOrder(s, 'BB1'));
      await payReceipt(s, st.o3, 'BB1');
    });
    staffConfirm(st.o3, 'BB1');
    const so = st.o3.so;
    await session(b, OUT, SELLER, PW, async ({ p, go, shot, type, tap, has, sem, calls }) => {
      const step = async (label, expected, shown, shotName) => {
        await tap(label, { wait: 1500 });
        await p.getByRole('alertdialog').getByRole('button', { name: label }).click();
        await p.waitForTimeout(3500);
        await sem();
        await shot(shotName);
        const now = sql(`select status from seller_orders where id='${so}'`);
        check(`BB2 seller: «${label}» → ${expected}, shown as «${shown}»`, now === expected && calls.some((c) => c.startsWith(`POST /api/v1/seller/orders/${so}/steps 200`)) && (await has(shown)), `status=${now}`);
      };
      await go(`/seller/orders/${so}`);
      check('BB2 seller: a new paid order reads «جديد» with the next step', (await has('جديد')) && (await has('اضغط «تأكيد الطلب»')), 'label + hint');
      await step('قبول الطلب', 'SELLER_CONFIRMED', 'مقبول', 'bb2-confirmed');
      await step('بدء التجهيز', 'PROCESSING', 'قيد التجهيز', 'bb2-processing');
      await step('جاهز للشحن', 'READY_TO_SHIP', 'جاهز للشحن', 'bb2-ready');
      check('BB2 labels: PROCESSING and READY_TO_SHIP no longer share a label', !(await has('جاري تجهيز الطلب')), 'distinct');
      await tap('بيانات الشحن', { wait: 2000 });
      st.tracking = `B5${Date.now() % 1000000}`;
      await type(p.getByRole('textbox', { name: /شركة الشحن/ }).first(), 'بوسطة');
      await type(p.getByRole('textbox', { name: /رقم البوليصة/ }).first(), st.tracking);
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.getByRole('button', { name: /للبوليصة/ }).first().click()]);
      await chooser.setFiles(img);
      await p.waitForTimeout(1500);
      await sem();
      await tap('حفظ', { wait: 4000 });
      await step('تم الشحن', 'SHIPPED', 'تم الشحن', 'bb2-shipped');
    });
    await session(b, OUT, BUYER, PW, async ({ p, go, shot, has, confirmDialog, calls }) => {
      await go(`/orders/${st.o3.id}`);
      await shot('bb3-buyer-tracking');
      check('BB3 buyer: tracking shows the shipment on its way with the carrier and waybill number', (await has('في طريقه إليك')) && (await has(st.tracking)), `tracking=${st.tracking}`);
      st.atShipped = true;
      if (ONLY.includes('G')) return; // the inbox journey runs while the order is in transit; receipt is confirmed after it
      await p.getByRole('button', { name: 'تأكيد الاستلام' }).last().click();
      await p.waitForTimeout(1500);
      await confirmDialog();
      const r = sql(`select status || '|' || coalesce(receipt_confirmed_by::text,'') from seller_orders where id='${so}'`).split('|');
      check('BB4 buyer: delivery confirmed in the app and recorded as the buyer’s', calls.some((c) => c.startsWith(`POST /api/v1/seller-orders/${so}/confirm-receipt 200`)) && r[1] === buyerId, `status=${r[0]}`);
    });
  }

  /* ───────────── G. Seller inbox ───────────── */
  if (ONLY.includes('G') && st.o3?.so) {
    const so = st.o3.so;
    const msg = `هل يمكن تغيير موعد التسليم؟ ${Date.now() % 10000}`;
    await session(b, OUT, BUYER, PW, async ({ p, go, shot, type, sem, calls }) => {
      await go(`/orders/${st.o3.id}`);
      await p.getByRole('button', { name: 'مراسلة البائع' }).last().click();
      await p.waitForTimeout(3500);
      await sem();
      st.conv = sql(`select id from conversations where seller_order_id='${so}'`);
      await type(p.getByRole('textbox', { name: /اكتب رسالتك/ }).last(), msg);
      const send = p.getByRole('button', { name: 'إرسال' }).last();
      await send.click();
      await send.click({ timeout: 1000 }).catch(() => {}); // a fast second tap must not send twice
      await p.waitForTimeout(3500);
      await sem();
      await shot('g1-buyer-message');
      const n = sql(`select count(*) from conversation_messages where conversation_id='${st.conv}' and body='${msg}'`);
      check('G1 buyer: message sent from the order, stored once (double tap → one row)', n === '1' && calls.some((c) => c.includes(`/conversations/${st.conv}/messages 20`)), `rows=${n}`);
    });
    check('G2 seller: notified of the new message', Number(sql(`select count(*) from notifications where user_id='${sellerUid}' and event like 'MESSAGE%' and created_at > now() - interval '10 minutes'`)) >= 1, 'MESSAGE_RECEIVED');
    const reply = `نعم، سنتواصل مع شركة الشحن اليوم ${Date.now() % 10000}`;
    await session(b, OUT, SELLER, PW, async ({ p, go, shot, type, has, unnamedButtons, sem, calls }) => {
      await go('/seller/messages');
      await shot('g2-seller-inbox');
      check('G2 seller: the conversation is in the store inbox with an unread count', (await has(st.o3.number)) && (await p.locator('flt-semantics:has-text("1")').count()) > 0, `#${st.o3.number}`);
      await p.locator(`flt-semantics:has-text("${st.o3.number}")`).last().click();
      await p.waitForTimeout(4000);
      await sem();
      await shot('g3-seller-conversation');
      check('G3 seller: opens the conversation and reads the buyer’s message', await has(msg.slice(0, 20)), 'message on screen');
      check('G3 a11y: no unnamed buttons in the conversation (attach / send named)', (await unnamedButtons()) === 0, 'all named');
      await p.waitForTimeout(2000);
      const read = sql(`select count(*) from conversation_reads where conversation_id='${st.conv}' and user_id='${sellerUid}' and last_read_at > now() - interval '5 minutes'`);
      check('G3 seller: reading it records the read position (unread cleared)', read === '1', `reads=${read}`);
      await type(p.getByRole('textbox', { name: /اكتب رسالتك/ }).last(), reply);
      await p.getByRole('button', { name: 'إرسال' }).last().click();
      await p.waitForTimeout(3500);
      await sem();
      await shot('g4-seller-replied');
      check('G4 seller: reply sent as the store and stored once', sql(`select count(*) from conversation_messages where conversation_id='${st.conv}' and body='${reply}' and sender_user_id='${sellerUid}'`) === '1' && calls.some((c) => c.includes(`/seller/conversations/${st.conv}/messages 20`)), 'one row');
    });
    check('G5 buyer: notified of the reply', Number(sql(`select count(*) from notifications where user_id='${buyerId}' and event like 'MESSAGE%' and created_at > now() - interval '10 minutes'`)) >= 1, 'MESSAGE_RECEIVED');
    await session(b, OUT, BUYER, PW, async ({ p, go, shot, has, confirmDialog, calls }) => {
      await go(`/messages/${st.conv}`);
      await shot('g5-buyer-sees-reply');
      check('G5 buyer: sees the store’s reply in the conversation', await has(reply.slice(0, 20)), 'reply on screen');
      // Then the buyer confirms delivery (BB4).
      await go(`/orders/${st.o3.id}`);
      await p.getByRole('button', { name: 'تأكيد الاستلام' }).last().click();
      await p.waitForTimeout(1500);
      await confirmDialog();
      await shot('bb4-received');
      const r = sql(`select status || '|' || coalesce(receipt_confirmed_by::text,'') from seller_orders where id='${so}'`).split('|');
      check('BB4 buyer: delivery confirmed in the app and recorded as the buyer’s', calls.some((c) => c.startsWith(`POST /api/v1/seller-orders/${so}/confirm-receipt 200`)) && r[1] === buyerId, `status=${r[0]}`);
      check('BB4 money: no release without EDMN Maker/Checker', sql(`select count(*) from journal_entries where source_id='${so}' and entry_type='SELLER_RELEASE'`) === '0', 'no SELLER_RELEASE');
    });
    // Authorization (API): another seller and another buyer cannot read the conversation.
    const s2 = await apiAs(OTHER_SELLER, PW, `/seller/conversations/${st.conv}`);
    const b2 = await apiAs(OTHER_BUYER, PW, `/conversations/${st.conv}`);
    check('G6 denial (API): another seller and another buyer cannot open the conversation', [403, 404].includes(s2.status) && [403, 404].includes(b2.status) && !s2.text.includes(msg) && !b2.text.includes(msg), `seller=${s2.status} buyer=${b2.status}`);
    const sellerSeen = await apiAs(SELLER, PW, '/seller/conversations');
    const row = JSON.parse(sellerSeen.text).items?.find((c) => c.id === st.conv);
    check('G6 seller inbox (API): the store has read everything (unread 0)', row?.unread === 0, `unread=${row?.unread}`);
  }

  /* ───────────── BD + BE. Return → seller rejects → buyer escalates ───────────── */
  if (ONLY.includes('BD') && st.o3?.so) {
    const so = st.o3.so;
    await session(b, OUT, BUYER, PW, async (s) => {
      const { p, go, shot, type, tapFresh, has, unnamedButtons, sem, calls } = s;
      await go(`/orders/${st.o3.id}`);
      const ret = p.getByRole('button', { name: 'طلب إرجاع' }).last();
      await s.reveal(ret);
      await ret.click();
      await p.waitForTimeout(3500);
      await sem();
      if (process.env.JOURNEY_DEBUG) await s.dump('return form');
      await shot('bd1-return-form');
      check('BD1 a11y: no unnamed buttons on the return form', (await unnamedButtons()) === 0, 'all named');
      await tapFresh(p.getByRole('button', { name: 'زيادة الكمية' }).first());
      await tapFresh(p.getByRole('radio', { name: /مطابق للوصف/ }).first());
      const docs = p.getByRole('button', { name: /صور أو مستندات/ }).first();
      await docs.scrollIntoViewIfNeeded();
      await p.waitForTimeout(800);
      await sem();
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), docs.click()]);
      await chooser.setFiles(img);
      await p.waitForTimeout(1500);
      await sem();
      await type(p.getByRole('textbox').last(), 'اللون المستلم مختلف عن صور المنتج في الإعلان');
      await tapFresh(p.getByRole('button', { name: 'إرسال طلب الإرجاع' }).last(), 3500);
      await shot('bd1-return-sent');
      const r = sql(`select id || '|' || status || '|' || reason from returns where seller_order_id='${so}' order by created_at desc limit 1`).split('|');
      st.ret = r[0];
      check('BD1 buyer: return requested from the order (REQUESTED)', calls.some((c) => /POST \/api\/v1\/returns 20\d/.test(c)) && r[1] === 'REQUESTED' && (await has('طلب')), `status=${r[1]} reason=${r[2]}`);
      check('BD1 security: evidence is PRIVATE', /^PRIVATE/.test(sql(`select string_agg(f.visibility, ',') from files f where f.id in (select file_id from return_evidence where return_id='${st.ret}')`)), 'PRIVATE');
    });
    check('BE1 seller: notified of the return', Number(sql(`select count(*) from notifications where user_id='${sellerUid}' and event='RETURN_REQUESTED' and created_at > now() - interval '10 minutes'`)) >= 1, 'RETURN_REQUESTED');
    await session(b, OUT, SELLER, PW, async ({ p, go, shot, type, tap, tapFresh, sem, calls }) => {
      await go(`/seller/returns/${st.ret}`);
      await shot('be1-seller-return');
      await tapFresh(p.getByRole('button', { name: 'رفض الإرجاع' }).last());
      await sem();
      await type(p.getByRole('textbox').last(), 'اللون مطابق للمواصفات المكتوبة في صفحة المنتج');
      await tap('تأكيد', { wait: 3500 });
      const r = sql(`select status from returns where id='${st.ret}'`);
      check('BE1 seller: rejects with a reason (REJECTED)', calls.some((c) => c.includes(`/seller/returns/${st.ret}/steps 200`)) && r === 'REJECTED', `status=${r}`);
    });
    check('BE2 buyer: notified of the seller’s answer', Number(sql(`select count(*) from notifications where user_id='${buyerId}' and event like 'RETURN%' and created_at > now() - interval '10 minutes'`)) >= 1, 'RETURN_* notification');
    await session(b, OUT, BUYER, PW, async ({ p, go, shot, type, tap, tapFresh, has, sem, calls }) => {
      await go(`/returns/${st.ret}`);
      await shot('be2-buyer-sees-rejection');
      check('BE2 buyer: sees the rejection and the seller’s reason', (await has('مرفوض')) && (await has('مطابق للمواصفات')), 'on screen');
      await tapFresh(p.getByRole('button', { name: /تحويل لفريق أضمن/ }).last());
      if (await p.getByRole('alertdialog').count()) {
        await p.getByRole('alertdialog').getByRole('button').last().click();
        await p.waitForTimeout(3500);
        await sem();
      } else if (await p.getByRole('textbox').count()) {
        await type(p.getByRole('textbox').last(), 'المنتج مختلف فعلاً والصور توضح ذلك');
        await tap('تأكيد', { wait: 3500 });
      }
      await shot('be3-escalated');
      const d = sql(`select status from disputes where return_id='${st.ret}'`);
      check('BE3 buyer: escalation opens one dispute for EDMN', calls.some((c) => c.includes(`/returns/${st.ret}/escalate 20`)) && d === 'OPEN', `dispute=${d}`);
      check('BE3 money: no refund created by the escalation', sql(`select count(*) from refunds where seller_order_id='${so}'`) === '0', 'none');
    });
  }

  await b.close();
  const pass = results.filter((r) => r.startsWith('PASS')).length;
  const fail = results.length - pass;
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + `\n\n${pass} PASS / ${fail} FAIL\n`);
  process.exit(fail ? 1 : 0);
})();
