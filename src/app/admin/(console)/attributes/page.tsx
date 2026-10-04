import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { attributeAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { attributeOptions, attributes } from '@/server/db/schema';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader } from '@/ui/data';
import { Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'السمات' };

export default async function AttributesAdmin(props: PageProps<'/admin/attributes'>) {
  const { allowed } = await adminWith('catalog.manage');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const rows = await db.select().from(attributes).orderBy(asc(attributes.code));
  const editing = rows.find((r) => r.id === sp.edit);
  const opts = editing ? await db.select().from(attributeOptions).where(eq(attributeOptions.attributeId, editing.id)).orderBy(asc(attributeOptions.sortOrder)) : [];
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <PageHeader title="سمات المنتجات" description="تُربط بالتصنيفات من صفحة التصنيفات (إلزامية / فلتر / خيار يكوّن متغيرات)." />
        <DataTable rows={rows} rowKey={(r) => r.id} columns={[
          { key: 'c', header: 'الكود', cell: (r) => <Link href={`/admin/attributes?edit=${r.id}`} className="ltr text-brand-700">{r.code}</Link> },
          { key: 'n', header: 'الاسم', cell: (r) => `${r.nameAr} / ${r.nameEn}` },
          { key: 't', header: 'النوع', cell: (r) => r.type },
          { key: 'u', header: 'الوحدة', cell: (r) => r.unit ?? '—' },
        ]} />
      </div>
      <ActionForm action={attributeAction} className="card h-fit space-y-3 p-4" key={editing?.id ?? 'new'}>
        <h2 className="font-bold">{editing ? 'تعديل سمة' : 'سمة جديدة'}</h2>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <Field label="الكود" htmlFor="code" required><Input id="code" name="code" defaultValue={editing?.code} required dir="ltr" readOnly={!!editing} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="الاسم (عربي)" htmlFor="nameAr" required><Input id="nameAr" name="nameAr" defaultValue={editing?.nameAr} required /></Field>
          <Field label="الاسم (إنجليزي)" htmlFor="nameEn" required><Input id="nameEn" name="nameEn" defaultValue={editing?.nameEn} required /></Field>
        </div>
        <Field label="النوع" htmlFor="type"><Select id="type" name="type" defaultValue={editing?.type ?? 'TEXT'} disabled={!!editing}>{['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN'].map((t) => <option key={t}>{t}</option>)}</Select>{editing && <input type="hidden" name="type" value={editing.type} />}</Field>
        <Field label="الوحدة" htmlFor="unit"><Input id="unit" name="unit" defaultValue={editing?.unit ?? ''} /></Field>
        <Field label="الخيارات (سطر لكل خيار: value|الاسم)" htmlFor="options"><Textarea id="options" name="options" rows={5} dir="ltr" defaultValue={opts.map((o) => `${o.value}|${o.labelAr}`).join('\n')} /></Field>
        <SubmitButton>حفظ</SubmitButton>
      </ActionForm>
    </div>
  );
}
