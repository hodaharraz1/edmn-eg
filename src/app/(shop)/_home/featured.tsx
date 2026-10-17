import type { CardProduct } from '@/ui/commerce';
import { Cards } from '@/app/_components/product-bits';
import { SectionHeading } from './hero';

/** «منتجات مميزة»: the shared marketplace card, five across on desktop (approved reference), two per row on phones. */
export function FeaturedProducts({ products }: { products: CardProduct[] }) {
  if (!products.length) return null;
  return (
    <section aria-labelledby="home-featured" className="space-y-4">
      <SectionHeading id="home-featured" title="منتجات مميزة" href="/search" hrefLabel="عرض المزيد" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 lg:[&>*:nth-child(6)]:hidden">
        <Cards items={products} back="/" />
      </div>
    </section>
  );
}
