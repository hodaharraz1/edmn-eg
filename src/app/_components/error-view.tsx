'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';

/** Generic error UI. The underlying error message is never shown (no stack/secret leakage). */
export function ErrorView({ reset, digest }: { reset: () => void; digest?: string }) {
  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-red-200 bg-white p-8 text-center">
        <TriangleAlert className="mx-auto size-12 text-red-500" aria-hidden />
        <h1 className="text-lg font-bold">حصلت مشكلة غير متوقعة</h1>
        <p className="text-sm text-muted">معلش، جرّب تاني. لو المشكلة فضلت موجودة، تواصل معانا.</p>
        {digest && <p className="text-xs text-muted ltr">ref: {digest}</p>}
        <button onClick={reset} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">
          <RefreshCw className="size-4" /> جرّب تاني
        </button>
      </div>
    </div>
  );
}
