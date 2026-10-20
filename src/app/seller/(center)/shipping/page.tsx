import { asc, eq } from 'drizzle-orm';
import { MapPin } from 'lucide-react';
import { shippingRatesAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { governorates, sellerShippingRates } from '@/server/db/schema';
import { requireSellerActor } from '@/server/web/session';
import { toInputAmount } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';

export const metadata = { title: 'الشحن' };
const INPUT = 'h-11 w-full min-w-0 rounded-xl border border-line px-3 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100';

export default async function ShippingPage() {
  const actor = await requireSellerActor('/seller/shipping');
  const govs = await db.select().from(governorates).orderBy(asc(governorates.sortOrder));
  const rates = await db.select().from(sellerShippingRates).where(eq(sellerShippingRates.sellerId, actor.sellerId!));
  return (
    <div className="space-y-4">
      <PageHeader title="الشحن حسب المحافظة" description="أنت المسؤول عن الشحن (Seller-fulfilled). حدد المحافظات التي تشحن لها والسعر ومدة التوصيل." />
      <Alert tone="info">المحافظات غير المفعّلة لن يستطيع عملاؤها شراء منتجاتك. يمكنك ضبط الشحن المجاني فوق حد معين من صفحة المتجر.</Alert>
      <ActionForm action={shippingRatesAction} className="space-y-3">
        <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3" data-testid="shipping-rates">
          {govs.map((g) => {
            const r = rates.find((x) => x.governorateId === g.id);
            return (
              <li key={g.id} className="card space-y-3 p-4">
                <input type="hidden" name="gov" value={g.id} />
                <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-bold text-brand-950"><MapPin className="size-4 text-brand-600" aria-hidden />{g.nameAr}</span>
                  <span className="flex items-center gap-2 text-xs font-semibold text-muted">
                    بشحن هنا
                    <input type="checkbox" name={`en_${g.id}`} defaultChecked={r?.enabled} className="size-5 accent-brand-700" aria-label={`تفعيل ${g.nameAr}`} />
                  </span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="grid gap-1 text-xs font-semibold text-muted">
                    السعر (ج.م)
                    <input name={`fee_${g.id}`} defaultValue={toInputAmount(r?.fee ?? 0)} inputMode="decimal" className={INPUT} aria-label={`سعر الشحن ${g.nameAr}`} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-muted">
                    من (يوم)
                    <input name={`min_${g.id}`} type="number" min={0} max={60} defaultValue={r?.etaMinDays ?? 1} className={INPUT} aria-label="أقل مدة" />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-muted">
                    إلى (يوم)
                    <input name={`max_${g.id}`} type="number" min={0} max={60} defaultValue={r?.etaMaxDays ?? 3} className={INPUT} aria-label="أقصى مدة" />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <SubmitButton size="lg" className="w-full sm:w-auto">حفظ أسعار الشحن</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
