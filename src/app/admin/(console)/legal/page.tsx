import { desc, eq } from 'drizzle-orm';
import { legalAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { legalDocuments } from '@/server/db/schema';
import { LEGAL_CODES, type LegalCode } from '@/server/modules/cms/service';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Textarea } from '@/ui/form';
import { cn } from '@/lib/cn';

export const metadata = { title: 'المستندات القانونية' };

export default async function Legal(props: PageProps<'/admin/legal'>) {
  const { allowed } = await adminWith('legal.manage');
  if (!allowed) return <Forbidden />;
  const code = (String((await props.searchParams).code ?? 'TERMS_OF_USE') as LegalCode) in LEGAL_CODES ? (String((await props.searchParams).code ?? 'TERMS_OF_USE') as LegalCode) : 'TERMS_OF_USE';
  const versions = await db.select().from(legalDocuments).where(eq(legalDocuments.code, code)).orderBy(desc(legalDocuments.createdAt));
  const latest = versions[0];
  return (
    <div className="space-y-4">
      <PageHeader title="المستندات القانونية" description="إدارة إصدارات الشروط والسياسات. كل إصدار منشور يُحفظ ولا يُعدّل، وتُسجّل موافقات المستخدمين على الإصدار المحدد." />
      <Alert tone="info" title="إصدارات النصوص القانونية">الإصدار الحالي 1.0 معتمد من إدارة الشركة. أي تعديل يُنشر كإصدار جديد، ويُحفظ كل إصدار سابق، وتُسجَّل موافقات المستخدمين على الإصدار الذي وافقوا عليه.</Alert>
      <nav className="flex flex-wrap gap-2">{(Object.keys(LEGAL_CODES) as LegalCode[]).map((c) => <a key={c} href={`/admin/legal?code=${c}`} className={cn('rounded-full border px-3 py-1 text-sm', c === code ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line')}>{LEGAL_CODES[c].title}</a>)}</nav>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">الإصدارات — {LEGAL_CODES[code].title}</h2>
        <ul className="divide-y divide-line text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>الإصدار <b className="ltr">{v.version}</b> · {v.title} · {formatDate(v.updatedAt, true)}</span>
              <span className="flex items-center gap-2"><StatusChip status={v.status} />{v.isCurrent && <Badge tone="success">الحالي</Badge>}</span>
              {v.status === 'DRAFT' && (
                <ActionForm action={legalAction} className="flex w-full flex-wrap items-center gap-2">
                  <input type="hidden" name="op" value="publish" /><input type="hidden" name="code" value={code} /><input type="hidden" name="version" value={v.version} />
                  <Checkbox name="approvedByCounsel" label="تمت مراجعته واعتماده من المستشار القانوني" />
                  <Input name="reason" required minLength={3} placeholder="سبب النشر / مرجع الاعتماد" className="w-64" aria-label="السبب" />
                  <SubmitButton size="sm">نشر هذا الإصدار</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </section>
      <ActionForm action={legalAction} className="card grid gap-3 p-5">
        <input type="hidden" name="op" value="draft" /><input type="hidden" name="code" value={code} />
        <h2 className="font-bold">حفظ مسودة (جديدة أو تحديث مسودة بنفس رقم الإصدار)</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="رقم الإصدار" required><Input name="version" required className="ltr" placeholder="1.0" /></Field>
          <Field label="العنوان" required><Input name="title" required defaultValue={latest?.title ?? LEGAL_CODES[code].title} /></Field>
        </div>
        <Field label="النص" required><Textarea name="body" required rows={14} defaultValue={latest?.body ?? ''} /></Field>
        <SubmitButton>حفظ كمسودة</SubmitButton>
      </ActionForm>
    </div>
  );
}
