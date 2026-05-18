import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { SITE_URL } from '@/lib/utils';
import SectionTag from '@/components/ui/SectionTag';
import CTABanner from '@/components/sections/CTABanner';
import { blogPosts } from '@/data/blog-posts';
import { Calendar, Clock, ArrowLeft, ArrowRight } from 'lucide-react';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seo' });
  return {
    title: t('blogTitle'),
    description: t('blogDesc'),
    alternates: {
      canonical: `${SITE_URL}/blog`,
      languages: { ar: `${SITE_URL}/blog`, en: `${SITE_URL}/en/blog` },
    },
  };
}

function BlogContent() {
  const t = useTranslations('blog');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;
  const getLocalizedHref = (href: string) => isAr ? href : `/en${href}`;

  const featured = blogPosts.filter((p) => p.featured);
  const rest = blogPosts.filter((p) => !p.featured);

  return (
    <>
      {/* Hero */}
      <section style={{ paddingTop: "100px", paddingBottom: "64px", background: "linear-gradient(180deg,#f5f5f7 0%,#ffffff 100%)" }}>
        <div className="container text-center">
          <SectionTag>{t('tag')}</SectionTag>
          <h1 className="text-[#1A57A1] mt-2 mb-4">{t('title')}</h1>
          <p className="text-lg text-[#4B5563] max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>
      </section>

      {/* Featured Posts */}
      <section className="section-padding bg-white">
        <div className="container">
          <h2 className="text-[#1A57A1] mb-8">
            {isAr ? 'مقالات مميزة' : 'Featured Articles'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {featured.map((post) => (
              <article key={post.slug} className="blog-card group">
                {/* Category Badge */}
                <div className="bg-gradient-to-br from-[#1A57A1] to-[#2B72D0] h-40 flex items-center justify-center relative overflow-hidden">
                  <span className="text-6xl">{post.category === 'education' ? '📚' : '🛡️'}</span>
                  <div className="absolute inset-0 bg-black/10" />
                  <span className="absolute top-4 start-4 bg-white/90 text-[#1A57A1] text-xs font-bold px-3 py-1 rounded-full">
                    {isAr ? 'مميز' : 'Featured'}
                  </span>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-4 text-xs text-[#9CA3AF] mb-3">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(post.publishedAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {isAr ? `${post.readTimeAr} ${t('minRead')}` : `${post.readTimeEn} ${t('minRead')}`}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#1F2937] text-xl mb-3 group-hover:text-[#1A57A1] transition-colors leading-snug">
                    {isAr ? post.titleAr : post.titleEn}
                  </h3>
                  <p className="text-[#4B5563] text-sm mb-5 leading-relaxed">
                    {isAr ? post.excerptAr : post.excerptEn}
                  </p>
                  <Link
                    href={getLocalizedHref(`/blog/${post.slug}`)}
                    className="inline-flex items-center gap-1.5 text-[#1A57A1] font-bold text-sm hover:gap-2.5 transition-all"
                  >
                    {t('readMore')}
                    <ArrowIcon size={14} />
                  </Link>
                </div>
              </article>
            ))}
          </div>

          {/* All Posts */}
          {rest.length > 0 && (
            <>
              <h2 className="text-[#1A57A1] mb-6">
                {isAr ? 'جميع المقالات' : 'All Articles'}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {rest.map((post) => (
                  <article key={post.slug} className="blog-card group p-5">
                    <span className="text-3xl mb-4 block">
                      {post.category === 'payments' ? '💳' : '📖'}
                    </span>
                    <div className="flex items-center gap-3 text-xs text-[#9CA3AF] mb-2">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {isAr ? `${post.readTimeAr} ${t('minRead')}` : `${post.readTimeEn} ${t('minRead')}`}
                      </span>
                    </div>
                    <h3 className="font-bold text-[#1F2937] mb-2 group-hover:text-[#1A57A1] transition-colors text-base leading-snug">
                      {isAr ? post.titleAr : post.titleEn}
                    </h3>
                    <p className="text-[#4B5563] text-xs mb-4 leading-relaxed">
                      {isAr ? post.excerptAr : post.excerptEn}
                    </p>
                    <Link
                      href={getLocalizedHref(`/blog/${post.slug}`)}
                      className="inline-flex items-center gap-1 text-[#1A57A1] font-bold text-xs hover:gap-2 transition-all"
                    >
                      {t('readMore')}
                      <ArrowIcon size={12} />
                    </Link>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <CTABanner />
    </>
  );
}

export default function BlogPage() {
  return <BlogContent />;
}
