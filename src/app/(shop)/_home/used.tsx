import { FileSearch, Handshake, Lock, Search, ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';

/**
 * «سوق المستعمل المضمون» on the homepage: the trusted-used promise next to the general marketplace (never replacing
 * it). Copy states what is actually protected — money, documented condition, inspection period — never a guarantee.
 */
const PILLARS = [
  { icon: FileSearch, title: 'جواز المنتج', body: 'حالة موثّقة: البطارية والشاشة والوظائف والعيوب، بالصور.' },
  { icon: Lock, title: 'حالة مجمّدة', body: 'وقت الاتفاق الحالة بتتثبت، ومتتغيرش من غير موافقتك.' },
  { icon: Search, title: 'فترة فحص', body: 'بعد الاستلام تفحص على راحتك، وفلوسك لسه محمية.' },
];

export function UsedTrustedSection() {
  return (
    <section aria-labelledby="home-used" data-testid="home-used" className="relative isolate overflow-hidden rounded-3xl bg-brand-950 p-6 text-white sm:p-8 lg:p-10">
      <div aria-hidden className="absolute -left-20 -top-20 -z-10 size-72 rounded-full bg-brand-500/25 blur-3xl" />
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold text-brand-100">
            <ShieldCheck className="size-4 text-emerald-300" aria-hidden /> سوق المستعمل المضمون
          </span>
          <h2 id="home-used" className="text-[clamp(1.4rem,4.6vw,2.2rem)] font-bold leading-snug">
            اشتري مستعمل من شخص متعرفوش،
            <span className="block text-sky-300">وفلوسك تفضل محمية لحد ما تستلم وتتأكد.</span>
          </h2>
          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <Link href="/account/deals/new?condition=USED" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white shadow-[var(--shadow-cta)] hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
              <Handshake className="size-5" aria-hidden /> لقيتها في أي مكان؟ اضمنها هنا.
            </Link>
            <Link href="/used" className="edmn-cta inline-flex h-12 items-center justify-center rounded-xl border border-white/30 bg-white/5 px-5 text-sm font-bold hover:bg-white/15">
              اعرف أكتر عن المستعمل المضمون
            </Link>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {PILLARS.map((p) => (
            <li key={p.title} className="flex items-start gap-3 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/30 text-sky-200">
                <p.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{p.title}</span>
                <span className="block text-sm leading-6 text-white/75">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
