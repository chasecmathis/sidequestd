"use client";

/**
 * The shared theme provider, wired to this document.
 *
 * `@sidequestd/core` decides *what* the theme is — the `system`/`light`/`dark`
 * choice, whether to follow the device, and the hydration timing that keeps the
 * answer from flashing. All of that is identical on native, so it lives there.
 *
 * What it deliberately does not do is touch the DOM. Stamping `data-theme` onto
 * `<html>` is the whole of this file, and it is web-only for a concrete reason:
 * that attribute is the single input to the `[data-theme="light"]` block in
 * `tokens.generated.css`, and it is how CSS — which never consults React —
 * learns which palette to paint. Native has no equivalent; its components read
 * the palette straight out of the context.
 *
 * Keeping it here rather than passing `onResolvedChange` at the call site means
 * there is one place that knows the attribute exists, and `layout.tsx` and the
 * theme tests cannot drift about what the browser is supposed to do.
 */
import { ThemeProvider, type ResolvedTheme } from "@sidequestd/core";
import { useCallback, type ReactNode } from "react";

export function WebThemeProvider({ children }: { children: ReactNode }) {
  const applyToDocument = useCallback((resolved: ResolvedTheme) => {
    document.documentElement.dataset.theme = resolved;
  }, []);

  return <ThemeProvider onResolvedChange={applyToDocument}>{children}</ThemeProvider>;
}
