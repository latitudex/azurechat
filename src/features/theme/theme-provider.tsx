"use client";

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

/**
 * Thin wrapper around `next-themes`'s ThemeProvider. The previous version
 * gated rendering on `isMounted` to dodge an old hydration mismatch, but
 * that broke the inline `<script>` next-themes injects before hydration
 * to prevent the dark/light flash — React 19 warns that scripts rendered
 * after mount never execute. next-themes is already SSR-safe; let it
 * render straight through.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
