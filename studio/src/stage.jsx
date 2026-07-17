// Stage — the press bed ("the stone"). Frames live in one transformed world layer
// (translate + scale, origin 0 0); the camera is plain state, never a canvas library.
//
// Pointer rules: space+drag or middle-drag pans (captured BEFORE frames see the pointer, so a pan
// started over a frame pans instead of dragging it); ctrl/cmd+wheel zooms toward the cursor;
// a bare two-finger wheel pans. The wheel listener is attached manually with { passive: false } —
// React's synthetic wheel is passive and preventDefault would be ignored, letting the page rubber-band.

import React, { useEffect, useRef } from 'react';
import { FrameView } from './frames.jsx';

const ZMIN = 0.15, ZMAX = 4;
const clampZ = (z) => Math.max(ZMIN, Math.min(ZMAX, z));

export function Stage({ state, dispatch, stageRef, spaceRef }) {
  const { frames, selectedId, camera } = state;
  const camRef = useRef(camera); camRef.current = camera;
  const pan = useRef(null);

  const setCamera = (camera) => dispatch({ type: 'camera', camera });

  // Zoom keeping the world point under `cx,cy` (stage-local px) fixed on screen.
  const zoomAt = (cx, cy, factor) => {
    const c = camRef.current;
    const z = clampZ(c.zoom * factor);
    if (z === c.zoom) return;
    const k = z / c.zoom;
    setCamera({ x: cx - (cx - c.x) * k, y: cy - (cy - c.y) * k, zoom: z });
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // pinch-zoom arrives as ctrl+wheel; exp keeps trackpad and wheel steps proportional
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0022));
      } else {
        const c = camRef.current;
        setCamera({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture-phase pan: runs before any frame's own pointerdown, and stopPropagation keeps the
  // frame from starting a drag underneath the pan.
  const onPointerDownCapture = (e) => {
    if (e.button !== 1 && !(e.button === 0 && spaceRef.current)) return;
    e.preventDefault();
    e.stopPropagation();
    const c = camRef.current;
    pan.current = { x0: e.clientX, y0: e.clientY, cx: c.x, cy: c.y };
    stageRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const p = pan.current;
    if (!p) return;
    setCamera({ ...camRef.current, x: p.cx + (e.clientX - p.x0), y: p.cy + (e.clientY - p.y0) });
  };
  const onPointerEnd = () => { pan.current = null; };

  // A press on the bare bed (not a frame, not a control) drops the selection.
  const onPointerDown = (e) => {
    if (e.target.closest('[data-frame], .zoomctl')) return;
    dispatch({ type: 'select', id: null });
  };

  const fit = () => {
    const el = stageRef.current;
    if (!el || !frames.length) { setCamera({ x: 0, y: 0, zoom: 1 }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of frames) {
      x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y);
      x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h);
    }
    const vw = el.clientWidth, vh = el.clientHeight;
    const z = clampZ(Math.min(vw / Math.max(1, x1 - x0) * 0.85, vh / Math.max(1, y1 - y0) * 0.85, 1.5));
    setCamera({ x: vw / 2 - ((x0 + x1) / 2) * z, y: vh / 2 - ((y0 + y1) / 2) * z, zoom: z });
  };

  const zoomCenter = (factor) => {
    const el = stageRef.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  };

  return (
    <div
      className="stage"
      ref={stageRef}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className="world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {frames.map((f) => (f.visible ? (
          <FrameView key={f.id} frame={f} selected={f.id === selectedId} zoom={camera.zoom} dispatch={dispatch} />
        ) : null))}
      </div>

      {frames.length === 0 && (
        <div className="empty" data-empty>
          <p><b>The stone is empty.</b></p>
          <p>Pick a sort from the type case, then roll a press.</p>
        </div>
      )}

      <div className="zoomctl" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomCenter(1 / 1.25)} aria-label="Zoom out">−</button>
        <span className="zpct" aria-live="polite">{Math.round(camera.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomCenter(1.25)} aria-label="Zoom in">+</button>
        <button type="button" onClick={fit}>Fit</button>
        <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>Reset</button>
      </div>
    </div>
  );
}
