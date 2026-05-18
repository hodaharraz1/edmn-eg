import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { SITE_URL } from '@/lib/utils';
import { blogPosts, getPostBySlug, getAllSlugs } from '@/data/blog-posts';
import SectionTag from '@/components/ui/SectionTag';
import CTABanner from '@/components/sections/CTABanner';
import { Calendar, Clock, ArrowLeft, ArrowRight, User } from 'lucide-react';

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: 'Not Found' };
  const isAr = locale === 'ar';
  return {
    title: `${isAr ? post.titleAr : post.titleEn} | إضمن EDMN`,
    description: isAr ? post.excerptAr : post.excerptEn,
    openGraph: {
      type: 'article',
      title: isAr ? post.titleAr : post.titleEn,
      description: isAr ? post.excerptAr : post.excerptEn,
      publishedTime: post.publishedAt,
    },
    alternates: {
      canonical: `${SITE_URL}/blog/${slug}`,
      languages: {
        ar: `${SITE_URL}/blog/${slug}`,
        en: `${SITE_URL}/en/blog/${slug}`,
      },
    },
  };
}

function BlogPostContent({ slug }: { slug: string }) {
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const t = useTranslations('blog');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;
  const getLocalizedHref = (href: string) => isAr ? href : `/en${href}`;

  const title = isAr ? post.titleAr : post.titleEn;
  const content = isAr ? post.contentAr : post.contentEn;
  const readTime = isAr ? post.readTimeAr : post.readTimeEn;

  // Simple markdown-to-HTML (headings and paragraphs)
  const renderContent = (md: string) => {
    return md
      .trim()
      .split('\n')
      .map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="text-xl font-bold text-[#1A57A1] mt-8 mb-3">{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold text-[#1F2937] mt-10 mb-4">{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return null; // Already in h1
        if (line.startsWith('- ')) return <li key={i} className="flex items-start gap-2 text-[#4B5563] mb-2"><span className="text-[#1A57A1] mt-1">•</span>{line.slice(2)}</li>;
        if (line.trim() === '') return <br key={i} />;
        return <p key={i} className="text-[#4B5563] leading-relaxed mb-3">{line}</p>;
      });
  };

  const relatedPosts = blogPosts.filter((p) => p.slug !== slug).slice(0, 2);

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: isAr ? post.excerptAr : post.excerptEn,
    datePublished: post.publishedAt,
    author: { '@type': 'Organization', name: 'إضمن EDMN' },
    publisher: {
      '@type': 'Organization',
      name: 'إضمن EDMN',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icons/logo.png` },
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />

      {/* Hero */}
      <section className="pt-32 pb-12 bg-gradient-to-br from-[#EBF2FC] to-white">
        <div className="container max-w-3xl">
          <Link
            href={getLocalizedHref('/blog')}
            className="inline-flex items-center gap-2 text-[#1A57A1] font-bold text-sm mb-6 hover:gap-3 transition-all"
          >
            <ArrowRight size={14} className={isAr ? 'rotate-180' : ''} />
            {t('backToBlog')}
          </Link>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="section-tag">{post.tags[0]}</span>
          </div>
          <h1 className="text-[#1F2937] mb-5">{title}</h1>
          <div className="flex flex-wrap items-center gap-5 text-sm text-[#6B7280]">
            <span className="flex items-center gap-1.5">
              <User size={14} className="text-[#1A57A1]" />
              {t('author')}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="text-[#1A57A1]" />
              {new Date(post.publishedAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={14} className="text-[#1A57A1]" />
              {readTime} {t('minRead')}
            </span>
          </div>
        </div>
      </section>

      {/* Article */}
      <section className="section-padding bg-white">
        <div className="container max-w-3xl">
          <article className="prose-content">
            {renderContent(content)}
          </article>

          {/* Tags */}
          <div className="mt-10 pt-6 border-t border-[#E5E7EB] flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-[#6B7280]">
              {isAr ? 'الوسوم:' : 'Tags:'}
            </span>
            {post.tags.map((tag) => (
              <span key={tag} className="px-3 py-1 bg-[#EBF2FC] text-[#1A57A1] rounded-full text-xs font-bold">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Related */}
      {relatedPosts.length > 0 && (
        <section className="section-padding bg-[#F4F3F3]">
          <div className="container max-w-3xl">
            <h2 className="text-[#1A57A1] mb-8">{t('relatedArticles')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {relatedPosts.map((rp) => (
                <Link
                  key={rp.slug}
                  href={getLocalizedHref(`/blog/${rp.slug}`)}
                  className="bg-white border border-[#E5E7EB] rounded-2xl p-5 hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 transition-all"
                >
                  <p className="font-bold text-[#1F2937] mb-2 hover:text-[#1A57A1] transition-colors leading-snug text-base">
                    {isAr ? rp.titleAr : rp.titleEn}
                  </p>
                  <p className="text-xs text-[#9CA3AF] flex items-center gap-1">
                    <Clock size={10} />
                    {isAr ? rp.readTimeAr : rp.readTimeEn} {t('minRead')}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <CTABanner />
    </>
  );
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  return <BlogPostContent slug={slug} />;
}
