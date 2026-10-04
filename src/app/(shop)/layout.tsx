import { BottomNav } from '@/app/_components/bottom-nav';
import { ShopFooter } from '@/app/_components/shop-footer';
import { ShopHeader } from '@/app/_components/shop-header';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ShopHeader />
      <main id="main" className="min-h-[60vh] pb-20 lg:pb-0">
        {children}
      </main>
      <ShopFooter />
      <BottomNav />
    </>
  );
}
