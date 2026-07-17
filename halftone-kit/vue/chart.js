// BarChart / LineChart — data-driven pressed surfaces, same V-10 stance as Button/Meter/Card: the
// DATA lives in a REAL, accessible <table> (visually hidden but in the a11y tree, with a <caption>),
// and the halftone is a decorative aria-hidden <Surface>. Screen readers read the numbers; sighted
// readers read ink. The chart GEOMETRY is the framework-free core (../core/charts.js) — pure fields
// shared unchanged with the React adapter.
//
//   h(BarChart, { data: [4, 9, 6, 3], caption: 'Impressions by week', color: 'blue' })
//   h(LineChart, { data: [{ label: 'Jan', value: 12 }, …], area: true, caption: 'Ink-up over time' })

import { defineComponent, h, computed, mergeProps } from 'vue';
import { Surface } from './surface.js';
import { barsField, areaField, lineField } from '../core/charts.js';

// Visually hidden, still in the accessibility tree (the standard sr-only recipe).
const SR_ONLY = {
  position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px',
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: '0',
};

// Accept [numbers] or [{label, value}]; normalize to {label, value} rows with 1-based fallback labels.
function rowsOf(data) {
  return data.map((d, i) =>
    (typeof d === 'number' ? { label: String(i + 1), value: d } : { label: d.label ?? String(i + 1), value: d.value ?? 0 }));
}
const valuesOf = (rows) => rows.map((r) => r.value);
const keyOf = (rows) => rows.map((r) => `${r.label}:${r.value}`).join('|'); // dep signature for re-press

// The accessible representation — read instead of the canvas.
function renderDataTable(rows, caption) {
  return h('table', { style: SR_ONLY }, [
    caption ? h('caption', null, caption) : null,
    h('thead', null, h('tr', null, [h('th', { scope: 'col' }, 'Label'), h('th', { scope: 'col' }, 'Value')])),
    h('tbody', null, rows.map((r, i) => h('tr', { key: i }, [h('th', { scope: 'row' }, r.label), h('td', null, r.value)]))),
  ]);
}

// Dial props shared by both charts — same names/shapes as Surface, forwarded straight through.
const dialProps = {
  screen: { type: String, default: undefined },
  scale: { type: [Number, String], default: undefined },
  r: { type: [Number, String, Function], default: undefined },
  ink: { type: [Number, String], default: undefined },
  roll: { type: [Number, String], default: undefined },
  seed: { type: [Number, String], default: undefined },
  color: { type: String, default: undefined },
};

export const BarChart = defineComponent({
  name: 'BarChart',
  // We merge $attrs ourselves onto the <figure> root, same reasoning as Surface.
  inheritAttrs: false,
  props: {
    data: { type: Array, default: () => [] },
    caption: { type: String, default: undefined },
    max: { type: Number, default: undefined },
    gap: { type: Number, default: undefined },
    ...dialProps,
    h: { type: [Number, String], default: 160 }, // canvas height dial (not the `h()` render fn)
    labels: { type: Boolean, default: true },
    surfaceStyle: { type: [Object, String, Array], default: undefined },
    surfaceClass: { type: [Object, String, Array], default: undefined },
  },
  setup(props, { attrs }) {
    // Memoized on the data signature (not raw `data` identity) — a fresh array with the same values
    // does not force a rebuild; a value change does.
    const rows = computed(() => rowsOf(props.data));
    const sig = computed(() => keyOf(rows.value));
    const field = computed(() => barsField(valuesOf(rows.value), { max: props.max, gap: props.gap }));

    return () => h('figure', mergeProps({ style: { margin: 0 } }, attrs), [
      renderDataTable(rows.value, props.caption),
      h(Surface, {
        field: field.value,
        screen: props.screen, scale: props.scale, r: props.r, ink: props.ink, roll: props.roll,
        seed: props.seed, color: props.color,
        h: props.h,
        deps: [sig.value, props.max, props.gap, props.screen, props.scale, props.r, props.ink, props.roll, props.seed, props.color, props.h],
        class: props.surfaceClass,
        style: props.surfaceStyle,
      }),
      props.labels && rows.value.length
        // Decorative (the table already names each bar); one centered label per column slot.
        ? h('div', {
          'aria-hidden': 'true',
          style: { display: 'grid', gridTemplateColumns: `repeat(${rows.value.length}, 1fr)`, gap: 0 },
        }, rows.value.map((row, i) => h('span', {
          key: i,
          style: { textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, row.label)))
        : null,
    ]);
  },
});

export const LineChart = defineComponent({
  name: 'LineChart',
  inheritAttrs: false,
  props: {
    data: { type: Array, default: () => [] },
    caption: { type: String, default: undefined },
    max: { type: Number, default: undefined },
    area: { type: Boolean, default: false },
    stroke: { type: Number, default: undefined },
    ...dialProps,
    h: { type: [Number, String], default: 160 },
    surfaceStyle: { type: [Object, String, Array], default: undefined },
    surfaceClass: { type: [Object, String, Array], default: undefined },
  },
  setup(props, { attrs }) {
    const rows = computed(() => rowsOf(props.data));
    const sig = computed(() => keyOf(rows.value));
    const field = computed(() => (props.area
      ? areaField(valuesOf(rows.value), { max: props.max })
      : lineField(valuesOf(rows.value), { max: props.max, stroke: props.stroke })));

    return () => h('figure', mergeProps({ style: { margin: 0 } }, attrs), [
      renderDataTable(rows.value, props.caption),
      h(Surface, {
        field: field.value,
        screen: props.screen, scale: props.scale, r: props.r, ink: props.ink, roll: props.roll,
        seed: props.seed, color: props.color,
        h: props.h,
        deps: [sig.value, props.max, props.area, props.stroke, props.screen, props.scale, props.r, props.ink, props.roll, props.seed, props.color, props.h],
        class: props.surfaceClass,
        style: props.surfaceStyle,
      }),
    ]);
  },
});
