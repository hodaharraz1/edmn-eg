import { asc, desc, eq, isNull } from 'drizzle-orm';
import { categoryAction, categoryAttributeAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { attributes, categories, categoryAttributes, commissionRules } from '@/server/db/schema';
import { bpsToPercentString } from '@/server/core/money';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/ui/form';
import Link from 'next/link';

export const metadata = { title: 'التصنيفات' };

export default async function CategoriesAdmin(props: PageProps<'/admin/categories'>) {
  const { allowed } = await adminWith('catalog.manage');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const all = await db.select().from(categories).orderBy(asc(categories.depth), asc(categories.sortOrder));
  const rules = await db.select().from(commissionRules).where(eq(commissionRules.isEnabled, true)).orderBy(desc(commissionRules.effectiveFrom));
  const [defRule] = await db.select().from(commissionRules).where(isNull(commissionRules.categoryId)).orderBy(desc(commissionRules.effectiveFrom)).limit(1);
  const editing = all.find((c) => c.id === sp.edit);
  const ordered: typeof all = [];
  const add = (parent: string | null) => all.filter((c) => c.parentId === parent).forEach((c) => { ordered.push(c); add(c.id); });
  add(null);
  const attrs = await db.select().from(attributes).orderBy(asc(attributes.nameAr));
  const linked = editing ? await db.select({ ca: categoryAttributes, a: attributes }).from(categoryAttributes).innerJoin(attributes, eq(attributes.id, categoryAttributes.attributeId)).where(eq(categoryAttributes.categoryId, editing.id)) : [];
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div>
        <PageHeader title="التصنيفات" description={`التغيير هنا لا يحتاج نشر كود. العمولة الافتراضية: ${defRule ? bpsToPercentString(defRule.percentBps) : '—'}% — إدارة العمولات من صفحة العمولات.`} />
        <div className="card divide-y divide-line">
          {ordered.map((c) => {
            const rule = rules.find((r) => r.categoryId === c.id);
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm" style={{ paddingInlineStart: 16 + c.depth * 24 }}>
                <span className="flex items-center gap-2">
                  <Link href={`/admin/categories?edit=${c.id}`} className="font-medium hover:text-brand-700">{c.nameAr}</Link>
                  <span className="text-xs text-muted ltr">/{c.slug}</span>
                  {!c.isActive && <Badge>غير نشط</Badge>}
                  {c.isRestricted && <Badge tone="warning">مراجعة خاصة</Badge>}
                  {c.isProhibited && <Badge tone="danger">محظور</Badge>}
                </span>
                <span className="text-xs text-muted">{rule ? `عمولة ${bpsToPercentString(rule.percentBps)}%` : 'العمولة الموروثة'}</span>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="space-y-4">
        <ActionForm action={categoryAction} className="card space-y-3 p-4" encType="multipart/form-data" key={editing?.id ?? 'new'}>
          <h2 className="font-bold">{editing ? `تعديل: ${editing.nameAr}` : 'تصنيف جديد'}</h2>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <Field label="التصنيف الأب" htmlFor="parentId"><Select id="parentId" name="parentId" defaultValue={editing?.parentId ?? ''}><option value="">— رئيسي —</option>{ordered.filter((c) => c.id !== editing?.id).map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.depth)}{c.nameAr}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الاسم (عربي)" htmlFor="nameAr" required><Input id="nameAr" name="nameAr" defaultValue={editing?.nameAr} required /></Field>
            <Field label="الاسم (إنجليزي)" htmlFor="nameEn" required><Input id="nameEn" name="nameEn" defaultValue={editing?.nameEn} required dir="ltr" /></Field>
            <Field label="الرابط (slug)" htmlFor="slug"><Input id="slug" name="slug" defaultValue={editing?.slug} dir="ltr" /></Field>
            <Field label="الترتيب" htmlFor="sortOrder"><Input id="sortOrder" name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} /></Field>
            <Field label="أيقونة (lucide)" htmlFor="icon"><Input id="icon" name="icon" defaultValue={editing?.icon ?? ''} dir="ltr" /></Field>
          </div>
          <Field label="وصف" htmlFor="descriptionAr"><Input id="descriptionAr" name="descriptionAr" defaultValue={editing?.descriptionAr ?? ''} /></Field>
          <Field label="عنوان SEO" htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={editing?.seoTitle ?? ''} /></Field>
          <Field label="وصف SEO" htmlFor="seoDescription"><Input id="seoDescription" name="seoDescription" defaultValue={editing?.seoDescription ?? ''} /></Field>
          <input type="file" name="image" accept="image/*" className="text-xs" aria-label="صورة التصنيف" />
          <Checkbox name="isActive" defaultChecked={editing?.isActive ?? true} label="نشط" />
          <Checkbox name="isRestricted" defaultChecked={editing?.isRestricted} label="مقيّد (مراجعة معززة لكل منتج)" />
          <Checkbox name="isProhibited" defaultChecked={editing?.isProhibited} label="محظور (لا يقبل منتجات)" />
          <SubmitButton>حفظ</SubmitButton>
          {editing && <Link href="/admin/categories" className="ms-3 text-sm text-muted">إلغاء</Link>}
        </ActionForm>
        {editing && (
          <section className="card space-y-3 p-4 text-sm">
            <h2 className="font-bold">سمات التصنيف (تُورّث للتصنيفات الفرعية)</h2>
            {linked.map(({ ca, a }) => (
              <ActionForm key={a.id} action={categoryAttributeAction} className="flex items-center justify-between rounded-lg border border-line p-2">
                <input type="hidden" name="categoryId" value={editing.id} /><input type="hidden" name="attributeId" value={a.id} /><input type="hidden" name="op" value="remove" />
                <span>{a.nameAr} {ca.isRequired && <Badge tone="warning">إلزامي</Badge>} {ca.isFilterable && <Badge>فلتر</Badge>} {ca.isVariantAxis && <Badge tone="brand">خيار</Badge>}</span>
                <SubmitButton size="sm" variant="ghost">إزالة</SubmitButton>
              </ActionForm>
            ))}
            <ActionForm action={categoryAttributeAction} className="space-y-2">
              <input type="hidden" name="categoryId" value={editing.id} />
              <Select name="attributeId" aria-label="السمة">{attrs.map((a) => <option key={a.id} value={a.id}>{a.nameAr} ({a.type})</option>)}</Select>
              <div className="flex flex-wrap gap-3"><Checkbox name="isRequired" label="إلزامي" /><Checkbox name="isFilterable" label="قابل للفلترة" /><Checkbox name="isVariantAxis" label="يكوّن خيارات" /></div>
              <SubmitButton size="sm" variant="outline">ربط السمة</SubmitButton>
            </ActionForm>
          </section>
        )}
      </aside>
    </div>
  );
}
