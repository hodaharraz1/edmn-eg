import { desc, eq, inArray, isNull } from 'drizzle-orm';
import { adjustmentAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, journalLines, ledgerAccounts, ledgerAdjustments, sellers, stores } from '@/server/db/schema';
import { ACCOUNTS, reconcile, type AccountCode } from '@/server/modules/finance/ledger';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader, StatCard, Tabs } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'دفتر القيود' };

export default async function Ledger(props: PageProps<'/admin/ledger'>) {
  const { actor, allowed } = await adminWith('finance.view');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'overview');
  const rec = await reconcile(db);
  const platform = await db.select().from(ledgerAccounts).where(isNull(ledgerAccounts.sellerId));
  return (
    <div className="space-y-4">
      <PageHeader title="دفتر القيود المزدوجة" description="القيود غير قابلة للتعديل أو الحذف (محمية بقيود على مستوى قاعدة البيانات). التصحيح يتم بقيود عكسية أو تسويات معتمدة." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="ميزان المراجعة" value={rec.trialBalanceOk ? 'متوازن ✓' : 'غير متوازن ✗'} tone={rec.trialBalanceOk ? 'success' : 'danger'} hint={`مدين ${formatEGP(rec.totalDebits)} = دائن ${formatEGP(rec.totalCredits)}`} />
        <StatCard label="فروقات الأرصدة" value={String(rec.mismatches.length)} tone={rec.mismatches.length ? 'danger' : 'success'} hint={`${rec.accounts} حساب تمت مطابقته`} />
        <StatCard label="نقدية المنصة" value={formatEGP(platform.find((a) => a.code === 'PLATFORM_CASH')?.balance ?? 0)} />
      </div>
      {rec.mismatches.length > 0 && <Alert tone="danger">يوجد فرق بين الرصيد المسقط والقيود في {rec.mismatches.length} حساب: {rec.mismatches.map((m) => m.code).join('، ')}. أوقف عمليات الصرف وتحقق فوراً.</Alert>}
      <Tabs active={tab} tabs={[{ key: 'overview', label: 'حسابات المنصة', href: '/admin/ledger' }, { key: 'journal', label: 'القيود', href: '/admin/ledger?tab=journal' }, { key: 'adjustments', label: 'التسويات اليدوية', href: '/admin/ledger?tab=adjustments' }]} />
      {tab === 'overview' && (
        <DataTable rows={platform} rowKey={(a) => a.id} columns={[
          { key: 'c', header: 'الحساب', cell: (a) => <span><b>{ACCOUNTS[a.code as AccountCode]?.name ?? a.code}</b> <span className="ltr text-xs text-muted">{a.code}</span></span> },
          { key: 't', header: 'النوع', cell: (a) => a.type },
          { key: 'b', header: 'الرصيد', cell: (a) => formatEGP(a.balance) },
        ]} />
      )}
      {tab === 'journal' && <Journal />}
      {tab === 'adjustments' && <Adjustments canCreate={hasPermission(actor, 'ledger.adjust.create')} canApprove={hasPermission(actor, 'ledger.adjust.approve')} userId={actor.userId!} />}
    </div>
  );
}

async function Journal() {
  const entries = await db.select().from(journalEntries).orderBy(desc(journalEntries.seq)).limit(60);
  const lines = entries.length
    ? await db.select({ l: journalLines, code: ledgerAccounts.code, sellerId: ledgerAccounts.sellerId }).from(journalLines).innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId)).where(inArray(journalLines.entryId, entries.map((e) => e.id)))
    : [];
  return (
    <ul className="space-y-2">
      {entries.map((e) => (
        <li key={e.id} className="card p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span><b>#{e.seq}</b> · {e.description}</span><span className="text-xs text-muted">{e.entryType} · {formatDate(e.createdAt, true)}</span></div>
          <table className="mt-2 w-full text-xs"><tbody>{lines.filter((x) => x.l.entryId === e.id).map((x) => (
            <tr key={x.l.id} className="border-t border-line"><td className="py-1">{ACCOUNTS[x.code as AccountCode]?.name ?? x.code}{x.sellerId && <span className="text-muted"> (بائع)</span>}</td><td className="w-28 text-end">{x.l.debit ? formatEGP(x.l.debit) : ''}</td><td className="w-28 text-end">{x.l.credit ? formatEGP(x.l.credit) : ''}</td></tr>
          ))}</tbody></table>
        </li>
      ))}
    </ul>
  );
}

async function Adjustments({ canCreate, canApprove, userId }: { canCreate: boolean; canApprove: boolean; userId: string }) {
  const rows = await db.select({ a: ledgerAdjustments, store: stores.name }).from(ledgerAdjustments).innerJoin(stores, eq(stores.sellerId, ledgerAdjustments.sellerId)).orderBy(desc(ledgerAdjustments.createdAt)).limit(100);
  const sellerList = canCreate ? await db.select({ id: sellers.id, store: stores.name }).from(sellers).innerJoin(stores, eq(stores.sellerId, sellers.id)).orderBy(stores.name) : [];
  return (
    <div className="space-y-4">
      <Alert tone="info">التسويات تمر بمرحلتين: موظف يُنشئ وآخر يعتمد (لا يمكن لنفس الشخص اعتماد ما أنشأه). موجب = إضافة لرصيد البائع، سالب = خصم.</Alert>
      <ul className="space-y-2">
        {rows.map(({ a, store }) => (
          <li key={a.id} className="card p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span><b>#{a.number}</b> · {store} · {a.reasonCode}</span><span className="flex items-center gap-2"><b className={a.amount < 0 ? 'text-danger-700' : 'text-success-700'}>{formatEGP(a.amount)}</b><StatusChip status={a.status} /></span></div>
            <p className="text-xs text-muted">{a.reason} · {formatDate(a.createdAt, true)} {a.rejectReason && `· رفض: ${a.rejectReason}`}</p>
            {a.status === 'PENDING_APPROVAL' && canApprove && (a.createdBy === userId ? <Badge tone="warning">أنشأتها أنت — يعتمدها موظف آخر</Badge> : (
              <ActionForm action={adjustmentAction} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="adjustmentId" value={a.id} /><input type="hidden" name="back" value="/admin/ledger?tab=adjustments" />
                <Input name="reason" placeholder="ملاحظة / سبب الرفض" className="w-56" aria-label="السبب" />
                <SubmitButton size="sm" name="op" value="approve">اعتماد وقيد</SubmitButton>
                <SubmitButton size="sm" variant="danger" name="op" value="reject">رفض</SubmitButton>
              </ActionForm>
            ))}
          </li>
        ))}
      </ul>
      {canCreate && (
        <ActionForm action={adjustmentAction} className="card grid gap-3 p-5 md:grid-cols-2" resetOnSuccess>
          <input type="hidden" name="op" value="create" /><input type="hidden" name="back" value="/admin/ledger?tab=adjustments" />
          <h2 className="font-bold md:col-span-2">طلب تسوية جديدة</h2>
          <Field label="البائع" required><Select name="sellerId" required>{sellerList.map((s) => <option key={s.id} value={s.id}>{s.store}</option>)}</Select></Field>
          <Field label="المبلغ (ج.م، سالب للخصم)" required><Input name="amount" required inputMode="decimal" className="ltr" /></Field>
          <Field label="كود السبب" required><Input name="reasonCode" required minLength={3} placeholder="SHIPPING_COMPENSATION" /></Field>
          <Field label="الشرح" required><Textarea name="reason" required minLength={10} rows={2} /></Field>
          <div className="md:col-span-2"><SubmitButton>إرسال للاعتماد</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}
