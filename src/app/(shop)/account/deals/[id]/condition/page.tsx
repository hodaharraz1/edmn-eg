import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { externalDeals } from '@/server/db/schema';
import { reportForDeal } from '@/server/modules/used/reports';
import { requireUser } from '@/server/web/session';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { ConditionEditor } from '@/app/_components/condition-editor';

export const metadata = { title: 'توثيق حالة المنتج' };

/** The deal's SELLER documents the used item before making an offer (the buyer sees it read-only on the deal page). */
export default async function DealCondition(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await requireUser(`/account/deals/${id}/condition`);
  const [deal] = await db.select({ id: externalDeals.id, title: externalDeals.title, sellerUserId: externalDeals.sellerUserId }).from(externalDeals).where(eq(externalDeals.id, id));
  if (!deal || deal.sellerUserId !== user.id) notFound();
  const b = await reportForDeal(id);
  if (!b) redirect(`/account/deals/${id}`);
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'صفقاتي', href: '/account/deals' }, { label: deal.title, href: `/account/deals/${id}` }, { label: 'توثيق الحالة' }]} />}
        title="توثيق حالة المنتج المستعمل"
        description="المشتري بيشوف البيانات والصور دي قبل ما يوافق، ولما يوافق بتتجمّد في الاتفاق. رقم الجهاز بيتخزن متشفّر وبيظهر مخفي."
      />
      <ConditionEditor b={b} mode="deal" back={`/account/deals/${id}/condition`} />
    </div>
  );
}
