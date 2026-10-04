import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { dealStepAction, inviteSellerAction } from '@/app/_actions/deals';
import { db } from '@/server/db/client';
import { externalDeals } from '@/server/db/schema';
import { dealProblems } from '@/server/modules/deals/service';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Stepper } from '@/ui/commerce';
import { DefinitionList, PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';
import Link from 'next/link';

export const metadata = { title: 'صفقة محمية جديدة' };
const STEPS = ['المنتج', 'البائع', 'السعر والشروط', 'التسليم', 'شروط خاصة', 'مراجعة ودعوة البائع'];

export default async function NewDealWizard(props: PageProps<'/account/deals/new'>) {
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const dealId = typeof sp.deal === 'string' ? sp.deal : '';
  let step = Math.min(6, Math.max(1, Number(sp.step) || 1));
  const [deal] = dealId ? await db.select().from(externalDeals).where(eq(externalDeals.id, dealId)) : [];
  if (dealId && (!deal || deal.buyerId !== user.id)) notFound();
  if (deal && deal.status !== 'DRAFT') return <Alert tone="info">تم إرسال هذه الصفقة بالفعل. <Link href={`/account/deals/${deal.id}`} className="underline">عرض الصفقة</Link></Alert>;
  if (!deal) step = 1;
  const hrefFor = (n: number) => (deal && n <= deal.wizardStep ? `/account/deals/new?deal=${deal.id}&step=${n}` : null);
  return (
    <div className="space-y-4">
      <PageHeader title="اضمن صفقة خارج السوق" description="اكتب تفاصيل الصفقة كما اتفقت مع البائع. سيراجعها البائع ويوافق عليها قبل الدفع." />
      <Stepper steps={STEPS} current={step} hrefFor={hrefFor} />
      {step < 6 ? (
        <ActionForm action={dealStepAction} className="card space-y-4 p-5" encType="multipart/form-data">
          {deal && <input type="hidden" name="dealId" value={deal.id} />}
          <input type="hidden" name="step" value={step} />
          {step === 1 && (
            <>
              <Field label="اسم المنتج" htmlFor="title" required><Input id="title" name="title" defaultValue={deal?.title} required /></Field>
              <Field label="وصف المنتج وحالته" htmlFor="description" required><Textarea id="description" name="description" defaultValue={deal?.description ?? ''} required rows={4} /></Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="الحالة" htmlFor="condition"><Select id="condition" name="condition" defaultValue={deal?.condition ?? 'USED'}><option value="NEW">جديد</option><option value="USED">مستعمل</option></Select></Field>
                <Field label="الكمية" htmlFor="quantity"><Input id="quantity" name="quantity" type="number" min={1} defaultValue={deal?.quantity ?? 1} /></Field>
                <Field label="النوع / التصنيف" htmlFor="productCategory"><Input id="productCategory" name="productCategory" defaultValue={deal?.productCategory ?? ''} placeholder="موبايل، لابتوب…" /></Field>
              </div>
              <Field label="رابط الإعلان الأصلي (اختياري)" htmlFor="sourceUrl"><Input id="sourceUrl" name="sourceUrl" defaultValue={deal?.sourceUrl ?? ''} dir="ltr" /></Field>
              <FileInput name="photos" multiple label="صور المنتج كما أرسلها البائع (اختياري)" />
            </>
          )}
          {step === 2 && (
            <>
              <Field label="اسم البائع" htmlFor="sellerName" required><Input id="sellerName" name="sellerName" defaultValue={deal?.sellerName ?? ''} required /></Field>
              <Field label="رقم موبايل البائع" htmlFor="sellerPhone" required hint="سنرسل له رابط الدعوة برسالة"><Input id="sellerPhone" name="sellerPhone" type="tel" dir="ltr" defaultValue={deal?.sellerPhone?.replace('+20', '0') ?? ''} required /></Field>
              <Field label="بريد البائع (اختياري)" htmlFor="sellerEmail"><Input id="sellerEmail" name="sellerEmail" type="email" dir="ltr" defaultValue={deal?.sellerEmail ?? ''} /></Field>
            </>
          )}
          {step === 3 && (
            <>
              <Field label={`سعر الوحدة (ج.م) × الكمية ${deal?.quantity ?? 1}`} htmlFor="unitPrice" required><Input id="unitPrice" name="unitPrice" inputMode="decimal" dir="ltr" defaultValue={toInputAmount(deal?.unitPrice)} required /></Field>
              <p className="text-xs text-muted">سيتم احتساب رسوم الخدمة حسب الإعدادات الحالية وعرضها في صفحة المراجعة قبل الإرسال.</p>
            </>
          )}
          {step === 4 && (
            <>
              <Field label="طريقة التسليم" htmlFor="deliveryMethod" required><Input id="deliveryMethod" name="deliveryMethod" defaultValue={deal?.deliveryMethod ?? ''} placeholder="شحن عبر شركة / تسليم يد بيد في…" required /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="آخر موعد للتسليم" htmlFor="deliveryDeadline" required><Input id="deliveryDeadline" name="deliveryDeadline" type="date" defaultValue={deal?.deliveryDeadline?.toISOString().slice(0, 10)} required /></Field>
                <Field label="مدة الفحص بعد الاستلام (أيام)" htmlFor="inspectionDays"><Input id="inspectionDays" name="inspectionDays" type="number" min={1} max={14} defaultValue={deal?.inspectionDays ?? 2} /></Field>
              </div>
            </>
          )}
          {step === 5 && (
            <Field label="شروط خاصة اتفقتم عليها (اختياري)" htmlFor="customTerms" hint="مثال: الجهاز بالعلبة والفاتورة، البطارية فوق 85%"><Textarea id="customTerms" name="customTerms" defaultValue={deal?.customTerms ?? ''} rows={5} /></Field>
          )}
          <div className="flex gap-2">
            {step > 1 && deal && <Link href={`/account/deals/new?deal=${deal.id}&step=${step - 1}`} className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm">السابق</Link>}
            <SubmitButton>حفظ والتالي</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        deal && (
          <div className="space-y-4">
            {dealProblems(deal).length > 0 && <Alert tone="warning">أكمل البيانات التالية: {dealProblems(deal).join('، ')}</Alert>}
            <section className="card p-5">
              <DefinitionList items={[
                { label: 'المنتج', value: `${deal.title} × ${deal.quantity}` },
                { label: 'البائع', value: `${deal.sellerName ?? '—'} · ${deal.sellerPhone ?? ''}` },
                { label: 'قيمة الصفقة', value: formatEGP(deal.totalAmount) },
                { label: 'رسوم الخدمة', value: `${formatEGP(deal.feeAmount)} (يتحملها ${deal.feePayer === 'BUYER' ? 'المشتري' : 'البائع'})` },
                { label: 'إجمالي ما ستدفعه', value: formatEGP(deal.buyerPays) },
                { label: 'صافي ما يستلمه البائع', value: formatEGP(deal.sellerReceives) },
                { label: 'التسليم', value: `${deal.deliveryMethod ?? '—'} · قبل ${formatDate(deal.deliveryDeadline)}` },
                { label: 'مدة الفحص', value: `${deal.inspectionDays} يوم` },
                { label: 'الشروط الخاصة', value: deal.customTerms ?? 'لا يوجد' },
              ]} />
            </section>
            <ActionForm action={inviteSellerAction} className="card space-y-3 p-5">
              <input type="hidden" name="dealId" value={deal.id} />
              <Checkbox name="acceptTerms" required label={<>أوافق على <Link href="/legal/protected-deal-terms" target="_blank" className="text-brand-700 underline">شروط الصفقات المحمية</Link> وأقر بصحة البيانات</>} />
              <SubmitButton variant="accent" size="lg">إرسال الدعوة للبائع</SubmitButton>
            </ActionForm>
          </div>
        )
      )}
    </div>
  );
}
