'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** The homepage uses its own dark header (approved homepage design); every other page keeps the standard header. */
export function HeaderSwitch({ home, other }: { home: ReactNode; other: ReactNode }) {
  return usePathname() === '/' ? home : other;
}
