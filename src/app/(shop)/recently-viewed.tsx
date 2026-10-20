'use client';

import { useEffect, useState } from 'react';
import { ProductCard, ProductRail, RailItem, type CardProduct } from '@/ui/commerce';

/** "Recently viewed" rail backed by localStorage ids (no server-side tracking). */
export function RecentlyViewed() {
  const [items, setItems] = useState<CardProduct[]>([]);
  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem('edmn_recent') ?? '[]');
    } catch {
      return;
    }
    if (!ids.length) return;
    fetch(`/api/products/cards?ids=${ids.join(',')}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => undefined);
  }, []);
  if (!items.length) return null;
  return (
    <ProductRail title="شُفتها مؤخراً">
      {items.map((p) => (
        <RailItem key={p.id}>
          <ProductCard p={p} />
        </RailItem>
      ))}
    </ProductRail>
  );
}
