import { asc } from 'drizzle-orm';
import { destinationAction, paymentMethodAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { paymentDestinations, paymentMethods } from '@/server/db/schema';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'إعدادات الدفع' };
const FIELDS: [string, string][] = [['bankName', 'اسم البنك'], ['accountName', 'اسم صاحب الحساب'], ['accountNumber', 'رقم الحساب'], ['iban', 'IBAN'], ['instapayAddress', 'عنوان إنستاباي (IPA)'], ['walletNumber', 'رقم المحفظة']];

function DestinationForm({ d }: { d?: typeof paymentDestinations.$inferSelect }) {
  return (
    <ActionForm action={destinationAction} className="grid gap-3 md:grid-cols-3">
      {d && <input type="hidden" name="id" value={d.id} />}<input type="hidden" name="back" value="/admin/payment-settings" />
      <Field label="الطريقة"><Select name="methodCode" defaultValue={d?.methodCode ?? 'BANK_TRANSFER'}>{['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH'].map((m) => <option key={m} value={m}>{label('paymentMethod', m)}</option>)}</Select></Field>
      <Field label="الاسم الظاهر" required><Input name="label" required defaultValue={d?.label} /></Field>
      <Field label="الترتيب"><Input name="sortOrder" type="number" defaultValue={d?.sortOrder ?? 0} /></Field>
      {FIELDS.map(([k, l]) => <Field key={k} label={l}><Input name={k} defaultValue={d?.details?.[k] ?? ''} className="ltr" /></Field>)}
      <Field label="تعليمات إضافية" className="md:col-span-3"><Textarea name="instructionsAr" rows={2} defaultValue={d?.instructionsAr ?? ''} /></Field>
      <Checkbox name="isEnabled" label="مفعّل ويظهر للعملاء" defaultChecked={d?.isEnabled ?? false} />
      <Input name="reason" required minLength={3} placeholder="سبب التعديل" aria-label="السبب" />
      <SubmitButton size="sm">حفظ</SubmitButton>
    </ActionForm>
  );
}

export default async function PaymentSettings() {
  const { allowed } = await adminWith('payments.destinations.manage');
  if (!allowed) return <Forbidden />;
  const methods = await db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder));
  const dests = await db.select().from(paymentDestinations).orderBy(asc(paymentDestinations.sortOrder));
  return (
    <div className="space-y-4">
      <PageHeader title="إعدادات الدفع" description="طرق الدفع اليدوية وحسابات الاستلام الرسمية التي تظهر للعملاء عند الدفع." />
      <Alert tone="danger" title="هام">لا تُدخل إلا حسابات استلام رسمية مملوكة للشركة بعد التحقق منها. الحسابات المزروعة في بيئة التطوير وهمية (معطلة) ولا يجوز استخدامها. كل تعديل يتطلب تحققاً إضافياً (2FA) ويُسجّل.</Alert>
      <section className="space-y-3">
        <h2 className="font-bold">طرق الدفع</h2>
        {methods.map((m) => (
          <ActionForm key={m.code} action={paymentMethodAction} className="card grid gap-3 p-4 md:grid-cols-[1fr_2fr]">
            <input type="hidden" name="code" value={m.code} /><input type="hidden" name="back" value="/admin/payment-settings" />
            <div><b>{m.nameAr}</b> {m.isEnabled ? <Badge tone="success">مفعّلة</Badge> : <Badge tone="neutral">معطلة</Badge>}<Checkbox name="isEnabled" label="مفعّلة" defaultChecked={m.isEnabled} /><Field label="الترتيب"><Input name="sortOrder" type="number" defaultValue={m.sortOrder} /></Field></div>
            <div className="space-y-2"><Field label="تعليمات الدفع للعميل"><Textarea name="instructionsAr" rows={3} defaultValue={m.instructionsAr ?? ''} /></Field><div className="flex gap-2"><Input name="reason" required minLength={3} placeholder="سبب التعديل" aria-label="السبب" /><SubmitButton size="sm">حفظ</SubmitButton></div></div>
          </ActionForm>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="font-bold">حسابات الاستلام</h2>
        {dests.map((d) => (
          <details key={d.id} className="card p-4">
            <summary className="cursor-pointer"><b>{d.label}</b> · {label('paymentMethod', d.methodCode)} {d.isEnabled ? <Badge tone="success">مفعّل</Badge> : <Badge tone="neutral">معطل</Badge>}</summary>
            <div className="mt-3"><DestinationForm d={d} /></div>
          </details>
        ))}
        <div className="card p-4"><h3 className="mb-2 font-semibold">حساب استلام جديد</h3><DestinationForm /></div>
      </section>
    </div>
  );
}
