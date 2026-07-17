// Left panel: the type case (add palette) and the stone's layer list. All chrome — real buttons,
// real inputs, no ink. The layer list mirrors z-order top-first (frames render in array order, so
// the LAST frame sits on top and heads the list); ▲ raises toward the top of the pile.

import React, { useEffect, useState } from 'react';
import { CASES } from './presets.js';

export function TypeCase({ onAdd, highlight }) {
  return (
    <section className={`typecase${highlight ? ' glow' : ''}`} aria-label="Type case">
      <h2>Type case</h2>
      <div className="sorts">
        {CASES.map((c) => (
          <button key={c.type} type="button" data-add={c.type} onClick={() => onAdd(c.type)}>
            <i aria-hidden="true">{c.glyph}</i>
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// Editable name — local while typing, committed (one undo step) on blur/Enter.
function NameField({ frame, dispatch }) {
  const [v, setV] = useState(frame.name);
  useEffect(() => { setV(frame.name); }, [frame.name, frame.id]);
  const commit = () => {
    const name = v.trim();
    if (name && name !== frame.name) dispatch({ type: 'rename', id: frame.id, name });
    else setV(frame.name);
  };
  return (
    <input
      className="name"
      value={v}
      aria-label={`Name of ${frame.name}`}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export function Layers({ frames, selectedId, dispatch }) {
  const glyph = Object.fromEntries(CASES.map((c) => [c.type, c.glyph]));
  const rows = [...frames].reverse(); // top of the pile first
  return (
    <section className="layers" aria-label="Layers">
      <h2>Stone</h2>
      {rows.length === 0 && <p className="hint">Nothing on the stone yet.</p>}
      <ul>
        {rows.map((f) => (
          <li
            key={f.id}
            data-layer={f.id}
            className={f.id === selectedId ? 'selected' : ''}
            // Clicking anywhere on the row EXCEPT the action buttons selects the frame — including
            // the name input (it spans most of the row; Figma-style, click-to-select then edit).
            onPointerDown={(e) => { if (!e.target.closest('button')) dispatch({ type: 'select', id: f.id }); }}
          >
            <i className="glyph" aria-hidden="true">{glyph[f.type]}</i>
            <NameField frame={f} dispatch={dispatch} />
            <button
              type="button"
              className="eye"
              aria-pressed={f.visible}
              aria-label={`${f.visible ? 'Hide' : 'Show'} ${f.name}`}
              onClick={() => dispatch({ type: 'visible', id: f.id })}
            >
              {f.visible ? '◉' : '○'}
            </button>
            <button type="button" aria-label={`Raise ${f.name}`} onClick={() => dispatch({ type: 'reorder', id: f.id, dir: +1 })}>▲</button>
            <button type="button" aria-label={`Lower ${f.name}`} onClick={() => dispatch({ type: 'reorder', id: f.id, dir: -1 })}>▼</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
