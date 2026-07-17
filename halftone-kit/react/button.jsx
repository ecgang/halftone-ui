// Button — a REAL <button> with a decorative pressed-ink fill. Every bit of semantics and a11y comes
// from the native element: type, disabled, focus ring, keyboard activation, and the accessible name
// (the children ARE the label, real text, not a canvas). The halftone is an aria-hidden <Surface>
// painted behind that label — it can never stand in for it (V-10: semantics from the DOM, ink on top).
// Pressing the button ramps the ink in (pressIn), so the click has a physical, plate-pressed feel.
//
//   <Button onClick={submit}>Publish</Button>
//   <Button color="blue" screen="am">Proof</Button>

import React, { useRef } from 'react';
import { Surface } from './surface.jsx';

const SOLID = () => 1; // a full ink plate; the screen supplies the texture, `color` the ink

export function Button({
  children,
  field = SOLID,
  screen, scale, r, ink, wash, roll, seed, color,
  animate = false, pressMs,
  surfaceStyle, surfaceClassName,
  className, style,
  onPointerDown,
  ...rest
}) {
  const press = useRef(null);

  return (
    <button
      className={className}
      style={{ position: 'relative', isolation: 'isolate', ...style }}
      onPointerDown={(e) => { press.current?.pressIn(); onPointerDown?.(e); }}
      {...rest}
    >
      <Surface
        pressRef={press}
        field={field}
        screen={screen} scale={scale} r={r} ink={ink} wash={wash} roll={roll} seed={seed} color={color}
        animate={animate} pressMs={pressMs}
        className={surfaceClassName}
        style={{ position: 'absolute', inset: 0, height: '100%', zIndex: 0, ...surfaceStyle }}
      />
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
    </button>
  );
}
