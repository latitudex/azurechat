'use client';

import { cn } from '@/features/ui/lib';
import type { ComponentPropsWithoutRef, CSSProperties, ElementType } from 'react';

export type ShimmerProps<T extends ElementType = 'span'> = {
  as?: T;
  /** Animation duration in seconds. */
  duration?: number;
} & Omit<ComponentPropsWithoutRef<T>, 'as'>;

/**
 * A text shimmer that sweeps a bright band left→right across its children,
 * used to signal in-progress / streaming state. CSS-only (no framer-motion):
 * a gradient clipped to the text, animated via `background-position`. The
 * bright band is the brand colour so a running tool "flashes" on-theme.
 *
 * Keyframes + base class live in app/globals.css (`.ai-shimmer`).
 */
export const Shimmer = <T extends ElementType = 'span'>({
  as,
  duration = 1.4,
  className,
  style,
  ...props
}: ShimmerProps<T>) => {
  const Comp = (as ?? 'span') as ElementType;
  return (
    <Comp
      className={cn('ai-shimmer', className)}
      style={{ '--ai-shimmer-duration': `${duration}s`, ...style } as CSSProperties}
      {...props}
    />
  );
};
