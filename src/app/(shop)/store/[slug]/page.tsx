import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { BadgeCheck, CalendarDays, RotateCcw, Star, Truck } from 'lucide-react';
import { db } from '@/server/db/client';
import { categories, files, products, sellers, stores } from '@/server/db/schema';
import { sellerReviewsPublic, reviewerDisplayName } from '@/server/modules/reviews/service';
import { formatDate } from '@/lib/format';
import { Listing, type SP } from '@/app/_components/listing';
import { Stars, mediaUrl } from '@/ui/commerce';
import { Breadcrumbs, Tabs } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

async function load(slug: string) {
  const [row] = await db
    .select({ store: stores, seller: sellers })
    .from(stores)
    .innerJoin(sellers, eq(sellers.id, stores.sellerId))
    .where(eq(stores.slug, decodeURIComponent(slug)));
  if (!row || !['APPROVED', 'RESTRICTED'].includes(row.seller.status)) return null;
  return row;
}

export async function generateMetadata(props: PageProps<'/store/[slug]'>): Promise<Metadata> {
  const r = await load((await props.params).slug);
  if (!r) return {};
  return { title: `متجر ${r.store.name}`, description: r.store.description ?? `تسوّق من متجر ${r.store.name} على اضمن`, alternates: { canonical: `/store/${r.store.slug}` } };
}

