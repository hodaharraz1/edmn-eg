import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { changePasswordAction, confirmCodeAction, sendCodeAction } from '@/app/_actions/account';
import { db } from '@/server/db/client';
import { sessions } from '@/server/db/schema';
import { currentUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Field, FormSection, Input } from '@/ui/form';

export const metadata = { title: 'الأمان' };

export default async function SecurityPage() {
  const user = (await currentUser())!;
  const active = await db.select().from(sessions).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.lastSeenAt)).limit(10);
  return (
    <div className="space-y-4">
      <PageHeader title="الأمان" />
      <FormSection title="التحقق من بيانات التواصل">
        {(['PHONE', 'EMAIL'] as const).map((ch) => {
          const verified = ch === 'PHONE' ? user.phoneVerifiedAt : user.emailVerifiedAt;
          return (
            <div key={ch} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
              <span>{ch === 'PHONE' ? 'رقم الموبايل' : 'البريد الإلكتروني'}: <span className="ltr">{ch === 'PHONE' ? user.phone : user.email}</span> {verified ? <Badge tone="success">مؤكد</Badge> : <Badge tone="warning">غير مؤكد</Badge>}</span>
              {!verified && (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={sendCodeAction}><input type="hidden" name="channel" value={ch} /><SubmitButton size="sm" variant="outline">إرسال رمز</SubmitButton></ActionForm>
                  <ActionForm action={confirmCodeAction} className="flex gap-2"><input type="hidden" name="channel" value={ch} /><Input name="code" placeholder="الرمز" className="h-8 w-28" inputMode="numeric" aria-label="رمز التحقق" /><SubmitButton size="sm">تأكيد</SubmitButton></ActionForm>
                </div>
              )}
            </div>
          );
        })}
      </FormSection>
      <FormSection title="تغيير كلمة المرور">
        <ActionForm action={changePasswordAction} className="grid max-w-xl gap-3" resetOnSuccess>
          <Field label="كلمة المرور الحالية" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="كلمة المرور الجديدة" htmlFor="next"><Input id="next" name="next" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <Field label="تأكيد كلمة المرور الجديدة" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <div><SubmitButton>تغيير كلمة المرور</SubmitButton></div>
        </ActionForm>
      </FormSection>
      <FormSection title="الجلسات النشطة" description="تغيير كلمة المرور يُنهي كل الجلسات الأخرى.">
        <ul className="divide-y divide-line text-sm">
          {active.map((s) => (
            <li key={s.id} className="py-2"><span className="ltr">{s.userAgent?.slice(0, 60) ?? 'جهاز'}</span> · <span className="text-muted">آخر نشاط {formatDate(s.lastSeenAt, true)}</span></li>
          ))}
        </ul>
      </FormSection>
    </div>
  );
}
