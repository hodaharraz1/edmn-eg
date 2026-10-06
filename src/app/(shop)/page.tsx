import { ArrowLeft, BadgeCheck, Camera, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';
import Link from 'next/link';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { categories, files, products, sellers, stores } from '@/server/db/schema';
import { searchProducts, productsByIds, type Sort } from '@/server/modules/catalog/search';
import { activeBlocks } from '@/server/modules/cms/service';
import { LinkButton } from '@/ui/button';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';
import { ProductCard, ProductRail, RailItem, SellerCard, mediaUrl } from '@/ui/commerce';
import { WishlistButton, wishlistSet } from '@/app/_components/product-bits';
import { RecentlyViewed } from './recently-viewed';

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
    <ProductRail key={b.id} title={b.title} href={href}>
      {items.map((p) => (
        <RailItem key={p.id}>
          <ProductCard p={p} wishlistSlot={<WishlistButton productId={p.id} active={wished.has(p.id)} back="/" />} />
        </RailItem>
      ))}
    </ProductRail>
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
    <section key={b.id} className="space-y-3">
      <h2 className="text-lg font-bold sm:text-xl">{b.title}</h2>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
        {ordered.map(({ c, key }) => {
          const Icon = ((c.icon && (Icons as unknown as Record<string, LucideIcon>)[c.icon]) || Icons.Tag) as LucideIcon;
          return (
            <Link key={c.id} href={`/category/${c.slug}`} className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center hover:bg-white">
              <span className="grid size-14 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-line transition-transform group-hover:-translate-y-0.5 sm:size-16">
                {key ? <img src={mediaUrl(key, 'thumb')!} alt="" className="size-full object-cover" /> : <Icon className="size-7 text-brand-600" aria-hidden />}
              </span>
              <span className="line-clamp-2 text-xs font-medium">{c.nameAr}</span>
            </Link>
          );
        })}
      </div>
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
    <section key={b.id} className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-lg font-bold sm:text-xl">{b.title}</h2>
        <Link href="/stores" className="text-sm font-semibold text-brand-700 hover:underline">
          كل المتاجر
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((s) => (
          <SellerCard key={s.slug} s={s} />
        ))}
      </div>
    </section>
  );
}

function hero(b: Block) {
  const d = b.data as { heading: string; subheading?: string; ctaLabel?: string; ctaHref?: string; imageKey?: string };
  return (
    <section key={b.id} className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-brand-700 via-brand-800 to-brand-950 text-white md:bg-gradient-to-l">
      {d.imageKey && <img src={mediaUrl(d.imageKey)!} alt="" className="absolute inset-0 size-full object-cover opacity-30" />}
      <div className="relative grid gap-6 p-6 sm:p-10 md:grid-cols-[1.4fr_1fr] md:items-center">
        <div className="space-y-4">
          <h1 className="text-2xl font-bold leading-tight sm:text-4xl">{d.heading}</h1>
          {d.subheading && <p className="max-w-xl text-sm text-white/85 sm:text-base">{d.subheading}</p>}
          <div className="flex flex-wrap gap-2">
            {d.ctaLabel && d.ctaHref && (
              <LinkButton href={d.ctaHref} size="lg" className="bg-amber-400 text-brand-950 hover:bg-amber-300">
                {d.ctaLabel}
              </LinkButton>
            )}
            <LinkButton href="/categories" size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">
              تصفح التصنيفات
            </LinkButton>
          </div>
        </div>
        {/* Brand visual: the official logo, unmodified, sitting directly on the hero background (decorative;
            the header logo is the accessible one). */}
        <div className="flex items-center justify-center pt-2 md:pt-0" aria-hidden>
          <img
            src={LOGO_SRC}
            width={LOGO_WIDTH}
            height={LOGO_HEIGHT}
            alt=""
            decoding="async"
            draggable={false}
            className="h-auto w-[clamp(120px,36vw,160px)] max-w-full select-none object-contain opacity-[0.92] md:w-[clamp(190px,21vw,300px)]"
          />
        </div>
      </div>
    </section>
  );
}

function banner(b: Block) {
  const d = b.data as { heading: string; body?: string; href?: string; tone?: string; imageKey?: string };
  const tone = d.tone === 'accent' ? 'bg-accent-600' : d.tone === 'dark' ? 'bg-brand-950' : 'bg-brand-600';
  const inner = (
    <div className={`relative overflow-hidden rounded-2xl ${tone} p-6 text-white`}>
      {d.imageKey && <img src={mediaUrl(d.imageKey)!} alt="" className="absolute inset-0 size-full object-cover opacity-25" />}
      <p className="relative text-lg font-bold">{d.heading}</p>
      {d.body && <p className="relative mt-1 text-sm text-white/85">{d.body}</p>}
    </div>
  );
  return d.href ? <Link key={b.id} href={d.href}>{inner}</Link> : <div key={b.id}>{inner}</div>;
}

function dealCta(b: Block) {
  const d = b.data as { heading: string; body?: string; ctaLabel?: string };
  return (
    <section key={b.id} className="overflow-hidden rounded-2xl border border-accent-100 bg-gradient-to-l from-accent-50 to-white">
      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-600 px-3 py-1 text-xs font-bold text-white">
            <ShieldCheck className="size-4" /> اضمن صفقة خارج السوق
          </span>
          <h2 className="text-xl font-bold sm:text-2xl">{d.heading}</h2>
          {d.body && <p className="max-w-2xl text-sm text-muted sm:text-base">{d.body}</p>}
          <ol className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs font-medium text-ink">
            <li>١. اكتب تفاصيل الصفقة</li>
            <li>٢. ابعت دعوة للبائع</li>
            <li>٣. ادفع لاضمن</li>
            <li>٤. استلم وأكّد</li>
          </ol>
        </div>
        <LinkButton href="/protected-deal" variant="accent" size="lg">
          {d.ctaLabel || 'ابدأ صفقة محمية'} <ArrowLeft className="size-4 ltr:rotate-180" />
        </LinkButton>
      </div>
    </section>
  );
}

function trust(b: Block) {
  const d = b.data as { items: { title: string; body: string }[] };
  return (
    <section key={b.id} className="space-y-3">
      <h2 className="text-lg font-bold sm:text-xl">{b.title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {d.items.map((it, i) => {
          const I = TRUST_ICONS[i % TRUST_ICONS.length];
          return (
            <div key={i} className="card flex gap-3 p-4">
              <I className="size-8 shrink-0 text-brand-600" aria-hidden />
              <div>
                <p className="font-semibold">{it.title}</p>
                <p className="mt-0.5 text-sm text-muted">{it.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default async function HomePage() {
  const blocks = await activeBlocks('HOME');
  const seen = new Set<string>();
  const rendered: React.ReactNode[] = [];
  // Sequential so product rails de-duplicate in page order.
  for (const b of blocks) {
    if (b.type === 'HERO') rendered.push(hero(b));
    else if (b.type === 'BANNER') rendered.push(banner(b));
    else if (b.type === 'FEATURED_CATEGORIES') rendered.push(await featuredCategories(b));
    else if (b.type === 'PRODUCT_RAIL') rendered.push(await rail(b, seen));
    else if (b.type === 'FEATURED_SELLERS') rendered.push(await featuredSellers(b));
    else if (b.type === 'DEAL_CTA') rendered.push(dealCta(b));
    else if (b.type === 'TRUST') rendered.push(trust(b));
  }
  return (
    <div className="container-page space-y-8 py-4 sm:py-6">
      {rendered}
      <RecentlyViewed />
    </div>
  );
}
