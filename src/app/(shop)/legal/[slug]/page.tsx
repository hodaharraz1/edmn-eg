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
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'السياسات', href: '/legal' }, { label: LEGAL_CODES[code].title }]} />} title={doc?.title ?? LEGAL_CODES[code].title} description={doc ? <>الإصدار <span dir="ltr">{doc.version}</span> · آخر تحديث {formatDate(doc.updatedAt)}</> : undefined} />
      {(!doc || doc.status !== 'APPROVED') && <Alert tone="warning" className="mb-4" title="نص غير نهائي">هذه الوثيقة مسودة قيد المراجعة القانونية ولا تمثل الصيغة النهائية المعتمدة.</Alert>}
      <article className="card space-y-3 p-6 text-sm leading-8">{doc ? <LegalBody body={doc.body} /> : 'لم يتم نشر هذه الوثيقة بعد.'}</article>
    </div>
  );
}

/** Minimal, safe formatting for legal text: "## " headings and "- " bullets; everything else is a paragraph. */
function LegalBody({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="list-disc space-y-1 ps-6 marker:text-brand-600">{list.map((x, i) => <li key={i}>{x}</li>)}</ul>);
    list = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('- ')) { list.push(line.slice(2)); continue; }
    flush();
    if (!line) continue;
    if (line.startsWith('## ')) blocks.push(<h2 key={`h${blocks.length}`} className="pt-3 text-base font-bold text-ink">{line.slice(3)}</h2>);
    else blocks.push(<p key={`p${blocks.length}`}>{line}</p>);
  }
  flush();
  return <>{blocks}</>;
}
