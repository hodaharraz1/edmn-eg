# Wallet and financial states — mobile

## What exists in the backend (reviewed before building)

| Area | Service (existing) | Used by the app as |
|---|---|---|
| Ledger (double entry, immutable journal, projections) | `finance/ledger.ts`, `postings.ts`, `controls.ts` (`financialInvariants`, `reconcile`) | Nothing writes to it from mobile. Tests check the trial balance after the wallet flow. |
| Seller and beneficiary balances | `finance/seller-wallet.ts` `sellerFinancialView(userId)`: the store sub-ledger plus Protected Deal payouts | `GET /wallet` |
| Holds, disputes, debts | `finance/holds.ts` `sellerFundsPosition` (withdrawable already excludes holds, in-flight requests and claims) | Shown as their own lines, never as available |
| Store statement | `finance/seller-statement.ts` (one row per journal entry; running balances reconcile with the ledger) | `GET /seller/statement` (`finance.view`) |
| Payout (withdrawal) requests | `finance/withdrawals.ts` `requestAccountWithdrawal`, `requestWithdrawal`, `previewAccountWithdrawal`, `cancelWithdrawal`, `accountWithdrawals` | Request, preview and cancel only |
| Approval, reservation, transfer, uncertain, returned | `approveWithdrawal` (two-person), `markWithdrawalProcessing`, `markWithdrawalPaid`, `markWithdrawalTransferUncertain`, `recordWithdrawalReturned` | **Admin console only.** The app only displays the result. |
| Receiving accounts | `identity/receiving.ts` (encrypted, versioned, staff-verified) | `GET/POST /wallet/receiving-accounts`, archive |
| Buyer payments and refunds | `payments/service.ts`, `finance/refunds.ts` (refunds go to the original payment destination) | `GET /wallet/activity` |
| **Buyer top-up / deposit** | **only while `wallet.topUpEnabled` (default off)** | PKG-WALLET-01 phase 1: transfer + receipt, credited by two staff; spending the balance is phase 2; no buyer cash-out |
| **Wallet-to-wallet transfer** | **none** | not built (D34, deferred by owner) |

No financial table, posting rule or approval rule was added or changed in Phase 4. The mobile layer is
`src/server/modules/mobile/wallet.ts` (projections) plus `src/server/api/routes/wallet.ts` (contract).

## What the wallet means in EDMN

While `wallet.topUpEnabled` is off (the default) EDMN keeps **no prepaid buyer balance** (PKG-WALLET-01 adds an opt-in deposit behind that flag). A buyer pays each order or deal by manual transfer, and EDMN reviews the
receipt. Refunds go back to the original payment method. The account wallet therefore shows **earnings**: from the
user's store, if they own one, and from Protected Deals where they are the seller. For a pure buyer it shows zero
balances with a one-line explanation, plus their payments and refunds in the activity list.

## Balance buckets (all from the server, in piastres)

| Bucket | Meaning | Withdrawable? |
|---|---|---|
| `available` | Released and free of holds, claims and in-flight requests | **yes**, the only one |
| `pending` | Paid; delivery or buyer-response window still open | no |
| `awaitingRelease` | Buyer confirmed (or timed out); waiting for the two-person release | no |
| `held` | Frozen by a hold or an open dispute | no |
| `reserved` | Locked by an approved payout that has not been paid yet | no |
| `debt` | Negative available balance after a post-release refund. Blocks every payout. | — |
| `unsecuredClaims` | Open claims not covered by any money in EDMN (information, not cash) | — |
| `paidOut` | Already transferred (information) | — |

The app adds nothing up. Every figure on screen is a server field. The buyer and store summaries combine figures
the server already returned (for example "معلّق" in the card footer = pending + awaitingRelease), and the breakdown
always lists each bucket on its own line.

## Payout request lifecycle (request only, per owner decision §20)

