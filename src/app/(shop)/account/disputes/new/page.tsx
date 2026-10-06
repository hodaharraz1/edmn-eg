import { openDisputeAction } from '@/app/_actions/account';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';
import { notFound } from 'next/navigation';

export const metadata = { title: 'فتح نزاع' };

const REASONS: [string, string][] = [
  ['NOT_RECEIVED', 'ما استلمتش الطلب'],
  ['NOT_AS_DESCRIBED', 'المنتج مش مطابق للوصف'],
  ['DAMAGED', 'المنتج تالف'],
  ['DEFECTIVE', 'المنتج معيب / مش شغال'],
  ['WRONG_ITEM', 'استلمت منتج تاني'],
  ['COUNTERFEIT', 'شاكك إن المنتج مش أصلي'],
  ['SELLER_UNRESPONSIVE', 'البائع مش بيرد'],
  ['OTHER', 'سبب تاني'],
];

export default async function NewDisputePage(props: PageProps<'/account/disputes/new'>) {
  const sp = await props.searchParams;
  const so = typeof sp.so === 'string' ? sp.so : '';
  const deal = typeof sp.deal === 'string' ? sp.deal : '';
  const preset = typeof sp.reason === 'string' && REASONS.some(([v]) => v === sp.reason) ? sp.reason : '';
  if (!so && !deal) notFound();
  return (
    <div className="space-y-4">
      <PageHeader title="بلّغ عن مشكلة" description="جرّب الأول تتواصل مع البائع أو تطلب إرجاع. لو المشكلة ما اتحلتش، افتح نزاع." />
      <Alert tone="info">طول ما النزاع مفتوح، مستحقات البائع عن الطلب ده بتفضل متجمّدة لحد ما فريق اضمن ياخد قراره.</Alert>
      <ActionForm action={openDisputeAction} className="card space-y-4 p-5" encType="multipart/form-data">
        {so && <input type="hidden" name="sellerOrderId" value={so} />}
        {deal && <input type="hidden" name="dealId" value={deal} />}
        <Field label="نوع المشكلة" htmlFor="reasonCode" required>
          <Select id="reasonCode" name="reasonCode" required defaultValue={preset}>
            <option value="" disabled>اختار</option>
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="احكي اللي حصل بالتفصيل" htmlFor="description" required hint="20 حرف على الأقل">
          <Textarea id="description" name="description" required minLength={20} rows={5} />
        </Field>
        <Field label="المبلغ اللي بتطالب بيه (اختياري)" htmlFor="claimedAmount"><Input id="claimedAmount" name="claimedAmount" inputMode="decimal" dir="ltr" /></Field>
        <FileInput name="evidence" multiple label="الأدلة (صور أو مستندات)" accept="image/jpeg,image/png,image/webp,application/pdf" hint="حتى 8 ملفات" />
        <SubmitButton variant="accent" size="lg">افتح النزاع</SubmitButton>
      </ActionForm>
    </div>
  );
}
