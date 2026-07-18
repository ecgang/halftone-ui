// BarChart / LineChart — data-driven pressed surfaces, same V-10 stance as Button/Meter/Card: the
// DATA lives in a REAL, accessible <table> (visually hidden but in the a11y tree, with a <caption>),
// and the halftone is a decorative aria-hidden <Surface>. Screen readers read the numbers; sighted
// readers read ink. The chart GEOMETRY is the framework-free core (../core/charts.js) — pure fields
// a Vue adapter reuses unchanged. `data` is an array of numbers or {label, value} objects.
//
//   <BarChart data={[4, 9, 6, 3]} caption="Impressions by week" color="blue" />
//   <LineChart data={[{label:'Jan', value:12}, …]} area caption="Ink-up over time" />

import React from 'react';
import { Surface } from './surface.jsx';
import { barsField, areaField, lineField } from '../core/charts.js';
import { SR_ONLY } from './_a11y.js';

// Accept [numbers] or [{label, value}]; normalize to {label, value} rows with 1-based fallback labels.
function rowsOf(data) {
  return data.map((d, i) =>
    (typeof d === 'number' ? { label: String(i + 1), value: d } : { label: d.label ?? String(i + 1), value: d.value ?? 0 }));
}
const valuesOf = (rows) => rows.map((r) => r.value);
const keyOf = (rows) => rows.map((r) => `${r.label}:${r.value}`).join('|'); // dep signature for re-press

// The accessible representation — read instead of the canvas. A <figure> wraps it + the surface.
function DataTable({ rows, caption }) {
  return (
    <table style={SR_ONLY}>
      {caption ? <caption>{caption}</caption> : null}
      <thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}><th scope="row">{r.label}</th><td>{r.value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function BarChart({
  data = [], caption, max, gap,
  screen, scale, r, ink, roll, seed, color,
  h = 160, labels = true,
  surfaceStyle, surfaceClassName,
  className, style,
  ...rest
}) {
  const rows = rowsOf(data);
  const sig = keyOf(rows);
  const field = React.useMemo(() => barsField(valuesOf(rows), { max, gap }), [sig, max, gap]);

  return (
    <figure className={className} style={{ margin: 0, ...style }} {...rest}>
      <DataTable rows={rows} caption={caption} />
      <Surface
        field={field}
        screen={screen} scale={scale} r={r} ink={ink} roll={roll} seed={seed} color={color}
        h={h}
        deps={[sig, max, gap, screen, scale, r, ink, roll, seed, color, h]}
        className={surfaceClassName}
        style={surfaceStyle}
      />
      {labels && rows.length ? (
        // Decorative (the table already names each bar); one centered label per column slot.
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, 1fr)`, gap: 0 }}>
          {rows.map((row, i) => (
            <span key={i} style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

export function LineChart({
  data = [], caption, max, area = false, stroke,
  screen, scale, r, ink, roll, seed, color,
  h = 160,
  surfaceStyle, surfaceClassName,
  className, style,
  ...rest
}) {
  const rows = rowsOf(data);
  const sig = keyOf(rows);
  const field = React.useMemo(
    () => (area ? areaField(valuesOf(rows), { max }) : lineField(valuesOf(rows), { max, stroke })),
    [sig, max, area, stroke],
  );

  return (
    <figure className={className} style={{ margin: 0, ...style }} {...rest}>
      <DataTable rows={rows} caption={caption} />
      <Surface
        field={field}
        screen={screen} scale={scale} r={r} ink={ink} roll={roll} seed={seed} color={color}
        h={h}
        deps={[sig, max, area, stroke, screen, scale, r, ink, roll, seed, color, h]}
        className={surfaceClassName}
        style={surfaceStyle}
      />
    </figure>
  );
}
