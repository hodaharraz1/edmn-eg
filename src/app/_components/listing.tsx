import { SlidersHorizontal, SearchX } from 'lucide-react';
import Link from 'next/link';
import { brandFacets, filterableAttributes, searchProducts, SORTS, type SearchQuery, type Sort } from '@/server/modules/catalog/search';
import { parseEgp } from '@/server/core/money';
import { Drawer } from '@/ui/client';
import { ProductGrid } from '@/ui/commerce';
import { Pagination } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';
import { buttonClass } from '@/ui/button';
import { Cards } from './product-bits';
import { deliveryGovernorate } from '@/server/web/context';

export type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export const SORT_LABELS: Record<Sort, string> = {
  recommended: 'الأنسب',
  best_selling: 'الأكثر مبيعاً',
  top_rated: 'الأعلى تقييماً',
  newest: 'الأحدث',
  price_asc: 'السعر: من الأقل',
  price_desc: 'السعر: من الأعلى',
};

/** Translate URL search params into a typed search query (all inputs validated). */
export function queryFromParams(sp: SP, base: Partial<SearchQuery> = {}): SearchQuery {
  const price = (v: string) => {
    try {
      return v ? parseEgp(v) : undefined;
    } catch {
      return undefined;
    }
  };
  const attrs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(sp)) if (k.startsWith('a_') && /^a_[a-z0-9_]+$/.test(k)) attrs[k.slice(2)] = many(v).slice(0, 10);
  const sort = one(sp.sort) as Sort;
  return {
    ...base,
    q: one(sp.q).slice(0, 100) || base.q,
    brandIds: many(sp.brand).filter((x) => /^[0-9a-f-]{36}$/.test(x)),
    condition: one(sp.condition) === 'USED' ? 'USED' : one(sp.condition) === 'NEW' ? 'NEW' : base.condition,
    minPrice: price(one(sp.min)),
    maxPrice: price(one(sp.max)),
    minRating: Number(one(sp.rating)) || undefined,
    inStock: one(sp.stock) === '1',
    verifiedOnly: one(sp.verified) === '1',
    dealsOnly: one(sp.deals) === '1' || base.dealsOnly,
    attrs,
    sort: SORTS.includes(sort) ? sort : base.sort ?? 'recommended',
    page: Math.max(1, Number(one(sp.page)) || 1),
    pageSize: 24,
  };
}

function hrefWith(path: string, sp: SP, patch: Record<string, string | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of many(v)) u.append(k, x);
  for (const [k, v] of Object.entries(patch)) {
    u.delete(k);
    if (v !== null) u.set(k, v);
  }
  if (!('page' in patch)) u.delete('page');
  const qs = u.toString();
  return qs ? `${path}?${qs}` : path;
}

