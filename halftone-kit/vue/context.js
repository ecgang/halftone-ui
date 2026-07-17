// @halftone-ui/vue — the provider. One <HalftoneProvider> owns exactly one createPressContext,
// and every Surface/Text/Image (and any usePress) below it shares that press context: its theme,
// grain dials, seed roll, plate inks and the live-surface registry. Two providers on one page hold
// fully independent state — the per-instance guarantee the core was built for (blocker 2 dead).
//
// SSR (V-3): the press context is constructed with reduced:false and touches no browser API; the
// only matchMedia / window reads live inside onMounted, which never runs during server render. So
// importing and server-rendering this file is safe.

import { defineComponent, provide, inject, onMounted, onBeforeUnmount, watch } from 'vue';
import { createPressContext } from '../core/index.js';

const HALFTONE_KEY = Symbol('halftone-press-context');

export const HalftoneProvider = defineComponent({
  name: 'HalftoneProvider',
  props: {
    context: { type: Object, default: null }, // advanced: inject an already-built press context; else one is built from props
    mode: { type: String, default: undefined },
    hue: { type: [Number, String], default: undefined },
    grain: { type: [Number, String], default: undefined },
    inks: { type: Object, default: undefined },
    pal: { type: Object, default: undefined },
    seed: { type: [Number, String], default: undefined },
  },
  setup(props, { slots }) {
    // Build the context exactly once (or adopt the injected one). setup() runs once per component
    // instance — a plain const, not a ref, because this is a lifecycle-owning object we must never
    // rebuild on a props change — its registry is live state.
    const ctx = props.context || createPressContext({
      mode: props.mode, hue: props.hue, grain: props.grain, inks: props.inks, pal: props.pal, seed: props.seed,
    });

    provide(HALFTONE_KEY, ctx);

    // Reflect prefers-reduced-motion onto the context, and keep it live. Browser-only (guarded);
    // onMounted never fires during SSR, so this is safe to import server-side.
    let mq = null;
    const applyReduced = () => { ctx.reduced = mq.matches; };
    onMounted(() => {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      applyReduced();
      mq.addEventListener?.('change', applyReduced);
    });
    onBeforeUnmount(() => {
      mq?.removeEventListener?.('change', applyReduced);
    });

    // Palette from CSS (the docs' model — ink comes from --ink, named colors from --blue/--orange/…).
    // This is the adapter's job (the core stays DOM-free): read the page's custom properties and fill
    // the shared palette, so a plain <Surface> inks with --ink and color="blue" resolves to --blue.
    // Best-effort — only sets what the page actually defines. Re-read on mode change (a theme swap can
    // swing every var). Runs on mount, and again whenever `mode` changes, re-inking any surface that
    // first drew with the pre-CSS fallback.
    const readPalette = () => {
      if (typeof window === 'undefined' || !document.documentElement) return;
      const cs = window.getComputedStyle(document.documentElement);
      const read = (v) => cs.getPropertyValue(v).trim();
      const fore = read('--ink'); if (fore) ctx.setPal('fore', fore);
      for (const name of ['blue', 'orange', 'green', 'grey', 'gray', 'purple', 'red', 'yellow', 'pink', 'teal']) {
        const c = read('--' + name); if (c) ctx.setPal(name, c);
      }
      ctx.repaint();
    };
    onMounted(readPalette);
    watch(() => props.mode, () => { readPalette(); });

    // Controlled theme: when mode/hue props change, push them onto the shared context and repaint
    // every live surface. Skipped entirely when the caller doesn't drive theme via props.
    const pushTheme = () => {
      if (props.mode == null && props.hue == null) return;
      ctx.setTheme({
        ...(props.mode != null && { mode: props.mode }),
        ...(props.hue != null && { hue: props.hue }),
      });
      ctx.repaint();
    };
    onMounted(pushTheme);
    watch(() => [props.mode, props.hue], () => { pushTheme(); });

    return () => slots.default?.();
  },
});

// The nearest press context. A component used outside a provider gets a clear error rather than a
// null deref three frames deep in the core.
export function useHalftoneContext() {
  const ctx = inject(HALFTONE_KEY, null);
  if (!ctx) throw new Error('Halftone components must be rendered inside a <HalftoneProvider>.');
  return ctx;
}

export { HALFTONE_KEY };
