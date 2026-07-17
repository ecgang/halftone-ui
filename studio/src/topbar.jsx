// Top bar — the press controls. "Roll a press" is the hero: one click re-rolls seed + roll +
// screen on the selection (or the whole stone when nothing is selected). Everything here is plain
// chrome: real buttons with disabled states, no ink.

import React, { useRef } from 'react';

export function Topbar({ state, dispatch, onProof, onCode, onData, onImport }) {
  const { selectedId, past, future, theme, frames } = state;
  const fileRef = useRef(null);

  return (
    <header className="topbar">
      <div className="brand">halftone<i>·studio</i></div>

      <button type="button" id="roll-press" className="hero" onClick={() => dispatch({ type: 'roll', id: selectedId })}
        disabled={!frames.length}
        title={selectedId ? 'Re-roll the selected frame' : 'Re-roll every frame'}>
        Roll a press
      </button>
      <button type="button" id="replay" onClick={() => dispatch({ type: 'replay' })} disabled={!frames.length}
        title="Re-run the press-in on every visible frame">
        Replay
      </button>

      <div className="spacer" />

      <div className="group" role="group" aria-label="History">
        <button type="button" id="undo" onClick={() => dispatch({ type: 'undo' })} disabled={!past.length}>Undo</button>
        <button type="button" id="redo" onClick={() => dispatch({ type: 'redo' })} disabled={!future.length}>Redo</button>
      </div>

      <div className="group" role="group" aria-label="Export">
        <button type="button" id="export-proof" onClick={onProof} disabled={!selectedId} title="Download the selected frame's ink as a PNG">
          Proof (PNG)
        </button>
        <button type="button" id="export-code" onClick={onCode} disabled={!frames.length}>Code (JSX)</button>
        <button type="button" id="export-data" onClick={onData} disabled={!frames.length}>Data (JSON)</button>
        <button type="button" id="import-data" onClick={() => fileRef.current?.click()}>Import</button>
        <input
          ref={fileRef} type="file" accept=".json,application/json" hidden
          aria-label="Import a scene JSON"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImport(file);
          }}
        />
      </div>

      <button
        type="button" id="theme-toggle"
        aria-pressed={theme === 'light'}
        onClick={() => dispatch({ type: 'theme', theme: theme === 'dark' ? 'light' : 'dark' })}
      >
        {theme === 'dark' ? '☀ Paper' : '☾ Night'}
      </button>
    </header>
  );
}
