import Link from '@/ui/link';
import { SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-page p-6 text-center">
      <div className="space-y-4">
        <SearchX className="mx-auto size-14 text-brand-600" aria-hidden />
        <h1 className="text-2xl font-bold">الصفحة دي مش موجودة</h1>
        <p className="text-muted">ممكن تكون الصفحة اتنقلت أو الرابط فيه غلط.</p>
        <div className="flex justify-center gap-2">
          <Link href="/" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">الرئيسية</Link>
          <Link href="/search" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">تصفح المنتجات</Link>
        </div>
      </div>
    </main>
  );
}
