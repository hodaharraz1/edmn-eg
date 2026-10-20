import * as Icons from 'lucide-react';
import { LayoutGrid, type LucideIcon } from 'lucide-react';
import Link from '@/ui/link';
import { mediaUrl } from '@/ui/commerce';
import { SectionHeading } from './hero';

export interface HomeCategory {
  slug: string;
  nameAr: string;
  icon: string | null;
  imageKey: string | null;
}

/**
 * «تصفح حسب الفئة»: one row of category cards on desktop (first card = all categories), a horizontal scroller on
 * mobile. A category image uploaded in Admin is shown when present; otherwise the category's own icon is drawn
 * as an object on a lit tile (no invented photography).
 */
export function CategoryBrowser({ categories }: { categories: HomeCategory[] }) {
  if (!categories.length) return null;
  return (
    <section aria-labelledby="home-cats" className="space-y-4">
      <SectionHeading id="home-cats" title="تصفح حسب الفئة" href="/categories" hrefLabel="عرض جميع الفئات" />
      <ul className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-8 lg:overflow-visible lg:px-0 lg:pb-0">
        <li className="w-28 shrink-0 snap-start lg:w-auto">
          <Link href="/categories" className="group flex h-full flex-col items-center gap-2 rounded-2xl border-2 border-brand-500 bg-brand-50/60 p-2.5 text-center shadow-[0_8px_24px_-14px_rgb(37_99_235/0.6)] transition-transform hover:-translate-y-0.5">
            <span className="grid aspect-[5/4] w-full place-items-center rounded-xl bg-white">
              <LayoutGrid className="size-9 text-brand-600" strokeWidth={1.6} aria-hidden />
            </span>
            <span className="text-sm font-bold text-brand-700">جميع الفئات</span>
          </Link>
        </li>
        {categories.map((c, i) => {
          const Icon = ((c.icon && (Icons as unknown as Record<string, LucideIcon>)[c.icon]) || Icons.Tag) as LucideIcon;
          return (
            <li key={c.slug} className={`w-28 shrink-0 snap-start lg:w-auto ${i >= 7 ? 'lg:hidden' : ''}`}>
              <Link href={`/category/${c.slug}`} className="group flex h-full flex-col items-center gap-2 rounded-2xl border border-line bg-white p-2.5 text-center shadow-[var(--shadow-card)] transition-[box-shadow,transform,border-color] hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[var(--shadow-pop)]">
                <span className="relative grid aspect-[5/4] w-full place-items-center overflow-hidden rounded-xl bg-gradient-to-b from-[#f4f8ff] to-[#e3ecfb]">
                  {c.imageKey ? (
                    <img src={mediaUrl(c.imageKey, 'thumb')!} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <>
                      <span aria-hidden className="absolute bottom-[18%] h-2.5 w-14 rounded-[50%] bg-brand-900/15 blur-[3px]" />
                      <Icon className="relative size-11 text-brand-700 drop-shadow-[0_6px_8px_rgb(29_78_216/0.25)] transition-transform duration-300 group-hover:scale-110" strokeWidth={1.4} aria-hidden />
                    </>
                  )}
                </span>
                <span className="line-clamp-1 text-[13px] font-semibold">{c.nameAr}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
