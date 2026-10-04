import { asc, eq } from 'drizzle-orm';
import { shippingRatesAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { governorates, sellerShippingRates } from '@/server/db/schema';
import { requireSellerActor } from '@/server/web/session';
import { toInputAmount } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';

export const metadata = { title: 'الشحن' };

export default async function ShippingPage() {
  const actor = await requireSellerActor('/seller/shipping');
  const govs = await db.select().from(governorates).orderBy(asc(governorates.sortOrder));
  const rates = await db.select().from(sellerShippingRates).where(eq(sellerShippingRates.sellerId, actor.sellerId!));
  return (
    <div className="space-y-4">
      <PageHeader title="الشحن حسب المحافظة" description="أنت المسؤول عن الشحن (Seller-fulfilled). حدد المحافظات التي تشحن لها والسعر ومدة التوصيل." />
      <Alert tone="info">المحافظات غير المفعّلة لن يستطيع عملاؤها شراء منتجاتك. يمكنك ضبط الشحن المجاني فوق حد معين من صفحة المتجر.</Alert>
      <ActionForm action={shippingRatesAction} className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line bg-page/60 text-xs text-muted"><tr><th className="px-4 py-3 text-start">المحافظة</th><th className="px-4 py-3 text-start">مفعّل</th><th className="px-4 py-3 text-start">سعر الشحن (ج.م)</th><th className="px-4 py-3 text-start">أقل مدة (أيام)</th><th className="px-4 py-3 text-start">أقصى مدة (أيام)</th></tr></thead>
          <tbody className="divide-y divide-line">
            {govs.map((g) => {
              const r = rates.find((x) => x.governorateId === g.id);
              return (
                <tr key={g.id}>
                  <td className="px-4 py-2 font-medium"><input type="hidden" name="gov" value={g.id} />{g.nameAr}</td>
                  <td className="px-4 py-2"><input type="checkbox" name={`en_${g.id}`} defaultChecked={r?.enabled} className="size-4 accent-brand-700" aria-label={`تفعيل ${g.nameAr}`} /></td>
                  <td className="px-4 py-2"><input name={`fee_${g.id}`} defaultValue={toInputAmount(r?.fee ?? 0)} inputMode="decimal" className="h-8 w-24 rounded border border-line px-2" aria-label={`سعر الشحن ${g.nameAr}`} /></td>
                  <td className="px-4 py-2"><input name={`min_${g.id}`} type="number" min={0} max={60} defaultValue={r?.etaMinDays ?? 1} className="h-8 w-16 rounded border border-line px-2" aria-label="أقل مدة" /></td>
                  <td className="px-4 py-2"><input name={`max_${g.id}`} type="number" min={0} max={60} defaultValue={r?.etaMaxDays ?? 3} className="h-8 w-16 rounded border border-line px-2" aria-label="أقصى مدة" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-line p-4"><SubmitButton>حفظ أسعار الشحن</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
