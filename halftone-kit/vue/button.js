// Button — a REAL <button> with a decorative pressed-ink fill. Every bit of semantics and a11y comes
// from the native element: type, disabled, focus ring, keyboard activation, and the accessible name
// (the default slot IS the label, real text, not a canvas). The halftone is an aria-hidden <Surface>
// painted behind that label — it can never stand in for it (V-10: semantics from the DOM, ink on top).
// Pressing the button ramps the ink in (pressIn), so the click has a physical, plate-pressed feel.
//
//   h(Button, { onClick: submit }, () => 'Publish')
//   h(Button, { color: 'blue', screen: 'am' }, () => 'Proof')

import { defineComponent, h, ref, mergeProps } from 'vue';
import { Surface } from './surface.js';

const SOLID = () => 1; // a full ink plate; the screen supplies the texture, `color` the ink

export const Button = defineComponent({
  name: 'Button',
  // Manual $attrs routing: everything (type/disabled/onClick/class/style/…) belongs on the real
  // <button>, never the canvas — Vue must not auto-apply attrs on our behalf.
  inheritAttrs: false,
  props: {
    field: { type: Function, default: undefined },
    screen: { type: String, default: undefined },
    scale: { type: [Number, String], default: undefined },
    r: { type: [Number, String, Function], default: undefined },
    ink: { type: [Number, String], default: undefined },
    wash: { type: [Number, String], default: undefined },
    roll: { type: [Number, String], default: undefined },
    seed: { type: [Number, String], default: undefined },
    color: { type: String, default: undefined },
    animate: { type: Boolean, default: false },
    pressMs: { type: Number, default: undefined },
    surfaceStyle: { type: [String, Object, Array], default: undefined },
    surfaceClass: { type: [String, Object, Array], default: undefined },
  },
  setup(props, { attrs, slots }) {
    const press = ref(null); // the Surface's press facade, handed back via pressRef

    // Ramp the ink in on press. `mergeProps` below composes same-named `on*` handlers into a
    // call-all chain (ours registered first, so it never swallows a caller's own @pointerdown) —
    // this is the fall-through the React version gets from manually calling onPointerDown?.(e).
    const onPointerdown = () => { press.value?.pressIn(); };

    return () => h('button', mergeProps(
      { onPointerdown, style: 'position:relative;isolation:isolate' },
      attrs,
    ), [
      h(Surface, {
        pressRef: press,
        field: props.field ?? SOLID,
        screen: props.screen, scale: props.scale, r: props.r, ink: props.ink, wash: props.wash,
        roll: props.roll, seed: props.seed, color: props.color,
        animate: props.animate, pressMs: props.pressMs,
        class: props.surfaceClass,
        style: ['position:absolute;inset:0;height:100%;z-index:0', props.surfaceStyle],
      }),
      h('span', { style: 'position:relative;z-index:1' }, slots.default?.()),
    ]);
  },
});
