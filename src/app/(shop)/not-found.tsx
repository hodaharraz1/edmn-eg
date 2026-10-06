import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/ui/feedback';

export default function ShopNotFound() {
  return (
    <div className="container-page py-12">
      <EmptyState icon={SearchX} title="الصفحة دي مش موجودة" description="ممكن تكون الصفحة اتنقلت أو المنتج مبقاش متاح." action={<Link href="/" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">ارجع للرئيسية</Link>} />
    </div>
  );
}
