// Meter — a REAL <progress> carries the value, the max, and the accessible readout; assistive tech
// gets a native progressbar with the true numbers. The visible bar is an aria-hidden <Surface> whose
// ink fills from the left to value/max, so sighted users read the same quantity in halftone. Nothing
// about the measurement lives in the canvas (V-10). The native <progress> is visually hidden, not
// removed — it stays in the a11y tree.
//
//   h(Meter, { value: 0.72 })            // 0..1
//   h(Meter, { value: 430, max: 500 })    // any range

import { defineComponent, h } from 'vue';
import { Surface } from './surface.js';

// Visually hidden, still in the accessibility tree (the standard sr-only recipe).
const SR_ONLY = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip:rect(0,0,0,0);white-space:nowrap;border:0';

export const Meter = defineComponent({
  name: 'Meter',
  // Manual $attrs routing: class/style belong to the container div, everything else (aria-*, id,
  // name, …) belongs on the real <progress> — it's the element that carries the semantics.
  inheritAttrs: false,
  props: {
    value: { type: [Number, String], default: 0 },
    max: { type: [Number, String], default: 1 },
    screen: { type: String, default: undefined },
    scale: { type: [Number, String], default: undefined },
    r: { type: [Number, String, Function], default: undefined },
    ink: { type: [Number, String], default: undefined },
    wash: { type: [Number, String], default: undefined },
    roll: { type: [Number, String], default: undefined },
    seed: { type: [Number, String], default: undefined },
    color: { type: String, default: undefined },
    h: { type: [Number, String], default: 12 }, // canvas height dial (not the `h()` render fn)
    surfaceStyle: { type: [String, Object, Array], default: undefined },
    surfaceClass: { type: [String, Object, Array], default: undefined },
  },
  setup(props, { attrs }) {
    return () => {
      const max = Number(props.max);
      const value = Number(props.value);
      const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
      // A hard fill edge at `frac`: full ink to its left, empty to its right. `field` is not a
      // geometry key, so a value change repaints the same grid rather than re-seeding it — the dots
      // hold still and only the fill boundary moves (forced via the explicit `deps` below).
      const field = (u) => (u <= frac ? 1 : 0);

      const { class: klass, style: styleAttr, ...rest } = attrs;

      return h('div', { class: klass, style: ['position:relative', styleAttr] }, [
        h('progress', { ...rest, value: props.value, max: props.max, style: SR_ONLY }),
        h(Surface, {
          field,
          screen: props.screen, scale: props.scale, r: props.r, ink: props.ink, wash: props.wash,
          roll: props.roll, seed: props.seed, color: props.color,
          h: props.h,
          deps: [
            frac, props.screen, props.scale, props.r, props.ink, props.wash, props.roll,
            props.seed, props.color, props.h,
          ],
          class: props.surfaceClass,
          style: props.surfaceStyle,
        }),
      ]);
    };
  },
});
