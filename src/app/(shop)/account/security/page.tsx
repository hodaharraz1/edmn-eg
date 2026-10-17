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
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, UserCheck } from 'lucide-react';

export const metadata = { title: 'الأمان' };

export default async function SecurityPage() {
  const user = await requireUser('/account');
  const closure = await latestClosureRequest(user.id);
  const active = await db.select().from(sessions).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.lastSeenAt)).limit(10);
  return (
    <div className="space-y-4">
      <PageHeader title="الأمان" description="كلمة المرور، تأكيد بيانات التواصل، والأجهزة المسجّل دخولك عليها." />
      <section className="relative isolate overflow-hidden rounded-2xl bg-brand-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-6" data-testid="security-summary">
        <div aria-hidden className="absolute -left-12 -top-12 -z-10 size-48 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 ring-1 ring-white/20"><ShieldCheck className="size-6" aria-hidden /></span>
          <div className="min-w-0 space-y-2">
            <p className="text-lg font-bold">حالة أمان حسابك</p>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-3">
              <SecurityFact ok={!!user.phoneVerifiedAt} text={user.phoneVerifiedAt ? 'الموبايل مؤكد' : 'الموبايل مش مؤكد'} />
              <SecurityFact ok={!user.email || !!user.emailVerifiedAt} text={!user.email ? 'مفيش بريد مسجّل' : user.emailVerifiedAt ? 'البريد مؤكد' : 'البريد مش مؤكد'} />
              <SecurityFact ok text={`${active.length} ${active.length === 1 ? 'جهاز نشط' : 'أجهزة نشطة'}`} />
            </ul>
          </div>
        </div>
      </section>
      <FormSection title="تأكيد بيانات التواصل" icon={UserCheck}>
        <ContactVerification user={user} />
      </FormSection>
      <FormSection title="تغيير كلمة المرور" icon={KeyRound} description="استخدم كلمة مرور قوية (8 حروف على الأقل) ومتستخدمهاش في أي موقع تاني.">
        <ActionForm action={changePasswordAction} className="grid max-w-xl gap-3" resetOnSuccess>
          <Field label="كلمة المرور الحالية" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="كلمة المرور الجديدة" htmlFor="next"><Input id="next" name="next" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <Field label="تأكيد كلمة المرور الجديدة" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <div><SubmitButton>تغيير كلمة المرور</SubmitButton></div>
        </ActionForm>
      </FormSection>
      <FormSection title="الأجهزة المسجّل دخولك عليها" icon={MonitorSmartphone} description="لما تغيّر كلمة المرور، هنسجّل خروجك من كل الأجهزة التانية.">
        <ul className="divide-y divide-line text-sm">
          {active.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft text-brand-700"><MonitorSmartphone className="size-4" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block truncate font-semibold ltr" dir="ltr">{s.userAgent?.slice(0, 60) ?? 'جهاز'}</span>
                <span className="block text-xs text-muted">آخر نشاط {formatDate(s.lastSeenAt, true)}</span>
              </span>
            </li>
          ))}
        </ul>
      </FormSection>
      <FormSection title="إغلاق الحساب" icon={LogOut} tone="danger" description="مش هينفع تقفل حسابك طول ما عندك عمليات أو مستحقات مفتوحة (طلبات، مدفوعات، مرتجعات، استردادات، نزاعات، صفقات، أرصدة أو سحب). بعد الإغلاق بنحتفظ بسجلات المعاملات المالية والأدلة المطلوبة، ونخفي بياناتك الشخصية.">
        {closure && closure.status !== 'COMPLETED' && <p className="mb-2 text-sm">آخر طلب: {closure.status === 'PENDING' ? 'قيد المراجعة' : closure.status === 'BLOCKED' ? 'متوقف بسبب عمليات مفتوحة' : 'ملغي'} · {formatDate(closure.createdAt, true)}</p>}
        <ActionForm action={accountClosureAction} className="space-y-2" data-testid="closure-form">
          <input type="hidden" name="op" value={closure?.status === 'PENDING' ? 'withdraw' : 'request'} />
          {closure?.status !== 'PENDING' && <Field label="سبب الإغلاق (اختياري)" htmlFor="closure-reason"><Input id="closure-reason" name="reason" /></Field>}
          <SubmitButton variant={closure?.status === 'PENDING' ? 'outline' : 'danger'}>{closure?.status === 'PENDING' ? 'إلغاء طلب الإغلاق' : 'طلب إغلاق الحساب'}</SubmitButton>
        </ActionForm>
      </FormSection>
    </div>
  );
}

function SecurityFact({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={`flex items-center gap-1.5 rounded-xl px-3 py-2 ring-1 ${ok ? 'bg-emerald-400/10 text-emerald-100 ring-emerald-300/25' : 'bg-amber-400/10 text-amber-100 ring-amber-300/30'}`}>
      <span className={`size-2 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden />
      {text}
    </li>
  );
}
