import { desc, eq } from 'drizzle-orm';
import { commissionRuleAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { categories, commissionRules } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'قواعد العمولات' };

export default async function Commissions() {
  const { allowed } = await adminWith('commissions.manage');
  if (!allowed) return <Forbidden />;
  const cats = await db.select({ id: categories.id, nameAr: categories.nameAr, parentId: categories.parentId }).from(categories).orderBy(categories.sortOrder);
  const rules = await db.select({ r: commissionRules, cat: categories.nameAr }).from(commissionRules).leftJoin(categories, eq(categories.id, commissionRules.categoryId)).orderBy(desc(commissionRules.effectiveFrom));
  return (
    <div className="space-y-4">
      <PageHeader title="قواعد العمولات" description="العمولة تُحسب لكل بند في الطلب وفق القاعدة السارية لتصنيفه لحظة الطلب، وتُحفظ لقطة منها على البند فلا تتأثر الطلبات السابقة بأي تعديل لاحق." />
      <Alert tone="info">القيم الافتراضية المزروعة هي قيم مرجعية تقريبية من السوق (Benchmark) وليست أسعاراً معتمدة — راجعها قبل الإطلاق. يُطبَّق أقرب تصنيف أب له قاعدة، ثم القاعدة العامة.</Alert>
      <DataTable rows={rules} rowKey={(x) => x.r.id} columns={[
        { key: 'l', header: 'القاعدة', cell: (x) => <span className="font-semibold">{x.r.label}</span> },
        { key: 'c', header: 'التصنيف', cell: (x) => x.cat ?? <Badge tone="brand">عامة</Badge> },
        { key: 'p', header: 'النسبة', cell: (x) => `${(x.r.percentBps / 100).toFixed(2)}%` },
        { key: 't', header: 'شرائح', cell: (x) => (x.r.tiers?.length ? x.r.tiers.map((t) => `${t.upTo == null ? 'ما فوق' : `حتى ${formatEGP(t.upTo)}`}: ${(t.bps / 100).toFixed(2)}%`).join(' · ') : '—') },
        { key: 'm', header: 'حد أدنى', cell: (x) => (x.r.minFee != null ? formatEGP(x.r.minFee) : '—') },
        { key: 'e', header: 'سارية من', cell: (x) => formatDate(x.r.effectiveFrom, true) },
        { key: 's', header: 'الحالة', cell: (x) => (
          <ActionForm action={commissionRuleAction} className="flex items-center gap-1"><input type="hidden" name="back" value="/admin/commissions" />
            <input type="hidden" name="op" value="toggle" /><input type="hidden" name="ruleId" value={x.r.id} /><input type="hidden" name="isEnabled" value={x.r.isEnabled ? '' : 'on'} />
            <Badge tone={x.r.isEnabled ? 'success' : 'neutral'}>{x.r.isEnabled ? 'مفعّلة' : 'معطلة'}</Badge>
            <Input name="reason" required minLength={3} placeholder="السبب" className="h-8 w-28 text-xs" aria-label="السبب" />
            <SubmitButton size="sm" variant="ghost">{x.r.isEnabled ? 'تعطيل' : 'تفعيل'}</SubmitButton>
          </ActionForm>
        ) },
      ]} />
      <ActionForm action={commissionRuleAction} className="card grid gap-3 p-5 md:grid-cols-2" resetOnSuccess><input type="hidden" name="back" value="/admin/commissions" />
        <input type="hidden" name="op" value="create" />
        <h2 className="font-bold md:col-span-2">إضافة نسخة قاعدة جديدة</h2>
        <Field label="الاسم" required><Input name="label" required minLength={2} /></Field>
        <Field label="التصنيف"><Select name="categoryId"><option value="">القاعدة العامة (كل التصنيفات)</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.nameAr}</option>)}</Select></Field>
        <Field label="النسبة %" required hint="مثال: 7.5"><Input name="percent" required inputMode="decimal" /></Field>
        <Field label="حد أدنى للعمولة لكل بند (ج.م)"><Input name="minFee" inputMode="decimal" /></Field>
        <Field label="سارية من"><Input name="effectiveFrom" type="datetime-local" /></Field>
        <Field label="شرائح سعرية (اختياري)" hint="سطر لكل شريحة بصيغة: الحد الأعلى للسعر:النسبة — واستخدم * للباقي. مثال: 1000:10 ثم *:6"><Textarea name="tiers" rows={3} className="ltr" /></Field>
        <Field label="ملاحظات" className="md:col-span-2"><Input name="notes" /></Field>
        <div className="md:col-span-2"><SubmitButton>حفظ القاعدة</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
