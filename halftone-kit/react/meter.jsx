// Meter — a REAL <progress> carries the value, the max, and the accessible readout; assistive tech
// gets a native progressbar with the true numbers. The visible bar is an aria-hidden <Surface> whose
// ink fills from the left to value/max, so sighted users read the same quantity in halftone. Nothing
// about the measurement lives in the canvas (V-10). The native <progress> is visually hidden, not
// removed — it stays in the a11y tree.
//
//   <Meter value={0.72} />            // 0..1
//   <Meter value={430} max={500} />   // any range

import React from 'react';
import { Surface } from './surface.jsx';

// Visually hidden, still in the accessibility tree (the standard sr-only recipe).
const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};

export function Meter({
  value = 0, max = 1,
  screen, scale, r, ink, wash, roll, seed, color,
  h = 12,
  surfaceStyle, surfaceClassName,
  className, style,
  ...rest
}) {
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  // A hard fill edge at `frac`: full ink to its left, empty to its right. `field` is not a geometry
  // key, so a value change repaints the same grid rather than re-seeding it — the dots hold still and
  // only the fill boundary moves.
  const field = React.useCallback((u) => (u <= frac ? 1 : 0), [frac]);

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <progress value={value} max={max} style={SR_ONLY} {...rest} />
      <Surface
        field={field}
        screen={screen} scale={scale} r={r} ink={ink} wash={wash} roll={roll} seed={seed} color={color}
        h={h}
        deps={[frac, screen, scale, r, ink, wash, roll, seed, color, h]}
        className={surfaceClassName}
        style={surfaceStyle}
      />
    </div>
  );
}
