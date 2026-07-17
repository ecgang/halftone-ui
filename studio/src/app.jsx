// Studio — a Figma-lite workspace where every element is pressed halftone ink. One reducer owns the
// scene; the verified React adapter owns every canvas (we never reimplement pressing). The panels
// are quiet chrome; the ink lives in the frames on the stone.

import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HalftoneProvider, useHalftoneContext } from '../../halftone-kit/react/index.js';
import { reducer, initialState } from './store.js';
import { starterFrame, sanitizeScene, sceneJSX } from './presets.js';
import { Stage } from './stage.jsx';
import { TypeCase, Layers } from './layers.jsx';
import { Inspector } from './inspector.jsx';
import { Topbar } from './topbar.jsx';

// Sets the CSS theme attribute the site's variables key off. Rendered as a CHILD of the provider on
// purpose: React flushes child effects first, so the attribute (and thus every CSS var) has already
// swapped by the time the provider's own effect re-reads the palette from getComputedStyle.
function ThemeSync({ theme }) {
  useEffect(() => { document.documentElement.dataset.mode = theme; }, [theme]);
  return null;
}

function download(name, href, revoke) {
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  if (revoke) URL.revokeObjectURL(href);
}

function Modal({ modal, onClose }) {
  const areaRef = useRef(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { areaRef.current?.focus(); }, []);
  const copy = async () => {
    const text = modal.text;
    try { await navigator.clipboard.writeText(text); } catch (e) {
      areaRef.current?.select();
      try { document.execCommand('copy'); } catch (e2) { /* clipboard denied; the text is selected */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={modal.title}>
        <h2>{modal.title}</h2>
        <textarea ref={areaRef} readOnly value={modal.text} data-modal-text />
        <div className="row">
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function StudioBody({ state, dispatch }) {
  const ctx = useHalftoneContext();
  const stageRef = useRef(null);
  const spaceRef = useRef(false);
  const [modal, setModal] = useState(null);
  const stateRef = useRef(state); stateRef.current = state;
  const modalRef = useRef(modal); modalRef.current = modal;

  const selected = state.frames.find((f) => f.id === state.selectedId) || null;

  // "Replay" — re-run the press-in on every live surface via the context registry. The engine
  // itself honors prefers-reduced-motion (pressIn snaps to rest under it), so no extra guard here.
  useEffect(() => {
    if (state.replayTick) ctx.surfaces.forEach((s) => s.pressIn());
  }, [ctx, state.replayTick]);

  // Space = pan mode (cursor + the stage's capture-phase pan). Skipped while a control has focus so
  // space still activates buttons and types spaces.
  useEffect(() => {
    const dn = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (e.target.closest?.('input, textarea, select, button')) return;
      spaceRef.current = true;
      document.body.classList.add('pan');
      e.preventDefault();
    };
    const up = (e) => {
      if (e.code !== 'Space') return;
      spaceRef.current = false;
      document.body.classList.remove('pan');
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // Global shortcuts. State is read through a ref so the handler registers once.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const editing = !!(t.closest?.('input, textarea, select') || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const s = stateRef.current;
      const key = e.key;
      if (mod && key.toLowerCase() === 'z') {
        if (editing) return; // leave text-field undo to the browser
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && key.toLowerCase() === 'd') {
        if (editing || !s.selectedId) return;
        e.preventDefault();
        dispatch({ type: 'duplicate', id: s.selectedId });
      } else if (key === 'Escape') {
        if (modalRef.current) setModal(null);
        else if (editing) t.blur?.();
        else dispatch({ type: 'select', id: null });
      } else if (!editing && (key === 'Delete' || key === 'Backspace') && s.selectedId) {
        e.preventDefault();
        dispatch({ type: 'remove', id: s.selectedId });
      } else if (!editing && s.selectedId && key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const f = s.frames.find((x) => x.id === s.selectedId);
        if (!f) return;
        const dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0;
        const dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0;
        dispatch({ type: 'patch', id: f.id, frame: { x: f.x + dx, y: f.y + dy } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  // Add a sort at the current center of the visible bed.
  const onAdd = (type) => {
    const el = stageRef.current;
    const { camera } = stateRef.current;
    const cx = el ? (el.clientWidth / 2 - camera.x) / camera.zoom : 0;
    const cy = el ? (el.clientHeight / 2 - camera.y) / camera.zoom : 0;
    const frame = starterFrame(type, cx, cy);
    if (frame) dispatch({ type: 'add', frame });
  };

  const onProof = () => {
    const s = stateRef.current;
    const f = s.frames.find((x) => x.id === s.selectedId);
    if (!f) return;
    const canvas = document.querySelector(`[data-frame="${f.id}"] canvas`);
    if (!canvas) return;
    download(`proof-${f.name.replace(/[^\w-]+/g, '-').toLowerCase()}.png`, canvas.toDataURL('image/png'));
  };

  const onCode = () => {
    const s = stateRef.current;
    const frames = s.selectedId ? s.frames.filter((f) => f.id === s.selectedId) : s.frames;
    setModal({ title: s.selectedId ? 'Code — selected frame' : 'Code — whole stone', text: sceneJSX(frames) });
  };

  const onData = () => {
    const blob = new Blob(
      [JSON.stringify({ app: 'halftone-studio', version: 1, frames: stateRef.current.frames }, null, 2)],
      { type: 'application/json' },
    );
    download('studio-scene.json', URL.createObjectURL(blob), true);
  };

  const onImport = async (file) => {
    try {
      const frames = sanitizeScene(JSON.parse(await file.text()));
      if (!frames) throw new Error('no frames array');
      dispatch({ type: 'import', frames });
    } catch (err) {
      setModal({ title: 'Import failed', text: `Could not read that scene: ${err.message || err}` });
    }
  };

  return (
    <div className="studio">
      <Topbar state={state} dispatch={dispatch} onProof={onProof} onCode={onCode} onData={onData} onImport={onImport} />
      <div className="main">
        <aside className="panel left" aria-label="Type case and layers">
          <TypeCase onAdd={onAdd} highlight={state.frames.length === 0} />
          <Layers frames={state.frames} selectedId={state.selectedId} dispatch={dispatch} />
        </aside>
        <Stage state={state} dispatch={dispatch} stageRef={stageRef} spaceRef={spaceRef} />
        <aside className="panel right" aria-label="Inspector">
          <Inspector frame={selected} dispatch={dispatch} />
        </aside>
      </div>
      {modal && <Modal modal={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  return (
    <HalftoneProvider mode={state.theme}>
      <ThemeSync theme={state.theme} />
      <StudioBody state={state} dispatch={dispatch} />
    </HalftoneProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
