/**
 * Payment provider abstraction.
 *
 * V1 only ships MANUAL (bank transfer / InstaPay / Vodafone Cash verified by EDMN staff).
 * A licensed PSP can be added by implementing `PaymentProvider` and calling the same
 * `confirmPaymentInternal()` used by manual verification — cart, orders, ledger and balances
 * do not change. Webhooks MUST be verified (signature) and are idempotent on providerReference.
 * No external gateway is simulated here.
 */
export interface PaymentInstructions {
  kind: 'MANUAL_TRANSFER' | 'REDIRECT';
  redirectUrl?: string;
}

export interface ProviderWebhookResult {
  paymentId: string;
  providerReference: string;
  status: 'CONFIRMED' | 'FAILED';
  amount: number;
}

export interface PaymentProvider {
  code: string;
  /** Called after the payment row is created at checkout. */
  initiate(payment: { id: string; amountDue: number; currency: string }): Promise<PaymentInstructions>;
  /** Verify & parse a provider callback. Must throw on invalid signatures. */
  parseWebhook?(rawBody: string, headers: Headers): Promise<ProviderWebhookResult>;
}

export const manualProvider: PaymentProvider = {
  code: 'MANUAL',
  async initiate() {
    return { kind: 'MANUAL_TRANSFER' };
  },
};

const registry = new Map<string, PaymentProvider>([[manualProvider.code, manualProvider]]);
export function getProvider(code: string): PaymentProvider {
  const p = registry.get(code);
  if (!p) throw new Error(`payment provider ${code} not configured`);
  return p;
}
