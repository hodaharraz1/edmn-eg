import { NO_VOLUNTARY_TEXT, RETURN_CONDITION_LABELS, RETURN_SHIPPING_LABELS, type ReturnPolicy } from '@/domain/return-policy';

type P = Partial<ReturnPolicy> & { type: ReturnPolicy['type'] };

/** Read-only display of a return policy (listing, checkout, order, deal offer, admin). Never hidden in T&C. */
export function ReturnPolicyView({ policy, mandatoryNotice, compact }: { policy: P | null | undefined; mandatoryNotice?: string | null; compact?: boolean }) {
  if (!policy) return <span className="text-muted">غير محددة</span>;
  return (
    <div className="space-y-1 text-sm" data-testid="return-policy-view">
      {policy.type === 'VOLUNTARY' ? (
        <>
          <p className="font-semibold">يسمح بالاسترجاع الاختياري خلال {policy.windowDays} يوم من الاستلام</p>
          {!compact && policy.conditions && policy.conditions.length > 0 && (
            <ul className="list-inside list-disc text-muted">{policy.conditions.map((c) => <li key={c}>{RETURN_CONDITION_LABELS[c]}</li>)}</ul>
          )}
          {!compact && policy.shippingPayer && <p className="text-muted">{RETURN_SHIPPING_LABELS[policy.shippingPayer]}</p>}
        </>
      ) : (
        <>
          <p className="font-semibold">{NO_VOLUNTARY_TEXT}</p>
          {!compact && <p className="text-xs text-muted">يظل من حقك الإبلاغ عن منتج معيب أو خاطئ أو تالف أو غير مطابق للوصف.</p>}
        </>
      )}
      {!compact && policy.notes ? <p className="whitespace-pre-line text-muted">{policy.notes}</p> : null}
      {mandatoryNotice ? <p className="text-xs text-muted">{mandatoryNotice}</p> : null}
    </div>
  );
}
