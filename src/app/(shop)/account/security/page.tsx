import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { accountClosureAction, changePasswordAction } from '@/app/_actions/account';
import { latestClosureRequest } from '@/server/modules/customers/closure';
import { db } from '@/server/db/client';
import { sessions } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { ContactVerification } from '@/app/_components/contact-verification';
import { Field, FormSection, Input } from '@/ui/form';

export const metadata = { title: 'الأمان' };

export default async function SecurityPage() {
  const user = await requireUser('/account');
  const closure = await latestClosureRequest(user.id);
  const active = await db.select().from(sessions).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.lastSeenAt)).limit(10);
  return (
    <div className="space-y-4">
      <PageHeader title="الأمان" />
      <FormSection title="تأكيد بيانات التواصل">
        <ContactVerification user={user} />
      </FormSection>
      <FormSection title="تغيير كلمة المرور">
        <ActionForm action={changePasswordAction} className="grid max-w-xl gap-3" resetOnSuccess>
          <Field label="كلمة المرور الحالية" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="كلمة المرور الجديدة" htmlFor="next"><Input id="next" name="next" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <Field label="تأكيد كلمة المرور الجديدة" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <div><SubmitButton>تغيير كلمة المرور</SubmitButton></div>
        </ActionForm>
      </FormSection>
      <FormSection title="الأجهزة المسجّل دخولك عليها" description="لما تغيّر كلمة المرور، هنسجّل خروجك من كل الأجهزة التانية.">
        <ul className="divide-y divide-line text-sm">
          {active.map((s) => (
            <li key={s.id} className="py-2"><span className="ltr">{s.userAgent?.slice(0, 60) ?? 'جهاز'}</span> · <span className="text-muted">آخر نشاط {formatDate(s.lastSeenAt, true)}</span></li>
          ))}
        </ul>
      </FormSection>
      <FormSection title="إغلاق الحساب" description="مش هينفع تقفل حسابك طول ما عندك عمليات أو مستحقات مفتوحة (طلبات، مدفوعات، مرتجعات، استردادات، نزاعات، صفقات، أرصدة أو سحب). بعد الإغلاق بنحتفظ بسجلات المعاملات المالية والأدلة المطلوبة، ونخفي بياناتك الشخصية.">
        {closure && closure.status !== 'COMPLETED' && <p className="mb-2 text-sm">آخر طلب: {closure.status === 'PENDING' ? 'قيد المراجعة' : closure.status === 'BLOCKED' ? 'متوقف بسبب عمليات مفتوحة' : 'ملغي'} · {formatDate(closure.createdAt, true)}</p>}
        <ActionForm action={accountClosureAction} className="space-y-2" data-testid="closure-form">
          <input type="hidden" name="op" value={closure?.status === 'PENDING' ? 'withdraw' : 'request'} />
          {closure?.status !== 'PENDING' && <Field label="سبب الإغلاق (اختياري)" htmlFor="closure-reason"><Input id="closure-reason" name="reason" /></Field>}
          <SubmitButton variant="outline">{closure?.status === 'PENDING' ? 'إلغاء طلب الإغلاق' : 'طلب إغلاق الحساب'}</SubmitButton>
        </ActionForm>
      </FormSection>
    </div>
  );
}
