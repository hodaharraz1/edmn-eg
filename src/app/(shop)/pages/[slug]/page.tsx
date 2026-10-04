import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageBySlug } from '@/server/modules/cms/service';
import { PageHeader } from '@/ui/data';

export async function generateMetadata(props: PageProps<'/pages/[slug]'>): Promise<Metadata> {
  const p = await pageBySlug(decodeURIComponent((await props.params).slug));
  return p ? { title: p.title } : {};
}

export default async function CmsPage(props: PageProps<'/pages/[slug]'>) {
  const p = await pageBySlug(decodeURIComponent((await props.params).slug));
  if (!p) notFound();
  return (
    <div className="container-page max-w-3xl py-6">
      <PageHeader title={p.title} />
      <article className="card whitespace-pre-line p-6 text-sm leading-8">{p.body}</article>
    </div>
  );
}
