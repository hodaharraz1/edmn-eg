import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/ui/feedback';

export default function ShopNotFound() {
  return (
    <div className="container-page py-12">
      <EmptyState icon={SearchX} title="غير موجود" description="ربما تم نقل الصفحة أو أن المنتج لم يعد متاحاً." action={<Link href="/" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">العودة للرئيسية</Link>} />
    </div>
  );
}
