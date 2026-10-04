# Shipping

## Model

In V1 **sellers ship their own orders** (any courier they choose). EDMN does not integrate a courier
API; instead it enforces **evidence**: every shipment must have carrier data and an uploaded waybill
before the order can be marked shipped, and seller funds are released only when the **buyer confirms
receipt**.

## Shipping fees by governorate

- Each seller configures, per Egyptian governorate (all 27 are seeded), whether they ship there, the
  fee (EGP) and the delivery estimate in days (`seller_shipping_rates`; Seller Center → الشحن).
- Optional store-level free-shipping threshold (`stores.free_shipping_threshold`).
- Pricing (`src/server/modules/commerce/pricing.ts`) groups the cart by seller; each seller group
  gets its own fee and ETA for the customer's delivery governorate. If a seller does not ship there,
  the lines are flagged and checkout is blocked with a clear message.
- The customer picks the delivery governorate in the header (stored in a cookie) and sees per-product
  delivery fee/ETA on product pages; the final fee is recalculated server-side at checkout and
  snapshotted on the seller order.
- The shipping fee belongs to the seller (part of seller net); commission is calculated on
  merchandise only.

## Fulfilment flow (seller order)

```
PAID → SELLER_CONFIRMED → (PROCESSING) → READY_TO_SHIP → SHIPPED → DELIVERED → COMPLETED
```

1. Seller confirms the order (optionally marks processing / ready).
2. **Create shipment** (`saveShipment`): carrier name (required), tracking number, shipped date,
   expected delivery date, note, and **waybill upload** (PDF/JPEG/PNG/WebP; magic-byte validated;
   stored privately — EDGE 19 covers invalid files).
3. **Mark shipped** (`markShipped`) is refused unless carrier data **and** at least one waybill exist.
   The customer is notified with carrier and tracking number.
4. Seller can add tracking events (in transit / failed attempt).
5. **Buyer confirms receipt** on the order page → `DELIVERED`; funds move from pending to available
   (unless an open dispute or financial hold exists). Idempotent (EDGE 10).
6. Follow-up: shipped orders without confirmation after `orders.deliveryFollowUpDays` are flagged and
   the buyer is reminded; operations staff can confirm **on the buyer's behalf** only with the
   `orders.confirm_receipt_on_behalf` permission and a written reason (audited).
7. After `orders.completionDays`, delivered orders become `COMPLETED`.

## Shipping Evidence Center (`/admin/shipping`)

All shipments with their waybills, searchable by order number, seller, customer, carrier, tracking
number, status and date range. Shipments marked shipped without a waybill would be flagged at the top
(the domain prevents this, the check is a safety net). Waybills are served through the authorized
private-file route.

## Returns logistics

Approved returns are shipped back by the customer to the store's return address (with optional
carrier/tracking), then received and inspected by the seller (or admin) before a refund is approved.
See the return state machine in [STATE_MACHINES.md](STATE_MACHINES.md).

## Future courier integration

A courier API (Bosta, Aramex, …) can be added behind the same `saveShipment`/tracking-event functions:
create the waybill via API, store the label as the waybill document, and ingest tracking webhooks as
`tracking_events`. The evidence and receipt-confirmation rules stay the same.
