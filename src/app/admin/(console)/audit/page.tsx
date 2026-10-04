import { and, desc, eq, gte, ilike, lt, type SQL } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { auditLogs, users } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { buttonClass } from '@/ui/button';
import { PageHeader } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';

export const metadata = { title: 'سجل التدقيق' };

export default async function Audit(props: PageProps<'/admin/audit'>) {
  const { allowed } = await adminWith('audit.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const action = String(sp.action ?? '').trim();
  const entity = String(sp.entity ?? '').trim();
  const entityId = String(sp.entityId ?? '').trim();
  const actorType = String(sp.actorType ?? '');
  const from = String(sp.from ?? '');
  const before = Number(sp.before ?? 0) || 0;
  const conds: SQL[] = [];
  if (action) conds.push(ilike(auditLogs.action, `%${action}%`));
  if (entity) conds.push(eq(auditLogs.entityType, entity));
  if (entityId) conds.push(eq(auditLogs.entityId, entityId));
  if (actorType) conds.push(eq(auditLogs.actorType, actorType));
  if (from) conds.push(gte(auditLogs.createdAt, new Date(from)));
  if (before) conds.push(lt(auditLogs.id, before));
  const rows = await db.select({ a: auditLogs, who: users.fullName, email: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLogs.id)).limit(100);
  const qs = new URLSearchParams(Object.entries({ action, entity, entityId, actorType, from }).filter(([, v]) => v));
  return (
    <div className="space-y-4">
      <PageHeader title="سجل التدقيق" description="سجل غير قابل للتعديل أو الحذف (محمي على مستوى قاعدة البيانات) لكل الإجراءات الحساسة." />
      <form className="card grid gap-2 p-3 sm:grid-cols-6" role="search">
        <Input name="action" defaultValue={action} placeholder="الإجراء (مثال: withdrawal)" className="ltr" aria-label="الإجراء" />
        <Input name="entity" defaultValue={entity} placeholder="نوع الكيان" className="ltr" aria-label="نوع الكيان" />
        <Input name="entityId" defaultValue={entityId} placeholder="معرّف الكيان" className="ltr" aria-label="المعرّف" />
        <Select name="actorType" defaultValue={actorType} aria-label="نوع المنفذ"><option value="">كل المنفذين</option>{['ADMIN', 'SELLER', 'CUSTOMER', 'SYSTEM', 'ANONYMOUS'].map((t) => <option key={t}>{t}</option>)}</Select>
        <Input type="date" name="from" defaultValue={from} aria-label="من تاريخ" />
        <button className={buttonClass('primary', 'md')}>تصفية</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-page text-start"><tr><th className="p-2 text-start">#</th><th className="p-2 text-start">الوقت</th><th className="p-2 text-start">المنفذ</th><th className="p-2 text-start">الإجراء</th><th className="p-2 text-start">الكيان</th><th className="p-2 text-start">التفاصيل</th></tr></thead>
          <tbody>
            {rows.map(({ a, who, email }) => (
              <tr key={a.id} className="border-t border-line align-top">
                <td className="p-2">{a.id}</td>
                <td className="whitespace-nowrap p-2">{formatDate(a.createdAt, true)}</td>
                <td className="p-2"><Badge tone="neutral">{a.actorType}</Badge> {who ?? ''} <span className="ltr block text-muted">{email ?? ''} {a.ip ?? ''}</span></td>
                <td className="ltr p-2 font-semibold">{a.action}</td>
                <td className="ltr p-2">{a.entityType}<span className="block text-muted">{a.entityId}</span></td>
                <td className="max-w-md p-2">
                  {a.reason && <p>السبب: {a.reason}</p>}
                  {(a.oldValues != null || a.newValues != null) && <details><summary className="cursor-pointer text-brand-700">القيم</summary><pre className="ltr mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-page p-2">{JSON.stringify({ old: a.oldValues, new: a.newValues }, null, 1)}</pre></details>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 100 && <a className={buttonClass('outline', 'sm')} href={`/admin/audit?${qs.toString()}&before=${rows[rows.length - 1].a.id}`}>الأقدم</a>}
    </div>
  );
}
