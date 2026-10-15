import { BadgeCheck, Camera, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';
import Link from '@/ui/link';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { categories, files, products, sellers, stores } from '@/server/db/schema';
import { searchProducts, productsByIds, type Sort } from '@/server/modules/catalog/search';
import { activeBlocks } from '@/server/modules/cms/service';
import { ProductCard, RailItem, SellerCard, mediaUrl } from '@/ui/commerce';
import { EscrowHowItWorks } from './_home/escrow';
import { HomeHero, SectionHeading, TrustStrip } from './_home/hero';
import { SellOnEdmn } from './_home/sell-cta';
import { WishlistButton, wishlistSet } from '@/app/_components/product-bits';
import { RecentlyViewed } from './recently-viewed';
import type { Metadata } from 'next';
import { JsonLd, siteJsonLd } from '@/app/_components/seo';
import { getAllSettings } from '@/server/modules/settings';

export const metadata: Metadata = { alternates: { canonical: '/' } };

type Block = Awaited<ReturnType<typeof activeBlocks>>[number];
const TRUST_ICONS: LucideIcon[] = [BadgeCheck, ShieldCheck, Camera, Sparkles];

async function rail(b: Block, seen: Set<string>) {
  const d = b.data as { source: string; productSlugs?: string[]; categorySlug?: string; limit?: number };
  const limit = d.limit ?? 12;
  let items;
  if (d.source === 'MANUAL' && d.productSlugs?.length) {
    const ids = await db.select({ id: products.id }).from(products).where(inArray(products.slug, d.productSlugs));
    items = await productsByIds(ids.map((i) => i.id));
  } else {
    const sort: Sort = d.source === 'BEST_SELLERS' ? 'best_selling' : d.source === 'NEW_ARRIVALS' ? 'newest' : d.source === 'TOP_RATED' ? 'top_rated' : 'recommended';
    let categoryId: string | undefined;
    if (d.categorySlug) categoryId = (await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, d.categorySlug)))[0]?.id;
    items = (await searchProducts({ sort, pageSize: limit + 12, dealsOnly: d.source === 'DEALS', condition: d.source === 'USED' ? 'USED' : d.source === 'RECOMMENDED' || d.source === 'BEST_SELLERS' ? 'NEW' : undefined, categoryId, inStock: true })).items;
  }
  // Each product appears once on the homepage: later rails skip products already shown above.
  items = items.filter((p) => !seen.has(p.id)).slice(0, limit);
  if (items.length < (d.source === 'USED' ? 1 : 3)) return null;
  for (const p of items) seen.add(p.id);
  const href = d.source === 'DEALS' ? '/deals' : d.source === 'BEST_SELLERS' ? '/best-sellers' : d.source === 'USED' ? '/search?condition=USED' : d.source === 'NEW_ARRIVALS' ? '/search?sort=newest' : undefined;
  const wished = await wishlistSet(items.map((i) => i.id));
  return (
    <section key={b.id} aria-labelledby={`rail-${b.id}`} className="space-y-4">
      <SectionHeading id={`rail-${b.id}`} title={b.title ?? 'منتجات مختارة'} href={href} />
      <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:gap-4 lg:mx-0 lg:px-0">
        {items.map((p) => (
          <RailItem key={p.id}>
            <ProductCard p={p} wishlistSlot={<WishlistButton productId={p.id} active={wished.has(p.id)} back="/" />} />
          </RailItem>
        ))}
      </div>
    </section>
  );
}

