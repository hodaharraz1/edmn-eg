import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { walletTopupCreditAction, walletTopupRejectAction } from '@/app/_actions/finance-movements';
import { MovementPanel, openMovementFor } from '@/app/_components/movement-panel';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { users, walletTopups } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Field, Input } from '@/ui/form';

const METHOD: Record<string, string> = { BANK_TRANSFER: 'تحويل بنكي', INSTAPAY: 'إنستاباي' };

export default async function WalletTopupReview(props: PageProps<'/admin/wallet-topups/[id]'>) {
  const { actor, allowed } = await adminWith('payments.verify');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [row] = await db.select({ t: walletTopups, user: users }).from(walletTopups).innerJoin(users, eq(users.id, walletTopups.userId)).where(eq(walletTopups.id, id));
  if (!row) notFound();
  const t = row.t;
  const back = `/admin/wallet-topups/${t.id}`;
  const open = t.status === 'PENDING_REVIEW' ? await openMovementFor('WALLET_TOPUP_CREDIT', t.id) : null;
  const own = t.userId === actor.userId;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'إيداعات المحافظ', href: '/admin/wallet-topups' }, { label: row.user.fullName }]} />} title="مراجعة إيداع محفظة" actions={<StatusChip status={t.status} />} />
      <section className="card grid gap-4 p-4 md:grid-cols-[1fr_1.2fr]">
        <a href={`/api/files/${t.proofFileId}`} target="_blank" className="block overflow-hidden rounded-lg border border-line bg-page">
          <img src={`/api/files/${t.proofFileId}`} alt="إيصال الإيداع" className="max-h-96 w-full object-contain" />
        </a>
        <DefinitionList items={[
          { label: 'العميل', value: <Link href={`/admin/customers/${row.user.id}`} className="text-brand-700">{row.user.fullName} · <span className="ltr">{row.user.phone}</span></Link> },
          { label: 'المبلغ المعلن', value: <b>{formatEGP(t.amount, { fixed: true })}</b> },
          { label: 'الطريقة', value: METHOD[t.method] ?? t.method },
          { label: 'رقم العملية', value: <span className="ltr">{t.payerReference ?? '—'}</span> },
          { label: 'وقت الرفع', value: formatDate(t.createdAt, true) },
          { label: 'القرار', value: t.decidedAt ? formatDate(t.decidedAt, true) : '—' },
          { label: 'سبب الرفض', value: t.rejectReason ?? '—' },
        ]} />
      </section>
      {t.status === 'PENDING_REVIEW' && own && <Alert tone="info">هذا إيداع خاص بحسابك: لا يمكنك طلبه أو اعتماده.</Alert>}
      {t.status === 'PENDING_REVIEW' && !own && hasPermission(actor, 'payments.verify') && (
        <>
          <MovementPanel actor={actor} kind="WALLET_TOPUP_CREDIT" entityId={t.id} amount={t.amount} back={back} open={open}>
            <ActionForm action={walletTopupCreditAction} className="space-y-2">
              <input type="hidden" name="topupId" value={t.id} /><input type="hidden" name="back" value={back} />
              <Field label="ملاحظة داخلية (اختياري)" htmlFor="note"><Input id="note" name="note" /></Field>
              <ConfirmSubmit confirm={`تأكيد استلام ${formatEGP(t.amount)} فعلياً في حساب اضمن وإضافته لمحفظة العميل؟ لا يمكن التراجع.`} variant="success">إضافة {formatEGP(t.amount)} لمحفظة العميل (تم التحقق من الحساب)</ConfirmSubmit>
            </ActionForm>
          </MovementPanel>
          <ActionForm action={walletTopupRejectAction} className="card space-y-2 p-4">
            <input type="hidden" name="topupId" value={t.id} /><input type="hidden" name="back" value={back} />
            <Field label="سبب الرفض (يظهر للعميل، 10 أحرف على الأقل)" htmlFor="reason" required><Input id="reason" name="reason" required minLength={10} /></Field>
            <SubmitButton variant="danger" size="sm">رفض الإيداع</SubmitButton>
          </ActionForm>
        </>
      )}
    </div>
  );
}
