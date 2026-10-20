import { asc, eq } from 'drizzle-orm';
import { usedPolicyAction } from '@/app/_actions/used';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { categories } from '@/server/db/schema';
import { listPolicies } from '@/server/modules/used/policies';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';
import { MOBILE_PHONE_POLICY, usedPolicySchema } from '@/domain/used';

export const metadata = { title: 'سياسات فئات المستعمل' };

/**
 * Category → condition schema → required evidence → verification → inspection → dispute reasons → protection levels.
 * Adding a category (laptops, consoles, cameras) is a new policy here — no code change. catalog.manage + fresh 2FA,
 * a reason, and every save is a new audited version (frozen snapshots keep the version they were made with).
 */
export default async function UsedPolicies() {
  const { allowed } = await adminWith('catalog.manage');
  if (!allowed) return <Forbidden />;
  const [rows, cats] = await Promise.all([listPolicies(), db.select({ id: categories.id, nameAr: categories.nameAr, depth: categories.depth }).from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.depth), asc(categories.nameAr))]);
  const template = JSON.stringify(usedPolicySchema.parse(MOBILE_PHONE_POLICY), null, 2);
  return (
    <div className="space-y-5" data-testid="admin-used-policies">
      <PageHeader title="سياسات فئات المستعمل" description="كل فئة ليها: بيانات الحالة، الصور المطلوبة، قواعد التحقق، مدة الفحص، أسباب النزاع، ومستويات الحماية." />
      {rows.map(({ p, categoryName }) => (
        <ActionForm key={p.id} action={usedPolicyAction} className="card space-y-3 p-5">
          <input type="hidden" name="categoryId" value={p.categoryId} />
          <input type="hidden" name="back" value="/admin/used/policies" />
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold">{categoryName}</h2>
            <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? 'مفعّلة' : 'متوقفة'}</Badge>
            <span className="text-xs text-muted">نسخة {p.version} · {formatDate(p.updatedAt, true)}</span>
          </div>
          <Field label="الإعدادات (JSON)" htmlFor={`cfg-${p.id}`}><Textarea id={`cfg-${p.id}`} name="config" rows={14} dir="ltr" className="font-mono text-xs" defaultValue={JSON.stringify(p.config, null, 2)} /></Field>
          <Checkbox name="enabled" defaultChecked={p.enabled} label="مفعّلة" />
          <Field label="سبب التعديل" htmlFor={`reason-${p.id}`} required><Input id={`reason-${p.id}`} name="reason" required minLength={3} /></Field>
          <SubmitButton>حفظ نسخة جديدة</SubmitButton>
        </ActionForm>
      ))}
      <ActionForm action={usedPolicyAction} className="card space-y-3 p-5">
        <input type="hidden" name="back" value="/admin/used/policies" />
        <h2 className="font-bold">تفعيل التوثيق لفئة جديدة</h2>
        <Field label="الفئة" htmlFor="new-cat"><Select id="new-cat" name="categoryId">{cats.map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.depth)}{c.nameAr}</option>)}</Select></Field>
        <Field label="الإعدادات (JSON) — ابدأ من قالب الموبايلات وعدّل" htmlFor="new-cfg"><Textarea id="new-cfg" name="config" rows={10} dir="ltr" className="font-mono text-xs" defaultValue={template} /></Field>
        <Checkbox name="enabled" defaultChecked label="مفعّلة" />
        <Field label="سبب التفعيل" htmlFor="new-reason" required><Input id="new-reason" name="reason" required minLength={3} /></Field>
        <SubmitButton variant="secondary">تفعيل</SubmitButton>
      </ActionForm>
    </div>
  );
}
