import { ChevronLeft, Landmark, PackageCheck, ShieldCheck, ShoppingCart, Truck } from 'lucide-react';
import { SectionHeading } from './hero';

/**
 * «كيف تعمل خدمة الضمان؟» — the REAL marketplace purchase flow (src/domain/machines.ts):
 *  order placed → payment to EDMN, manually verified (PAYMENT_UNDER_REVIEW → PAID)
 *  → seller confirms and ships (SHIPPED; delivery evidence opens the buyer's response window)
 *  → buyer confirms receipt, or the window ends without objection (DELIVERED = entitled, funds still held)
 *  → seller release only after an Admin-approved payout (COMPLETED).
 * Protected Deals between individuals (outside the marketplace) have their own entry under the seller banner.
 */
const STEPS = [
  { icon: ShoppingCart, title: 'تطلب المنتج', body: 'تختار المنتج وتكمّل الطلب على عنوانك', tone: 'violet' },
  { icon: Landmark, title: 'دفع آمن', body: 'تدفع لحساب اضمن والمبلغ يبقى محفوظًا لدينا', tone: 'indigo' },
  { icon: Truck, title: 'الشحن والاستلام', body: 'البائع يشحن المنتج وتستلمه وتفحصه', tone: 'blue' },
  { icon: PackageCheck, title: 'تأكيد الاستلام', body: 'تؤكد الاستلام أو تفتح شكوى خلال المهلة', tone: 'emerald' },
  { icon: ShieldCheck, title: 'تحويل المبلغ للبائع', body: 'بعد التأكيد وموافقة اضمن يتحول المبلغ', tone: 'teal' },
] as const;

const TONES = {
  violet: { ring: 'bg-violet-50 text-violet-600', badge: 'bg-violet-600' },
  indigo: { ring: 'bg-indigo-50 text-indigo-600', badge: 'bg-indigo-600' },
  blue: { ring: 'bg-brand-50 text-brand-600', badge: 'bg-brand-600' },
  emerald: { ring: 'bg-emerald-50 text-emerald-600', badge: 'bg-emerald-600' },
  teal: { ring: 'bg-teal-50 text-teal-600', badge: 'bg-teal-600' },
};

export function EscrowHowItWorks() {
  return (
    <section id="escrow" aria-labelledby="escrow-title" className="scroll-mt-40 space-y-4">
      <SectionHeading id="escrow-title" title="كيف تعمل خدمة الضمان؟" href="/legal/buyer-terms" hrefLabel="معرفة المزيد" />
      <div className="rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)] sm:p-7">
        <ol className="grid gap-5 lg:grid-cols-5 lg:gap-2">
          {STEPS.map((s, i) => {
            const t = TONES[s.tone];
            return (
              <li key={s.title} className="relative flex items-start gap-4 lg:flex-col lg:items-center lg:px-3 lg:text-center">
                {i < STEPS.length - 1 && <ChevronLeft aria-hidden className="absolute -end-3 top-6 hidden size-5 text-slate-300 lg:block" />}
                {i < STEPS.length - 1 && <span aria-hidden className="absolute start-7 top-16 -bottom-5 w-px bg-line lg:hidden" />}
                <span className={`relative grid size-14 shrink-0 place-items-center rounded-full ${t.ring} ring-4 ring-white`}>
                  <s.icon className="size-6" aria-hidden />
                  <span className={`absolute -top-1 -start-1 grid size-6 place-items-center rounded-full ${t.badge} text-xs font-bold text-white ring-2 ring-white`} aria-hidden>
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0 pt-1 lg:pt-0">
                  <span className="block font-bold leading-7">
                    <span className="sr-only">الخطوة {i + 1}: </span>
                    {s.title}
                  </span>
                  <span className="block text-sm leading-6 text-muted">{s.body}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
