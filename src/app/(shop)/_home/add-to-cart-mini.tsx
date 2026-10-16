'use client';

import { Check, ShoppingCart } from 'lucide-react';
import { useActionState } from 'react';
import { addToCartAction } from '@/app/_actions/shop';

/** One-tap «أضف إلى السلة» for single-option products — the same server action as the product page (quantity 1). */
export function AddToCartMini({ variantId, describedBy }: { variantId: string; describedBy: string }) {
  const [state, action, pending] = useActionState(addToCartAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      <input type="hidden" name="intent" value="add" />
      <button type="submit" disabled={pending} aria-describedby={describedBy} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 text-[13px] font-bold sm:text-sm text-white transition-[background-color,transform] hover:bg-brand-700 active:scale-[0.98] disabled:opacity-70">
        {state.ok && !pending ? <Check className="size-4" aria-hidden /> : <ShoppingCart className="size-4" aria-hidden />}
        {pending ? 'جارٍ الإضافة…' : state.ok ? 'اتضاف للسلة' : 'أضف إلى السلة'}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-[11px] font-semibold leading-4 text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
