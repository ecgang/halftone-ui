// Text — a wordmark pressed into halftone. It rasterises the type once (via the core's textField)
// and reads it back as a tone field, exactly as the docs masthead does: the raster is built at the
// canvas's own CSS width, so the raw press point p.x/p.y ARE raster pixels and the sample lines up
// with no scaling. The canvas height follows the wordmark's natural height (pushed through the
// press as `h`), so the type never distorts. Re-rasterises when the width (or the type) changes.
//
// The REAL heading is the caller's job — wrap a visually-hidden <h1>{text}</h1> beside this. The
// canvas is aria-hidden decoration.

import { defineComponent, h, ref, mergeProps, onMounted, onBeforeUnmount, watch } from 'vue';
import { textField } from '../core/index.js';
import { usePress } from './use-press.js';
import { useHalftoneContext } from './context.js';

export const Text = defineComponent({
  name: 'Text',
  inheritAttrs: false,
  props: {
    text: { type: String, default: '' },
    screen: { type: String, default: undefined },
    scale: { type: [Number, String], default: undefined },
    r: { type: [Number, String, Function], default: undefined },
    ink: { type: [Number, String], default: undefined },
    wash: { type: [Number, String], default: undefined },
    roll: { type: [Number, String], default: undefined },
    color: { type: String, default: undefined },
    animate: { type: Boolean, default: undefined },
    pressMs: { type: Number, default: undefined },
  },
  setup(props, { attrs }) {
    const ctx = useHalftoneContext();
    const el = ref(null);
    const raster = ref(null);   // { sample, H, cell } — filled at first rasterise
    const width = ref(0);       // last width we rasterised at

    // Stable, point-based field: sample the wordmark at the raw canvas point (raster space == canvas
    // space). Identity never changes, so usePress won't rebuild on it — we drive redraws explicitly
    // after each rasterise. Returns 0 (blank) until the first raster lands.
    const field = (u, v, p) => {
      const R = raster.value;
      return R ? R.sample(p.x, p.y, R.cell) : 0;
    };

    // animate is handled here (post-raster), not by usePress — a press-in at mount would animate the
    // still-empty field and finish before the type exists.
    const getOpts = () => ({
      field, screen: props.screen, scale: props.scale, r: props.r, ink: props.ink,
      wash: props.wash, roll: props.roll, color: props.color, pressMs: props.pressMs,
    });
    const watchSource = () => [props.screen, props.scale, props.r, props.ink, props.wash, props.roll, props.color];

    const press = usePress(el, getOpts, watchSource);

    // (re)rasterise at a CSS width, then push the wordmark's natural height so the canvas aspect
    // matches and the sample coordinates line up. `h` is a geometry key → set() rebuilds and redraws.
    const rasterize = (w) => {
      if (!w || typeof document === 'undefined') return;
      const cell = (props.r ?? 2.5) * 0.8 * (props.scale ?? ctx.grain.scale); // FM grid pitch (px), matches grainPts
      const { H, sample } = textField(props.text, Math.round(w), () => document.createElement('canvas'));
      raster.value = { sample, H, cell: cell * 0.5 };           // sample radius = half a cell (docs)
      const firstRaster = width.value === 0;
      width.value = w;
      press.set({ h: H });
      if (props.animate && firstRaster) press.pressIn();
    };

    // Track width (browser only). Falls back to a one-shot measure where ResizeObserver is absent.
    let ro = null;
    onMounted(() => {
      const node = el.value;
      if (!node) return;
      if (typeof ResizeObserver === 'undefined') { rasterize(node.clientWidth); return; }
      ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== width.value) rasterize(w);
      });
      ro.observe(node);
      if (node.clientWidth) rasterize(node.clientWidth); // observe() may not deliver an initial frame in time
    });
    onBeforeUnmount(() => { ro?.disconnect(); ro = null; });

    // Re-rasterise when the type or a cell-affecting dial changes, at the current width. No skip
    // guard here: Vue's default `watch` is ALREADY lazy (it never fires on setup, unlike React's
    // useEffect, which is why the React port needs an `inited` ref) — a guard on top of that would
    // swallow the FIRST real text/scale/r change.
    watch(() => [props.text, props.scale, props.r], () => {
      if (width.value) rasterize(width.value);
    });

    return () => h('canvas', mergeProps(
      { style: 'display:block;width:100%' },
      attrs,
      // AFTER the $attrs merge so it can't be overridden: the canvas is decorative, always.
      { ref: el, 'aria-hidden': 'true' },
    ));
  },
});
