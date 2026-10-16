'use client';

import { Check, LayoutGrid, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

/**
 * Homepage search: one long field with a category choice. Uses the existing search routes — all categories →
 * /search?q=…, a chosen category → /category/<slug>?q=… (the category listing already filters by q).
 * Desktop: an inline category select. Mobile: a category button opening an accessible bottom sheet (native
 * <dialog>: focus trap, Escape, backdrop). Without JavaScript the form still submits to /search.
 */
export function HomeSearch({ categories }: { categories: { slug: string; nameAr: string }[] }) {
  const router = useRouter();
  const [cat, setCat] = useState('');
  const sheet = useRef<HTMLDialogElement>(null);
  const chosen = categories.find((c) => c.slug === cat);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    router.push(cat ? `/category/${encodeURIComponent(cat)}${qs}` : `/search${qs}`);
  }
  function pick(slug: string) {
    setCat(slug);
    sheet.current?.close();
  }

  return (
    <>
      <form action="/search" role="search" aria-label="ابحث في اضمن" onSubmit={onSubmit} className="mx-auto flex h-[3.25rem] w-full max-w-3xl items-center rounded-full bg-white p-1 text-ink shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)] ring-1 ring-white/30 transition-shadow focus-within:ring-4 focus-within:ring-brand-400/50">
        <label htmlFor="home-search" className="sr-only">
          ابحث عن منتج أو متجر
        </label>
        <Search className="ms-3 size-5 shrink-0 text-slate-400" aria-hidden />
        <input id="home-search" name="q" type="search" enterKeyHint="search" autoComplete="off" placeholder="ابحث عن منتج أو متجر…" className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-base placeholder:text-slate-400 focus:outline-none" />
        <button type="button" onClick={() => sheet.current?.showModal()} aria-haspopup="dialog" aria-label={chosen ? `الفئة: ${chosen.nameAr}` : 'اختيار الفئة'} className="me-1 grid size-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 sm:hidden">
          <LayoutGrid className={`size-5 ${chosen ? 'text-brand-600' : ''}`} aria-hidden />
        </button>
        <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
        <label htmlFor="home-search-cat" className="sr-only">
          الفئة
        </label>
        <select id="home-search-cat" value={cat} onChange={(e) => setCat(e.target.value)} className="hidden h-full max-w-40 cursor-pointer bg-transparent px-3 text-sm font-medium text-slate-600 focus:outline-none sm:block">
          <option value="">جميع الفئات</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.nameAr}
            </option>
          ))}
        </select>
        <button type="submit" className="h-full shrink-0 rounded-full bg-brand-600 px-5 text-sm font-bold text-white transition-[background-color,transform] hover:bg-brand-700 active:scale-[0.97] sm:px-7 sm:text-base">
          ابحث
        </button>
      </form>
      {chosen && (
        <p className="mx-auto mt-2 flex max-w-3xl items-center gap-2 text-xs text-brand-100 sm:hidden">
          البحث في: <span className="font-bold text-white">{chosen.nameAr}</span>
          <button type="button" onClick={() => setCat('')} className="min-h-11 px-2 font-semibold text-sky-300 underline underline-offset-2">
            كل الفئات
          </button>
        </p>
      )}
      <dialog ref={sheet} aria-labelledby="home-cat-sheet-title" className="edmn-sheet m-0 mt-auto max-h-[80dvh] w-full max-w-none rounded-t-3xl bg-white p-0 text-ink backdrop:bg-black/50">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-4 py-2">
          <h2 id="home-cat-sheet-title" className="font-bold">
            ابحث في فئة
          </h2>
          <button type="button" onClick={() => sheet.current?.close()} aria-label="إغلاق" className="grid size-11 place-items-center rounded-full hover:bg-page">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <ul className="px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
          {[{ slug: '', nameAr: 'جميع الفئات' }, ...categories].map((c) => (
            <li key={c.slug || 'all'}>
              <button type="button" onClick={() => pick(c.slug)} aria-pressed={cat === c.slug} className="flex min-h-12 w-full items-center justify-between rounded-xl px-3 text-start text-[15px] hover:bg-page aria-pressed:font-bold aria-pressed:text-brand-700">
                {c.nameAr}
                {cat === c.slug && <Check className="size-5" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
