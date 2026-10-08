'use client';

import { ChevronDown, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
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
export function CategoryMenu({ categories, label }: { categories: MenuCategory[]; label: string }) {
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
      className="group relative"
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
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold hover:bg-white/10"
        data-testid="category-menu-trigger"
      >
        <LayoutGrid className="size-4" aria-hidden /> {label} <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div
        id={panelId}
        hidden={!open}
        aria-label={label}
        className="absolute top-10 start-0 z-50 grid w-[760px] grid-cols-3 gap-4 rounded-xl bg-white p-5 text-ink shadow-[var(--shadow-pop)]"
        data-testid="category-menu-panel"
        onClick={(e) => {
          // Choosing a category closes the menu; clicks elsewhere inside it keep it open.
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {categories.map((c) => (
          <div key={c.id}>
            <Link href={`/category/${c.slug}`} className="font-bold hover:text-brand-700">
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
