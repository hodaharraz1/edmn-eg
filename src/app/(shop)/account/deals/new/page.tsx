import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { dealStepAction, inviteSellerAction } from '@/app/_actions/deals';
import { db } from '@/server/db/client';
import { externalDeals, governorates } from '@/server/db/schema';
import { decryptLocation } from '@/server/modules/locations';
import { LocationPicker } from '@/app/_components/location-picker';
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
const STEPS = ['المنتج', 'السعر المطلوب', 'توقعات التسليم', 'شروط خاصة', 'عنوان الاستلام', 'المراجعة'];

export default async function NewDealWizard(props: PageProps<'/account/deals/new'>) {
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const dealId = typeof sp.deal === 'string' ? sp.deal : '';
  let step = Math.min(6, Math.max(1, Number(sp.step) || 1));
  const [deal] = dealId ? await db.select().from(externalDeals).where(eq(externalDeals.id, dealId)) : [];
  if (dealId && (!deal || deal.buyerId !== user.id)) notFound();
  if (deal && deal.status !== 'DRAFT') return <Alert tone="info">طلب الصفقة دي اتعمل خلاص. <Link href={`/account/deals/${deal.id}`} className="underline">شوف الصفقة</Link></Alert>;
  if (!deal) step = 1;
  const govs = await db.select({ id: governorates.id, nameAr: governorates.nameAr }).from(governorates).orderBy(asc(governorates.sortOrder));
  const myLoc = deal ? decryptLocation(deal.buyerLocationEnc) : null;
  const govName = (id?: number | null) => govs.find((g) => g.id === id)?.nameAr ?? '—';
  const hrefFor = (n: number) => (deal && n <= deal.wizardStep ? `/account/deals/new?deal=${deal.id}&step=${n}` : null);
  return (
    <div className="space-y-4">
      <PageHeader title="اضمن صفقة خارج السوق" description="اكتب تفاصيل الصفقة زي ما اتفقت مع البائع. بعدها هتاخد رابط آمن تبعته له، وهو يراجع ويوافق قبل أي دفع." />
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
              <FileInput name="photos" multiple label="صور المنتج اللي بعتها البائع (اختياري)" />
            </>
          )}
          {step === 2 && (
            <>
              <Field label={`سعر الوحدة (ج.م) × الكمية ${deal?.quantity ?? 1}`} htmlFor="unitPrice" required><Input id="unitPrice" name="unitPrice" inputMode="decimal" dir="ltr" defaultValue={toInputAmount(deal?.unitPrice)} required /></Field>
              <p className="text-xs text-muted">رسوم خدمة الضمان تدريجية حسب قيمة الصفقة ومقسومة بالتساوي بينك وبين البائع، وهتشوفها في صفحة المراجعة قبل الإرسال.</p>
            </>
          )}
          {step === 3 && (
            <>
              <p className="rounded-lg bg-brand-50 p-2 text-xs text-brand-900">دي توقعاتك بس. البائع هو اللي بيحدد طريقة ومدة التوصيل ومصاريف الشحن في عرضه، وانت توافق أو تطلب تعديل قبل أي دفع.</p>
              <Field label="طريقة التسليم المفضلة" htmlFor="deliveryMethod" required><Input id="deliveryMethod" name="deliveryMethod" defaultValue={deal?.deliveryMethod ?? ''} placeholder="شحن عبر شركة / تسليم يد بيد في…" required /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="آخر موعد تحب تستلم قبله" htmlFor="deliveryDeadline" required><Input id="deliveryDeadline" name="deliveryDeadline" type="date" defaultValue={deal?.deliveryDeadline?.toISOString().slice(0, 10)} required /></Field>
                <Field label="مدة الفحص بعد الاستلام (أيام)" htmlFor="inspectionDays"><Input id="inspectionDays" name="inspectionDays" type="number" min={1} max={14} defaultValue={deal?.inspectionDays ?? 2} /></Field>
              </div>
            </>
          )}
          {step === 4 && (
            <Field label="شروط خاصة اتفقتوا عليها (اختياري)" htmlFor="customTerms" hint="مثال: الجهاز بالعلبة والفاتورة، البطارية فوق 85%"><Textarea id="customTerms" name="customTerms" defaultValue={deal?.customTerms ?? ''} rows={5} /></Field>
          )}
          {step === 5 && (
            <>
              <LocationPicker governorates={govs} title="عنوان الاستلام (عنوانك)" defaults={myLoc ?? undefined} />
              <div className="space-y-3 rounded-xl border border-dashed border-line p-4">
                <p className="text-sm font-semibold">بيانات البائع (اختياري)</p>
                <p className="rounded-lg bg-brand-50 p-2 text-sm text-brand-900" data-testid="seller-optional-note">مش لازم تكون عارف بيانات البائع كاملة. بعد ما الطلب يتعمل هتاخد رابط آمن تبعته للبائع، وهو هيسجّل بياناته ويراجع الصفقة بنفسه.</p>
                <Field label="اسم البائع (للتذكير فقط)" htmlFor="sellerName"><Input id="sellerName" name="sellerName" defaultValue={deal?.sellerName ?? ''} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="موبايل البائع" htmlFor="sellerPhone"><Input id="sellerPhone" name="sellerPhone" type="tel" dir="ltr" defaultValue={deal?.sellerPhone?.replace('+20', '0') ?? ''} /></Field>
                  <Field label="إيميل البائع" htmlFor="sellerEmail"><Input id="sellerEmail" name="sellerEmail" type="email" dir="ltr" defaultValue={deal?.sellerEmail ?? ''} /></Field>
                </div>
              </div>
            </>
          )}
          <div className="flex gap-2">
            {step > 1 && deal && <Link href={`/account/deals/new?deal=${deal.id}&step=${step - 1}`} className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm">السابق</Link>}
            <SubmitButton>حفظ والتالي</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        deal && (
          <div className="space-y-4">
            {dealProblems(deal).length > 0 && <Alert tone="warning">كمّل البيانات دي: {dealProblems(deal).join('، ')}</Alert>}
            <section className="card p-5">
              <DefinitionList items={[
                { label: 'المنتج', value: `${deal.title} × ${deal.quantity}` },
                { label: 'عنوان الاستلام', value: myLoc ? `${govName(myLoc.governorateId)} · ${myLoc.city} · ${myLoc.street}${myLoc.gps ? ' · (موقع محدد)' : ''}` : '—' },
                { label: 'البائع', value: deal.sellerName ? `${deal.sellerName} (للتذكير — البائع بيسجّل بياناته بنفسه)` : 'البائع هيسجّل بياناته من الرابط' },
                { label: 'قيمة الصفقة', value: formatEGP(deal.totalAmount) },
                { label: 'رسوم خدمة الضمان من اضمن (تقديرية)', value: formatEGP((deal.buyerPays ?? 0) - (deal.totalAmount ?? 0)) },
                { label: 'الإجمالي التقريبي اللي هتدفعه', value: formatEGP(deal.buyerPays) },
                { label: 'توقعات التسليم (غير ملزمة)', value: `${deal.deliveryMethod ?? '—'} · يُفضّل قبل ${formatDate(deal.deliveryDeadline)}` },
                { label: 'مدة الفحص', value: `${deal.inspectionDays} يوم` },
                { label: 'الشروط الخاصة', value: deal.customTerms ?? 'مفيش' },
              ]} />
            </section>
            <ActionForm action={inviteSellerAction} className="card space-y-3 p-5">
              <input type="hidden" name="dealId" value={deal.id} />
              <Checkbox name="acceptTerms" required label={<>أوافق على <Link href="/legal/protected-deal-terms" target="_blank" className="text-brand-700 underline">شروط الصفقات المحمية</Link> وأقر بصحة البيانات</>} />
              <p className="text-xs text-muted">السعر النهائي (مع الشحن) وسياسة الإرجاع بيحددهم البائع في عرضه، وانت هتراجعهم وتوافق قبل الدفع.</p>
              <SubmitButton variant="accent" size="lg" className="w-full sm:w-auto">إنشاء طلب الصفقة</SubmitButton>
            </ActionForm>
          </div>
        )
      )}
    </div>
  );
}
