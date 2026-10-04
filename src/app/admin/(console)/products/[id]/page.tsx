import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq } from 'drizzle-orm';
import { moderateProductAction, moderateRevisionAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { brands, categories, files, productImages, productModerationEvents, productRevisions, productVariants, products, sellerShippingRates, sellers, stores, users } from '@/server/db/schema';
import { attributeMap } from '@/server/modules/catalog/products';
import { evaluateListingPolicy } from '@/server/modules/catalog/taxonomy';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { mediaUrl, Stars } from '@/ui/commerce';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Field, Select, Textarea } from '@/ui/form';

export default async function AdminProductReview(props: PageProps<'/admin/products/[id]'>) {
  const { actor, allowed } = await adminWith('products.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [row] = await db.select({ p: products, store: stores, seller: sellers }).from(products).innerJoin(stores, eq(stores.sellerId, products.sellerId)).innerJoin(sellers, eq(sellers.id, products.sellerId)).where(eq(products.id, id));
  if (!row) notFound();
  const p = row.p;
  const [imgs, variants, attrs, cat, brand, events, rev, rates] = await Promise.all([
    db.select({ i: productImages, key: files.storageKey }).from(productImages).innerJoin(files, eq(files.id, productImages.fileId)).where(eq(productImages.productId, id)).orderBy(asc(productImages.sortOrder)),
    db.select().from(productVariants).where(eq(productVariants.productId, id)),
    attributeMap(db, id),
    p.categoryId ? db.select().from(categories).where(eq(categories.id, p.categoryId)).then((r) => r[0]) : null,
    p.brandId ? db.select().from(brands).where(eq(brands.id, p.brandId)).then((r) => r[0]) : null,
    db.select({ e: productModerationEvents, actor: users.fullName }).from(productModerationEvents).leftJoin(users, eq(users.id, productModerationEvents.actorUserId)).where(eq(productModerationEvents.productId, id)).orderBy(desc(productModerationEvents.createdAt)),
    db.select().from(productRevisions).where(and(eq(productRevisions.productId, id), eq(productRevisions.status, 'SUBMITTED'))).then((r) => r[0]),
    db.select().from(sellerShippingRates).where(and(eq(sellerShippingRates.sellerId, p.sellerId), eq(sellerShippingRates.enabled, true))),
  ]);
  const verdict = await evaluateListingPolicy(db, `${p.titleAr} ${p.description ?? ''}`, p.categoryId);
  const can = hasPermission(actor, 'products.moderate');
  const decisions: [string, string][] =
    p.status === 'SUBMITTED' ? [['START_REVIEW', 'بدء المراجعة'], ['APPROVE', 'موافقة ونشر'], ['REQUEST_CHANGES', 'طلب تعديلات'], ['REJECT', 'رفض']] :
    p.status === 'UNDER_REVIEW' ? [['APPROVE', 'موافقة ونشر'], ['REQUEST_CHANGES', 'طلب تعديلات'], ['REJECT', 'رفض']] :
    ['LIVE', 'APPROVED'].includes(p.status) ? [['SUSPEND', 'إيقاف']] : p.status === 'SUSPENDED' ? [['REINSTATE', 'إعادة تفعيل']] : [];
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'المنتجات', href: '/admin/products' }, { label: p.titleAr }]} />} title={p.titleAr} description={`${row.store.name} · أُرسل ${formatDate(p.submittedAt, true)}`} actions={<><StatusChip status={p.status} />{p.needsEnhancedReview && <Badge tone="danger">مراجعة معززة</Badge>}</>} />
      {(verdict.blocked.length > 0 || verdict.review.length > 0) && <Alert tone="warning" title="تنبيهات سياسة المنتجات">{[...verdict.blocked.map((v) => `محظور: ${v.reasonCode} (${v.pattern})`), ...verdict.review.map((v) => `مراجعة: ${v.reasonCode} (${v.pattern})`)].join(' · ')}</Alert>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="card p-4">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {imgs.map(({ i, key }) => (
                <a key={i.id} href={mediaUrl(key)!} target="_blank" className="relative overflow-hidden rounded-lg border border-line bg-white">
                  <img src={mediaUrl(key, 'thumb')!} alt="" className="aspect-square w-full object-contain" />
                  {i.isActualItem && <span className="absolute top-1 start-1 rounded bg-amber-500 px-1 text-[10px] font-bold text-white">حقيقية</span>}
                </a>
              ))}
            </div>
          </section>
          <section className="card p-4">
            <DefinitionList items={[
              { label: 'التصنيف', value: cat?.nameAr },
              { label: 'العلامة', value: brand?.name ?? '—' },
              { label: 'الحالة', value: `${label('condition', p.condition)} ${p.usedGrade ? `· ${label('usedGrade', p.usedGrade)}` : ''}` },
              { label: 'البائع', value: <Link href={`/admin/sellers/${p.sellerId}`} className="text-brand-700">{row.store.name}</Link> },
              { label: 'تقييم البائع', value: <Stars value={row.seller.ratingAvg} count={row.seller.ratingCount} /> },
              { label: 'الشحن', value: `${rates.length} محافظة مفعّلة · التجهيز ${p.processingDays ?? row.store.defaultProcessingDays} يوم` },
              { label: 'الإرجاع', value: p.returnPolicyOverride ? (p.acceptsVoluntaryReturns ? `${p.voluntaryReturnDays} يوم` : 'لا يقبل') : `سياسة المتجر (${row.store.acceptsVoluntaryReturns ? `${row.store.voluntaryReturnDays} يوم` : 'لا'})` },
              { label: 'الضمان', value: p.warrantyInfo ?? '—' },
            ]} />
            <h3 className="mt-4 font-bold">الوصف</h3>
            <p className="whitespace-pre-line text-sm">{p.description}</p>
            {p.keyFeatures.length > 0 && <ul className="mt-2 list-inside list-disc text-sm">{p.keyFeatures.map((f) => <li key={f}>{f}</li>)}</ul>}
            {p.condition === 'USED' && (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
                <p><b>وصف الحالة:</b> {p.conditionNotes}</p><p><b>العيوب:</b> {p.defects}</p><p><b>المرفقات:</b> {p.includedAccessories ?? '—'}</p><p><b>الاستخدام:</b> {p.usageInfo ?? '—'}</p>
              </div>
            )}
            <h3 className="mt-4 font-bold">المواصفات</h3>
            <p className="text-sm">{Object.entries(attrs).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') || '—'}</p>
            <h3 className="mt-4 font-bold">الخيارات والأسعار</h3>
            <ul className="text-sm">{variants.map((v) => <li key={v.id}>{v.label || v.sku} — {formatEGP(v.price)} {v.compareAtPrice && <s className="text-muted">{formatEGP(v.compareAtPrice)}</s>} · مخزون {v.stockOnHand} {!v.isActive && '(غير مفعّل)'}</li>)}</ul>
          </section>
          {rev && (
            <section className="card space-y-3 border-amber-300 p-4">
              <h2 className="font-bold">تعديل مقترح على إعلان معتمد</h2>
              <p className="text-sm">الحقول: {rev.changedFields.join('، ')}</p>
              <pre className="max-h-64 overflow-auto rounded bg-page p-2 text-xs ltr">{JSON.stringify(rev.data, null, 2)}</pre>
              {can && (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={moderateRevisionAction}><input type="hidden" name="revisionId" value={rev.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton variant="success" size="sm">اعتماد التعديل</SubmitButton></ActionForm>
                  <ActionForm action={moderateRevisionAction} className="flex gap-2"><input type="hidden" name="revisionId" value={rev.id} /><input type="hidden" name="decision" value="reject" /><input name="reason" placeholder="سبب الرفض" required className="h-8 rounded border border-line px-2 text-sm" aria-label="سبب الرفض" /><SubmitButton variant="danger" size="sm">رفض</SubmitButton></ActionForm>
                </div>
              )}
            </section>
          )}
        </div>
        <aside className="space-y-4">
          {can && decisions.length > 0 && (
            <ActionForm action={moderateProductAction} className="card space-y-3 p-4">
              <h2 className="font-bold">قرار المراجعة</h2>
              <input type="hidden" name="productId" value={p.id} />
              <Field label="الإجراء" htmlFor="decision"><Select id="decision" name="decision">{decisions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <Field label="كود السبب" htmlFor="reasonCode"><Select id="reasonCode" name="reasonCode" defaultValue=""><option value="">—</option>{['IMAGE_QUALITY', 'MISSING_INFO', 'WRONG_CATEGORY', 'PROHIBITED_ITEM', 'COUNTERFEIT_RISK', 'PRICE_ISSUE', 'USED_DISCLOSURE', 'OTHER'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="السبب (يظهر للبائع، إلزامي للرفض والتعديل والإيقاف)" htmlFor="reason"><Textarea id="reason" name="reason" rows={3} /></Field>
              <SubmitButton className="w-full">تسجيل القرار</SubmitButton>
            </ActionForm>
          )}
          <section className="card p-4 text-sm">
            <h2 className="mb-2 font-bold">سجل المراجعة</h2>
            <ul className="space-y-2">{events.map(({ e, actor: who }) => <li key={e.id}><Badge>{e.action}</Badge> {formatDate(e.createdAt, true)} <span className="text-muted">{who ?? ''}</span>{e.reason && <p className="text-xs">{e.reason}</p>}</li>)}</ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
