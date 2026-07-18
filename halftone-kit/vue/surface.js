// Surface — a pressed canvas, the base primitive every other Vue halftone component is built on.
// It renders a decorative <canvas aria-hidden> and drives it through usePress; the SEMANTICS always
// live in the real DOM the caller wraps around it (a real <button>, <h1>, <img alt>), never in the
// canvas. `field` is the tone contract — (u, v) -> darkness in [0,1] over normalized coords — and
// everything else is a press dial with a context-level default.
//
// The canvas fills its box width and measures its own height (give the element a CSS height, or
// pass `h`). By default it re-presses only when a scalar dial changes; a data-driven surface whose
// `field` closes over changing values should pass an explicit `deps` (e.g. deps: [value]).

import { defineComponent, h, ref, mergeProps, onMounted, onBeforeUnmount } from 'vue';
import { usePress } from './use-press.js';
import { dialProps } from './_props.js';

export const Surface = defineComponent({
  name: 'Surface',
  // We merge $attrs ourselves (BEFORE the decorative aria-hidden), so Vue must not auto-apply them
  // to the root element on our behalf — that would race with the merge order below.
  inheritAttrs: false,
  props: {
    field: { type: Function, default: undefined },
    ...dialProps,
    wash: { type: [Number, String], default: undefined },
    h: { type: [Number, String], default: undefined }, // canvas height dial (not the `h()` render fn)
    animate: { type: Boolean, default: undefined },
    pressMs: { type: Number, default: undefined },
    deps: { type: Array, default: undefined }, // explicit watch source; overrides the scalar-dial default
    pressRef: { type: [Object, Function], default: undefined }, // ref object (.value) or a function ref
  },
  setup(props, { attrs }) {
    const el = ref(null);

    const getOpts = () => ({
      field: props.field, screen: props.screen, scale: props.scale, r: props.r, ink: props.ink,
      wash: props.wash, roll: props.roll, h: props.h, seed: props.seed, color: props.color,
      animate: props.animate, pressMs: props.pressMs,
    });

    // Default watch source = the scalar dials. `field` identity is intentionally excluded (it is
    // usually a fresh closure every render); to redraw on data change, drive it through `deps`.
    const watchSource = () => props.deps ?? [
      props.screen, props.scale, props.r, props.ink, props.wash, props.roll, props.h, props.seed, props.color,
    ];

    const press = usePress(el, getOpts, watchSource);

    // Optional escape hatch: hand the stable press facade back to a caller-owned ref (object or
    // function ref) so a wrapper (e.g. <Button>) can drive pressIn() on interaction without Surface
    // losing ownership of the canvas.
    onMounted(() => {
      if (!props.pressRef) return;
      if (typeof props.pressRef === 'function') props.pressRef(press);
      else props.pressRef.value = press;
    });
    onBeforeUnmount(() => {
      if (!props.pressRef) return;
      if (typeof props.pressRef === 'function') props.pressRef(null);
      else props.pressRef.value = null;
    });

    return () => h('canvas', mergeProps(
      { style: 'display:block;width:100%' },
      attrs,
      // AFTER the $attrs merge so it can't be overridden: the canvas is decorative, always.
      // Semantics live in the caller's real DOM (V-10). A caller passing aria-hidden must not
      // expose it to a11y.
      { ref: el, 'aria-hidden': 'true' },
    ));
  },
});
