import { Users } from 'lucide-react';
import { respondStoreInvitationAction } from '@/app/_actions/account';
import { requireCustomer } from '@/server/web/session';
import { splitInvitations, staffInvitationsForUser } from '@/server/modules/sellers/service';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge, EmptyState } from '@/ui/feedback';
import Link from '@/ui/link';

export const metadata = { title: 'دعوات فرق المتاجر' };

export default async function StoreInvitationsPage() {
  const actor = await requireCustomer('/account/store-invitations');
  const list = await staffInvitationsForUser(actor.userId!);
  const { open, past } = splitInvitations(list);
  return (
    <div className="space-y-5">
      <PageHeader title="دعوات فرق المتاجر" description="لما متجر يدعوك تنضم لفريقه، الدعوة بتظهر هنا. مفيش أي صلاحية على المتجر بتتفعّل لحسابك غير لما تقبل بنفسك." />
      {open.length === 0 ? (
        <EmptyState icon={Users} title="مفيش دعوات مستنية ردك" description="لو صاحب متجر قالك إنه بعتلك دعوة، اتأكد إنه استخدم نفس البريد بتاع حسابك." />
      ) : (
        <ul className="space-y-3" data-testid="store-invitations">
          {open.map(({ inv, storeName }) => (
            <li key={inv.id} className="card space-y-2 p-4 text-sm">
              <p className="font-semibold">متجر «{storeName ?? '—'}» بيدعوك بدور {label('sellerRole', inv.role)}</p>
              <p className="text-xs text-muted">الدعوة صالحة لحد {formatDate(inv.expiresAt, true)}</p>
              <Alert tone="info">لو قبلت، هتقدر تدخل مركز البائع بصلاحيات الدور ده بس، وصاحب المتجر يقدر يشيلك من الفريق في أي وقت. حساب واحد ينفع يكون عضو في متجر واحد بس.</Alert>
              <div className="flex gap-2">
                <ActionForm action={respondStoreInvitationAction}><input type="hidden" name="invitationId" value={inv.id} /><input type="hidden" name="decision" value="ACCEPT" /><SubmitButton size="sm">قبول الدعوة</SubmitButton></ActionForm>
                <ActionForm action={respondStoreInvitationAction}><input type="hidden" name="invitationId" value={inv.id} /><input type="hidden" name="decision" value="DECLINE" /><SubmitButton size="sm" variant="outline">رفض</SubmitButton></ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">دعوات سابقة</h2>
          <ul className="divide-y divide-line rounded-xl bg-white text-sm ring-1 ring-line">
            {past.map(({ inv, storeName }) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span>{storeName ?? '—'} · {label('sellerRole', inv.role)}</span>
                <Badge tone={inv.status === 'ACCEPTED' ? 'success' : 'neutral'}>{label('storeInvitation', inv.status === 'PENDING' ? 'EXPIRED' : inv.status)}</Badge>
              </li>
            ))}
          </ul>
          {past.some(({ inv }) => inv.status === 'ACCEPTED') && <p className="text-xs"><Link href="/seller" className="text-brand-700 underline">روح لمركز البائع</Link></p>}
        </section>
      )}
    </div>
  );
}
