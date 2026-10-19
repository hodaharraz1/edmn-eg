import { and, eq, sql } from 'drizzle-orm';
import { BarChart3, FileSearch, Flag, Settings2 } from 'lucide-react';
import Link from '@/ui/link';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { productPassports, riskFlags } from '@/server/db/schema';
import { usedAnalytics } from '@/server/modules/used/analytics';
import { listPolicies } from '@/server/modules/used/policies';
import { BarChart, DataTable, PageHeader, StatCard } from '@/ui/data';
import { PROTECTION_LEVEL_LABELS, USED_DISPUTE_REASONS, type ProtectionLevel } from '@/domain/used';

export const metadata = { title: 'المستعمل المضمون' };

const EVENT_LABELS: Record<string, string> = {
  USED_LISTING_STARTED: 'بدء توثيق مستعمل',
  USED_LISTING_COMPLETED: 'اكتمال التوثيق والإقرار',
  EXTERNAL_DEAL_CREATED: 'صفقة خارجية جديدة',
  DEAL_INVITE_CLAIMED: 'البائع قبل الدعوة',
  SELLER_OFFER_SUBMITTED: 'عرض بائع موثّق',
  CONDITION_FROZEN: 'تجميد الحالة باتفاق',
  INSPECTION_STARTED: 'بدء فترة الفحص',
  BUYER_ACCEPTED: 'قبول المشتري',
  INSPECTION_DISPUTE_OPENED: 'نزاع أثناء الفحص',
  PASSPORT_VERIFIED: 'مراجعة جواز من الفريق',
  INSPECTION_RECORDED: 'تسجيل فحص فني',
};
const STAGES: Record<string, string> = { created: 'اتعملت', invited: 'اتبعتت دعوة', seller_joined: 'البائع انضم', agreed: 'اتفاق', paid: 'اتدفعت', delivered: 'اتسلّمت', buyer_accepted: 'قبول المشتري', completed: 'اكتملت' };

/** Trusted Used Commerce control room: configuration entry points, review queues and privacy-safe analytics. */
export default async function UsedAdminHome() {
  const { actor, allowed } = await adminWith(['products.moderate', 'deals.manage', 'reports.view', 'catalog.manage']);
  if (!allowed) return <Forbidden />;
  const [policies, unreviewed, levels, dupes] = await Promise.all([
    listPolicies(),
    db.select({ n: sql<number>`count(*)::int` }).from(productPassports).where(eq(productPassports.verificationStatus, 'UNREVIEWED')),
    db.select({ level: productPassports.level, n: sql<number>`count(*)::int` }).from(productPassports).groupBy(productPassports.level),
    db.select({ n: sql<number>`count(*)::int` }).from(riskFlags).where(and(eq(riskFlags.code, 'DUPLICATE_IDENTIFIER'), eq(riskFlags.status, 'OPEN'))),
  ]);
  const a = hasPermission(actor, 'reports.view') ? await usedAnalytics(actor) : null;
  return (
    <div className="space-y-6" data-testid="admin-used">
      <PageHeader title="المستعمل المضمون" description="جواز المنتج، مستويات الحماية، سياسات الفئات، ومؤشر أمان الصفقة. مفيش أي إجراء هنا بيحرّك فلوس — الإتاحة فاضلة بالموافقة المزدوجة." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="فئات مفعّل فيها التوثيق" value={policies.filter((p) => p.p.enabled).length} icon={<Settings2 className="size-5" />} href="/admin/used/policies" />
        <StatCard label="جوازات محتاجة مراجعة" value={unreviewed[0]?.n ?? 0} tone="warning" icon={<FileSearch className="size-5" />} href="/admin/used/passports?status=UNREVIEWED" />
        <StatCard label="نفس رقم الجهاز لبائعين مختلفين" value={dupes[0]?.n ?? 0} tone={(dupes[0]?.n ?? 0) ? 'danger' : 'neutral'} icon={<Flag className="size-5" />} href="/admin/risk" />
        <StatCard label="جوازات حسب المستوى" value={levels.map((l) => `${PROTECTION_LEVEL_LABELS[l.level as ProtectionLevel]}: ${l.n}`).join(' · ') || '0'} icon={<BarChart3 className="size-5" />} />
      </div>

      {a && (
        <>
          <section className="card space-y-3 p-5">
            <h2 className="font-bold">رحلة الصفقات المستعملة</h2>
            <BarChart data={a.funnel.map((f) => ({ label: STAGES[f.stage] ?? f.stage, value: Number(f.n) }))} format={(v) => String(v)} />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-3 p-5">
              <h2 className="font-bold">الأحداث (آخر 30 يوم / الإجمالي)</h2>
              <DataTable rows={a.events} rowKey={(r) => r.name} columns={[{ key: 'n', header: 'الحدث', cell: (r) => EVENT_LABELS[r.name] ?? r.name }, { key: 'd', header: '30 يوم', cell: (r) => r.d30 }, { key: 't', header: 'الإجمالي', cell: (r) => r.total }]} />
            </section>
            <section className="card space-y-3 p-5">
              <h2 className="font-bold">نزاعات المستعمل حسب السبب</h2>
              <DataTable rows={a.disputes} rowKey={(r) => r.reason} columns={[{ key: 'r', header: 'السبب', cell: (r) => USED_DISPUTE_REASONS[r.reason as keyof typeof USED_DISPUTE_REASONS] ?? r.reason }, { key: 'n', header: 'العدد', cell: (r) => r.n }]} />
            </section>
            <section className="card space-y-2 p-5 text-sm">
              <h2 className="font-bold">وقت الإتاحة والتكرار</h2>
              <p>متوسط (وسيط) الوقت من الاستحقاق للإتاحة: <span className="font-bold">{a.release.median_hours ?? '—'}</span> ساعة ({a.release.n} صفقة)</p>
              <p>مشترين اتعاملوا أكتر من مرة: <span className="font-bold">{a.repeat.buyers}</span> · بائعين: <span className="font-bold">{a.repeat.sellers}</span></p>
            </section>
            <section className="card space-y-3 p-5">
              <h2 className="font-bold">قيمة الصفقات (شرائح)</h2>
              <DataTable rows={a.value} rowKey={(r) => r.bucket} columns={[{ key: 'b', header: 'الشريحة (ج.م)', cell: (r) => r.bucket }, { key: 'n', header: 'العدد', cell: (r) => r.n }]} />
            </section>
          </div>
          <p className="text-xs text-muted">التحليلات مجمّعة ومن غير بيانات شخصية: مفيش أسماء أو أرقام موبايلات أو عناوين أو أرقام أجهزة أو بيانات دفع.</p>
        </>
      )}

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="font-bold">روابط سريعة</h2>
        <ul className="flex flex-wrap gap-3">
          <li><Link href="/admin/used/passports" className="inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">جوازات المنتجات والفحص</Link></li>
          <li><Link href="/admin/used/policies" className="inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">سياسات الفئات</Link></li>
          <li><Link href="/admin/used/score" className="inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">قواعد مؤشر الأمان</Link></li>
          <li><Link href="/admin/disputes" className="inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">النزاعات</Link></li>
        </ul>
      </section>
    </div>
  );
}
