// Inspector — bound to the selection. Every control is a real labelled input dispatching through
// the store, so each edit is undoable and flows straight back into the pressed component's props.
// Sliders scrub through the gesture channel (begin/transient/commit) so a scrub is ONE undo step;
// text and number fields commit whole values on blur/Enter.

import React, { useEffect, useRef, useState } from 'react';
import { SCREENS } from './store.js';
import { FIELDS } from './presets.js';

// Palette names the provider fills from the page's CSS vars (context.jsx), plus `fore` (--ink).
const SWATCHES = [
  ['fore', 'var(--ink)'], ['blue', 'var(--blue)'], ['green', 'var(--green)'],
  ['purple', 'var(--purple)'], ['pink', 'var(--pink)'], ['orange', 'var(--orange)'],
  ['red', 'var(--red)'], ['grey', 'var(--grey)'],
];

function NumberField({ id, label, value, onCommit, step = 1, min, max }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value, id]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setV(String(value));
  };
  return (
    <label className="field num">
      <span>{label}</span>
      <input
        id={id} type="number" value={v} step={step} min={min} max={max}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </label>
  );
}

function TextField({ id, label, value, onCommit }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value, id]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <label className="field text">
      <span>{label}</span>
      <input
        id={id} type="text" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </label>
  );
}

// A press dial. `input` events flow as transients behind one `begin`; the NATIVE `change` event
// (mouse release / each keyboard step) commits. React's synthetic onChange is useless for the
// commit — React re-fires it on every input event for range sliders, which would push one history
// entry per pointermove — so the commit listens to the real DOM event via a ref instead. Keyboard
// steps therefore cost one undo step apiece, a pointer scrub exactly one total.
function Dial({ id, label, value, min, max, step, frameId, prop, dispatch, fmt = (x) => x }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const commit = () => dispatch({ type: 'commit' });
    el.addEventListener('change', commit); // native change: fires on release, NOT per input
    return () => el.removeEventListener('change', commit);
  }, [dispatch]);
  const send = (v) => {
    dispatch({ type: 'begin' });
    dispatch({ type: 'transient', id: frameId, props: { [prop]: v } });
  };
  return (
    <label className="field dial">
      <span>{label} <em>{fmt(value)}</em></span>
      <input
        ref={ref}
        id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => send(Number(e.target.value))}
      />
    </label>
  );
}

function SortProps({ frame, dispatch }) {
  const p = frame.props;
  const patch = (props) => dispatch({ type: 'patch', id: frame.id, props });
  switch (frame.type) {
    case 'surface':
      return (
        <label className="field">
          <span>Field</span>
          <select id="insp-field" value={p.fieldName} onChange={(e) => patch({ fieldName: e.target.value })}>
            {Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
        </label>
      );
    case 'text':
      return <TextField id="insp-text" label="Text" value={p.text} onCommit={(text) => patch({ text })} />;
    case 'image':
      return <TextField id="insp-src" label="Image src" value={p.src} onCommit={(src) => patch({ src })} />;
    case 'button':
      return <TextField id="insp-label" label="Label" value={p.label} onCommit={(label) => patch({ label })} />;
    case 'meter':
      return (
        <Dial id="insp-value" label="Value" value={p.value ?? 0} min={0} max={1} step={0.01}
          frameId={frame.id} prop="value" dispatch={dispatch} fmt={(x) => x.toFixed(2)} />
      );
    case 'card':
      return (
        <>
          <TextField id="insp-heading" label="Heading" value={p.heading} onCommit={(heading) => patch({ heading })} />
          <TextField id="insp-body" label="Body" value={p.body} onCommit={(body) => patch({ body })} />
        </>
      );
    case 'barchart':
    case 'linechart':
      return (
        <TextField
          id="insp-data" label="Data" value={(p.data || []).join(', ')}
          onCommit={(s) => {
            const data = s.split(/[,\s]+/).map(Number).filter(Number.isFinite);
            if (data.length) patch({ data });
          }}
        />
      );
    default: return null;
  }
}

export function Inspector({ frame, dispatch }) {
  if (!frame) {
    return (
      <div className="inspector" data-inspector>
        <h2>Inspector</h2>
        <p className="hint">Select a frame on the stone to set its dials.</p>
      </div>
    );
  }
  const p = frame.props;
  const geom = (patch) => dispatch({ type: 'patch', id: frame.id, frame: patch });
  const prop = (props) => dispatch({ type: 'patch', id: frame.id, props });

  return (
    <div className="inspector" data-inspector>
      <h2>{frame.name}</h2>

      <h3>Position</h3>
      <div className="grid2">
        <NumberField id="insp-x" label="X" value={frame.x} onCommit={(x) => geom({ x: Math.round(x) })} />
        <NumberField id="insp-y" label="Y" value={frame.y} onCommit={(y) => geom({ y: Math.round(y) })} />
        <NumberField id="insp-w" label="W" value={frame.w} min={40} onCommit={(w) => geom({ w: Math.max(40, Math.round(w)) })} />
        <NumberField id="insp-h" label="H" value={frame.h} min={40} onCommit={(h) => geom({ h: Math.max(40, Math.round(h)) })} />
      </div>

      <h3>Sort</h3>
      <SortProps frame={frame} dispatch={dispatch} />

      <h3>Press</h3>
      <label className="field">
        <span>Screen</span>
        <select id="insp-screen" value={p.screen ?? 'stipple'} onChange={(e) => prop({ screen: e.target.value })}>
          {SCREENS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <Dial id="insp-scale" label="Scale" value={p.scale ?? 1} min={0.4} max={2.4} step={0.05}
        frameId={frame.id} prop="scale" dispatch={dispatch} fmt={(x) => x.toFixed(2)} />
      <Dial id="insp-r" label="Pitch r" value={p.r ?? 2.5} min={1} max={6} step={0.1}
        frameId={frame.id} prop="r" dispatch={dispatch} fmt={(x) => x.toFixed(1)} />
      <Dial id="insp-ink" label="Ink" value={p.ink ?? 1} min={0.3} max={2} step={0.05}
        frameId={frame.id} prop="ink" dispatch={dispatch} fmt={(x) => x.toFixed(2)} />

      <div className="field">
        <span id="swatch-label">Ink color</span>
        <div className="swatches" role="group" aria-labelledby="swatch-label">
          {SWATCHES.map(([name, css]) => (
            <button
              key={name} type="button"
              className={`swatch${(p.color ?? 'fore') === name ? ' on' : ''}`}
              style={{ background: css }}
              aria-label={`Ink: ${name}`}
              aria-pressed={(p.color ?? 'fore') === name}
              onClick={() => prop({ color: name })}
            />
          ))}
        </div>
      </div>

      <div className="grid2">
        <NumberField id="insp-seed" label="Seed" value={p.seed ?? 0} onCommit={(seed) => prop({ seed: Math.round(seed) })} />
        <NumberField id="insp-roll" label="Roll" value={p.roll ?? 0} onCommit={(roll) => prop({ roll: Math.round(roll) })} />
      </div>
      <button type="button" id="insp-die" className="die" onClick={() => dispatch({ type: 'roll', id: frame.id })}>
        ⚄ Roll this frame
      </button>
    </div>
  );
}
