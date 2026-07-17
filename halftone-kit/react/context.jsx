// @halftone-ui/react — the provider. One <HalftoneProvider> owns exactly one createPressContext,
// and every Surface/Text/Image (and any usePress) below it shares that press context: its theme,
// grain dials, seed roll, plate inks and the live-surface registry. Two providers on one page hold
// fully independent state — the per-instance guarantee the core was built for (blocker 2 dead).
//
// SSR (V-3): the press context is constructed with reduced:false and touches no browser API; the
// only matchMedia / window reads live inside effects, which never run during server render. So
// importing and server-rendering this file is safe.

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { createPressContext } from '../core/index.js';

const HalftoneContext = createContext(null);

export function HalftoneProvider({
  context,           // advanced: inject an already-built press context; else one is built from props
  mode, hue, grain, inks, pal, seed,
  children,
}) {
  // Build the context exactly once (or adopt the injected one). A ref, not useMemo, because this is
  // a lifecycle-owning object we must never rebuild on a props change — its registry is live state.
  const ref = useRef(null);
  if (ref.current == null) {
    ref.current = context || createPressContext({ mode, hue, grain, inks, pal, seed });
  }
  const ctx = ref.current;

  // Reflect prefers-reduced-motion onto the context, and keep it live. Browser-only (guarded).
  // The core reads ctx.reduced at press-in time, so updating the flag is enough — no repaint needed.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => { ctx.reduced = mq.matches; };
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [ctx]);

  // Palette from CSS (the docs' model — ink comes from --ink, named colors from --blue/--orange/…).
  // This is the adapter's job (the core stays DOM-free): read the page's custom properties and fill
  // the shared palette, so a plain <Surface> inks with --ink and color="blue" resolves to --blue.
  // Best-effort — only sets what the page actually defines. Re-read on mode change (a theme swap can
  // swing every var). Runs after the children's mount effects (React fires effects child-first), so
  // the repaint re-inks surfaces that first drew with the pre-CSS fallback.
  useEffect(() => {
    if (typeof window === 'undefined' || !document.documentElement) return;
    const cs = window.getComputedStyle(document.documentElement);
    const read = (v) => cs.getPropertyValue(v).trim();
    const fore = read('--ink'); if (fore) ctx.setPal('fore', fore);
    for (const name of ['blue', 'orange', 'green', 'grey', 'gray', 'purple', 'red', 'yellow', 'pink', 'teal']) {
      const c = read('--' + name); if (c) ctx.setPal(name, c);
    }
    ctx.repaint();
  }, [ctx, mode]);

  // Controlled theme: when mode/hue props change, push them onto the shared context and repaint
  // every live surface. Skipped entirely when the caller doesn't drive theme via props.
  useEffect(() => {
    if (mode == null && hue == null) return;
    ctx.setTheme({ ...(mode != null && { mode }), ...(hue != null && { hue }) });
    ctx.repaint();
  }, [ctx, mode, hue]);

  return <HalftoneContext.Provider value={ctx}>{children}</HalftoneContext.Provider>;
}

// The nearest press context. A component used outside a provider gets a clear error rather than a
// null deref three frames deep in the core.
export function useHalftoneContext() {
  const ctx = useContext(HalftoneContext);
  if (!ctx) throw new Error('Halftone components must be rendered inside a <HalftoneProvider>.');
  return ctx;
}

export { HalftoneContext };
