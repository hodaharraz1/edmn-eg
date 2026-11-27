/**
 * PKG-WALLET-02 integration: spend the customer wallet balance (orders + Protected Deals) and refund to it.
 * لم يتم التحقق: needs Postgres (docker compose up postgres && npm run migrate && npx vitest run tests/integration/wallet-spend.test.ts).
 *
 * Proves:
 *  1. Flag off → checkout with method WALLET is refused (feature disabled).
 *  2. Wallet checkout posts Dr CUSTOMER_WALLETS / Cr the same lines a confirmed transfer posts (SELLER_PENDING
 *     + COMMISSION_DEFERRED), one SPEND sub-ledger row per seller order, payment CONFIRMED by the payer, no
 *     financial_approvals row (owner exception), order PAID, reservations committed.
 *  3. Balance can NEVER go negative: two concurrent wallet checkouts racing for the same balance — exactly one
 *     succeeds (users-row lock); the WALLET_NEGATIVE control stays empty.
 *  4. Wallet-funded Protected Deal: Dr CUSTOMER_WALLETS / Cr DEAL_FUNDS_HELD, deal ACTIVE.
 *  5. Refund of a wallet-paid seller order: staff approval credits CUSTOMER_WALLETS (not CUSTOMER_REFUNDS_PAYABLE),
 *     SPEND_REVERSAL row, refund COMPLETED without a REFUND_PAID entry, ledger controls stay green.
 *  6. Refund of a wallet-funded deal (dispute FULL_REFUND): DEAL_REFUND credits CUSTOMER_WALLETS + SPEND_REVERSAL.
 *  7. Idempotency: replaying the wallet checkout returns the original order/payment; no double spend.
 *  8. ledger:check / controls: WALLET_LEDGER_DRIFT and UNAPPROVED_JOURNAL stay empty after every step.
 */
import { describe, expect, it } from 'vitest';

// TODO(PKG-WALLET-02): implement against tests/helpers (db harness like checkout-concurrency.test.ts).
// Each case above maps to one `it` block; use the wallet top-up flow (maker/checker) to fund the wallet first.
describe('PKG-WALLET-02 wallet spend (لم يتم التحقق — يحتاج Postgres)', () => {
  it.todo('flag off refuses WALLET checkout');
  it.todo('wallet checkout posts the same credit lines as a confirmed transfer + SPEND rows');
  it.todo('concurrent spends never drive the balance negative');
  it.todo('wallet deal funding credits DEAL_FUNDS_HELD and activates the deal');
  it.todo('refund of a wallet-paid order credits the wallet (SPEND_REVERSAL) and completes');
  it.todo('deal dispute refund of a wallet-funded deal credits the wallet');
  it.todo('checkout replay is idempotent');
  it.todo('ledger controls stay green (WALLET_LEDGER_DRIFT, WALLET_NEGATIVE, UNAPPROVED_JOURNAL)');
});
