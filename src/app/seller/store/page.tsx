import { eq } from 'drizzle-orm';
import { storeSettingsAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { files, stores } from '@/server/db/schema';
import { requireSellerActor } from '@/server/web/session';
import { toInputAmount } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { mediaUrl } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Checkbox, Field, FormSection, Input, Textarea } from '@/ui/form';

export const metadata = { title: 'إعدادات المتجر' };

export default async function StoreSettings() {
  const actor = await requireSellerActor('/seller/store');
  const [s] = await db.select().from(stores).where(eq(stores.sellerId, actor.sellerId!));
  if (!s) return <Alert tone="warning">أكمل بيانات المتجر من طلب الانضمام أولاً.</Alert>;
  const [logo] = s.logoFileId ? await db.select({ key: files.storageKey }).from(files).where(eq(files.id, s.logoFileId)) : [];
  return (
    <div className="space-y-4">
      <PageHeader title="إعدادات المتجر" />
      <ActionForm action={storeSettingsAction} className="space-y-4" encType="multipart/form-data">
        <FormSection title="الهوية">
          <div className="flex items-center gap-4">
            <span className="grid size-20 place-items-center overflow-hidden rounded-2xl bg-brand-50 text-2xl font-bold text-brand-700">{logo ? <img src={mediaUrl(logo.key, 'thumb')!} alt="" className="size-full object-cover" /> : s.name.charAt(0)}</span>
            <div className="flex-1"><FileInput name="logo" label="تغيير الشعار" /></div>
          </div>
          <FileInput name="banner" label="صورة الغلاف (اختياري)" />
          <Field label="اسم المتجر" htmlFor="name" required><Input id="name" name="name" defaultValue={s.name} required /></Field>
          <Field label="الوصف" htmlFor="description"><Textarea id="description" name="description" defaultValue={s.description ?? ''} rows={3} /></Field>
          <Field label="هاتف خدمة العملاء" htmlFor="supportPhone"><Input id="supportPhone" name="supportPhone" defaultValue={s.supportPhone ?? ''} dir="ltr" /></Field>
        </FormSection>
        <FormSection title="الشحن">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مدة التجهيز الافتراضية (أيام عمل)" htmlFor="defaultProcessingDays"><Input id="defaultProcessingDays" name="defaultProcessingDays" type="number" min={0} max={30} defaultValue={s.defaultProcessingDays} /></Field>
            <Field label="شحن مجاني للطلبات فوق (ج.م) — اختياري" htmlFor="freeShippingThreshold"><Input id="freeShippingThreshold" name="freeShippingThreshold" defaultValue={toInputAmount(s.freeShippingThreshold)} dir="ltr" /></Field>
          </div>
          <Field label="سياسة الشحن (تظهر للعملاء)" htmlFor="shippingPolicy"><Textarea id="shippingPolicy" name="shippingPolicy" defaultValue={s.shippingPolicy ?? ''} rows={2} /></Field>
        </FormSection>
        <FormSection title="الإرجاع" description="سياستك الاختيارية لا تلغي حقوق المستهلك المقررة قانوناً.">
          <Field label="عنوان استلام المرتجعات" htmlFor="returnAddress" required><Input id="returnAddress" name="returnAddress" defaultValue={s.returnAddress ?? ''} required /></Field>
          <Checkbox name="acceptsVoluntaryReturns" defaultChecked={s.acceptsVoluntaryReturns} label="أقبل الإرجاع الاختياري" />
          <Field label="مدة الإرجاع الاختياري (أيام)" htmlFor="voluntaryReturnDays"><Input id="voluntaryReturnDays" name="voluntaryReturnDays" type="number" min={1} max={365} defaultValue={s.voluntaryReturnDays ?? ''} /></Field>
          <Field label="شروط الإرجاع" htmlFor="returnConditions"><Textarea id="returnConditions" name="returnConditions" defaultValue={s.returnConditions ?? ''} rows={2} /></Field>
        </FormSection>
        <SubmitButton size="lg">حفظ الإعدادات</SubmitButton>
      </ActionForm>
    </div>
  );
}
