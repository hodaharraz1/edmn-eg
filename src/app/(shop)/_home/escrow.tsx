import { AlertTriangle, ArrowLeft, BadgeCheck, FileSignature, FileText, Handshake, KeyRound, Landmark, LockKeyhole, ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';

/**
 * "كيف تعمل خدمة الضمان؟" — the ACTUAL Protected Deal flow (src/domain/machines.ts dealMachine):
 *   INVITED → SELLER_JOINED → OFFER_PENDING_BUYER → ACCEPTED → PAYMENT_PENDING → PAYMENT_UNDER_REVIEW → ACTIVE
 *   → DELIVERY_HANDOVER_VERIFIED (delivery OTP: SMS to the buyer, entered by the seller at handover)
 *   → BUYER_CONFIRMED_RECEIPT (or the inspection window ends without objection) → ENTITLED_AWAITING_RELEASE
 *   → COMPLETED after a manual admin approval.   Side path: DISPUTED → decision (refund or release).
 * No numbers, fees or timings are invented here; the landing /protected-deal shows the published fee terms.
 */
const STEPS = [
  { icon: FileText, title: 'اكتب تفاصيل الصفقة', body: 'المنتج والسعر وموعد التسليم وأي شروط اتفقتوا عليها، وابعت الدعوة للبائع برابط آمن.' },
  { icon: FileSignature, title: 'البائع يراجع ويقدّم عرضه', body: 'البائع ينضم للصفقة ويؤكد الشروط، وأنت توافق على العرض أو تطلب تعديله.' },
  { icon: Landmark, title: 'ادفع لحساب اضمن', body: 'التحويل لحسابات اضمن المعلنة فقط، وفريقنا يراجعه يدويًا. من هنا المبلغ محمي.' },
  { icon: KeyRound, title: 'التسليم برمز الاستلام', body: 'يصلك رمز استلام برسالة، وتعطيه للبائع وقت التسليم ليتأكد أن المنتج وصلك.' },
  { icon: BadgeCheck, title: 'افحص وأكّد الاستلام', body: 'بعد الفحص تأكد الاستلام، أو تنتهي مهلة الفحص بدون اعتراض.' },
  { icon: LockKeyhole, title: 'إتاحة المبلغ للبائع', body: 'المبلغ لا يُتاح للبائع إلا بعد موافقة يدوية من إدارة اضمن.' },
];

export function EscrowHowItWorks() {
  return (
    <section id="escrow" aria-labelledby="escrow-title" className="relative isolate overflow-hidden rounded-3xl bg-brand-950 px-5 py-10 text-white sm:px-10 sm:py-14 lg:px-14">
      <div aria-hidden className="edmn-hero-glow pointer-events-none absolute inset-0 -z-10 opacity-70" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-2xl space-y-3">
          <p className="inline-flex items-center gap-2 rounded-full bg-accent-600 px-3 py-1 text-xs font-bold">
            <ShieldCheck className="size-4" aria-hidden /> خدمة الضمان من اضمن
          </p>
          <h2 id="escrow-title" className="text-2xl font-extrabold leading-tight sm:text-4xl">
            كيف تعمل خدمة الضمان؟
          </h2>
          <p className="text-sm leading-7 text-white/75 sm:text-base">
            اتفقت مع بائع على فيسبوك أو عند تاجر؟ اعمل صفقة محمية على اضمن: المبلغ يبقى محفوظًا لدى اضمن طوال الصفقة، ولا يصل للبائع إلا بعد التسليم وتأكيدك.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/account/deals/new" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 font-bold text-white hover:bg-accent-700">
            <Handshake className="size-4" aria-hidden /> أنشئ صفقة ضمان
          </Link>
          <Link href="/protected-deal" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/25 px-6 font-bold text-white hover:bg-white/10">
            التفاصيل والرسوم <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
          </Link>
        </div>
      </div>

      {/* The process as one connected track. Steps 3–6 sit inside the "protected" span: from payment to release
          the money is held by EDMN. Desktop: a horizontal track; mobile: a vertical one. */}
      <div className="relative mt-10">
        <div aria-hidden className="absolute inset-x-[8.33%] top-[1.375rem] hidden h-0.5 bg-white/15 lg:block" />
        <div aria-hidden className="absolute end-[8.33%] start-[41.67%] top-[1.375rem] hidden h-0.5 bg-emerald-300/80 lg:block" />
        <ol className="relative grid gap-0 lg:grid-cols-6 lg:gap-4">
          {STEPS.map((s, i) => {
            const held = i >= 2;
            return (
              <li key={s.title} className="relative flex gap-4 pb-7 last:pb-0 lg:flex-col lg:items-center lg:pb-0 lg:text-center">
                {i < STEPS.length - 1 && <span aria-hidden className={`absolute start-[1.31rem] top-12 bottom-1 w-0.5 lg:hidden ${held ? 'bg-emerald-300/80' : 'bg-white/15'}`} />}
                <span className={`relative grid size-11 shrink-0 place-items-center rounded-full bg-white text-brand-800 ${held ? 'ring-4 ring-emerald-300/40' : 'ring-4 ring-white/10'}`}>
                  <s.icon className="size-5" aria-hidden />
                  <span className="absolute -top-1.5 -end-1.5 grid size-5 place-items-center rounded-full bg-accent-600 text-[11px] font-bold text-white" aria-hidden>
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0 pt-1 lg:pt-0">
                  <span className="block font-bold leading-7">
                    <span className="sr-only">الخطوة {i + 1}: </span>
                    {s.title}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-white/70">{s.body}</span>
                  {i === 2 && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-200 lg:hidden">
                      <LockKeyhole className="size-3.5" aria-hidden /> من هنا المبلغ محفوظ لدى اضمن
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-6 hidden grid-cols-6 gap-4 lg:grid">
          <p className="col-span-4 col-start-3 flex items-center justify-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100">
            <LockKeyhole className="size-4 text-emerald-300" aria-hidden /> من لحظة الدفع حتى إتاحة المبلغ للبائع، المبلغ محفوظ لدى اضمن
          </p>
        </div>
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
        <p>
          <span className="font-bold">حصلت مشكلة؟ </span>
          افتح نزاعًا قبل تأكيد الاستلام. فريق اضمن يراجع الأدلة من الطرفين ويقرر استرجاع المبلغ لك أو إتاحته للبائع، وفق{' '}
          <Link href="/legal/protected-deal-terms" className="font-semibold underline underline-offset-4 hover:text-white">
            شروط الصفقات المحمية
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
