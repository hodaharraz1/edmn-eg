'use client';

import { ChevronDown, LayoutGrid } from 'lucide-react';
import Link from '@/ui/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface MenuCategory {
  id: string | number;
  slug: string;
  nameAr: string;
  children: { id: string | number; slug: string; nameAr: string }[];
}

/** Header overlays announce themselves so only one large overlay is open at a time. */
const OVERLAY_EVENT = 'edmn:header-overlay';

/**
 * Desktop category mega menu (same layout as before). Opens/closes on the trigger; closes on any pointer
 * down outside it, Escape (focus returns to the trigger), focus leaving it, choosing a category, route
 * changes and browser back/forward, and when another header overlay opens. Listeners exist only while open.
 */
export function CategoryMenu({ categories, label, triggerClassName, quickLinks }: { categories: MenuCategory[]; label: string; triggerClassName?: string; quickLinks?: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Route change (link, back/forward, programmatic) → closed (state adjusted during render, React's pattern).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: 'categories' }));
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    const onOverlay = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== 'categories') setOpen(false);
    };
    const onPop = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OVERLAY_EVENT, onOverlay);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OVERLAY_EVENT, onOverlay);
      window.removeEventListener('popstate', onPop);
    };
  }, [open, close]);

  return (
    <div
      ref={rootRef}
      className="group"
      data-testid="category-menu"
      onBlur={(e) => {
        // Keyboard: tabbing out of the trigger/menu closes it.
        if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName ?? 'flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold hover:bg-white/10'}
        data-testid="category-menu-trigger"
      >
        <LayoutGrid className="size-4" aria-hidden /> {label} <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div
        id={panelId}
        hidden={!open}
        aria-label={label}
        // Anchored to the (sticky) site header, so it opens below the whole header and never covers the search row.
        className="absolute inset-x-0 top-full z-50 mx-auto mt-2 grid w-[min(760px,calc(100%-2rem))] grid-cols-3 gap-4 rounded-2xl bg-white p-5 text-ink shadow-[var(--shadow-pop)] ring-1 ring-line"
        data-testid="category-menu-panel"
        onClick={(e) => {
          // Choosing a category closes the menu; clicks elsewhere inside it keep it open.
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {quickLinks && quickLinks.length > 0 && (
          <div className="col-span-3 flex flex-wrap gap-2 border-b border-line pb-4">
            {quickLinks.map((q) => (
              <Link key={q.href} href={q.href} className="inline-flex min-h-9 items-center rounded-full bg-brand-50 px-3.5 text-sm font-semibold text-brand-800 hover:bg-brand-100">
                {q.label}
              </Link>
            ))}
          </div>
        )}
        {categories.map((c) => (
          <div key={c.id}>
            <Link href={`/category/${c.slug}`} className="font-bold text-brand-950 hover:text-brand-700">
              {c.nameAr}
            </Link>
            <ul className="mt-1 space-y-0.5">
              {c.children.slice(0, 6).map((ch) => (
                <li key={ch.id}>
                  <Link href={`/category/${ch.slug}`} className="text-sm text-muted hover:text-brand-700">
                    {ch.nameAr}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
