// Card — a real container (its element, role, and every child are ordinary DOM) resting on a
// decorative pressed backdrop. The <Surface> is an aria-hidden whisper of ink behind the content;
// none of the card's meaning lives in the canvas (V-10). Default backdrop is a low, sparse tone so
// it reads as pressed paper, not a filled block — tune it with `field`, `color`, `screen`, `ink`.
//
//   <Card><h3>Plate registration</h3><p>…</p></Card>
//   <Card as="article" screen="lines" color="blue">…</Card>

import React from 'react';
import { Surface } from './surface.jsx';

const WHISPER = () => 0.12; // a light constant tone -> small/sparse dots, a paper-grain backdrop

export function Card({
  children,
  field = WHISPER,
  screen, scale, r, ink, wash, roll, seed, color,
  as: Tag = 'div',
  surfaceStyle, surfaceClassName,
  className, style,
  ...rest
}) {
  return (
    <Tag
      className={className}
      style={{ position: 'relative', isolation: 'isolate', ...style }}
      {...rest}
    >
      <Surface
        field={field}
        screen={screen} scale={scale} r={r} ink={ink} wash={wash} roll={roll} seed={seed} color={color}
        className={surfaceClassName}
        style={{ position: 'absolute', inset: 0, height: '100%', zIndex: 0, ...surfaceStyle }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </Tag>
  );
}