async function featuredCategories(b: Block) {
  const slugs = (b.data as { categorySlugs: string[] }).categorySlugs ?? [];
  const rows = slugs.length
    ? await db.select({ c: categories, key: files.storageKey }).from(categories).leftJoin(files, eq(files.id, categories.imageFileId)).where(and(inArray(categories.slug, slugs), eq(categories.isActive, true)))
    : [];
  const ordered = slugs.map((s) => rows.find((r) => r.c.slug === s)).filter(Boolean) as typeof rows;
  if (!ordered.length) return null;
  return (
    <section key={b.id} aria-labelledby={`cats-${b.id}`} className="space-y-4">
      <SectionHeading id={`cats-${b.id}`} title={b.title ?? 'تسوّق حسب التصنيف'} href="/categories" hrefLabel="كل التصنيفات" />
      <ul className="grid grid-cols-3 gap-2.5 xs:grid-cols-4 sm:grid-cols-6 sm:gap-3">
        {ordered.map(({ c, key }) => {
          const Icon = ((c.icon && (Icons as unknown as Record<string, LucideIcon>)[c.icon]) || Icons.Tag) as LucideIcon;
          return (
            <li key={c.id}>
              <Link
                href={`/category/${c.slug}`}
                className="group flex h-full flex-col items-center gap-2.5 rounded-2xl bg-white p-3 text-center shadow-[var(--shadow-card)] ring-1 ring-line transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] hover:ring-brand-200 sm:p-4"
              >
                <span className="grid size-12 place-items-center overflow-hidden rounded-2xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100 sm:size-14">
                  {key ? <img src={mediaUrl(key, 'thumb')!} alt="" className="size-full object-cover" /> : <Icon className="size-6 sm:size-7" aria-hidden />}
                </span>
                <span className="line-clamp-2 text-xs font-semibold leading-5 sm:text-sm">{c.nameAr}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function featuredSellers(b: Block) {
  const slugs = (b.data as { storeSlugs: string[] }).storeSlugs ?? [];
  const where = slugs.length ? and(inArray(stores.slug, slugs), eq(sellers.status, 'APPROVED')) : eq(sellers.status, 'APPROVED');
  const rows = await db
    .select({
      name: stores.name,
      slug: stores.slug,
      isVerified: stores.isVerified,
      description: stores.description,
      logoKey: files.storageKey,
      ratingAvg: sellers.ratingAvg,
      ratingCount: sellers.ratingCount,
      productCount: sql<number>`(select count(*)::int from products p where p.seller_id = ${sellers.id} and p.status = 'LIVE')`,
    })
    .from(stores)
    .innerJoin(sellers, eq(sellers.id, stores.sellerId))
    .leftJoin(files, eq(files.id, stores.logoFileId))
    .where(where)
    .limit(8);
  if (!rows.length) return null;
  return (
    <section key={b.id} aria-labelledby={`stores-${b.id}`} className="space-y-4">
      <SectionHeading id={`stores-${b.id}`} eyebrow="بائعون تمت مراجعة هويتهم ومستنداتهم" title={b.title ?? 'متاجر موثّقة'} href="/stores" hrefLabel="كل المتاجر" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((s) => (
          <SellerCard key={s.slug} s={s} />
        ))}
      </div>
    </section>
  );
}

function banner(b: Block) {
  const d = b.data as { heading: string; body?: string; href?: string; tone?: string; imageKey?: string };
  const tone = d.tone === 'accent' ? 'bg-accent-600' : d.tone === 'dark' ? 'bg-brand-950' : 'bg-brand-600';
  const inner = (
    <div className={`relative overflow-hidden rounded-3xl ${tone} p-6 text-white sm:p-8`}>
      {d.imageKey && <img src={mediaUrl(d.imageKey)!} alt="" className="absolute inset-0 size-full object-cover opacity-25" />}
      <p className="relative text-lg font-bold">{d.heading}</p>
      {d.body && <p className="relative mt-1 text-sm text-white/85">{d.body}</p>}
    </div>
  );
  return d.href ? <Link key={b.id} href={d.href}>{inner}</Link> : <div key={b.id}>{inner}</div>;
}

function trust(b: Block) {
  const d = b.data as { items: { title: string; body: string }[] };
  return (
    <section key={b.id} aria-labelledby={`trust-${b.id}`} className="space-y-4">
      <SectionHeading id={`trust-${b.id}`} title={b.title ?? 'ليه تشتري من اضمن؟'} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {d.items.map((it, i) => {
          const I = TRUST_ICONS[i % TRUST_ICONS.length];
          return (
            <li key={i} className="flex gap-3 rounded-2xl bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-line">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <I className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-bold leading-7">{it.title}</span>
                <span className="mt-0.5 block text-sm leading-6 text-muted">{it.body}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Top-level categories for the hero quick links (real catalog data, catalog order). */
async function quickCategories() {
  return db
    .select({ slug: categories.slug, name: categories.nameAr })
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.isActive, true)))
    .orderBy(asc(categories.sortOrder))
    .limit(5);
}

export default async function HomePage() {
  const s = await getAllSettings();
  const blocks = await activeBlocks('HOME');
  const seen = new Set<string>();
  const heroBlock = blocks.find((b) => b.type === 'HERO');
  const heroSupport = (heroBlock?.data as { subheading?: string } | undefined)?.subheading;
  const rendered: React.ReactNode[] = [];
  let escrowPlaced = false;
  const placeEscrow = () => {
    if (escrowPlaced) return;
    escrowPlaced = true;
    rendered.push(<EscrowHowItWorks key="escrow" />);
  };
  // Sequential so product rails de-duplicate in page order. The hero is rendered once above (CMS supplies its
  // supporting line); the protected-deal explainer replaces the old DEAL_CTA block and always appears — right
  // after the first product rail, or before the trust blocks when there are no rails.
  for (const b of blocks) {
    if (b.type === 'HERO' || b.type === 'DEAL_CTA') continue;
    if (b.type === 'TRUST') placeEscrow();
    if (b.type === 'BANNER') rendered.push(banner(b));
    else if (b.type === 'FEATURED_CATEGORIES') rendered.push(await featuredCategories(b));
    else if (b.type === 'PRODUCT_RAIL') {
      const r = await rail(b, seen);
      rendered.push(r);
      if (r) placeEscrow();
    } else if (b.type === 'FEATURED_SELLERS') {
      rendered.push(await featuredSellers(b));
      rendered.push(<SellOnEdmn key="sell" />);
    } else if (b.type === 'TRUST') rendered.push(trust(b));
  }
  placeEscrow();
  return (
    <div className="container-page space-y-10 py-4 sm:space-y-14 sm:py-6">
      <JsonLd data={siteJsonLd({ legalName: s['company.legalName'] || undefined, email: s['marketplace.supportEmail'] || undefined, phone: s['marketplace.supportPhone'] || undefined, sameAs: s['company.socialLinks'].map((l) => l.href) })} />
      <div className="space-y-4 sm:space-y-5">
        <HomeHero support={heroSupport} quickCategories={await quickCategories()} />
        <TrustStrip />
      </div>
      {rendered}
      <RecentlyViewed />
    </div>
  );
}
