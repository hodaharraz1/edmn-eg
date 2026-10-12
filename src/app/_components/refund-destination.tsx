import { and, eq } from 'drizzle-orm';
import { chooseRefundDestinationAction } from '@/app/_actions/identity';
import { db } from '@/server/db/client';
import { receivingDestinations, type refunds } from '@/server/db/schema';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Input, Select } from '@/ui/form';
import Link from '@/ui/link';

type Refund = typeof refunds.$inferSelect;

/**
 * Where a refund will be sent (customer view) — the original payment method by default; the customer may pick
 * one of THEIR OWN approved receiving destinations before the refund is approved. Showing this never moves money.
 */
export async function RefundDestination({ refund, userId, back }: { refund: Refund; userId: string; back: string }) {
  const snap = (refund.destinationSnapshot ?? {}) as { source?: string; masked?: string; method?: string };
  const where = snap.source === 'RECEIVING_DESTINATION' ? `بيانات الاستلام المعتمدة (${snap.masked ?? ''})` : 'نفس وسيلة الدفع الأصلية';
  const open = ['REQUESTED', 'UNDER_REVIEW'].includes(refund.status) && !refund.approvalId;
  const mine = open ? await db.select({ id: receivingDestinations.id, masked: receivingDestinations.maskedLabel, type: receivingDestinations.type }).from(receivingDestinations).where(and(eq(receivingDestinations.userId, userId), eq(receivingDestinations.status, 'APPROVED'))) : [];
  return (
    <div className="mt-1 space-y-1 text-xs" data-testid="refund-destination">
      <p className="text-muted">الوجهة: {where}</p>
      {open && (
        <details>
          <summary className="cursor-pointer text-brand-700">وسيلة الدفع الأصلية مش متاحة؟</summary>
          {mine.length === 0 ? (
            <p className="mt-1">أضف <Link className="text-brand-700 underline" href="/account/receiving">بيانات استلام الأموال</Link> واستنى اعتمادها، وبعدها اختارها هنا.</p>
          ) : (
            <ActionForm action={chooseRefundDestinationAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="refundId" value={refund.id} /><input type="hidden" name="back" value={back} />
              <Select name="destinationId" required aria-label="بيانات الاستلام" className="w-auto">
                {mine.map((d) => <option key={d.id} value={d.id}>{d.type === 'BANK_ACCOUNT' ? 'حساب بنكي' : 'محفظة'} {d.masked}</option>)}
              </Select>
              <Input name="reason" required minLength={5} placeholder="ليه مش هينفع وسيلة الدفع الأصلية؟" aria-label="السبب" className="w-56" />
              <SubmitButton size="sm" variant="outline">استخدمها للاسترداد</SubmitButton>
            </ActionForm>
          )}
        </details>
      )}
    </div>
  );
}
