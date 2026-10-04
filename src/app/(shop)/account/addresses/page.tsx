import { MapPin } from 'lucide-react';
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
      <PageHeader title="العناوين" />
      {list.length === 0 ? <EmptyState icon={MapPin} title="لا توجد عناوين محفوظة" /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <div key={a.id} className="card space-y-1 p-4 text-sm">
              <p className="font-semibold">{a.recipientName} {a.isDefault && <Badge tone="brand">افتراضي</Badge>}</p>
              <p className="text-muted">{govs.find((g) => g.id === a.governorateId)?.nameAr}، {a.city}، {a.street}</p>
              <p className="text-xs text-muted ltr">{a.phone}</p>
              <div className="flex gap-3 pt-2">
                <a href={`/account/addresses?edit=${a.id}`} className="text-xs text-brand-700 hover:underline">تعديل</a>
                <form action={archiveAddressAction}><input type="hidden" name="id" value={a.id} /><ConfirmSubmit confirm="حذف العنوان؟" variant="ghost" size="sm" className="h-auto px-0 text-xs text-red-600">حذف</ConfirmSubmit></form>
              </div>
            </div>
          ))}
        </div>
      )}
      <section className="card p-5">
        <h2 className="mb-3 font-bold">{editing ? 'تعديل العنوان' : 'إضافة عنوان'}</h2>
        <AddressForm address={editing} defaultName={user.fullName} defaultPhone={user.phone ?? ''} />
      </section>
    </div>
  );
}
