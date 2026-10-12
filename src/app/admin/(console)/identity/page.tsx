import Link from '@/ui/link';
import { BadgeCheck } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import type { IdentityStatus } from '@/server/db/schema';
import { IDENTITY_LABELS, identityQueue } from '@/server/modules/identity/service';
import { formatDate } from '@/lib/format';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, Badge, EmptyState } from '@/ui/feedback';

export const metadata = { title: 'مركز التحقق من الهوية' };

const TABS: { key: string; label: string; statuses: IdentityStatus[] }[] = [
  { key: 'pending', label: 'قيد المراجعة', statuses: ['PENDING_REVIEW'] },
  { key: 'action', label: 'بانتظار العميل', statuses: ['MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED'] },
  { key: 'approved', label: 'تم التحقق', statuses: ['APPROVED'] },
  { key: 'rejected', label: 'مرفوض', statuses: ['REJECTED'] },
];

export default async function IdentityQueue(props: PageProps<'/admin/identity'>) {
  const { actor, allowed } = await adminWith('identity.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const rows = await identityQueue(actor, tab.statuses);
  return (
    <div className="space-y-4">
      <PageHeader title="مركز التحقق من الهوية" description="هوية واحدة على مستوى المستخدم تُستخدم للشراء والبيع في السوق والصفقات المحمية. التحقق من الهوية ليس اعتمادًا للمتجر ولا اعتمادًا لوسيلة سحب." />
      <Alert tone="info">حالات «ربط من طلب بائع سابق» لم تُعتمد تلقائيًا أبدًا: قرار البائع السابق كان لطلب المتجر، والهوية تحتاج مراجعة مستقلة.</Alert>
      <Tabs active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/identity?tab=${t.key}` }))} />
      {rows.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="لا توجد حالات" />
      ) : (
        <ul className="space-y-2" data-testid="identity-queue">
          {rows.map(({ v, name }) => (
            <li key={v.id} className="card flex flex-wrap items-center justify-between gap-2 p-4">
              <span>
                <Link href={`/admin/identity/${v.id}`} className="font-semibold text-brand-700">{name}</Link>
                {v.source === 'LEGACY_SELLER_APPLICATION' && <Badge tone="warning" className="ms-2">ربط من طلب بائع سابق</Badge>}
                <span className="block text-xs text-muted">آخر 4 أرقام: <span className="ltr">{v.nationalIdLast4 ?? '—'}</span> · نسخة التقديم {v.submissionVersion} · {formatDate(v.submittedAt, true)}</span>
              </span>
              <Badge tone={v.status === 'APPROVED' ? 'success' : v.status === 'REJECTED' ? 'danger' : 'warning'}>{IDENTITY_LABELS[v.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