export default async function StorePage(props: PageProps<'/store/[slug]'>) {
  const r = await load((await props.params).slug);
  if (!r) notFound();
  const sp = (await props.searchParams) as SP;
  const tab = typeof sp.tab === 'string' ? sp.tab : 'products';
  const { store, seller } = r;
  const [logo] = store.logoFileId ? await db.select({ key: files.storageKey }).from(files).where(eq(files.id, store.logoFileId)) : [];
  const [banner] = store.bannerFileId ? await db.select({ key: files.storageKey }).from(files).where(eq(files.id, store.bannerFileId)) : [];
  const cats = await db
    .selectDistinct({ nameAr: categories.nameAr, slug: categories.slug })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.sellerId, seller.id), eq(products.status, 'LIVE')));
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(products).where(and(eq(products.sellerId, seller.id), inArray(products.status, ['LIVE'])));
  const positive = seller.ratingCount ? Math.round((seller.positiveCount / seller.ratingCount) * 100) : null;
  const base = `/store/${store.slug}`;
  return (
    <div className="container-page space-y-5 py-6">
      <Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'المتاجر', href: '/stores' }, { label: store.name }]} />
      <section className="relative isolate overflow-hidden rounded-3xl bg-brand-950 text-white shadow-[var(--shadow-pop)]">
        {banner ? (
          <>
            <img src={mediaUrl(banner.key)!} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
            <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-l from-brand-950/95 via-brand-950/80 to-brand-950/40" />
          </>
        ) : (
          <>
            <div aria-hidden className="edmn-hero-bg absolute inset-0 -z-20" />
            <div aria-hidden className="edmn-hero-grid absolute inset-0 -z-10" />
          </>
        )}
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-3xl font-bold text-brand-700 shadow-[0_10px_30px_-10px_rgb(59_130_246/0.7)] ring-4 ring-white/10 sm:size-24">
            {logo ? <img src={mediaUrl(logo.key, 'thumb')!} alt={store.name} className="size-full object-cover" /> : store.name.charAt(0)}
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold sm:text-3xl">
              {store.name} {store.isVerified && <BadgeCheck className="size-6 text-sky-300" aria-label="متجر موثّق" />}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {store.isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-3 py-1 font-semibold text-emerald-200 ring-1 ring-emerald-300/30">
                  <BadgeCheck className="size-4" aria-hidden /> بائع موثّق الهوية
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                {seller.ratingCount ? (
                  <span aria-label={`التقييم ${Number(seller.ratingAvg).toFixed(1)} من 5 من ${seller.ratingCount} تقييم`} className="inline-flex items-center gap-1">
                    <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden /> {Number(seller.ratingAvg).toFixed(1)} <span className="text-white/70">({seller.ratingCount})</span>
                  </span>
                ) : 'متجر جديد'}
              </span>
              {positive !== null && <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">{positive}% تقييمات إيجابية</span>}
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15"><CalendarDays className="size-4" aria-hidden /> على اضمن من {formatDate(seller.approvedAt)}</span>
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">{count} منتج</span>
            </div>
          </div>
        </div>
      </section>
      <Tabs
        active={tab}
        tabs={[
          { key: 'products', label: 'المنتجات', href: base },
          { key: 'deals', label: 'العروض', href: `${base}?tab=deals` },
          { key: 'reviews', label: 'التقييمات', href: `${base}?tab=reviews`, count: seller.ratingCount },
          { key: 'info', label: 'معلومات المتجر', href: `${base}?tab=info` },
        ]}
      />
      {tab === 'reviews' ? (
        <StoreReviews sellerId={seller.id} />
      ) : tab === 'info' ? (
        <section className="card grid gap-5 p-5 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <h2 className="font-bold text-brand-950">عن المتجر</h2>
            <p className="whitespace-pre-line text-muted">{store.description || '—'}</p>
            <h3 className="pt-2 font-bold">التصنيفات</h3>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <a key={c.slug} href={`/category/${c.slug}`} className="inline-flex min-h-10 items-center rounded-full bg-page px-3.5 hover:bg-brand-50 hover:text-brand-700">{c.nameAr}</a>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <p className="flex items-start gap-2"><Truck className="mt-0.5 size-4 text-brand-600" /> {store.shippingPolicy || `بيجهّز الطلبات خلال ${store.defaultProcessingDays} يوم عمل، وبيشحن للمحافظات اللي مفعّلها.`}</p>
            <p className="flex items-start gap-2">
              <RotateCcw className="mt-0.5 size-4 text-brand-600" />
              {store.acceptsVoluntaryReturns ? `بيقبل الإرجاع الاختياري خلال ${store.voluntaryReturnDays} يوم. ${store.returnConditions ?? ''}` : 'ما بيقدّمش إرجاع اختياري، مع الاحتفاظ بحقوق المستهلك المقررة قانونًا.'}
            </p>
            <p className="flex items-start gap-2"><Star className="mt-0.5 size-4 text-brand-600" /> كل البائعين على اضمن مرّوا بمراجعة هوية قبل البيع.</p>
          </div>
        </section>
      ) : (
        <Listing path={base} sp={{ ...sp, tab: undefined }} base={{ sellerId: seller.id, dealsOnly: tab === 'deals' }} />
      )}
    </div>
  );
}

async function StoreReviews({ sellerId }: { sellerId: string }) {
  const reviews = await sellerReviewsPublic(sellerId, 50);
  if (!reviews.length) return <EmptyState icon={Star} title="مفيش تقييمات لسه" description="تقييمات العملاء بتظهر بعد ما يستلموا طلباتهم." />;
  return (
    <div className="card divide-y divide-line">
      {reviews.map(({ r, author }) => (
        <article key={r.id} className="space-y-1 p-4 text-sm">
          <div className="flex items-center gap-2"><Stars value={r.rating} showValue={false} /> <span className="text-xs text-muted">{reviewerDisplayName(author)} · {formatDate(r.createdAt)}</span></div>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {r.deliveryRating && <span>التوصيل {r.deliveryRating}/5</span>}
            {r.packagingRating && <span>التغليف {r.packagingRating}/5</span>}
            {r.accuracyRating && <span>مطابقة الوصف {r.accuracyRating}/5</span>}
          </div>
          {r.body && <p>{r.body}</p>}
          {r.sellerResponse && <p className="rounded-lg bg-page p-2 text-xs"><b>رد البائع:</b> {r.sellerResponse}</p>}
        </article>
      ))}
    </div>
  );
}
