import { asc, desc } from 'drizzle-orm';
import { cmsBlockAction, cmsPageAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { CMS_BLOCK_TYPES, cmsBlocks, cmsPages } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader, Tabs } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export const metadata = { title: 'إدارة المحتوى' };

const EXAMPLE = '{"heading":"عنوان","subheading":"","ctaLabel":"تسوق الآن","ctaHref":"/deals"}';

export default async function Cms(props: PageProps<'/admin/cms'>) {
  const { allowed } = await adminWith('cms.manage');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'blocks');
  const blocks = await db.select().from(cmsBlocks).orderBy(asc(cmsBlocks.placement), asc(cmsBlocks.sortOrder));
  const pages = await db.select().from(cmsPages).orderBy(desc(cmsPages.updatedAt));
  return (
    <div className="space-y-4">
      <PageHeader title="إدارة المحتوى" description="أقسام الصفحة الرئيسية والبانرات والصفحات الثابتة. البيانات تُتحقق من صحتها قبل الحفظ." />
      <Tabs active={tab} tabs={[{ key: 'blocks', label: 'أقسام الصفحة الرئيسية', href: '/admin/cms' }, { key: 'pages', label: 'الصفحات', href: '/admin/cms?tab=pages' }]} />
      {tab === 'blocks' && (
        <>
          {blocks.map((b) => (
            <details key={b.id} className="card p-4">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2"><b>{b.title ?? b.type}</b><Badge tone="neutral">{b.type}</Badge><Badge tone="neutral">{b.placement} · {b.sortOrder}</Badge>{b.isActive ? <Badge tone="success">ظاهر</Badge> : <Badge tone="neutral">مخفي</Badge>}</summary>
              <BlockForm b={b} />
              {b.isActive && <ActionForm action={cmsBlockAction} className="mt-2"><input type="hidden" name="op" value="disable" /><input type="hidden" name="id" value={b.id} /><SubmitButton size="sm" variant="ghost">إخفاء القسم</SubmitButton></ActionForm>}
            </details>
          ))}
          <div className="card p-4"><h2 className="mb-2 font-bold">قسم جديد</h2><BlockForm /></div>
        </>
      )}
      {tab === 'pages' && (
        <>
          {pages.map((p) => (
            <details key={p.id} className="card p-4">
              <summary className="cursor-pointer"><b>{p.title}</b> <span className="ltr text-xs text-muted">/pages/{p.slug}</span> {p.isPublished ? <Badge tone="success">منشورة</Badge> : <Badge tone="neutral">مسودة</Badge>} <span className="text-xs text-muted">{formatDate(p.updatedAt)}</span></summary>
              <PageForm p={p} />
            </details>
          ))}
          <div className="card p-4"><h2 className="mb-2 font-bold">صفحة جديدة</h2><PageForm /></div>
        </>
      )}
    </div>
  );
}

function BlockForm({ b }: { b?: typeof cmsBlocks.$inferSelect }) {
  return (
    <ActionForm action={cmsBlockAction} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="op" value="save" />{b && <input type="hidden" name="id" value={b.id} />}
      <Field label="النوع"><Select name="type" defaultValue={b?.type ?? 'BANNER'}>{CMS_BLOCK_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="العنوان الداخلي"><Input name="title" defaultValue={b?.title ?? ''} /></Field>
      <Field label="المكان"><Input name="placement" defaultValue={b?.placement ?? 'HOME'} className="ltr" /></Field>
      <Field label="الترتيب"><Input name="sortOrder" type="number" defaultValue={b?.sortOrder ?? 0} /></Field>
      <Field label="البيانات (JSON)" className="md:col-span-2" hint="الحقول حسب نوع القسم؛ يُرفض الحفظ إن لم تطابق المخطط."><Textarea name="data" rows={5} className="ltr font-mono text-xs" defaultValue={b ? JSON.stringify(b.data, null, 2) : EXAMPLE} /></Field>
      <FileInput name="image" label="صورة (للبانر/الواجهة)" />
      <Checkbox name="isActive" label="ظاهر" defaultChecked={b?.isActive ?? true} />
      <div className="md:col-span-2"><SubmitButton size="sm">حفظ</SubmitButton></div>
    </ActionForm>
  );
}

function PageForm({ p }: { p?: typeof cmsPages.$inferSelect }) {
  return (
    <ActionForm action={cmsPageAction} className="mt-3 grid gap-3 md:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="العنوان" required><Input name="title" required defaultValue={p?.title} /></Field>
      <Field label="الرابط (slug)" required><Input name="slug" required defaultValue={p?.slug} className="ltr" /></Field>
      <Field label="المحتوى (نص؛ الأسطر الفارغة تفصل الفقرات)" className="md:col-span-2"><Textarea name="body" rows={8} defaultValue={p?.body} /></Field>
      <Checkbox name="isPublished" label="منشورة" defaultChecked={p?.isPublished ?? false} />
      <div className="md:col-span-2"><SubmitButton size="sm">حفظ</SubmitButton></div>
    </ActionForm>
  );
}
