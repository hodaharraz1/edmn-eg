import { ShieldCheck } from 'lucide-react';
import { LogoImage } from '@/ui/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page grid min-h-[70vh] place-items-center py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="card p-6 sm:p-8">
          <div className="mb-4 flex justify-center"><LogoImage variant="auth" /></div>
          {children}
        </div>
        <p className="flex items-center justify-center gap-2 text-center text-xs text-muted">
          <ShieldCheck className="size-4 text-emerald-600" /> اتصالك مشفّر وبياناتك محمية
        </p>
      </div>
    </div>
  );
}
