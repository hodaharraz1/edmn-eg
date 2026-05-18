import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <p className="text-8xl mb-4">404</p>
      <h1 className="text-[#1A57A1] mb-4">الصفحة غير موجودة</h1>
      <p className="text-[#4B5563] mb-8 max-w-md">
        الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
      </p>
      <Link
        href="/"
        className="px-8 py-3 bg-[#1A57A1] text-white rounded-xl font-bold hover:bg-[#164A8A] transition-all"
      >
        العودة للرئيسية
      </Link>
    </div>
  );
}