```
REQUESTED ─(EDMN reviews)─► UNDER_REVIEW ─(two-person approval: reserves AVAILABLE → RESERVED)─► APPROVED ─► PROCESSING
   │                                                                                                  │
   └─ CANCELLED (requester, before approval)                                                          ├─► PAID (reference shown)
REJECTED (reason shown)                                                                               ├─► TRANSFER_UNCERTAIN  ← shown as «جاري التحقق من التحويل»
                                                                                                      └─► FAILED_BEFORE_TRANSFER / RETURNED (funds restored by EDMN)
```

- **Idempotency:** `clientKey` is generated once per intent and reused on every retry of the same submit. The server
  returns the original request with `created=false`, so a lost response can never create two requests.
- **A request posts nothing to the ledger.** Reservation happens only at approval, in the admin console (tested).
- **`TRANSFER_UNCERTAIN`** is never treated as paid or failed, cannot be cancelled, and the money stays reserved
  (tested). Only EDMN staff resolve it.
- **Cancellation:** the requester's own account-level request, before approval. A request to the store's payout
  method belongs to the store and is cancelled from the Seller Center by a member with `finance.withdraw`, the same
  rule as on the web.
- **Blocking reasons**, computed by the server: identity not verified, no verified destination, store debt, nothing
  available. The app shows the reason and offers no request button.

## Destinations

| Key | Source | Can receive |
|---|---|---|
| `STORE_PAYOUT_METHOD` | the owned store's verified payout method | store sales + Protected Deal earnings |
| `<receiving account id>` | the user's **verified** receiving account | Protected Deal earnings only |

New receiving accounts are encrypted, masked in every response, and `PENDING_REVIEW` until staff verify them. They are
not offered as a destination before verification (tested). Archiving keeps existing snapshots intact.

## Real Money OFF

The yellow strip at the top of every screen was removed (owner request). While Real Money is OFF, the TEST state is
shown **inside money steps only** with `EdmnTestMoneyNotice`, wherever money is involved:
- checkout;
- payment / receipt upload;
- deal money card;
- wallet balances;
- account and store payout requests;
- activity detail.

Each test activity row is tagged «تجريبي». Real Money stays OFF, and nothing in Phase 4 changes the payment or ledger
configuration.

## Permissions

| Route | Auth | Extra rule |
|---|---|---|
| `/wallet*` | customer (session user) | own data only; another user's request id or account id → 404 |
| `/seller/statement` | seller | `finance.view` (a `CATALOG_MANAGER` gets 403, tested) |
| `/seller/payout-account` | seller | `finance.view` |
| `/seller/payout-requests` (Phase 1) | seller | view `finance.view`; request and cancel `finance.withdraw` |

## Tests

- `tests/integration/mobile-wallet-api.test.ts` (Flow G):
  - a buyer with no earnings sees zero balances and no top-up, and payments are listed and filterable on the server;
  - store owner:
    - wallet available equals `/seller/funds` withdrawable;
    - over-limit and foreign destinations are refused;
    - preview works;
    - one request per `clientKey` with no journal entry;
    - a stranger cannot cancel or list it;
    - approval reserves exactly the amount, and the request can no longer be cancelled;
    - `TRANSFER_UNCERTAIN` keeps the funds reserved and is shown as such;
    - the statement needs `finance.view`;
    - trial balance and per-entry balance checks hold;
  - receiving accounts: validation, masked, pending until verified, owner-only archive.
- `tests/unit/openapi-contract.test.ts`:
  - account payout routes are allow-listed;
  - the request body is exactly `{amountPiastres, destination, clientKey}`;
  - wallet writes run as `customer`, with no identity fields;
  - no path contains withdraw, settle, refund, release, ledger or transfer.
- Flutter widget tests:
  - no global TEST banner, but the notice appears in the payment step;
  - the wallet shows server balances, keeps held money apart from available, and has no top-up or transfer action;
  - a blocked payout shows its reason and offers no button;
  - a payout retry reuses the same key, and the uncertain status is shown without a cancel action.
