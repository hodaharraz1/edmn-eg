import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { marketHref } from '@/lib/market-url';
import { Logo } from '@/ui/logo';

export const metadata: Metadata = { title: { default: 'مركز بائعي اضمن', template: '%s | EDMN Seller Center' }, robots: { index: false, follow: false } };

/** Seller Center entry shell: no customer header, cart or admin navigation. */
export default function SellerAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="flex flex-col gap-6 bg-brand-950 px-6 py-6 text-white sm:px-10 lg:min-h-dvh lg:py-12">
        <div className="-mx-6 -mt-6 flex items-center justify-between gap-3 bg-white px-6 py-4 sm:-mx-10 sm:px-10 lg:-mt-12">
          <Logo href="/seller/login" variant="sidebar" label="مركز بائعي اضمن" />
          <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-brand-950">Seller Center</span>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-wide text-amber-300" dir="ltr">EDMN Seller Center</p>
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">مركز بائعي اضمن</h1>
          <p className="max-w-md text-sm text-white/75">أدر متجرك، منتجاتك، طلباتك، شحناتك وأرباحك من مكان واحد.</p>
        </div>
        <ul className="hidden max-w-md gap-3 text-sm lg:grid">
          {[
            [BadgeCheck, 'تسجيل مفتوح للأفراد والشركات بعد مراجعة البيانات'],
            [Truck, 'تحديد سعر ومدة الشحن لكل محافظة'],
            [Wallet, 'الرصيد يصبح متاحاً بعد استلام العميل وموافقة الإدارة على الإتاحة'],
            [ShieldCheck, 'مستنداتك وبيانات الدفع خاصة ومشفّرة'],
          ].map(([I, t]) => {
            const Icon = I as typeof BadgeCheck;
            return (
              <li key={t as string} className="flex items-start gap-3 rounded-xl bg-white/10 p-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
                <span>{t as string}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-auto hidden text-xs text-white/50 lg:block">
          تتسوق؟ <Link href={marketHref('/')} className="underline hover:text-white">اذهب إلى سوق اضمن</Link>
        </p>
      </aside>
      <main id="main" className="grid place-items-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-lg space-y-4">
          <div className="card p-6 sm:p-8">{children}</div>
          <p className="flex items-center justify-center gap-2 text-center text-xs text-muted">
            <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> اتصالك مشفّر وبياناتك محمية
          </p>
        </div>
      </main>
    </div>
  );
}
