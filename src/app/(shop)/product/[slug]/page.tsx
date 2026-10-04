import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { BadgeCheck, CircleAlert, PackageCheck, RotateCcw, ShieldCheck, Store, Truck } from 'lucide-react';
import { db } from '@/server/db/client';
import { sellerShippingRates } from '@/server/db/schema';
import { productDetailBySlug, relatedProducts } from '@/server/modules/catalog/search';
import { productReviewsPublic, ratingHistogram, reviewerDisplayName, sellerReviewsPublic } from '@/server/modules/reviews/service';
import { getSetting } from '@/server/modules/settings';
import { deliveryGovernorate } from '@/server/web/context';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { Gallery, RecordRecentlyViewed } from '@/ui/client';
import { DeliveryLine, Price, ProductCard, ProductRail, RailItem, Stars, mediaUrl } from '@/ui/commerce';
import { Breadcrumbs } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { AddToCartForm } from '@/app/_components/add-to-cart';
import { WishlistButton, wishlistSet } from '@/app/_components/product-bits';
import { JsonLd, absoluteUrl, breadcrumbJsonLd } from '@/app/_components/seo';

export async function generateMetadata(props: PageProps<'/product/[slug]'>): Promise<Metadata> {
  const d = await productDetailBySlug(decodeURIComponent((await props.params).slug));
  if (!d || !d.visible) return { title: d?.product.publishedAt ? 'منتج غير متاح' : 'غير موجود', robots: { index: false } };
  const img = d.images[0] ? mediaUrl(d.images[0].key, 'md') : undefined;
  return {
    title: d.product.seoTitle || d.product.titleAr,
    description: d.product.seoDescription || (d.product.description ?? '').slice(0, 155),
    alternates: { canonical: `/product/${d.product.slug}` },
    openGraph: { title: d.product.titleAr, images: img ? [img] : undefined, type: 'website' },
  };
}

