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
import { Badge, EmptyState } from '@/ui/feedback';

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
      <section className="card overflow-hidden">
        <div className="h-28 bg-gradient-to-l from-brand-600 to-brand-900 sm:h-40">
          {banner && <img src={mediaUrl(banner.key)!} alt="" className="size-full object-cover" />}
        </div>
        <div className="flex flex-wrap items-end gap-4 p-5">
          <span className="-mt-14 grid size-24 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-brand-50 text-3xl font-bold text-brand-700 shadow">
            {logo ? <img src={mediaUrl(logo.key, 'thumb')!} alt={store.name} className="size-full object-cover" /> : store.name.charAt(0)}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              {store.name} {store.isVerified && <BadgeCheck className="size-5 text-brand-600" aria-label="متجر موثّق" />}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {seller.ratingCount ? <Stars value={seller.ratingAvg} count={seller.ratingCount} /> : <span>متجر جديد</span>}
              {positive !== null && <span>{positive}% تقييمات إيجابية</span>}
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" /> على اضمن من {formatDate(seller.approvedAt)}</span>
              <span>{count} منتج</span>
              {store.isVerified && <Badge tone="brand">بائع موثّق الهوية</Badge>}
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
            <h2 className="font-bold">عن المتجر</h2>
            <p className="whitespace-pre-line text-muted">{store.description || '—'}</p>
            <h3 className="pt-2 font-bold">التصنيفات</h3>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <a key={c.slug} href={`/category/${c.slug}`} className="rounded-full bg-page px-3 py-1 hover:text-brand-700">{c.nameAr}</a>
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
