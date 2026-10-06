import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Pilot/staging safety label for anything that looks like a payment destination or a payout. */
export function TestMoneyNotice({ kind = 'payment', className }: { kind?: 'payment' | 'payout'; className?: string }) {
  return (
    <div role="note" className={cn('flex items-start gap-3 rounded-xl border-2 border-dashed border-red-400 bg-red-50 p-4 text-red-900', className)}>
      <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1 text-sm">
        <p className="font-bold" dir="ltr">{kind === 'payment' ? 'TEST PAYMENT DESTINATION — NOT FOR REAL MONEY' : 'TEST PAYOUT — NO REAL MONEY IS TRANSFERRED'}</p>
        <p>
          {kind === 'payment'
            ? 'دي وجهة دفع تجريبية. متحوّلش أي فلوس حقيقية — ارفع أي صورة كإثبات تجريبي، وفريق اضمن هيأكّدها يدوياً عشان تكمّل التجربة.'
            : 'سحب تجريبي: تقفيله بيحدّث الأرصدة في النظام بس، ومفيش أي فلوس حقيقية بتتحوّل للبائع.'}
        </p>
      </div>
    </div>
  );
}

export function TestBadge({ className }: { className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-800', className)} dir="ltr">TEST</span>;
}
