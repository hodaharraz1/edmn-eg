import { openDisputeAction } from '@/app/_actions/account';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';
import { notFound } from 'next/navigation';

export const metadata = { title: 'فتح نزاع' };

const REASONS: [string, string][] = [
  ['NOT_RECEIVED', 'لم أستلم الطلب'],
  ['NOT_AS_DESCRIBED', 'المنتج غير مطابق للوصف'],
  ['DAMAGED', 'المنتج تالف'],
  ['COUNTERFEIT', 'أشك أن المنتج غير أصلي'],
  ['SELLER_UNRESPONSIVE', 'البائع لا يستجيب'],
  ['OTHER', 'سبب آخر'],
];

export default async function NewDisputePage(props: PageProps<'/account/disputes/new'>) {
  const sp = await props.searchParams;
  const so = typeof sp.so === 'string' ? sp.so : '';
  const deal = typeof sp.deal === 'string' ? sp.deal : '';
  const preset = typeof sp.reason === 'string' && REASONS.some(([v]) => v === sp.reason) ? sp.reason : '';
  if (!so && !deal) notFound();
  return (
    <div className="space-y-4">
      <PageHeader title="الإبلاغ عن مشكلة" description="جرّب أولاً التواصل مع البائع أو طلب إرجاع. افتح نزاعاً إذا لم تُحل المشكلة." />
      <Alert tone="info">أثناء النزاع يتم تجميد مستحقات البائع لهذا الطلب حتى يصدر فريق اضمن قراره.</Alert>
      <ActionForm action={openDisputeAction} className="card space-y-4 p-5" encType="multipart/form-data">
        {so && <input type="hidden" name="sellerOrderId" value={so} />}
        {deal && <input type="hidden" name="dealId" value={deal} />}
        <Field label="نوع المشكلة" htmlFor="reasonCode" required>
          <Select id="reasonCode" name="reasonCode" required defaultValue={preset}>
            <option value="" disabled>اختر</option>
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="اشرح ما حدث بالتفصيل" htmlFor="description" required hint="20 حرفاً على الأقل">
          <Textarea id="description" name="description" required minLength={20} rows={5} />
        </Field>
        <Field label="المبلغ المطالب به (اختياري)" htmlFor="claimedAmount"><Input id="claimedAmount" name="claimedAmount" inputMode="decimal" dir="ltr" /></Field>
        <FileInput name="evidence" multiple label="أدلة (صور / مستندات)" accept="image/jpeg,image/png,image/webp,application/pdf" hint="حتى 8 ملفات" />
        <SubmitButton variant="accent" size="lg">فتح النزاع</SubmitButton>
      </ActionForm>
    </div>
  );
}
