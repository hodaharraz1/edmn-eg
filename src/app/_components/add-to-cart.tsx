'use client';

import { ShoppingCart, Zap } from 'lucide-react';
import { addToCartAction } from '@/app/_actions/shop';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { QuantityInput } from '@/ui/client';

export function AddToCartForm({ variantId, max, disabled }: { variantId: string; max: number; disabled?: boolean }) {
  return (
    <ActionForm action={addToCartAction} className="space-y-3">
      <input type="hidden" name="variantId" value={variantId} />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">الكمية</span>
        <QuantityInput max={Math.max(1, Math.min(max, 99))} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <SubmitButton size="lg" className="w-full" name="intent" value="add" pendingText="جارٍ الإضافة…">
          <ShoppingCart className="size-5" /> ضيف للسلة
        </SubmitButton>
        <SubmitButton size="lg" variant="secondary" className="w-full" name="intent" value="buy">
          <Zap className="size-5" /> اشتري دلوقتي
        </SubmitButton>
      </div>
      {disabled && <p className="text-xs text-muted">المنتج ده مش متاح للطلب دلوقتي.</p>}
    </ActionForm>
  );
}
