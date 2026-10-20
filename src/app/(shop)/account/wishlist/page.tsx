import { desc, eq } from 'drizzle-orm';
import { Heart } from 'lucide-react';
import { db } from '@/server/db/client';
import { wishlistItems } from '@/server/db/schema';
import { productsByIds } from '@/server/modules/catalog/search';
import { requireUser } from '@/server/web/session';
import { Cards } from '@/app/_components/product-bits';
import { LinkButton } from '@/ui/button';
import { ProductGrid } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

export const metadata = { title: 'المفضلة' };

export default async function WishlistPage() {
  const user = await requireUser('/account');
  const rows = await db.select().from(wishlistItems).where(eq(wishlistItems.userId, user.id)).orderBy(desc(wishlistItems.createdAt));
  const items = await productsByIds(rows.map((r) => r.productId));
  return (
    <div>
      <PageHeader title="المفضلة" description="المنتجات اللي حفظتها. المنتجات غير المتاحة دلوقتي مش بتظهر هنا." />
      {items.length ? (
        <ProductGrid className="xl:grid-cols-4"><Cards items={items} back="/account/wishlist" /></ProductGrid>
      ) : (
        <EmptyState icon={Heart} title="المفضلة فاضية" action={<LinkButton href="/">شوف المنتجات</LinkButton>} />
      )}
    </div>
  );
}
