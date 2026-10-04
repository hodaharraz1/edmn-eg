import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { requestReturnAction } from '@/app/_actions/account';
import { db } from '@/server/db/client';
import { orders, orderItems, sellerOrders, stores } from '@/server/db/schema';
import { returnWindow } from '@/server/modules/postpurchase/returns';
import { requireUser } from '@/server/web/session';
import { RETURN_REASONS } from '@/domain/machines';
import { formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Field, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'طلب إرجاع' };

export default async function NewReturnPage(props: PageProps<'/account/returns/new'>) {
  const user = await requireUser('/account');
  const soId = (await props.searchParams).so;
  if (typeof soId !== 'string' || !/^[0-9a-f-]{36}$/.test(soId)) notFound();
  const [row] = await db.select({ so: sellerOrders, order: orders, store: stores.name }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).innerJoin(stores, eq(stores.sellerId, sellerOrders.sellerId)).where(eq(sellerOrders.id, soId));
  if (!row || row.order.customerId !== user.id) notFound();
  const items = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, soId));
  const win = await returnWindow(db, row.so.sellerId);
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'طلباتي', href: '/account/orders' }, { label: `#${row.order.number}-${row.so.suffix}`, href: `/account/orders/${row.order.id}` }, { label: 'طلب إرجاع' }]} />} title="طلب إرجاع" description={`من ${row.store}`} />
      <Alert tone="info">
        يمكنك طلب الإرجاع خلال {win.effective} يوم من الاستلام. {win.voluntary ? `يقبل هذا البائع الإرجاع الاختياري خلال ${win.voluntary} يوم.` : 'البائع لا يقدم إرجاعاً اختيارياً، دون الإخلال بحقوقك المقررة قانوناً.'} للمنتجات التالفة أو المعيبة أرفق صوراً واضحة.
      </Alert>
      <ActionForm action={requestReturnAction} className="card space-y-5 p-5" encType="multipart/form-data">
        <input type="hidden" name="sellerOrderId" value={soId} />
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">المنتجات المراد إرجاعها</legend>
          {items.map((it) => {
            const max = it.quantity - it.returnedQuantity;
            return (
              <label key={it.id} className={`flex items-center gap-3 rounded-lg border border-line p-3 text-sm ${max <= 0 ? 'opacity-50' : ''}`}>
                <input type="checkbox" name="item" value={it.id} disabled={max <= 0} className="size-4 accent-brand-700" />
                <span className="flex-1">{it.titleSnapshot} <span className="text-xs text-muted">{it.variantLabel} · {formatEGP(it.unitPrice)}</span></span>
                <select name={`qty_${it.id}`} disabled={max <= 0} className="h-8 rounded border border-line px-1" aria-label="الكمية">
                  {Array.from({ length: Math.max(1, max) }, (_, i) => (
                    <option key={i} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </fieldset>
        <Field label="سبب الإرجاع" htmlFor="reason" required>
          <Select id="reason" name="reason" required defaultValue="">
            <option value="" disabled>اختر السبب</option>
            {RETURN_REASONS.map((r) => (
              <option key={r} value={r}>{label('returnReason', r)}</option>
            ))}
          </Select>
        </Field>
        <Field label="اشرح المشكلة" htmlFor="description" required>
          <Textarea id="description" name="description" required minLength={10} rows={4} />
        </Field>
        <FileInput name="evidence" multiple label="صور توضح حالة المنتج (مطلوبة للتالف / المعيب)" hint="حتى 6 صور" accept="image/jpeg,image/png,image/webp" />
        <SubmitButton size="lg">إرسال طلب الإرجاع</SubmitButton>
      </ActionForm>
    </div>
  );
}
