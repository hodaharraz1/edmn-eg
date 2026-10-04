import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { Trash2 } from 'lucide-react';
import { productControlAction, productDetailsAction, productImagesAction, productLogisticsAction, productVariantsAction, removeImageAction, submitProductAction } from '@/app/_actions/seller';
import { PRODUCT_STEPS, STEP_KEYS } from '@/app/_components/product-steps';
import { db } from '@/server/db/client';
import { brands, categories, stores } from '@/server/db/schema';
import { productForSellerEdit, submissionProblems } from '@/server/modules/catalog/products';
import { effectiveAttributes } from '@/server/modules/catalog/taxonomy';
import { isDomainError } from '@/server/core/errors';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Stepper, mediaUrl } from '@/ui/commerce';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Radio, Select, Textarea } from '@/ui/form';

export default async function ProductEditor(props: PageProps<'/seller/products/[id]'>) {
  const actor = await requireSellerActor('/seller/products');
  const { id } = await props.params;
  const sp = await props.searchParams;
  let g;
  try {
    g = await productForSellerEdit(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const p = g.product;
  const stepKey = (STEP_KEYS as readonly string[]).includes(String(sp.step)) ? String(sp.step) : 'details';
  const current = STEP_KEYS.indexOf(stepKey as (typeof STEP_KEYS)[number]) + 1;
  const editable = ['DRAFT', 'REJECTED'].includes(p.status);
  const approved = ['APPROVED', 'LIVE'].includes(p.status);
  const locked = ['SUBMITTED', 'UNDER_REVIEW', 'ARCHIVED', 'SUSPENDED'].includes(p.status);
  const [attrs, brandList, cats, [store]] = await Promise.all([
    p.categoryId ? effectiveAttributes(db, p.categoryId) : Promise.resolve([]),
    db.select().from(brands).where(eq(brands.isActive, true)).orderBy(asc(brands.name)),
    db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.depth), asc(categories.nameAr)),
    db.select().from(stores).where(eq(stores.sellerId, p.sellerId)),
  ]);
  const problems = await submissionProblems(db, p);
  const optionAttrs = attrs.filter((a) => a.ca.isVariantAxis && (a.attr.type === 'SELECT'));
  const rev = g.openRevision;
  const href = (k: string) => `/seller/products/${p.id}?step=${k}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'المنتجات', href: '/seller/products' }, { label: p.titleAr }]} />}
        title={p.titleAr}
        description={`${label('condition', p.condition)} · آخر تحديث ${formatDate(p.updatedAt, true)}`}
        actions={<><StatusChip status={p.status} />{p.status === 'LIVE' && <Link href={`/product/${p.slug}`} target="_blank" className="text-sm text-brand-700 hover:underline">عرض في السوق</Link>}</>}
      />
      {p.status === 'REJECTED' && <Alert tone="danger" title="المنتج يحتاج تعديلات قبل النشر">{p.statusReason}</Alert>}
      {p.status === 'SUSPENDED' && <Alert tone="danger" title="المنتج موقوف من الإدارة">{p.statusReason}</Alert>}
      {locked && p.status !== 'SUSPENDED' && p.status !== 'ARCHIVED' && (
        <Alert tone="info" title="المنتج قيد المراجعة" action={<form action={productControlAction}><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="op" value="withdraw" /><button className="text-xs underline">سحب للتعديل</button></form>}>لا يمكن تعديل المنتج أثناء المراجعة.</Alert>
      )}
      {approved && <Alert tone="info">المنتج معتمد. تعديل الأسعار والمخزون يُطبق فوراً، أما تعديل البيانات الأساسية أو الصور فيُرسل للمراجعة دون إيقاف الإعلان الحالي.</Alert>}
      {rev && <Alert tone="warning" title="يوجد تعديل قيد المراجعة">الحقول المعدلة: {rev.changedFields.join('، ')}</Alert>}

      <Stepper steps={PRODUCT_STEPS} current={current} hrefFor={(n) => (n === 1 ? null : href(STEP_KEYS[n - 1]))} />

      {stepKey === 'details' && (
        <ActionForm action={productDetailsAction} className="card space-y-4 p-5">
          <input type="hidden" name="productId" value={p.id} />
          <input type="hidden" name="next" value="images" />
          <fieldset disabled={locked} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="اسم المنتج (عربي)" htmlFor="titleAr" required><Input id="titleAr" name="titleAr" defaultValue={p.titleAr} required /></Field>
              <Field label="اسم المنتج (إنجليزي – اختياري)" htmlFor="titleEn"><Input id="titleEn" name="titleEn" defaultValue={p.titleEn ?? ''} dir="ltr" /></Field>
              <Field label="التصنيف" htmlFor="categoryId" required>
                <Select id="categoryId" name="categoryId" defaultValue={p.categoryId ?? ''} disabled={!editable}>
                  {cats.filter((c) => !c.isProhibited).map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.depth)}{c.nameAr}</option>)}
                </Select>
                {!editable && <input type="hidden" name="categoryId" value={p.categoryId ?? ''} />}
              </Field>
              <Field label="العلامة التجارية" htmlFor="brandId">
                <Select id="brandId" name="brandId" defaultValue={p.brandId ?? ''}><option value="">بدون علامة / أخرى</option>{brandList.map((b) => <option key={b.id} value={b.id}>{b.nameAr || b.name}</option>)}</Select>
              </Field>
            </div>
            <Field label="الحالة" htmlFor="condition"><Select id="condition" name="condition" defaultValue={p.condition}><option value="NEW">جديد</option><option value="USED">مستعمل</option></Select></Field>
            {p.condition === 'USED' && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">إفصاح المنتج المستعمل (إلزامي)</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="درجة الحالة" htmlFor="usedGrade" required>
                    <Select id="usedGrade" name="usedGrade" defaultValue={p.usedGrade ?? ''}><option value="">اختر</option>{['LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE'].map((g) => <option key={g} value={g}>{label('usedGrade', g)}</option>)}</Select>
                  </Field>
                  <Field label="مدة الاستخدام" htmlFor="usageInfo"><Input id="usageInfo" name="usageInfo" defaultValue={p.usageInfo ?? ''} /></Field>
                </div>
                <Field label="وصف الحالة" htmlFor="conditionNotes" required><Textarea id="conditionNotes" name="conditionNotes" defaultValue={p.conditionNotes ?? ''} rows={2} /></Field>
                <Field label="العيوب الموجودة (اكتب «لا يوجد» إن لم توجد)" htmlFor="defects" required><Textarea id="defects" name="defects" defaultValue={p.defects ?? ''} rows={2} /></Field>
                <Field label="المرفقات المضمنة" htmlFor="includedAccessories"><Input id="includedAccessories" name="includedAccessories" defaultValue={p.includedAccessories ?? ''} /></Field>
              </div>
            )}
            <Field label="الوصف" htmlFor="description" required hint="20 حرفاً على الأقل"><Textarea id="description" name="description" defaultValue={p.description ?? ''} rows={6} /></Field>
            <Field label="أهم المميزات (ميزة في كل سطر)" htmlFor="keyFeatures"><Textarea id="keyFeatures" name="keyFeatures" defaultValue={p.keyFeatures.join('\n')} rows={4} /></Field>
            <Field label="الضمان" htmlFor="warrantyInfo"><Input id="warrantyInfo" name="warrantyInfo" defaultValue={p.warrantyInfo ?? ''} /></Field>
            {attrs.filter((a) => !a.ca.isVariantAxis || a.attr.type !== 'SELECT').length > 0 && (
              <div className="space-y-3">
                <p className="font-semibold">المواصفات</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {attrs.filter((a) => !(a.ca.isVariantAxis && a.attr.type === 'SELECT')).map((a) => {
                    const v = g.attributes[a.attr.code] ?? [];
                    const name = `attr_${a.attr.code}`;
                    return (
                      <Field key={a.attr.id} label={`${a.attr.nameAr}${a.attr.unit ? ` (${a.attr.unit})` : ''}`} htmlFor={name} required={a.ca.isRequired}>
                        {a.attr.type === 'SELECT' ? (
                          <Select id={name} name={name} defaultValue={v[0] ?? ''}><option value="">—</option>{a.options.map((o) => <option key={o.value} value={o.value}>{o.labelAr}</option>)}</Select>
                        ) : a.attr.type === 'MULTI_SELECT' ? (
                          <div className="flex flex-wrap gap-2">{a.options.map((o) => <label key={o.value} className="flex items-center gap-1 text-sm"><input type="checkbox" name={name} value={o.value} defaultChecked={v.includes(o.value)} /> {o.labelAr}</label>)}</div>
                        ) : a.attr.type === 'BOOLEAN' ? (
                          <Select id={name} name={name} defaultValue={v[0] ?? ''}><option value="">—</option><option value="true">نعم</option><option value="false">لا</option></Select>
                        ) : (
                          <Input id={name} name={name} defaultValue={v[0] ?? ''} inputMode={a.attr.type === 'NUMBER' ? 'decimal' : undefined} />
                        )}
                      </Field>
                    );
                  })}
                </div>
              </div>
            )}
            {optionAttrs.map((a) => (
              <input key={a.attr.id} type="hidden" name={`attr_${a.attr.code}`} value={(g.attributes[a.attr.code] ?? [])[0] ?? (g.variants[0]?.options?.[a.attr.code] ?? '')} />
            ))}
            <SubmitButton>{approved ? 'إرسال التعديلات للمراجعة' : 'حفظ والتالي'}</SubmitButton>
          </fieldset>
        </ActionForm>
      )}

      {stepKey === 'images' && (
        <div className="card space-y-4 p-5">
          {p.condition === 'USED' && <Alert tone="warning">المنتجات المستعملة تتطلب صوراً حقيقية للقطعة نفسها (لا تُقبل صور الكتالوج وحدها). حدد خيار «صور حقيقية» عند الرفع.</Alert>}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {g.images.map(({ img, key }) => (
              <div key={img.id} className="relative overflow-hidden rounded-lg border border-line bg-white">
                <img src={mediaUrl(key, 'thumb')!} alt="" className="aspect-square w-full object-contain" />
                {img.isActualItem && <span className="absolute top-1 start-1 rounded bg-amber-500 px-1 text-[10px] font-bold text-white">حقيقية</span>}
                {!locked && (
                  <form action={removeImageAction} className="absolute bottom-1 end-1">
                    <input type="hidden" name="productId" value={p.id} />
                    <input type="hidden" name="fileId" value={img.fileId} />
                    <button className="grid size-7 place-items-center rounded-full bg-white shadow" aria-label="حذف الصورة"><Trash2 className="size-3.5 text-red-600" /></button>
                  </form>
                )}
              </div>
            ))}
          </div>
          {!locked && (
            <ActionForm action={productImagesAction} className="space-y-3" encType="multipart/form-data" resetOnSuccess>
              <input type="hidden" name="productId" value={p.id} />
              <FileInput name="images" multiple label="اختر صور المنتج" hint="JPG / PNG / WEBP — حتى 8 ميجابايت للصورة، بحد أدنى 50×50 بكسل" />
              <Checkbox name="isActualItem" defaultChecked={p.condition === 'USED'} label="هذه صور حقيقية للقطعة المعروضة للبيع" />
              <SubmitButton>رفع الصور</SubmitButton>
            </ActionForm>
          )}
          <Link href={href('variants')} className="inline-block text-sm font-semibold text-brand-700">التالي: السعر والمخزون ←</Link>
        </div>
      )}

      {stepKey === 'variants' && (
        <ActionForm action={productVariantsAction} className="card space-y-4 p-5">
          <input type="hidden" name="productId" value={p.id} />
          <input type="hidden" name="next" value="logistics" />
          <p className="text-sm text-muted">لكل خيار (لون / مقاس / سعة) سعر ومخزون مستقل. {approved && 'لا يمكن تغيير خيارات منتج معتمد، فقط السعر والكمية والتفعيل.'}</p>
          <div className="space-y-3">
            {[...g.variants.map((v) => ({ key: v.id, v })), ...(editable ? [{ key: 'new1', v: null }, ...(g.variants.length === 0 ? [] : [])] : [])].map(({ key, v }, idx) => (
              <fieldset key={key} disabled={locked} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-4">
                <input type="hidden" name="row" value={key} />
                {v && <input type="hidden" name={`id_${key}`} value={v.id} />}
                <legend className="px-1 text-xs font-semibold text-muted">{v ? v.label || `الخيار ${idx + 1}` : 'خيار جديد'}</legend>
                {optionAttrs.map((a) => (
                  <Field key={a.attr.id} label={a.attr.nameAr} htmlFor={`opt_${a.attr.code}_${key}`}>
                    <Select id={`opt_${a.attr.code}_${key}`} name={`opt_${a.attr.code}_${key}`} defaultValue={v?.options?.[a.attr.code] ?? ''} disabled={!!v && approved}>
                      <option value="">—</option>
                      {a.options.map((o) => <option key={o.value} value={o.value}>{o.labelAr}</option>)}
                    </Select>
                  </Field>
                ))}
                <Field label="SKU" htmlFor={`sku_${key}`} required><Input id={`sku_${key}`} name={`sku_${key}`} defaultValue={v?.sku ?? ''} dir="ltr" /></Field>
                <Field label="السعر (ج.م)" htmlFor={`price_${key}`} required><Input id={`price_${key}`} name={`price_${key}`} defaultValue={toInputAmount(v?.price)} inputMode="decimal" dir="ltr" /></Field>
                <Field label="السعر قبل الخصم" htmlFor={`compare_${key}`}><Input id={`compare_${key}`} name={`compare_${key}`} defaultValue={toInputAmount(v?.compareAtPrice)} inputMode="decimal" dir="ltr" /></Field>
                <Field label="الكمية المتوفرة" htmlFor={`stock_${key}`} hint={v?.reserved ? `${v.reserved} محجوزة لطلبات` : undefined}><Input id={`stock_${key}`} name={`stock_${key}`} type="number" min={0} defaultValue={v?.stockOnHand ?? 0} /></Field>
                <Field label="حد التنبيه" htmlFor={`low_${key}`}><Input id={`low_${key}`} name={`low_${key}`} type="number" min={0} defaultValue={v?.lowStockThreshold ?? 2} /></Field>
                <Field label="الباركود (اختياري)" htmlFor={`barcode_${key}`}><Input id={`barcode_${key}`} name={`barcode_${key}`} defaultValue={v?.barcode ?? ''} dir="ltr" /></Field>
                <div className="flex items-end"><Checkbox name={`active_${key}`} defaultChecked={v ? v.isActive : true} label="مفعّل" /></div>
              </fieldset>
            ))}
          </div>
          {editable && g.variants.length > 0 && <p className="text-xs text-muted">لإضافة خيار آخر احفظ ثم سيظهر صف جديد. لحذف خيار امسح الـ SKU والسعر.</p>}
          {!locked && <SubmitButton>حفظ والتالي</SubmitButton>}
        </ActionForm>
      )}

      {stepKey === 'logistics' && (
        <ActionForm action={productLogisticsAction} className="card space-y-4 p-5">
          <input type="hidden" name="productId" value={p.id} />
          <input type="hidden" name="next" value="review" />
          <p className="text-sm text-muted">مصاريف الشحن تُحدد حسب المحافظة من صفحة <Link href="/seller/shipping" className="text-brand-700 underline">الشحن</Link>.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="الوزن (جرام)" htmlFor="weightGrams"><Input id="weightGrams" name="weightGrams" type="number" min={0} defaultValue={p.weightGrams ?? ''} /></Field>
            <Field label="الطول (سم)" htmlFor="lengthCm"><Input id="lengthCm" name="lengthCm" type="number" min={0} defaultValue={p.lengthCm ?? ''} /></Field>
            <Field label="العرض (سم)" htmlFor="widthCm"><Input id="widthCm" name="widthCm" type="number" min={0} defaultValue={p.widthCm ?? ''} /></Field>
            <Field label="الارتفاع (سم)" htmlFor="heightCm"><Input id="heightCm" name="heightCm" type="number" min={0} defaultValue={p.heightCm ?? ''} /></Field>
          </div>
          <Field label="مدة التجهيز (أيام عمل)" htmlFor="processingDays" hint={`افتراضي المتجر: ${store?.defaultProcessingDays ?? 2}`}><Input id="processingDays" name="processingDays" type="number" min={0} max={30} defaultValue={p.processingDays ?? ''} /></Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">سياسة الإرجاع الاختياري</legend>
            <Radio name="returnPolicy" value="STORE" defaultChecked={!p.returnPolicyOverride} label="حسب سياسة المتجر" description={store?.acceptsVoluntaryReturns ? `المتجر يقبل الإرجاع خلال ${store.voluntaryReturnDays} يوم` : 'المتجر لا يقدم إرجاعاً اختيارياً'} />
            <Radio name="returnPolicy" value="ACCEPT" defaultChecked={p.returnPolicyOverride && !!p.acceptsVoluntaryReturns} label="أقبل الإرجاع الاختياري لهذا المنتج" />
            <Radio name="returnPolicy" value="NONE" defaultChecked={p.returnPolicyOverride && !p.acceptsVoluntaryReturns} label="لا أقدم إرجاعاً اختيارياً لهذا المنتج" description="دون الإخلال بحقوق المستهلك المقررة قانوناً" />
            <Field label="مدة الإرجاع الاختياري (أيام)" htmlFor="voluntaryReturnDays"><Input id="voluntaryReturnDays" name="voluntaryReturnDays" type="number" min={1} max={365} defaultValue={p.voluntaryReturnDays ?? ''} /></Field>
          </fieldset>
          <details><summary className="cursor-pointer text-sm font-semibold">تحسين محركات البحث (اختياري)</summary>
            <div className="mt-3 grid gap-3"><Field label="عنوان الصفحة" htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={p.seoTitle ?? ''} /></Field><Field label="الوصف المختصر" htmlFor="seoDescription"><Textarea id="seoDescription" name="seoDescription" defaultValue={p.seoDescription ?? ''} rows={2} /></Field></div>
          </details>
          <SubmitButton>حفظ والتالي</SubmitButton>
        </ActionForm>
      )}

      {stepKey === 'review' && (
        <div className="card space-y-4 p-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">الاسم</dt><dd className="font-medium">{p.titleAr}</dd></div>
            <div><dt className="text-muted">الحالة</dt><dd>{label('condition', p.condition)} {p.usedGrade && `· ${label('usedGrade', p.usedGrade)}`}</dd></div>
            <div><dt className="text-muted">الصور</dt><dd>{g.images.length} صورة ({g.images.filter((i) => i.img.isActualItem).length} حقيقية)</dd></div>
            <div><dt className="text-muted">الخيارات</dt><dd>{g.variants.filter((v) => v.isActive).map((v) => `${v.label || v.sku}: ${formatEGP(v.price)} (${v.stockOnHand})`).join(' · ') || '—'}</dd></div>
          </dl>
          {problems.length > 0 ? (
            <Alert tone="warning" title="أكمل التالي قبل الإرسال"><ul className="list-inside list-disc">{problems.map((x) => <li key={x}>{x}</li>)}</ul></Alert>
          ) : editable ? (
            <Alert tone="success">المنتج جاهز للإرسال للمراجعة.</Alert>
          ) : null}
          {editable && (
            <ActionForm action={submitProductAction}>
              <input type="hidden" name="productId" value={p.id} />
              <SubmitButton size="lg">إرسال للمراجعة</SubmitButton>
            </ActionForm>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {p.status === 'LIVE' && <Control id={p.id} op="deactivate" label="إيقاف مؤقت" />}
            {p.status === 'APPROVED' && <Control id={p.id} op="activate" label="تفعيل ونشر" />}
            {['LIVE', 'APPROVED'].includes(p.status) && <Control id={p.id} op="outofstock" label="تحديد كنفدت الكمية" />}
            {!['ARCHIVED', 'SUBMITTED', 'UNDER_REVIEW'].includes(p.status) && (
              <form action={productControlAction}>
                <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="op" value="archive" />
                <ConfirmSubmit confirm="أرشفة المنتج؟ لن يظهر للعملاء وتظل الطلبات السابقة محفوظة." variant="outline" size="sm">أرشفة</ConfirmSubmit>
              </form>
            )}
          </div>
          {g.events.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold">سجل المراجعة</p>
              <ul className="space-y-1 text-xs">{g.events.map((e) => <li key={e.id}><Badge>{e.action}</Badge> {formatDate(e.createdAt, true)} {e.reason && `— ${e.reason}`}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Control({ id, op, label: l }: { id: string; op: string; label: string }) {
  return (
    <form action={productControlAction}>
      <input type="hidden" name="productId" value={id} />
      <input type="hidden" name="op" value={op} />
      <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-page">{l}</button>
    </form>
  );
}
