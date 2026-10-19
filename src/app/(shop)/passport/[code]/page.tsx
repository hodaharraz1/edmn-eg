import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { BadgeCheck, CalendarClock, FileText, ScanSearch, ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';
import { db } from '@/server/db/client';
import { productPassportEvents } from '@/server/db/schema';
import { passportPage } from '@/server/modules/used/views';
import { customerActorOrNull, getAdminActor } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { Breadcrumbs, Timeline } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { ConditionDetails, CoverageList, LevelExplainer, ProtectionLevelBadge } from '@/app/_components/used';
import type { ProtectionLevel } from '@/domain/used';

export const metadata: Metadata = { title: 'جواز المنتج', robots: { index: false } };

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'إنشاء جواز المنتج',
  DECLARED: 'إقرار البائع بالحالة والصور',
  UPDATED: 'تعديل البائع لبيانات الحالة (محتاج إقرار جديد)',
  VERIFIED: 'مراجعة فريق اضمن للبيانات والصور',
  VERIFICATION_REJECTED: 'مراجعة فريق اضمن: البيانات محتاجة تصحيح',
  INSPECTION_RECORDED: 'تسجيل تقرير فحص فني',
  SNAPSHOT_FROZEN: 'تثبيت الحالة في اتفاق شراء',
  AMENDMENT_PROPOSED: 'البائع اقترح تعديل على الحالة المتفق عليها',
  AMENDMENT_ACCEPTED: 'المشتري وافق على تعديل الحالة',
  AMENDMENT_REJECTED: 'المشتري رفض تعديل الحالة',
  LEVEL_CHANGED: 'تغيير مستوى الحماية',
};
const RESULT_LABELS = { PASS: 'ناجح', PASS_WITH_NOTES: 'ناجح بملاحظات', FAIL: 'غير ناجح' } as const;

export default async function PassportPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const actor = (await getAdminActor()) ?? (await customerActorOrNull());
  const v = await passportPage(decodeURIComponent(code).toUpperCase(), actor);
  if (!v) notFound();
  const pp = v.bundle.passport!;
  const level = pp.level as ProtectionLevel;
  const events = await db.select().from(productPassportEvents).where(eq(productPassportEvents.passportId, pp.id)).orderBy(asc(productPassportEvents.createdAt));
  const title = v.product?.title ?? v.deal?.title ?? 'منتج مستعمل';
  return (
    <div className="container-page max-w-4xl space-y-6 py-6" data-testid="passport-page">
      <Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'سوق المستعمل المضمون', href: '/used' }, { label: 'جواز المنتج' }]} />
      <header className="relative isolate overflow-hidden rounded-3xl bg-brand-950 p-6 text-white sm:p-8">
        <div aria-hidden className="absolute -left-16 -top-16 -z-10 size-56 rounded-full bg-brand-500/30 blur-3xl" />
        <p className="flex items-center gap-2 text-sm text-sky-200">
          <ShieldCheck className="size-4" aria-hidden /> جواز المنتج من اضمن
        </p>
        <h1 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl">{title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="ltr rounded-lg bg-white/10 px-2.5 py-1 font-mono tracking-wider" data-testid="passport-code">{pp.code}</span>
          <ProtectionLevelBadge level={level} className="bg-white text-brand-950 ring-white/30" />
          <span className="text-white/70">اتعمل {formatDate(pp.createdAt)}</span>
        </div>
        {v.product && (
          <Link href={`/product/${v.product.slug}`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-brand-950 hover:bg-brand-50">
            شوف الإعلان واشتري بحماية اضمن
          </Link>
        )}
        {v.deal && (
          <Link href={`/account/deals/${v.deal.id}`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-brand-950 hover:bg-brand-50">
            الرجوع للصفقة المحمية
          </Link>
        )}
      </header>

      {v.bundle.report.status === 'DRAFT' && <Alert tone="warning" title="البائع بيحدّث بيانات الحالة">البيانات المعروضة ممكن تتغير لحد ما البائع يقر بيها تاني.</Alert>}

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">مستوى الحماية</h2>
        <LevelExplainer level={level} />
        <CoverageList level={level} warranty={null} />
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">الحالة كما أقرّ بها البائع</h2>
        <p className="text-xs text-muted">
          إقرار البائع{v.bundle.report.declaredAt ? ` بتاريخ ${formatDate(v.bundle.report.declaredAt, true)}` : ''}: «{v.bundle.policy.declaration}»
        </p>
        <ConditionDetails fields={v.fields} defects={v.bundle.check.defects} identifierMasked={v.bundle.report.identifierMasked} evidence={v.evidence} showPrivate={v.showPrivate} />
      </section>

      <section className="card space-y-3 p-5" data-testid="passport-verification">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <BadgeCheck className="size-5 text-emerald-600" aria-hidden /> مراجعة اضمن
        </h2>
        {pp.verificationStatus === 'VERIFIED' ? (
          <p className="text-sm">فريق اضمن راجع البيانات والصور اللي قدّمها البائع{pp.verifiedAt ? ` بتاريخ ${formatDate(pp.verifiedAt)}` : ''}. دي مراجعة مستندات وصور، مش فحص فني للجهاز.</p>
        ) : pp.verificationStatus === 'REJECTED' ? (
          <p className="text-sm">المراجعة طلبت تصحيح في البيانات. الحالة المعروضة لسه مسؤولية البائع.</p>
        ) : (
          <p className="text-sm text-muted">لسه ما اتراجعتش من فريق اضمن. الحالة موصوفة من البائع ومثبتة هنا، وأي اختلاف جوهري من حقك تفتح عليه نزاع خلال فترة الفحص.</p>
        )}
      </section>

      <section className="card space-y-3 p-5" data-testid="passport-inspection">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <ScanSearch className="size-5 text-brand-700" aria-hidden /> الفحص الفني
        </h2>
        {v.bundle.inspections.length === 0 ? (
          <p className="text-sm text-muted">المنتج ده ما اتفحصش فحص فني. اضمن مش بتدّعي فحص ما حصلش.</p>
        ) : (
          <ul className="space-y-3">
            {v.bundle.inspections.map((i) => (
              <li key={i.id} className="rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-line">
                <p className="font-semibold">
                  {i.provider} — النتيجة: {RESULT_LABELS[i.result as keyof typeof RESULT_LABELS] ?? i.result}
                </p>
                <p className="mt-1 text-muted">{i.summary}</p>
                <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden /> {formatDate(i.performedAt)}</span>
                  {v.showPrivate && (
                    <a href={`/api/files/${i.reportFileId}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 hover:underline">
                      <FileText className="size-3.5" aria-hidden /> تقرير الفحص
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">سجل جواز المنتج</h2>
        <Timeline items={events.map((e) => ({ title: EVENT_LABELS[e.kind] ?? e.kind, time: formatDate(e.createdAt, true), done: true }))} />
      </section>
    </div>
  );
}
