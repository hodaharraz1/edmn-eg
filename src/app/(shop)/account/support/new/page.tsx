import { openTicketAction } from '@/app/_actions/account';
import { TICKET_TYPES } from '@/domain/machines';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'تذكرة دعم جديدة' };

export default async function NewTicket(props: PageProps<'/account/support/new'>) {
  const sp = await props.searchParams;
  return (
    <div>
      <PageHeader title="تذكرة دعم جديدة" />
      <ActionForm action={openTicketAction} className="card space-y-4 p-5" encType="multipart/form-data">
        <input type="hidden" name="relatedType" value={typeof sp.rt === 'string' ? sp.rt : ''} />
        <input type="hidden" name="relatedId" value={typeof sp.rid === 'string' ? sp.rid : ''} />
        <Field label="نوع المشكلة" htmlFor="type" required>
          <Select id="type" name="type" defaultValue={typeof sp.type === 'string' ? sp.type : 'ORDER'}>
            {TICKET_TYPES.map((t) => <option key={t} value={t}>{label('ticketType', t)}</option>)}
          </Select>
        </Field>
        <Field label="العنوان" htmlFor="subject" required><Input id="subject" name="subject" required minLength={5} /></Field>
        <Field label="التفاصيل" htmlFor="body" required hint="اذكر رقم الطلب إن وجد"><Textarea id="body" name="body" required minLength={10} rows={5} /></Field>
        <Field label="مرفق (اختياري)" htmlFor="attachment"><input id="attachment" type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-sm" /></Field>
        <SubmitButton>إرسال</SubmitButton>
      </ActionForm>
    </div>
  );
}
