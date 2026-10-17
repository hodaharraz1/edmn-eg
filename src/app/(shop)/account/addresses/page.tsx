import { MapPin, MapPinPlus, Pencil, Phone, Trash2 } from 'lucide-react';
import { FormSection } from '@/ui/form';
import { archiveAddressAction } from '@/app/_actions/account';
import { AddressForm } from '@/app/_components/address-form';
import { myAddresses } from '@/server/modules/customers/addresses';
import { allGovernorates } from '@/server/web/context';
import { requireUser } from '@/server/web/session';
import { ConfirmSubmit } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Badge, EmptyState } from '@/ui/feedback';

export const metadata = { title: 'العناوين' };

export default async function AddressesPage(props: PageProps<'/account/addresses'>) {
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const list = await myAddresses(user.id);
  const govs = await allGovernorates();
  const editing = list.find((a) => a.id === sp.edit);
  return (
    <div className="space-y-6">
      <PageHeader title="العناوين" description="عناوين التوصيل المحفوظة. العنوان الافتراضي بيتختار تلقائيًا في الدفع." />
      {list.length === 0 ? <EmptyState icon={MapPin} title="مفيش عناوين محفوظة" description="ضيف عنوانك تحت علشان الدفع يبقى أسرع." /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <div key={a.id} className={`card flex flex-col gap-3 p-4 text-sm ${a.isDefault ? 'border-brand-300 ring-2 ring-brand-100' : ''} ${editing?.id === a.id ? 'ring-2 ring-brand-400' : ''}`}>
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><MapPin className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-bold text-brand-950">{a.label || a.recipientName} {a.isDefault && <Badge tone="brand">افتراضي</Badge>}</p>
                  {a.label && <p className="text-muted">{a.recipientName}</p>}
                  <p className="leading-6 text-ink/80">{govs.find((g) => g.id === a.governorateId)?.nameAr}، {a.city}، {a.street}</p>
                  <p className="flex items-center gap-1 text-xs text-muted"><Phone className="size-3.5" aria-hidden /> <span dir="ltr">{a.phone}</span></p>
                </div>
              </div>
              <div className="mt-auto flex gap-2 border-t border-line pt-3">
                <a href={`/account/addresses?edit=${a.id}#address-form`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-700 ring-1 ring-line hover:bg-soft"><Pencil className="size-4" aria-hidden /> تعديل</a>
                <form action={archiveAddressAction}><input type="hidden" name="id" value={a.id} /><ConfirmSubmit confirm="تحذف العنوان ده؟" variant="ghost" size="sm" className="min-h-10 gap-1.5 text-red-700 hover:bg-red-50"><Trash2 className="size-4" aria-hidden /> حذف</ConfirmSubmit></form>
              </div>
            </div>
          ))}
        </div>
      )}
      <FormSection id="address-form" title={editing ? 'تعديل العنوان' : 'ضيف عنوان جديد'} icon={editing ? Pencil : MapPinPlus}>
        <AddressForm address={editing} defaultName={user.fullName} defaultPhone={user.phone ?? ''} />
      </FormSection>
    </div>
  );
}
