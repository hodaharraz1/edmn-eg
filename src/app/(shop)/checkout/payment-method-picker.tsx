'use client';

import { useState } from 'react';
import { Radio } from '@/ui/form';
import { formatEGP } from '@/lib/format';

/**
 * Payment method radios + the expectedTotal the server will re-check. COD carries no transfer
 * destination and may add a collection fee, so the quoted total switches with the chosen method.
 */
export function PaymentMethodPicker(props: { methods: { code: string; nameAr: string; instructionsAr: string | null }[]; grandTotal: number; codFee: number; windowHours: number }) {
  const [method, setMethod] = useState(props.methods[0]?.code ?? '');
  const isCod = method === 'COD';
  const total = props.grandTotal + (isCod ? props.codFee : 0);
  return (
    <>
      <input type="hidden" name="expectedTotal" value={total} />
      <div className="grid gap-2">
        {props.methods.map((m) => (
          <Radio
            key={m.code}
            name="paymentMethod"
            value={m.code}
            checked={method === m.code}
            onChange={() => setMethod(m.code)}
            required
            label={m.nameAr}
            description={m.code === 'COD' && props.codFee > 0 ? `${m.instructionsAr ?? ''} (رسوم التحصيل ${formatEGP(props.codFee)})` : (m.instructionsAr ?? undefined)}
          />
        ))}
      </div>
      {isCod ? (
        <p className="mt-3 text-xs text-muted">هتدفع {formatEGP(total)} نقدًا للمندوب عند الاستلام. لو رفضت الاستلام الطلب بيرجع للبائع ومفيش أي مبلغ مستحق عليك.</p>
      ) : (
        <p className="mt-3 text-xs text-muted">
          الدفع دلوقتي بالتحويل اليدوي: بعد ما تأكّد الطلب هتظهرلك بيانات التحويل، وبعدها ترفع إثبات الدفع خلال {props.windowHours} ساعة عشان فريق اضمن يراجعه. الكميات محجوزة لك طول المدة دي.
        </p>
      )}
    </>
  );
}