async function Filters({ path, sp, categoryId, hideBrand }: { path: string; sp: SP; categoryId?: string; hideBrand?: boolean }) {
  const [brands, attrs] = await Promise.all([hideBrand ? Promise.resolve([]) : brandFacets(categoryId), categoryId ? filterableAttributes(categoryId) : Promise.resolve([])]);
  const selectedBrands = new Set(many(sp.brand));
  return (
    <form action={path} className="space-y-5 text-sm">
      {one(sp.q) && <input type="hidden" name="q" value={one(sp.q)} />}
      {one(sp.sort) && <input type="hidden" name="sort" value={one(sp.sort)} />}
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">الحالة</legend>
        {[
          ['', 'الكل'],
          ['NEW', 'جديد'],
          ['USED', 'مستعمل'],
        ].map(([v, l]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name="condition" value={v} defaultChecked={one(sp.condition) === v} className="accent-brand-700" /> {l}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">السعر (ج.م)</legend>
        <div className="flex items-center gap-2">
          <input name="min" defaultValue={one(sp.min)} inputMode="decimal" placeholder="من" aria-label="أقل سعر" className="h-9 w-full rounded-lg border border-line px-2" />
          <span>–</span>
          <input name="max" defaultValue={one(sp.max)} inputMode="decimal" placeholder="إلى" aria-label="أعلى سعر" className="h-9 w-full rounded-lg border border-line px-2" />
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">التقييم</legend>
        {[4, 3].map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="radio" name="rating" value={r} defaultChecked={one(sp.rating) === String(r)} className="accent-brand-700" /> {r} نجوم فأكثر
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">خيارات</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="stock" value="1" defaultChecked={one(sp.stock) === '1'} className="accent-brand-700" /> متوفر فقط</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="verified" value="1" defaultChecked={one(sp.verified) === '1'} className="accent-brand-700" /> بائع موثّق</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="deals" value="1" defaultChecked={one(sp.deals) === '1'} className="accent-brand-700" /> عليه خصم</label>
      </fieldset>
      {brands.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 font-semibold">العلامة التجارية</legend>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {brands.map((b) => (
              <label key={b.id} className="flex items-center gap-2">
                <input type="checkbox" name="brand" value={b.id} defaultChecked={selectedBrands.has(b.id)} className="accent-brand-700" />
                {b.nameAr || b.name} <span className="text-xs text-muted">({b.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {attrs.map((a) => (
        <fieldset key={a.code} className="space-y-2">
          <legend className="mb-1 font-semibold">{a.nameAr}</legend>
          <div className="max-h-40 space-y-1.5 overflow-y-auto">
            {a.values.map((v) => (
              <label key={v.value} className="flex items-center gap-2">
                <input type="checkbox" name={`a_${a.code}`} value={v.value} defaultChecked={many(sp[`a_${a.code}`]).includes(v.value)} className="accent-brand-700" />
                {v.label === 'true' ? 'نعم' : v.label === 'false' ? 'لا' : v.label} <span className="text-xs text-muted">({v.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <button className={buttonClass('primary', 'sm', 'flex-1')}>تطبيق</button>
        <Link href={one(sp.q) ? `${path}?q=${encodeURIComponent(one(sp.q))}` : path} className={buttonClass('outline', 'sm')}>
          مسح
        </Link>
      </div>
    </form>
  );
}

/** Shared listing page body: filters (sidebar / mobile drawer), sort, grid, pagination, empty state. */
export async function Listing({ path, sp, base = {}, hideBrand, emptyHint }: { path: string; sp: SP; base?: Partial<SearchQuery>; hideBrand?: boolean; emptyHint?: string }) {
  const query = queryFromParams(sp, base);
  const gov = await deliveryGovernorate();
  const result = await searchProducts(query);
  const filters = <Filters path={path} sp={sp} categoryId={base.categoryId} hideBrand={hideBrand} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
      <aside className="hidden lg:block">
        <div className="card sticky top-32 p-4">{filters}</div>
      </aside>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{result.total.toLocaleString('ar-EG-u-nu-latn')} منتج · التوصيل إلى {gov?.nameAr}</p>
          <div className="flex items-center gap-2">
            <Drawer
              title="تصفية النتائج"
              trigger={
                <button type="button" className={buttonClass('outline', 'sm', 'lg:hidden')}>
                  <SlidersHorizontal className="size-4" /> تصفية
                </button>
              }
            >
              {filters}
            </Drawer>
            <nav aria-label="ترتيب" className="scrollbar-none flex gap-1 overflow-x-auto">
              {SORTS.map((s) => (
                <Link
                  key={s}
                  href={hrefWith(path, sp, { sort: s })}
                  aria-current={query.sort === s ? 'true' : undefined}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${query.sort === s ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-page'}`}
                >
                  {SORT_LABELS[s]}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        {result.items.length ? (
          <>
            <ProductGrid>
              <Cards items={result.items} back={hrefWith(path, sp, {})} priorityCount={4} />
            </ProductGrid>
            <Pagination page={result.page} pages={result.pages} hrefFor={(p) => hrefWith(path, sp, { page: String(p) })} />
          </>
        ) : (
          <EmptyState icon={SearchX} title="لا توجد نتائج مطابقة" description={emptyHint ?? 'جرّب كلمات بحث مختلفة أو قلّل عوامل التصفية.'} action={<Link href={path} className={buttonClass('outline')}>مسح التصفية</Link>} />
        )}
      </div>
    </div>
  );
}
