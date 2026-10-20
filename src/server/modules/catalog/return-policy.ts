import { RETURN_CONDITION_KEYS, RETURN_SHIPPING_PAYERS, type ReturnPolicy } from '@/domain/return-policy';

type ProductPolicyFields = {
  returnPolicyOverride: boolean;
  acceptsVoluntaryReturns: boolean | null;
  voluntaryReturnDays: number | null;
  returnConditionKeys: string[] | null;
  returnShippingPayer: string | null;
  returnPolicyNotes: string | null;
};
type StorePolicyFields = {
  acceptsVoluntaryReturns: boolean;
  voluntaryReturnDays: number | null;
  returnConditionKeys: string[] | null;
  returnShippingPayer: string | null;
  returnConditions: string | null;
};

const keys = (v: string[] | null | undefined) => (v ?? []).filter((k): k is (typeof RETURN_CONDITION_KEYS)[number] => (RETURN_CONDITION_KEYS as readonly string[]).includes(k));
const payer = (v: string | null | undefined) => ((RETURN_SHIPPING_PAYERS as readonly string[]).includes(v ?? '') ? (v as ReturnPolicy['shippingPayer']) : 'BY_REASON');

/** The seller's voluntary return policy that applies to a listing (product override, else store default). */
export function listingReturnPolicy(p: ProductPolicyFields, store: StorePolicyFields): ReturnPolicy {
  const own = p.returnPolicyOverride;
  const accepts = own ? !!p.acceptsVoluntaryReturns : store.acceptsVoluntaryReturns;
  const days = own ? p.voluntaryReturnDays : store.voluntaryReturnDays;
  if (!accepts || !days) return { type: 'NONE', windowDays: null, conditions: [], shippingPayer: payer(own ? p.returnShippingPayer : store.returnShippingPayer), notes: (own ? p.returnPolicyNotes : store.returnConditions) ?? '' };
  return {
    type: 'VOLUNTARY',
    windowDays: days,
    conditions: keys(own ? p.returnConditionKeys : store.returnConditionKeys),
    shippingPayer: payer(own ? p.returnShippingPayer : store.returnShippingPayer),
    notes: (own ? p.returnPolicyNotes : store.returnConditions) ?? '',
  };
}
