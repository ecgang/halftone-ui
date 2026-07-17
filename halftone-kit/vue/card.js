// Card — a real container (its element, role, and every child are ordinary DOM) resting on a
// decorative pressed backdrop. The <Surface> is an aria-hidden whisper of ink behind the content;
// none of the card's meaning lives in the canvas (V-10). Default backdrop is a low, sparse tone so
// it reads as pressed paper, not a filled block — tune it with `field`, `color`, `screen`, `ink`.
//
//   h(Card, {}, () => [h('h3', 'Plate registration'), h('p', '…')])
//   h(Card, { as: 'article', screen: 'lines', color: 'blue' }, () => …)

import { defineComponent, h, mergeProps } from 'vue';
import { Surface } from './surface.js';

const WHISPER = () => 0.12; // a light constant tone -> small/sparse dots, a paper-grain backdrop

export const Card = defineComponent({
  name: 'Card',
  // Manual $attrs routing: everything (class/style/id/role/…) belongs on the container element,
  // never the canvas.
  inheritAttrs: false,
  props: {
    field: { type: Function, default: undefined },
    as: { type: String, default: 'div' }, // same prop name as the React adapter — API parity
    screen: { type: String, default: undefined },
    scale: { type: [Number, String], default: undefined },
    r: { type: [Number, String, Function], default: undefined },
    ink: { type: [Number, String], default: undefined },
    wash: { type: [Number, String], default: undefined },
    roll: { type: [Number, String], default: undefined },
    seed: { type: [Number, String], default: undefined },
    color: { type: String, default: undefined },
    surfaceStyle: { type: [String, Object, Array], default: undefined },
    surfaceClass: { type: [String, Object, Array], default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => h(props.as, mergeProps(
      { style: 'position:relative;isolation:isolate' },
      attrs,
    ), [
      h(Surface, {
        field: props.field ?? WHISPER,
        screen: props.screen, scale: props.scale, r: props.r, ink: props.ink, wash: props.wash,
        roll: props.roll, seed: props.seed, color: props.color,
        class: props.surfaceClass,
        style: ['position:absolute;inset:0;height:100%;z-index:0', props.surfaceStyle],
      }),
      h('div', { style: 'position:relative;z-index:1' }, slots.default?.()),
    ]);
  },
});
