import Link from '@/ui/link';
import { reconciliationAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { reconCounts, reconImportsList, reconQueue } from '@/server/modules/finance/reconciliation';
import { pageOf } from '@/server/modules/_shared';
import type { ReconState } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { Input, Select, Textarea } from '@/ui/form';
import { Landmark } from 'lucide-react';

export const metadata = { title: 'المطابقة مع كشوف الحسابات' };

const STATES: ReconState[] = ['UNMATCHED', 'SUGGESTED_MATCH', 'MISMATCH', 'MATCHED', 'IGNORED_WITH_REASON'];

export default async function Reconciliation(props: PageProps<'/admin/reconciliation'>) {
  const { actor, allowed } = await adminWith(['reconciliation.manage', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const state = (STATES.includes(sp.state as ReconState) ? sp.state : 'SUGGESTED_MATCH') as ReconState;
  const { limit, offset, page } = pageOf(sp.page);
  const [rows, counts, imports] = await Promise.all([reconQueue([state], limit, offset), reconCounts(), reconImportsList(5)]);
  const can = hasPermission(actor, 'reconciliation.manage');
  const back = `/admin/reconciliation?state=${state}`;
  return (
    <div className="space-y-4">
      <PageHeader title="المطابقة مع كشوف الحسابات" description="كشف البنك / إنستاباي / فودافون كاش ↔ الدفعة أو الصرف ↔ القيد. أي مطابقة تحتاج تأكيدًا يدويًا مسجلًا — لا مطابقة تلقائية للحالات الملتبسة." />
      <Alert tone="info">مزودو الدفع غير مربوطين؛ الاستيراد بملف CSV: <span className="ltr">externalRef,direction(IN|OUT),amount,occurredAt,counterparty</span></Alert>
      {can && (
        <ActionForm action={reconciliationAction} className="card grid gap-2 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <input type="hidden" name="op" value="import" /><input type="hidden" name="back" value={back} />
          <Select name="channel" aria-label="القناة" className="w-auto"><option value="BANK_TRANSFER">تحويل بنكي</option><option value="INSTAPAY">إنستاباي</option><option value="VODAFONE_CASH">فودافون كاش</option></Select>
          <div className="grid gap-2"><FileInput name="file" label="ملف CSV" accept="text/csv,.csv" /><Textarea name="csv" rows={2} placeholder="أو الصق السطور هنا" aria-label="سطور CSV" className="ltr" /></div>
          <SubmitButton size="sm">استيراد</SubmitButton>
        </ActionForm>
      )}
      <Tabs active={state} tabs={STATES.map((s) => ({ key: s, label: `${s} (${counts[s] ?? 0})`, href: `/admin/reconciliation?state=${s}` }))} />
      {rows.length === 0 ? (
        <EmptyState icon={Landmark} title="لا توجد حركات" />
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => {
            const cands = ((t.suggestion as { candidates?: { type: string; id: string; amount: number; strength: string }[] } | null)?.candidates ?? []);
            return (
              <li key={t.id} className="card p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b className="ltr">{t.externalRef}</b> · {t.channel} · {t.direction === 'IN' ? 'وارد' : 'صادر'} · {formatDate(t.occurredAt, true)} {t.counterparty && `· ${t.counterparty}`}</span>
                  <span className="flex items-center gap-2"><b>{formatEGP(t.amount)}</b><StatusChip status={t.state} /></span>
                </div>
                {t.matchedType && <p className="text-xs text-muted">مطابقة مع {t.matchedType}:{t.matchedId?.slice(0, 8)} {t.note && `— ${t.note}`}</p>}
                {can && t.state !== 'MATCHED' && cands.map((c) => (
                  <ActionForm key={c.id} action={reconciliationAction} className="mt-2 flex flex-wrap items-center gap-2 rounded bg-page p-2">
                    <input type="hidden" name="op" value="match" /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="type" value={c.type} /><input type="hidden" name="targetId" value={c.id} /><input type="hidden" name="back" value={back} />
                    <span className="text-xs">{c.type}:{c.id.slice(0, 8)} · {formatEGP(c.amount)} · {c.strength === 'REFERENCE_AND_AMOUNT' ? 'مرجع + مبلغ' : 'مبلغ فقط (ملتبس)'}</span>
                    <Input name="note" required minLength={3} placeholder="ملاحظة" className="w-40" aria-label="ملاحظة المطابقة" />
                    <SubmitButton size="sm" variant="outline">تأكيد المطابقة</SubmitButton>
                  </ActionForm>
                ))}
                {can && (
                  <ActionForm action={reconciliationAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
                    <Select name="op" className="w-auto" aria-label="الإجراء"><option value="ignore">استبعاد بسبب</option><option value="mismatch">تسجيل عدم تطابق</option><option value="unmatch">فك المطابقة</option></Select>
                    <Input name="note" required minLength={3} placeholder="السبب" className="w-48" aria-label="السبب" />
                    <SubmitButton size="sm" variant="outline">تنفيذ</SubmitButton>
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">صفحة {page}{rows.length === limit && <> · <Link className="text-brand-700" href={`/admin/reconciliation?state=${state}&page=${page + 1}`}>التالي</Link></>}</p>
      <section className="card p-4 text-sm"><h2 className="mb-1 font-bold">آخر عمليات الاستيراد</h2>{imports.map((i) => <p key={i.id}>{i.channel} · {i.rowCount} سطر · {i.status}{i.error ? ` — ${i.error}` : ''} · {formatDate(i.createdAt, true)}</p>)}</section>
    </div>
  );
}
