// Surface — a pressed canvas, the base primitive every other React halftone component is built on.
// It renders a decorative <canvas aria-hidden> and drives it through usePress; the SEMANTICS always
// live in the real DOM the caller wraps around it (a real <button>, <h1>, <img alt>), never in the
// canvas. `field` is the tone contract — (u, v) -> darkness in [0,1] over normalized coords — and
// everything else is a press dial with a context-level default.
//
// The canvas fills its box width and measures its own height (give the element a CSS height, or
// pass `h`). By default it re-presses only when a scalar dial changes; a data-driven surface whose
// `field` closes over changing values should pass an explicit `deps` (e.g. deps={[value]}).

import React, { useRef } from 'react';
import { usePress } from './use-press.js';

export function Surface({
  field,
  screen, scale, r, ink, wash, roll, h, seed, color,
  animate, pressMs,
  deps,
  className, style,
  ...rest
}) {
  const ref = useRef(null);
  const opts = { field, screen, scale, r, ink, wash, roll, h, seed, color, animate, pressMs };
  // Default dep list = the scalar dials. `field` identity is intentionally excluded (it is usually a
  // fresh closure every render); to redraw on data change, drive it through `deps`.
  usePress(ref, opts, deps ?? [screen, scale, r, ink, wash, roll, h, seed, color]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ display: 'block', width: '100%', ...style }}
      {...rest}
    />
  );
}
