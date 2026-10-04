import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { brandAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { brands, files } from '@/server/db/schema';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { mediaUrl } from '@/ui/commerce';
import { DataTable, PageHeader } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Checkbox, Field, Input } from '@/ui/form';

export const metadata = { title: 'العلامات التجارية' };

export default async function BrandsAdmin(props: PageProps<'/admin/brands'>) {
  const { allowed } = await adminWith('catalog.manage');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const rows = await db.select({ b: brands, logo: files.storageKey }).from(brands).leftJoin(files, eq(files.id, brands.logoFileId)).orderBy(asc(brands.name));
  const editing = rows.find((r) => r.b.id === sp.edit)?.b;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div>
        <PageHeader title="العلامات التجارية" />
        <DataTable rows={rows} rowKey={(r) => r.b.id} columns={[
          { key: 'l', header: '', cell: (r) => <span className="grid size-9 place-items-center overflow-hidden rounded bg-page">{r.logo ? <img src={mediaUrl(r.logo, 'thumb')!} alt="" className="size-full object-contain" /> : r.b.name.charAt(0)}</span> },
          { key: 'n', header: 'الاسم', cell: (r) => <Link href={`/admin/brands?edit=${r.b.id}`} className="font-medium text-brand-700">{r.b.name} {r.b.nameAr && `· ${r.b.nameAr}`}</Link> },
          { key: 's', header: 'الرابط', cell: (r) => <span className="ltr text-xs">/brand/{r.b.slug}</span> },
          { key: 'a', header: 'الحالة', cell: (r) => <Badge tone={r.b.isActive ? 'success' : 'neutral'}>{r.b.isActive ? 'نشط' : 'غير نشط'}</Badge> },
        ]} />
      </div>
      <ActionForm action={brandAction} className="card h-fit space-y-3 p-4" encType="multipart/form-data" key={editing?.id ?? 'new'}>
        <h2 className="font-bold">{editing ? 'تعديل علامة' : 'علامة جديدة'}</h2>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <Field label="الاسم" htmlFor="name" required><Input id="name" name="name" defaultValue={editing?.name} required /></Field>
        <Field label="الاسم بالعربية" htmlFor="nameAr"><Input id="nameAr" name="nameAr" defaultValue={editing?.nameAr ?? ''} /></Field>
        <Field label="الرابط" htmlFor="slug"><Input id="slug" name="slug" defaultValue={editing?.slug} dir="ltr" /></Field>
        <Field label="عنوان SEO" htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={editing?.seoTitle ?? ''} /></Field>
        <Field label="وصف SEO" htmlFor="seoDescription"><Input id="seoDescription" name="seoDescription" defaultValue={editing?.seoDescription ?? ''} /></Field>
        <input type="file" name="logo" accept="image/*" className="text-xs" aria-label="الشعار" />
        <Checkbox name="isActive" defaultChecked={editing?.isActive ?? true} label="نشط" />
        <SubmitButton>حفظ</SubmitButton>
      </ActionForm>
    </div>
  );
}
