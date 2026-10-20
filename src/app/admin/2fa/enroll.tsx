'use client';

import { useActionState } from 'react';
import { adminTotpBeginAction } from '@/app/_actions/admin-auth';
import { Alert } from '@/ui/feedback';

export function Enroll() {
  const [state, action, pending] = useActionState(async () => adminTotpBeginAction(), {} as Awaited<ReturnType<typeof adminTotpBeginAction>>);
  const secret = state.data?.secret as string | undefined;
  return (
    <div className="space-y-2">
      <Alert tone="warning">المصادقة الثنائية إلزامية لحسابات الإدارة. فعّلها الآن.</Alert>
      {!secret ? (
        <form action={action}>
          <button disabled={pending} className="h-9 w-full rounded-lg border border-line text-sm font-semibold">إنشاء مفتاح المصادقة</button>
        </form>
      ) : (
        <p className="rounded-lg bg-page p-3 text-xs">أضف المفتاح في تطبيق المصادقة (إدخال يدوي، على أساس الوقت):<br /><code className="ltr select-all text-sm font-bold">{secret}</code></p>
      )}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
    </div>
  );
}
