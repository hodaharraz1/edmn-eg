import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { currentLegal, legalCodeForSlug, LEGAL_CODES } from '@/server/modules/cms/service';
import { formatDate } from '@/lib/format';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';

export async function generateMetadata(props: PageProps<'/legal/[slug]'>): Promise<Metadata> {
  const code = legalCodeForSlug((await props.params).slug);
  return code ? { title: LEGAL_CODES[code].title, alternates: { canonical: `/legal/${LEGAL_CODES[code].slug}` } } : {};
}

export default async function LegalPage(props: PageProps<'/legal/[slug]'>) {
  const code = legalCodeForSlug((await props.params).slug);
  if (!code) notFound();
  const doc = await currentLegal(code);
  return (
    <div className="container-page max-w-3xl py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'السياسات', href: '/legal' }, { label: LEGAL_CODES[code].title }]} />} title={doc?.title ?? LEGAL_CODES[code].title} description={doc ? `الإصدار ${doc.version} · آخر تحديث ${formatDate(doc.updatedAt)}` : undefined} />
      {(!doc || doc.status !== 'APPROVED') && <Alert tone="warning" className="mb-4" title="نص غير نهائي">هذه الوثيقة مسودة قيد المراجعة القانونية ولا تمثل الصيغة النهائية المعتمدة.</Alert>}
      <article className="card whitespace-pre-line p-6 text-sm leading-8">{doc?.body ?? 'لم يتم نشر هذه الوثيقة بعد.'}</article>
    </div>
  );
}
