// Text — a wordmark pressed into halftone. It rasterises the type once (via the core's textField)
// and reads it back as a tone field, exactly as the docs masthead does: the raster is built at the
// canvas's own CSS width, so the raw press point p.x/p.y ARE raster pixels and the sample lines up
// with no scaling. The canvas height follows the wordmark's natural height (pushed through the
// press as `h`), so the type never distorts. Re-rasterises when the width (or the type) changes.
//
// The REAL heading is the caller's job — wrap a visually-hidden <h1>{text}</h1> beside this. The
// canvas is aria-hidden decoration.

import React, { useEffect, useRef } from 'react';
import { textField } from '../core/index.js';
import { usePress } from './use-press.js';
import { useHalftoneContext } from './context.jsx';

export function Text({
  text,
  screen, scale, r, ink, wash, roll, color,
  animate, pressMs,
  className, style,
  ...rest
}) {
  const ctx = useHalftoneContext();
  const ref = useRef(null);
  const raster = useRef(null);   // { sample, H, cell } — filled at first rasterise
  const width = useRef(0);       // last width we rasterised at
  const inited = useRef(false);

  // Stable, point-based field: sample the wordmark at the raw canvas point (raster space == canvas
  // space). Identity never changes, so usePress won't rebuild on it — we drive redraws explicitly
  // after each rasterise. Returns 0 (blank) until the first raster lands.
  const field = useRef((u, v, p) => {
    const R = raster.current;
    return R ? R.sample(p.x, p.y, R.cell) : 0;
  }).current;

  // animate is handled here (post-raster), not by usePress — a press-in at mount would animate the
  // still-empty field and finish before the type exists.
  const press = usePress(
    ref,
    { field, screen, scale, r, ink, wash, roll, color, pressMs },
    [screen, scale, r, ink, wash, roll, color],
  );

  // (re)rasterise at a CSS width, then push the wordmark's natural height so the canvas aspect
  // matches and the sample coordinates line up. `h` is a geometry key → set() rebuilds and redraws.
  const rasterize = (w) => {
    if (!w || typeof document === 'undefined') return;
    const cell = (r ?? 2.5) * 0.8 * (scale ?? ctx.grain.scale); // FM grid pitch (px), matches grainPts
    const { H, sample } = textField(text, Math.round(w), () => document.createElement('canvas'));
    raster.current = { sample, H, cell: cell * 0.5 };           // sample radius = half a cell (docs)
    const firstRaster = width.current === 0;
    width.current = w;
    press.set({ h: H });
    if (animate && firstRaster) press.pressIn();
  };

  // Track width (browser only). Falls back to a one-shot measure where ResizeObserver is absent.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof ResizeObserver === 'undefined') { rasterize(el.clientWidth); return undefined; }
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== width.current) rasterize(w);
    });
    ro.observe(el);
    if (el.clientWidth) rasterize(el.clientWidth); // observe() may not deliver an initial frame in time
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-rasterise when the type or a cell-affecting dial changes, at the current width. Skips mount
  // (the width effect above already rasterised once).
  useEffect(() => {
    if (!inited.current) { inited.current = true; return; }
    if (width.current) rasterize(width.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, scale, r]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ display: 'block', width: '100%', ...style }}
      {...rest}
      aria-hidden="true" // after {...rest} so it can't be overridden — the canvas is always decorative
    />
  );
}
