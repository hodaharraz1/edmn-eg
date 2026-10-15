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

      <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="edmn-step group relative flex gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm transition-colors hover:bg-white/[0.1]">
            <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand-800">
              <s.icon className="size-5" aria-hidden />
              <span className="absolute -top-2 -end-2 grid size-6 place-items-center rounded-full bg-accent-600 text-xs font-bold text-white" aria-hidden>
                {i + 1}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block font-bold leading-7">
                <span className="sr-only">الخطوة {i + 1}: </span>
                {s.title}
              </span>
              <span className="mt-1 block text-sm leading-6 text-white/70">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
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
