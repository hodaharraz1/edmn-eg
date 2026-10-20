import { Wallet } from 'lucide-react';
import { destinationReviewAction, revealDestinationAction } from '@/app/_actions/identity';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { RevealRows } from '@/app/_components/reveal-rows';
import { hasPermission } from '@/server/core/actor';
import type { ReceivingDestinationStatus } from '@/server/db/schema';
import { DESTINATION_STATUS_LABELS, destinationQueue } from '@/server/modules/identity/receiving';
import { identityStatus, IDENTITY_LABELS } from '@/server/modules/identity/service';
import { db } from '@/server/db/client';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, Badge, EmptyState } from '@/ui/feedback';
import { Checkbox, Input, Select } from '@/ui/form';

export const metadata = { title: 'بيانات استلام الأموال' };

const TABS: { key: string; label: string; statuses: ReceivingDestinationStatus[] }[] = [
  { key: 'pending', label: 'قيد المراجعة', statuses: ['PENDING_REVIEW'] },
  { key: 'approved', label: 'معتمدة', statuses: ['APPROVED'] },
  { key: 'other', label: 'بانتظار العميل / مرفوضة', statuses: ['MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED', 'REJECTED'] },
];

export default async function ReceivingDestinationsAdmin(props: PageProps<'/admin/receiving-destinations'>) {
  const { actor, allowed } = await adminWith(['destinations.review', 'destinations.view_full']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const canReview = hasPermission(actor, 'destinations.review');
  const canReveal = hasPermission(actor, 'destinations.view_full');
  const rows = canReview ? await destinationQueue(actor, tab.statuses) : [];
  const ids = await Promise.all(rows.map((r) => identityStatus(db, r.d.userId)));
  const back = `/admin/receiving-destinations?tab=${tab.key}`;
  return (
    <div className="space-y-4">
      <PageHeader title="بيانات استلام الأموال" description="وجهات يرسل لها اضمن مبالغ مستحقة للعملاء (مثل المستردات) عند تعذر استخدام وسيلة الدفع الأصلية. ليست محفظة: لا رصيد ولا إيداع ولا سحب." />
      <Alert tone="info">الاعتماد يتطلب هوية صاحب البيانات «تم التحقق» وتأكيدك أن صاحب الحساب/المحفظة هو نفس صاحب الهوية. الاعتماد لا يحرك أي مبلغ.</Alert>
      <Tabs active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/receiving-destinations?tab=${t.key}` }))} />
      {!canReview ? <Alert tone="info">قائمة المراجعة تحتاج صلاحية «مراجعة بيانات الاستلام».</Alert> : rows.length === 0 ? <EmptyState icon={Wallet} title="لا توجد بيانات" /> : (
        <ul className="space-y-3" data-testid="destination-queue">
          {rows.map(({ d, owner }, i) => (
            <li key={d.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b>{owner}</b> · {label('payoutType', d.type)} · <span className="ltr">{d.maskedLabel}</span> · صاحب الحساب: {d.holderName} · نسخة {d.version} · {formatDate(d.createdAt, true)}</span>
                <span className="flex gap-2"><Badge tone={ids[i] === 'APPROVED' ? 'success' : 'warning'}>الهوية: {IDENTITY_LABELS[ids[i]]}</Badge><Badge>{DESTINATION_STATUS_LABELS[d.status]}</Badge></span>
              </div>
              {canReveal && <RevealRows action={revealDestinationAction} id={d.id} back={back} label="عرض البيانات كاملة (2FA، مسجل)" />}
              {d.userId !== actor.userId && ['PENDING_REVIEW', 'APPROVED'].includes(d.status) && (
                <ActionForm action={destinationReviewAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                  <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
                  <Select name="decision" required defaultValue="" aria-label="القرار" className="w-auto">
                    <option value="" disabled>القرار</option>
                    {d.status === 'PENDING_REVIEW' ? <><option value="APPROVE">اعتماد</option><option value="MORE_INFO_REQUIRED">مطلوب استكمال</option><option value="REJECT">رفض</option></> : <option value="REVERIFICATION_REQUIRED">طلب إعادة التحقق</option>}
                  </Select>
                  {d.status === 'PENDING_REVIEW' && <Checkbox name="holderMatchesIdentity" label="صاحب الحساب هو نفس صاحب الهوية المتحقق منها" />}
                  <Input name="reason" placeholder="السبب (مطلوب لغير الاعتماد)" aria-label="السبب" className="w-56" />
                  <SubmitButton size="sm">تسجيل (2FA)</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
