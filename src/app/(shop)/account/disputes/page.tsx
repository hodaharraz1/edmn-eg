import Link from 'next/link';
import { desc, eq, or } from 'drizzle-orm';
import { Scale } from 'lucide-react';
import { db } from '@/server/db/client';
import { disputes } from '@/server/db/schema';
import { currentUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'النزاعات' };

export default async function DisputesPage() {
  const user = (await currentUser())!;
  const list = await db.select().from(disputes).where(or(eq(disputes.claimantUserId, user.id), eq(disputes.respondentUserId, user.id))).orderBy(desc(disputes.createdAt));
  return (
    <div>
      <PageHeader title="النزاعات" description="فريق اضمن يراجع كل نزاع بناءً على الأدلة المقدمة من الطرفين." />
      {list.length === 0 ? (
        <EmptyState icon={Scale} title="لا توجد نزاعات" description="نتمنى أن تظل كذلك!" />
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((d) => (
            <li key={d.id}>
              <Link href={`/account/disputes/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm hover:bg-page/50">
                <span>نزاع #{d.number} · {d.dealId ? 'صفقة محمية' : 'طلب من السوق'} · {formatDate(d.createdAt)}</span>
                <StatusChip status={d.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
