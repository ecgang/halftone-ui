// FrameView — one sheet on the stone. The frame div is the studio's interaction surface (select,
// drag, corner-resize); the pressed component inside is display-only (pointer-events: none), so a
// Button frame can never swallow the drag that should move it. Semantics stay honest: every canvas
// under here is the adapter's own aria-hidden decoration, and the frame itself is chrome.

import React, { useEffect, useRef, useState } from 'react';
import { Surface, Text, Image, Button, Meter, Card, BarChart, LineChart } from '../../halftone-kit/react/index.js';
import { FIELDS } from './presets.js';

const MIN = 40; // px, both axes

// The press measures its canvas width at (re)build time; a pure-width resize otherwise leaves the
// old raster stretching in CSS. Remount the body once the width settles (debounced so a live drag
// doesn't remount per pointermove) — a fresh mount re-measures and re-presses crisp.
function useSettledWidthKey(w) {
  const [key, setKey] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => setKey((k) => k + 1), 220);
    return () => clearTimeout(t);
  }, [w]);
  return key;
}

function FrameBody({ frame }) {
  const p = frame.props;
  const dials = { screen: p.screen, scale: p.scale, r: p.r, ink: p.ink, roll: p.roll, seed: p.seed, color: p.color };
  switch (frame.type) {
    case 'surface':
      return (
        <Surface
          field={(FIELDS[p.fieldName] || FIELDS.gradient).fn}
          {...dials} h={frame.h} animate
          deps={[p.fieldName, p.screen, p.scale, p.r, p.ink, p.roll, p.seed, p.color, frame.h]}
        />
      );
    case 'text':
      // Text sizes itself to the wordmark's natural height; no h/seed dials on this sort.
      return <Text text={p.text ?? ''} screen={p.screen} scale={p.scale} r={p.r} ink={p.ink} roll={p.roll} color={p.color} animate />;
    case 'image':
      return <Image src={p.src} {...dials} h={frame.h} animate />;
    case 'button':
      return (
        <Button
          {...dials} tabIndex={-1}
          style={{ width: '100%', height: '100%', border: 0, cursor: 'inherit',
                   font: 'inherit', fontWeight: 600, letterSpacing: '0.03em', color: 'var(--bg)' }}
        >
          {p.label ?? ''}
        </Button>
      );
    case 'meter':
      return (
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Meter value={p.value ?? 0} max={1} {...dials} h={14} style={{ width: '100%' }} />
        </div>
      );
    case 'card':
      return (
        <Card {...dials} style={{ width: '100%', height: '100%', padding: '14px 16px', overflow: 'hidden' }}>
          <h3 style={{ margin: '0 0 6px', font: 'inherit', fontWeight: 700 }}>{p.heading ?? ''}</h3>
          <p style={{ margin: 0, color: 'var(--mut)' }}>{p.body ?? ''}</p>
        </Card>
      );
    case 'barchart':
      return <BarChart data={p.data || []} caption={frame.name} labels={false} {...dials} h={frame.h} />;
    case 'linechart':
      return <LineChart data={p.data || []} area={p.area !== false} caption={frame.name} {...dials} h={frame.h} />;
    default:
      return null;
  }
}

const CORNERS = ['nw', 'ne', 'sw', 'se'];

export function FrameView({ frame, selected, zoom, dispatch }) {
  // One gesture ref serves both move and resize; `last` dedupes so a sub-pixel wiggle that rounds
  // to the same rect never dispatches (a value-identical transient would still fake a history step).
  const gesture = useRef(null);

  const startGesture = (e, corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dispatch({ type: 'select', id: frame.id });
    dispatch({ type: 'begin' });
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { corner, x0: e.clientX, y0: e.clientY, f0: frame, last: null };
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    const dx = (e.clientX - g.x0) / zoom;
    const dy = (e.clientY - g.y0) / zoom;
    const { f0 } = g;
    let patch;
    if (!g.corner) {
      patch = { x: Math.round(f0.x + dx), y: Math.round(f0.y + dy) };
    } else {
      // Corners resize their two edges; the anchored corner stays put (x/y shift by the width the
      // frame actually gained, so the min clamp can't drag the anchor).
      const east = g.corner[1] === 'e', south = g.corner[0] === 's';
      const w = Math.round(Math.max(MIN, f0.w + (east ? dx : -dx)));
      const h = Math.round(Math.max(MIN, f0.h + (south ? dy : -dy)));
      patch = { w, h, x: east ? f0.x : f0.x + (f0.w - w), y: south ? f0.y : f0.y + (f0.h - h) };
    }
    if (g.last && Object.keys(patch).every((k) => patch[k] === g.last[k])) return;
    g.last = patch;
    dispatch({ type: 'transient', id: frame.id, frame: patch });
  };

  const onPointerUp = () => {
    if (!gesture.current) return;
    gesture.current = null;
    dispatch({ type: 'commit' });
  };

  const widthKey = useSettledWidthKey(frame.w);

  return (
    <div
      className={`frame${selected ? ' selected' : ''}`}
      data-frame={frame.id}
      data-type={frame.type}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
      onPointerDown={(e) => startGesture(e, null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* display-only: the studio owns every pointer on the stone */}
      {/* "Replay" presses every LIVE surface via the context registry (app.jsx), so no remount key
          is needed for it — widthKey alone forces the re-measure remount after a resize settles. */}
      <div className="frame-body" key={widthKey}>
        <FrameBody frame={frame} />
      </div>
      {selected && CORNERS.map((c) => (
        <div
          key={c}
          className={`handle ${c}`}
          onPointerDown={(e) => startGesture(e, c)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ))}
    </div>
  );
}
