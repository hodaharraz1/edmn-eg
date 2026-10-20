'use client';

import NextLink from 'next/link';
import { useState, type ComponentProps } from 'react';

/**
 * EDMN link: same API and behaviour as `next/link`, but routes are prefetched on user INTENT (pointer
 * hover, keyboard focus, touch start) instead of whenever the link scrolls into view. Pages show dozens of
 * links (product cards, footer, navigation); viewport prefetch rendered each of them on the server even
 * though users follow one (measured: ~31 server renders per page view). The hover/touch head-start still
 * makes navigation feel instant. An explicit `prefetch` prop is respected as-is.
 * See node_modules/next/dist/docs/01-app/02-guides/prefetching.md («Hover-triggered prefetch»).
 */
export default function Link({ prefetch, onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false);
  if (prefetch !== undefined) return <NextLink prefetch={prefetch} onMouseEnter={onMouseEnter} onFocus={onFocus} onTouchStart={onTouchStart} {...props} />;
  return (
    <NextLink
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}
