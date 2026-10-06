'use client';

import { MapPin } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { setGovernorateAction } from '@/app/_actions/shop';
import { cn } from '@/lib/cn';

type Gov = { id: number; nameAr: string };

/**
 * Header delivery-location selector (browsing context only; checkout prices from the checkout address).
 *
 * - Works before hydration: the trigger uses the native popover API and the form posts the server action
 *   natively, so an early tap never needs a second click.
 * - After hydration the submit is intercepted (no React form action), so React's automatic form reset no
 *   longer snaps the select back to the server-rendered default — that reset used to re-apply the old
 *   governorate on the next "apply". The select stays uncontrolled (a choice made before hydration is
 *   kept) and is re-keyed on the stored governorate. The popover closes only once the server has stored
 *   the choice and the refreshed header has rendered, so the header always shows server state.
 */
export function DeliveryLocationPicker({ governorates, current, className }: { governorates: Gov[]; current: Gov; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const popId = `delivery-location-${uid}`;
  const popRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set when the server stored the choice. The popover is closed only once the transition has committed
  // (pending → false), i.e. after the refreshed header with the new governorate is on screen. Closing
  // right after the action resolved left a window where the header (and a re-opened selector) still
  // showed the previous governorate.
  const saved = useRef(false);
  useEffect(() => {
    if (!pending && saved.current) {
      saved.current = false;
      popRef.current?.hidePopover();
    }
  }, [pending]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await setGovernorateAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      saved.current = true;
    });
  }

  return (
    <>
      <button
        type="button"
        popoverTarget={popId}
        className={cn('flex min-w-0 shrink items-center gap-1 rounded-lg px-1.5 py-1 text-start text-xs hover:bg-page', className)}
        data-testid="delivery-location"
        aria-label={`التوصيل إلى ${current.nameAr} – غيّر محافظة التوصيل`}
      >
        <MapPin className="size-4 shrink-0 text-brand-700" aria-hidden />
        <span className="min-w-0 leading-tight">
          <span className="block text-[10px] text-muted">التوصيل إلى</span>
          <span className="block truncate font-semibold" data-testid="delivery-location-name">{current.nameAr}</span>
        </span>
      </button>
      <div
        ref={popRef}
        id={popId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${popId}-title`}
        onToggle={(e) => {
          // Re-opening always starts from the stored governorate, never from an abandoned choice.
          if ((e as unknown as ToggleEvent).newState === 'open') {
            if (selectRef.current) selectRef.current.value = String(current.id);
            setError(null);
          }
        }}
        className="fixed inset-0 m-auto h-fit w-[min(92vw,360px)] rounded-2xl bg-white p-4 text-ink shadow-[var(--shadow-pop)] backdrop:bg-black/40"
        data-testid="delivery-location-dialog"
      >
        <form action={setGovernorateAction as unknown as (fd: FormData) => void} onSubmit={onSubmit} className="space-y-3">
          <h2 id={`${popId}-title`} className="flex items-center gap-1.5 font-bold">
            <MapPin className="size-5 text-brand-700" aria-hidden /> اختار محافظة التوصيل
          </h2>
          <p className="text-xs text-muted">بنستخدمها علشان نوريك المنتجات اللي بتتشحن لمحافظتك ومصاريف شحنها. مصاريف الشحن النهائية بتتحسب على عنوان التوصيل لما تكمّل الشراء.</p>
          <label htmlFor={`${popId}-select`} className="sr-only">
            المحافظة
          </label>
          <select
            key={current.id}
            ref={selectRef}
            id={`${popId}-select`}
            name="governorateId"
            defaultValue={String(current.id)}
            aria-disabled={pending}
            className="h-11 w-full rounded-lg border border-line bg-white px-2 text-sm"
            data-testid="delivery-location-select"
          >
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nameAr}
              </option>
            ))}
          </select>
          {error && (
            <p role="alert" className="text-xs font-semibold text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {/* Default (submit) button without an explicit type attribute, like the header search button. */}
            <button
              disabled={pending}
              className="h-11 flex-1 rounded-lg bg-brand-700 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              data-testid="delivery-location-apply"
            >
              {pending ? 'جارٍ الحفظ…' : 'احفظ'}
            </button>
            <button type="button" popoverTarget={popId} popoverTargetAction="hide" className="h-11 rounded-lg border border-line px-4 text-sm">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