export default async function ProductPage(props: PageProps<'/product/[slug]'>) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const d = await productDetailBySlug(decodeURIComponent(slug));
  // Listings that were never approved/published are not public, even by direct URL. Previously published
  // listings (later archived/suspended) keep an "unavailable" page so past buyers' links still resolve.
  if (!d || (!d.visible && !d.product.publishedAt)) notFound();
  const p = d.product;
  const variantId = typeof sp.v === 'string' ? sp.v : undefined;
  const v = d.variants.find((x) => x.id === variantId) ?? d.variants.find((x) => x.stockOnHand - x.reserved > 0) ?? d.variants[0];
  const available = v ? v.stockOnHand - v.reserved : 0;
  const gov = await deliveryGovernorate();
  const [rate] = gov ? await db.select().from(sellerShippingRates).where(and(eq(sellerShippingRates.sellerId, p.sellerId), eq(sellerShippingRates.governorateId, gov.id))) : [];
  const shipFee = rate?.enabled ? (d.store.freeShippingThreshold !== null && v && v.price >= d.store.freeShippingThreshold ? 0 : rate.fee) : null;
  const [reviews, hist, sellerReviews, related, statutoryDays, wished] = await Promise.all([
    productReviewsPublic(p.id, 10),
    ratingHistogram(p.id),
    sellerReviewsPublic(p.sellerId, 3),
    relatedProducts(p.id, p.categoryId),
    getSetting('returns.statutoryWindowDays'),
    wishlistSet([p.id]),
  ]);
  const accepts = p.returnPolicyOverride ? p.acceptsVoluntaryReturns : d.store.acceptsVoluntaryReturns;
  const days = p.returnPolicyOverride ? p.voluntaryReturnDays : d.store.voluntaryReturnDays;
  const crumbs = [{ label: 'الرئيسية', href: '/' }, ...d.breadcrumbs.map((c) => ({ label: c.nameAr, href: `/category/${c.slug}` })), { label: p.titleAr }];
  const positive = d.seller.ratingCount ? Math.round((d.seller.positiveCount / d.seller.ratingCount) * 100) : null;
  const optionKeys = [...new Set(d.variants.flatMap((x) => Object.keys(x.options ?? {})))];

  const productLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.titleAr,
    description: p.description,
    sku: v?.sku,
    image: d.images.slice(0, 5).map((i) => absoluteUrl(mediaUrl(i.key)!)),
    itemCondition: p.condition === 'USED' ? 'https://schema.org/UsedCondition' : 'https://schema.org/NewCondition',
    ...(d.brand ? { brand: { '@type': 'Brand', name: d.brand.name } } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EGP',
      price: v ? (v.price / 100).toFixed(2) : undefined,
      availability: d.visible && available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: absoluteUrl(`/product/${p.slug}`),
      seller: { '@type': 'Organization', name: d.store.name },
    },
    ...(p.ratingCount > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(p.ratingAvg), reviewCount: p.ratingCount } } : {}),
  };

  return (
    <div className="container-page space-y-8 py-6">
      <RecordRecentlyViewed id={p.id} />
      <JsonLd data={productLd} />
      <JsonLd data={breadcrumbJsonLd(crumbs.map((c) => ({ name: c.label, url: c.href ?? `/product/${p.slug}` })))} />
      <Breadcrumbs items={crumbs} />

      {!d.visible && (
        <Alert tone="warning" title="هذا المنتج غير متاح حالياً">
          قد يكون البائع أوقفه مؤقتاً أو أنه قيد المراجعة. <Link href="/search" className="underline">تصفح منتجات مشابهة</Link>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_320px]">
        <div className="relative">
          <Gallery alt={p.titleAr} images={d.images.map((i) => ({ src: mediaUrl(i.key, 'md')!, full: mediaUrl(i.key)!, actual: i.isActualItem }))} />
          <div className="absolute top-3 end-3">
            <WishlistButton productId={p.id} active={wished.has(p.id)} back={`/product/${p.slug}`} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {d.brand && (
              <Link href={`/brand/${d.brand.slug}`} className="text-sm font-semibold text-brand-700 hover:underline">
                {d.brand.nameAr || d.brand.name}
              </Link>
            )}
            <Badge tone={p.condition === 'USED' ? 'warning' : 'brand'}>
              {label('condition', p.condition)}
              {p.usedGrade ? ` · ${label('usedGrade', p.usedGrade)}` : ''}
            </Badge>
          </div>
          <h1 className="text-xl font-bold leading-snug sm:text-2xl">{p.titleAr}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {p.ratingCount > 0 ? (
              <a href="#reviews" className="hover:underline">
                <Stars value={p.ratingAvg} count={p.ratingCount} size="md" />
              </a>
            ) : (
              <span className="text-muted">لا توجد تقييمات بعد</span>
            )}
            {v && <span className="text-xs text-muted ltr">SKU: {v.sku}</span>}
          </div>
          <div className="border-y border-line py-4">
            <Price value={v?.price ?? p.minPrice} compareAt={v?.compareAtPrice} size="lg" />
            <p className="mt-1 text-xs text-muted">السعر شامل ضريبة القيمة المضافة إن وجدت. مصاريف الشحن تُحسب عند الدفع.</p>
          </div>

          {optionKeys.length > 0 && d.variants.length > 1 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">اختر النوع:</p>
              <div className="flex flex-wrap gap-2">
                {d.variants.map((x) => {
                  const out = x.stockOnHand - x.reserved <= 0;
                  return (
                    <Link
                      key={x.id}
                      href={`/product/${p.slug}?v=${x.id}`}
                      scroll={false}
                      aria-current={x.id === v?.id}
                      className={`rounded-lg border px-3 py-2 text-sm ${x.id === v?.id ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-line bg-white hover:border-brand-400'} ${out ? 'opacity-50 line-through' : ''}`}
                    >
                      {x.label || x.sku} · {formatEGP(x.price)}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {p.keyFeatures.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm marker:text-brand-600">
              {p.keyFeatures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}

          {p.condition === 'USED' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="mb-2 flex items-center gap-2 font-bold text-amber-900">
                <CircleAlert className="size-4" /> إفصاح حالة المنتج المستعمل
              </p>
              <dl className="space-y-1.5 text-amber-950">
                <div><dt className="inline font-semibold">الحالة: </dt><dd className="inline">{label('usedGrade', p.usedGrade)} — {p.conditionNotes}</dd></div>
                <div><dt className="inline font-semibold">العيوب المعلنة: </dt><dd className="inline">{p.defects || 'لا يوجد'}</dd></div>
                {p.includedAccessories && <div><dt className="inline font-semibold">المرفقات: </dt><dd className="inline">{p.includedAccessories}</dd></div>}
                {p.usageInfo && <div><dt className="inline font-semibold">مدة الاستخدام: </dt><dd className="inline">{p.usageInfo}</dd></div>}
              </dl>
              <p className="mt-2 text-xs text-amber-800">الصور المميزة بعلامة «صورة حقيقية» هي صور للقطعة نفسها المعروضة للبيع.</p>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="card space-y-4 p-4">
            <Price value={v?.price ?? p.minPrice} compareAt={v?.compareAtPrice} />
            <DeliveryLine fee={shipFee} min={rate?.enabled ? rate.etaMinDays + (p.processingDays ?? d.store.defaultProcessingDays) : null} max={rate?.enabled ? rate.etaMaxDays + (p.processingDays ?? d.store.defaultProcessingDays) : null} />
            <p className="text-xs text-muted">التوصيل إلى: <span className="font-semibold text-ink">{gov?.nameAr}</span> (يمكنك تغييرها من أعلى الصفحة)</p>
            <p className={`text-sm font-semibold ${available > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {available > 5 ? 'متوفر' : available > 0 ? `متبقي ${available} فقط` : 'نفدت الكمية'}
            </p>
            {d.visible && v && available > 0 && shipFee !== null ? (
              <AddToCartForm variantId={v.id} max={available} />
            ) : d.visible && shipFee === null ? (
              <Alert tone="warning">البائع لا يشحن إلى محافظتك حالياً.</Alert>
            ) : null}
            <div className="space-y-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
              <p className="flex items-center gap-1.5 font-bold"><ShieldCheck className="size-4" /> شراء محمي من اضمن</p>
              <p>تدفع لاضمن، ولا يحصل البائع على أرباحه إلا بعد تأكيدك استلام الطلب. لو حصلت مشكلة يتدخل فريق اضمن.</p>
            </div>
          </div>
          <div className="card space-y-3 p-4 text-sm">
            <p className="text-xs text-muted">يُباع ويُشحن بواسطة</p>
            <Link href={`/store/${d.store.slug}`} className="flex items-center gap-2 font-bold hover:text-brand-700">
              <Store className="size-4" /> {d.store.name} {d.store.isVerified && <BadgeCheck className="size-4 text-brand-600" aria-label="متجر موثّق" />}
            </Link>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {d.seller.ratingCount > 0 ? <Stars value={d.seller.ratingAvg} count={d.seller.ratingCount} /> : <span>متجر جديد</span>}
              {positive !== null && <span>{positive}% تقييمات إيجابية</span>}
              {d.seller.approvedAt && <span>على اضمن منذ {formatDate(d.seller.approvedAt)}</span>}
            </div>
            <p className="flex items-start gap-2 text-xs">
              <RotateCcw className="mt-0.5 size-4 shrink-0 text-brand-600" />
              <span>
                {accepts ? `يقبل البائع الإرجاع الاختياري خلال ${days} يوم من الاستلام.` : 'البائع لا يقدم إرجاعاً اختيارياً، دون الإخلال بحقوق المستهلك المقررة قانوناً.'}{' '}
                <Link href="/legal/returns" className="text-brand-700 underline">سياسة الإرجاع</Link>
              </span>
            </p>
            <p className="flex items-start gap-2 text-xs">
              <PackageCheck className="mt-0.5 size-4 shrink-0 text-brand-600" /> يجهّز البائع الطلب خلال {p.processingDays ?? d.store.defaultProcessingDays} يوم عمل.
            </p>
          </div>
        </aside>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-bold">الوصف</h2>
          <div className="prose-ar whitespace-pre-line text-sm leading-7">{p.description}</div>
          {d.specs.length > 0 && (
            <>
              <h3 className="pt-2 font-bold">المواصفات</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {d.specs.map((s) => (
                    <tr key={s.code}>
                      <th scope="row" className="w-40 py-2 text-start font-medium text-muted">{s.name}</th>
                      <td className="py-2">{s.value}</td>
                    </tr>
                  ))}
                  {p.warrantyInfo && (
                    <tr><th scope="row" className="py-2 text-start font-medium text-muted">الضمان</th><td className="py-2">{p.warrantyInfo}</td></tr>
                  )}
                  {p.weightGrams ? (
                    <tr><th scope="row" className="py-2 text-start font-medium text-muted">الوزن</th><td className="py-2">{(p.weightGrams / 1000).toLocaleString('ar-EG-u-nu-latn')} كجم</td></tr>
                  ) : null}
                </tbody>
              </table>
            </>
          )}
        </section>
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Truck className="size-5 text-brand-600" /> الشحن والإرجاع</h2>
          <p>الشحن يتم بواسطة البائع مباشرة، ويمكنك متابعة رقم التتبع من صفحة الطلب.</p>
          <p>حق الإرجاع القانوني: يمكن تقديم طلب إرجاع خلال {statutoryDays} يوم من الاستلام وفقاً للسياسة المعتمدة (النص النهائي يخضع للمراجعة القانونية).</p>
          {d.store.shippingPolicy && <p className="text-muted">{d.store.shippingPolicy}</p>}
          {d.store.returnConditions && <p className="text-muted">شروط البائع: {d.store.returnConditions}</p>}
        </section>
      </div>

      <section id="reviews" className="card grid gap-6 p-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          <h2 className="text-lg font-bold">تقييمات المنتج</h2>
          <div className="flex items-center gap-2">
            <span className="text-4xl font-bold">{Number(p.ratingAvg).toFixed(1)}</span>
            <Stars value={p.ratingAvg} count={p.ratingCount} size="md" showValue={false} />
          </div>
          <ul className="space-y-1">
            {hist.map((h) => (
              <li key={h.rating} className="flex items-center gap-2 text-xs">
                <span className="w-10">{h.rating} نجوم</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-page">
                  <span className="block h-full bg-amber-400" style={{ width: `${p.ratingCount ? (h.count / p.ratingCount) * 100 : 0}%` }} />
                </span>
                <span className="w-6 text-muted">{h.count}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">التقييمات من مشترين مؤكدين فقط. تقييم المنتج منفصل عن تقييم البائع.</p>
        </div>
        <div className="space-y-4">
          {reviews.length === 0 && <p className="text-sm text-muted">لا توجد تقييمات بعد. التقييم متاح للمشترين بعد استلام الطلب.</p>}
          {reviews.map(({ r, author }) => (
            <article key={r.id} className="border-b border-line pb-4 last:border-0">
              <div className="flex items-center gap-2">
                <Stars value={r.rating} showValue={false} />
                {r.title && <span className="font-semibold">{r.title}</span>}
              </div>
              <p className="mt-1 text-xs text-muted">{reviewerDisplayName(author)} · {formatDate(r.createdAt)} · <Badge tone="success">شراء مؤكد</Badge></p>
              {r.body && <p className="mt-2 text-sm">{r.body}</p>}
              {r.sellerResponse && <p className="mt-2 rounded-lg bg-page p-3 text-xs"><span className="font-semibold">رد البائع: </span>{r.sellerResponse}</p>}
            </article>
          ))}
          {sellerReviews.length > 0 && (
            <div className="rounded-xl bg-page p-4">
              <p className="mb-2 text-sm font-bold">آراء العملاء في البائع</p>
              {sellerReviews.map(({ r, author }) => (
                <p key={r.id} className="text-xs">
                  <Stars value={r.rating} showValue={false} /> {r.body} — <span className="text-muted">{reviewerDisplayName(author)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      {related.length > 0 && (
        <ProductRail title="منتجات مشابهة">
          {related.map((r) => (
            <RailItem key={r.id}>
              <ProductCard p={r} />
            </RailItem>
          ))}
        </ProductRail>
      )}
    </div>
  );
}
