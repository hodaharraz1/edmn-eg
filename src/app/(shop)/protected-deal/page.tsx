import type { Metadata } from 'next';
import { BadgeCheck, FileSignature, FileText, Handshake, KeyRound, Landmark, LockKeyhole, PackageCheck, Scale, ShieldCheck, Wallet } from 'lucide-react';
import Link from '@/ui/link';
import { db } from '@/server/db/client';
import { activeVersionId, loadVersion } from '@/server/modules/pricing/service';
import { formatEGP } from '@/lib/format';
import { bpsToPercentString } from '@/server/core/money';

export const metadata: Metadata = {
  title: 'اضمن صفقة خارج السوق — صفقات محمية',
  description: 'اشتري من أي بائع برّه اضمن وانت مطمّن: بتدفع لاضمن، والبائع ما بياخدش فلوسه غير بعد التسليم برمز الاستلام وتأكيدك (أو انتهاء مهلتك بدون اعتراض) وموافقة الإدارة.',
  alternates: { canonical: '/protected-deal' },
};

/**
 * The real Protected Deal flow (src/domain/machines.ts dealMachine): invitation → seller joins and offers →
 * buyer accepts → payment to EDMN (manual review) → delivery verified with the receipt code (SMS to the buyer,
 * entered by the seller at handover) → buyer confirms (or the inspection window ends) → release only after an
 * admin approval. Disputes freeze the money until EDMN decides.
 */
const STEPS = [
  { icon: FileText, title: 'اكتب تفاصيل الصفقة', body: 'المنتج والسعر وموعد التسليم وأي شروط اتفقتوا عليها.', who: 'أنت' },
  { icon: Handshake, title: 'ابعت الدعوة للطرف التاني', body: 'رابط آمن يراجع منه الشروط وينضم للصفقة.', who: 'أنت' },
  { icon: FileSignature, title: 'البائع يقدّم عرضه', body: 'توافق على العرض أو تطلب تعديله قبل أي دفع.', who: 'البائع ثم أنت' },
  { icon: Landmark, title: 'ادفع لحساب اضمن', body: 'التحويل لحسابات اضمن المعلنة بس، وفريقنا يراجعه يدويًا.', who: 'أنت' },
  { icon: KeyRound, title: 'التسليم برمز الاستلام', body: 'يوصلك رمز برسالة وتديه للبائع وقت التسليم.', who: 'البائع وأنت' },
  { icon: LockKeyhole, title: 'تأكيد ثم إتاحة المبلغ', body: 'تأكد الاستلام بعد الفحص، والمبلغ يتاح للبائع بموافقة الإدارة.', who: 'أنت ثم اضمن' },
];

