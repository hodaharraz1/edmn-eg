import { confirmCodeAction, sendCodeAction } from '@/app/_actions/account';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Badge } from '@/ui/feedback';
import { Input } from '@/ui/form';

type U = { phone: string | null; email: string | null; phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null };

/** Phone/e-mail one-time-code verification (shared by the customer account and Seller onboarding). */
export function ContactVerification({ user, only }: { user: U; only?: ('PHONE' | 'EMAIL')[] }) {
  return (
    <div className="space-y-2">
      {(only ?? (['PHONE', 'EMAIL'] as const)).map((ch) => {
        const verified = ch === 'PHONE' ? user.phoneVerifiedAt : user.emailVerifiedAt;
        return (
          <div key={ch} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
            <span>
              {ch === 'PHONE' ? 'رقم الموبايل' : 'البريد الإلكتروني'}: <span className="ltr">{ch === 'PHONE' ? user.phone : user.email}</span>{' '}
              {verified ? <Badge tone="success">مؤكد</Badge> : <Badge tone="warning">غير مؤكد</Badge>}
            </span>
            {!verified && (
              <div className="flex flex-wrap gap-2">
                <ActionForm action={sendCodeAction}><input type="hidden" name="channel" value={ch} /><SubmitButton size="sm" variant="outline">ابعت الرمز</SubmitButton></ActionForm>
                <ActionForm action={confirmCodeAction} className="flex gap-2"><input type="hidden" name="channel" value={ch} /><Input name="code" placeholder="الرمز" className="h-8 w-28" inputMode="numeric" aria-label="رمز التحقق" /><SubmitButton size="sm">تأكيد</SubmitButton></ActionForm>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
