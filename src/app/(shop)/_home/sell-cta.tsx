import { ArrowLeft, BadgeCheck, ShieldCheck, Store, Truck } from 'lucide-react';
import Link from '@/ui/link';

/** Seller invitation: what selling on EDMN actually involves (no promises of numbers or earnings). */
export function SellOnEdmn() {
  const points = [
    { icon: BadgeCheck, text: 'متجر موثّق بعد مراجعة الهوية والمستندات' },
    { icon: Truck, text: 'تحدد سعر ومدة الشحن لكل محافظة بنفسك' },
    { icon: ShieldCheck, text: 'المشتري يدفع لاضمن، فتبيع لعملاء جدد وأنت مطمّن' },
  ];
  return (
    <section aria-labelledby="sell-title" className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 rounded-3xl bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-4">
        <p className="text-xs font-bold tracking-wide text-brand-600">للتجار وأصحاب المتاجر</p>
        <h2 id="sell-title" className="text-2xl font-extrabold sm:text-3xl">
          بيع على اضمن
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {points.map((p) => (
            <li key={p.text} className="flex items-start gap-2 text-sm leading-6">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                <p.icon className="size-4" aria-hidden />
              </span>
              {p.text}
            </li>
          ))}
        </ul>
      </div>
      <Link href="/sell" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-7 font-bold text-white shadow-sm hover:bg-brand-800">
        <Store className="size-4" aria-hidden /> ابدأ البيع <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
      </Link>
    </section>
  );
}