export default async function ProtectedDealLanding() {
  const pv = await activeVersionId(db, 'PROTECTED_DEAL');
  const fee = pv ? await loadVersion(db, pv).then((v) => ({ firstBps: v.tiersByClass.DEAL[0].totalBps, firstUpTo: v.tiersByClass.DEAL[0].upperBound ?? 0, minFee: v.minFee })) : null;
  return (
    <>
      <section aria-labelledby="pd-title" className="relative isolate overflow-hidden bg-brand-950 text-white">
        <div aria-hidden className="edmn-hero-bg absolute inset-0 -z-20" />
        <div aria-hidden className="edmn-hero-grid absolute inset-0 -z-10" />
        <div className="container-page grid items-center gap-10 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold text-brand-100">
              <ShieldCheck className="size-4 text-emerald-300" aria-hidden /> اضمن صفقة خارج السوق
            </span>
            <h1 id="pd-title" className="text-[clamp(1.9rem,7vw,3.4rem)] font-bold leading-[1.25]">
              عندك صفقة مع شخص خارج اضمن؟
              <span className="block text-sky-300">خلّي اضمن تحمي المبلغ حتى إتمام الصفقة.</span>
            </h1>
            <p className="max-w-xl leading-8 text-brand-100/85">
              لقيت حاجة على فيسبوك أو عند تاجر؟ اضمن بيحتفظ بالمبلغ طول الصفقة، ومش بيتصرف للبائع غير بعد التسليم برمز الاستلام، وتأكيدك أو انتهاء مهلة الفحص بدون اعتراض، وموافقة يدوية من الإدارة.
            </p>
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <Link href="/account/deals/new" className="edmn-cta inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 text-base font-bold text-white shadow-[var(--shadow-cta)] hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
                <Handshake className="size-5" aria-hidden /> أنشئ صفقة ضمان
              </Link>
              <Link href="/legal/protected-deal-terms" className="edmn-cta inline-flex h-14 items-center justify-center rounded-xl border border-white/30 bg-white/5 px-7 text-base font-bold hover:bg-white/15">
                شروط الصفقات المحمية
              </Link>
            </div>
          </div>
          <ProtectedMoneyCard />
        </div>
      </section>

      <div className="container-page space-y-12 py-10">
        <section aria-labelledby="pd-steps" className="space-y-5">
          <div className="space-y-1">
            <h2 id="pd-steps" className="text-2xl font-bold text-brand-950">إزاي بتشتغل؟</h2>
            <p className="text-sm text-muted">في كل خطوة هتعرف حصل إيه، والمبلغ فين، ومين عليه الدور.</p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card relative flex gap-4 p-5">
                <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <s.icon className="size-6" aria-hidden />
                  <span className="absolute -top-1.5 -start-1.5 grid size-6 place-items-center rounded-full bg-brand-950 text-xs font-bold text-white" aria-hidden>
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block font-bold text-brand-950">
                    <span className="sr-only">الخطوة {i + 1}: </span>
                    {s.title}
                  </span>
                  <span className="block text-sm leading-6 text-muted">{s.body}</span>
                  <span className="inline-flex rounded-full bg-soft px-2.5 py-0.5 text-xs font-semibold text-brand-800">الدور على: {s.who}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <Scale className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
            <span>
              <span className="font-bold">حصلت مشكلة؟ </span>افتح نزاعًا قبل تأكيد الاستلام. المبلغ بيتجمّد لحد ما فريق اضمن يراجع أدلة الطرفين ويقرر الاسترجاع لك أو الإتاحة للبائع.
            </span>
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Value icon={BadgeCheck} title="مفيش دفع مباشر لحد متعرفوش">بتدفع بس لحساب اضمن اللي ظاهر في صفحة الدفع.</Value>
          <Value icon={Scale} title="نزاعات بقرار محايد">لو المنتج مختلف أو موصلش، فريق اضمن بيراجع الأدلة ويقرر.</Value>
          <Value icon={Wallet} title="رسوم واضحة">
            {fee
              ? `رسوم خدمة الضمان تدريجية: تبدأ من ${bpsToPercentString(fee.firstBps)}% على أول ${formatEGP(fee.firstUpTo)} وتقل كل ما القيمة تزيد، بحد أدنى ${formatEGP(fee.minFee)}، ومقسومة بين المشتري والبائع حسب التسعير المنشور. نصيب كل طرف بيظهر قبل ما تأكد.`
              : 'هتشوف الرسوم قبل ما تأكد الصفقة.'}
          </Value>
        </section>

        <section className="relative isolate overflow-hidden rounded-3xl bg-brand-950 p-6 text-white sm:p-10">
          <div aria-hidden className="edmn-hero-bg absolute inset-0 -z-10 opacity-80" />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold">جاهز تحمي صفقتك؟</h2>
              <p className="mt-1 text-brand-100/85">اكتب التفاصيل في دقيقتين وابعت الدعوة للطرف التاني.</p>
            </div>
            <Link href="/account/deals/new" className="edmn-cta inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 text-base font-bold text-white shadow-[var(--shadow-cta)] hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
              <Handshake className="size-5" aria-hidden /> أنشئ صفقة ضمان
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function Value({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-2 p-5">
      <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-bold text-brand-950">{title}</p>
      <p className="text-sm leading-6 text-muted">{children}</p>
    </div>
  );
}

/** Illustration of a deal's protected-money state (no amounts or names — nothing that reads as real data). */
function ProtectedMoneyCard() {
  const rows = [
    { icon: Landmark, text: 'اتدفع لحساب اضمن', state: 'done' },
    { icon: PackageCheck, text: 'التسليم برمز الاستلام', state: 'current' },
    { icon: LockKeyhole, text: 'إتاحة المبلغ للبائع بعد التأكيد', state: 'next' },
  ] as const;
  return (
    <figure aria-label="مثال توضيحي لحالة مبلغ محمي في صفقة" className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-brand-500/25 blur-3xl" />
      <div className="rounded-3xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-brand-100">صفقة محمية</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200 ring-1 ring-emerald-300/30">
            <ShieldCheck className="size-4" aria-hidden /> المبلغ محمي
          </span>
        </div>
        <ol className="mt-4 space-y-2">
          {rows.map((r) => (
            <li key={r.text} className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${r.state === 'current' ? 'bg-white text-ink' : 'bg-white/[0.06]'}`}>
              <span className={`grid size-9 shrink-0 place-items-center rounded-full ${r.state === 'done' ? 'bg-emerald-500' : r.state === 'current' ? 'bg-brand-600 text-white' : 'bg-white/10 text-white/70'}`}>
                <r.icon className="size-4" aria-hidden />
              </span>
              <span className={`text-sm font-semibold ${r.state === 'next' ? 'text-white/70' : ''}`}>{r.text}</span>
              {r.state === 'current' && <span className="ms-auto rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">الدور على البائع</span>}
            </li>
          ))}
        </ol>
        <figcaption className="mt-3 text-xs text-brand-100/70">مثال توضيحي: الحالة الفعلية لصفقتك بتظهر في صفحة الصفقة.</figcaption>
      </div>
    </figure>
  );
}
