import Link from 'next/link';
import { and, eq, isNull } from 'drizzle-orm';
import { CheckCircle2, Circle } from 'lucide-react';
import { onboardingStepAction } from '@/app/_actions/seller-onboarding';
import { db } from '@/server/db/client';
import { sellerDocuments, sellerPayoutMethods, stores } from '@/server/db/schema';
import { applicationChecklist, sellerContextForUser } from '@/server/modules/sellers/service';
import { getSetting } from '@/server/modules/settings';
import { allGovernorates } from '@/server/web/context';
import { requireUser } from '@/server/web/session';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Stepper } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';
import { redirect } from 'next/navigation';

export const metadata = { title: 'طلب الانضمام كبائع' };
const STEPS = ['الهوية والعنوان', 'بيانات النشاط', 'المتجر', 'الوثائق', 'استلام الأرباح', 'المراجعة والإرسال'];

export default async function OnboardingPage(props: PageProps<'/seller/onboarding'>) {
  const user = await requireUser('/seller');
  const ctx = (await sellerContextForUser(user.id))!;
  const s = ctx.seller;
  if (!['DRAFT', 'MORE_INFO_REQUIRED'].includes(s.status)) redirect('/seller');
  const sp = await props.searchParams;
  let step = Math.min(6, Math.max(1, Number(sp.step) || s.onboardingStep));
  if (step === 2 && s.type !== 'BUSINESS') step = 3;
  const govs = await allGovernorates();
  const [store] = await db.select().from(stores).where(eq(stores.sellerId, s.id));
  const docs = await db.select().from(sellerDocuments).where(and(eq(sellerDocuments.sellerId, s.id), isNull(sellerDocuments.supersededAt)));
  const [payout] = await db.select().from(sellerPayoutMethods).where(and(eq(sellerPayoutMethods.sellerId, s.id), eq(sellerPayoutMethods.status, 'PENDING_VERIFICATION')));
  const checklist = await applicationChecklist(db, s);
  const businessDocs = s.type === 'BUSINESS' ? await getSetting('sellers.businessRequiredDocuments') : [];
  const hasDoc = (k: string) => docs.some((d) => d.kind === k);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="طلب الانضمام كبائع" description={`نوع الحساب: ${label('sellerType', s.type)}`} />
      {s.status === 'MORE_INFO_REQUIRED' && <Alert tone="warning" title="مطلوب منك معلومات إضافية">{s.statusReason}</Alert>}
      <Stepper steps={STEPS} current={step} hrefFor={(n) => (n <= s.onboardingStep + 1 ? `/seller/onboarding?step=${n}` : null)} />
      <ActionForm action={onboardingStepAction} className="card space-y-4 p-5" encType="multipart/form-data">
        <input type="hidden" name="step" value={step} />
        {step === 1 && (
          <>
            <Field label="نوع الحساب" htmlFor="type"><Select id="type" name="type" defaultValue={s.type}><option value="INDIVIDUAL">فرد</option><option value="BUSINESS">شركة / نشاط تجاري</option></Select></Field>
            <Field label="الاسم القانوني الكامل (كما في البطاقة)" htmlFor="legalName" required><Input id="legalName" name="legalName" defaultValue={s.legalName ?? ''} required /></Field>
            <Field label="الرقم القومي (14 رقماً)" htmlFor="nationalId" required hint={s.nationalIdLast4 ? `محفوظ بشكل مشفر (ينتهي بـ ${s.nationalIdLast4}) — أعد إدخاله للتعديل` : 'يُحفظ مشفراً ولا يظهر للعملاء'}>
              <Input id="nationalId" name="nationalId" inputMode="numeric" maxLength={14} dir="ltr" required autoComplete="off" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="رقم الموبايل" htmlFor="mobile" required hint={s.mobileVerifiedAt ? 'مؤكد ✓' : 'يجب أن يكون نفس رقم حسابك المؤكد'}><Input id="mobile" name="mobile" dir="ltr" defaultValue={s.mobile?.replace('+20', '0') ?? ''} required /></Field>
              <Field label="البريد الإلكتروني" htmlFor="email" required><Input id="email" name="email" type="email" dir="ltr" defaultValue={s.email ?? ''} required /></Field>
            </div>
            <Field label="العنوان" htmlFor="addressLine" required><Input id="addressLine" name="addressLine" defaultValue={s.addressLine ?? ''} required /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="المدينة" htmlFor="city" required><Input id="city" name="city" defaultValue={s.city ?? ''} required /></Field>
              <Field label="المحافظة" htmlFor="governorateId" required>
                <Select id="governorateId" name="governorateId" defaultValue={s.governorateId ?? ''} required><option value="" disabled>اختر</option>{govs.map((g) => <option key={g.id} value={g.id}>{g.nameAr}</option>)}</Select>
              </Field>
            </div>
            {!s.mobileVerifiedAt && <Alert tone="warning">رقم الموبايل غير مؤكد. أكّده من <Link className="underline" href="/account/security">إعدادات الأمان</Link> قبل إرسال الطلب.</Alert>}
          </>
        )}
        {step === 2 && (
          <>
            <Field label="الاسم القانوني للنشاط" htmlFor="businessLegalName" required><Input id="businessLegalName" name="businessLegalName" defaultValue={s.businessLegalName ?? ''} required /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="رقم السجل التجاري" htmlFor="commercialRegistrationNo"><Input id="commercialRegistrationNo" name="commercialRegistrationNo" defaultValue={s.commercialRegistrationNo ?? ''} dir="ltr" /></Field>
              <Field label="رقم التسجيل الضريبي" htmlFor="taxRegistrationNo"><Input id="taxRegistrationNo" name="taxRegistrationNo" defaultValue={s.taxRegistrationNo ?? ''} dir="ltr" /></Field>
            </div>
            <Field label="عنوان النشاط" htmlFor="businessAddress" required><Input id="businessAddress" name="businessAddress" defaultValue={s.businessAddress ?? ''} required /></Field>
            <Field label="الممثل القانوني / المفوض" htmlFor="authorizedRepresentative" required><Input id="authorizedRepresentative" name="authorizedRepresentative" defaultValue={s.authorizedRepresentative ?? ''} required /></Field>
          </>
        )}
        {step === 3 && (
          <>
            <Field label="اسم المتجر" htmlFor="name" required><Input id="name" name="name" defaultValue={store?.name} required /></Field>
            <Field label="وصف المتجر" htmlFor="description"><Textarea id="description" name="description" defaultValue={store?.description ?? ''} rows={3} /></Field>
            <Field label="عنوان استلام المرتجعات" htmlFor="returnAddress" required><Input id="returnAddress" name="returnAddress" defaultValue={store?.returnAddress ?? ''} required /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="محافظة عنوان الإرجاع" htmlFor="returnGovernorateId" required>
                <Select id="returnGovernorateId" name="returnGovernorateId" defaultValue={store?.returnGovernorateId ?? s.governorateId ?? ''} required><option value="" disabled>اختر</option>{govs.map((g) => <option key={g.id} value={g.id}>{g.nameAr}</option>)}</Select>
              </Field>
              <Field label="هاتف خدمة العملاء (اختياري)" htmlFor="supportPhone"><Input id="supportPhone" name="supportPhone" dir="ltr" defaultValue={store?.supportPhone ?? ''} /></Field>
            </div>
            <FileInput name="logo" label="شعار المتجر (اختياري)" />
          </>
        )}
        {step === 4 && (
          <>
            <Alert tone="info">الوثائق تُحفظ في تخزين خاص مشفّر الوصول، ولا يطلع عليها إلا فريق مراجعة البائعين.</Alert>
            {(['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', ...businessDocs] as string[]).map((k) => (
              <div key={k} className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-semibold">{label('docKind', k)} {hasDoc(k) ? <Badge tone="success">تم الرفع</Badge> : <Badge tone="warning">مطلوب</Badge>}</p>
                <FileInput name={k} label={hasDoc(k) ? 'استبدال الملف' : 'رفع الملف'} accept="image/jpeg,image/png,image/webp,application/pdf" hint="صورة واضحة أو PDF" />
              </div>
            ))}
          </>
        )}
        {step === 5 && (
          <>
            {payout && <Alert tone="success">الوسيلة الحالية: {payout.maskedLabel}. يمكنك استبدالها بإدخال بيانات جديدة.</Alert>}
            <Field label="وسيلة استلام الأرباح" htmlFor="payoutType"><Select id="payoutType" name="payoutType" defaultValue={payout?.type ?? 'INSTAPAY'}><option value="INSTAPAY">إنستاباي</option><option value="MOBILE_WALLET">محفظة موبايل</option><option value="BANK_ACCOUNT">حساب بنكي</option></Select></Field>
            <Field label="اسم صاحب الحساب" htmlFor="holderName" required><Input id="holderName" name="holderName" defaultValue={s.legalName ?? ''} required /></Field>
            <Field label="عنوان إنستاباي" htmlFor="instapayAddress" hint="مطلوب لإنستاباي"><Input id="instapayAddress" name="instapayAddress" dir="ltr" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="مزود المحفظة" htmlFor="walletProvider"><Input id="walletProvider" name="walletProvider" placeholder="فودافون كاش" /></Field>
              <Field label="رقم المحفظة" htmlFor="walletNumber"><Input id="walletNumber" name="walletNumber" dir="ltr" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="البنك" htmlFor="bankName"><Input id="bankName" name="bankName" /></Field>
              <Field label="رقم الحساب" htmlFor="accountNumber"><Input id="accountNumber" name="accountNumber" dir="ltr" /></Field>
              <Field label="IBAN" htmlFor="iban"><Input id="iban" name="iban" dir="ltr" /></Field>
            </div>
          </>
        )}
        {step === 6 && (
          <>
            <ul className="space-y-2">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-sm">{c.ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Circle className="size-5 text-slate-300" />} {c.label}</li>
              ))}
            </ul>
            <Checkbox name="acceptAgreement" required label={<>قرأت وأوافق على <Link href="/legal/seller-agreement" target="_blank" className="text-brand-700 underline">اتفاقية البائع</Link> و<Link href="/legal/prohibited-products" target="_blank" className="text-brand-700 underline">سياسة المنتجات المحظورة</Link> و<Link href="/legal/fees" target="_blank" className="text-brand-700 underline">الرسوم والعمولات</Link></>} />
          </>
        )}
        <div className="flex gap-2">
          {step > 1 && <Link href={`/seller/onboarding?step=${step === 3 && s.type !== 'BUSINESS' ? 1 : step - 1}`} className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm">السابق</Link>}
          <SubmitButton>{step === 6 ? 'إرسال الطلب للمراجعة' : 'حفظ والتالي'}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
