import { desc } from 'drizzle-orm';
import { policyRuleAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { listingPolicyRules } from '@/server/db/schema';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Field, Input, Select } from '@/ui/form';

export const metadata = { title: 'سياسة المنتجات المحظورة' };

export default async function PolicyAdmin() {
  const { allowed } = await adminWith('policy.manage');
  if (!allowed) return <Forbidden />;
  const rows = await db.select().from(listingPolicyRules).orderBy(desc(listingPolicyRules.createdAt));
  return (
    <div className="space-y-4">
      <PageHeader title="سياسة المنتجات المحظورة والمقيدة" description="كلمات تمنع إرسال المنتج (حظر) أو تحيله لمراجعة معززة. التصنيفات المحظورة/المقيدة تُدار من صفحة التصنيفات." />
      <ActionForm action={policyRuleAction} className="card grid gap-3 p-4 sm:grid-cols-5" resetOnSuccess>
        <Field label="النوع" htmlFor="kind"><Select id="kind" name="kind"><option value="BLOCK_KEYWORD">حظر</option><option value="REVIEW_KEYWORD">مراجعة معززة</option></Select></Field>
        <Field label="الكلمة / العبارة" htmlFor="pattern"><Input id="pattern" name="pattern" required /></Field>
        <Field label="كود السبب" htmlFor="reasonCode"><Input id="reasonCode" name="reasonCode" required dir="ltr" placeholder="WEAPONS" /></Field>
        <Field label="وصف" htmlFor="description"><Input id="description" name="description" /></Field>
        <div className="flex items-end"><SubmitButton>إضافة</SubmitButton></div>
      </ActionForm>
      <DataTable rows={rows} rowKey={(r) => r.id} columns={[
        { key: 'k', header: 'النوع', cell: (r) => <Badge tone={r.kind === 'BLOCK_KEYWORD' ? 'danger' : 'warning'}>{r.kind === 'BLOCK_KEYWORD' ? 'حظر' : 'مراجعة'}</Badge> },
        { key: 'p', header: 'العبارة', cell: (r) => r.pattern },
        { key: 'c', header: 'الكود', cell: (r) => <code className="text-xs">{r.reasonCode}</code> },
        { key: 'a', header: 'الحالة', cell: (r) => (
          <ActionForm action={policyRuleAction} className="flex items-center gap-2">
            <input type="hidden" name="op" value="toggle" /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="isActive" value={r.isActive ? 'false' : 'true'} />
            <input name="reason" placeholder="السبب" required className="h-8 w-28 rounded border border-line px-2 text-xs" aria-label="السبب" />
            <SubmitButton size="sm" variant="outline">{r.isActive ? 'تعطيل' : 'تفعيل'}</SubmitButton>
            <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'مفعّل' : 'معطّل'}</Badge>
          </ActionForm>
        ) },
      ]} />
    </div>
  );
}
