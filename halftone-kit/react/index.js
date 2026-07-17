// @halftone-ui/react — the framework adapter. A thin, copy-in (degit/shadcn-style) layer over the
// framework-free ../core: a provider that owns one press context, the usePress bridge, and the
// pressed-canvas primitives. React authors JSX; the consumer's own bundler compiles this folder.
//
// v1 slice: Provider + usePress + Surface + Text + Image + Button/Meter/Card (Surface + real DOM +
// a11y). The chart family is the next P3 slice.

export { HalftoneProvider, useHalftoneContext, HalftoneContext } from './context.jsx';
export { usePress } from './use-press.js';
export { Surface } from './surface.jsx';
export { Text } from './text.jsx';
export { Image } from './image.jsx';
export { Button } from './button.jsx';
export { Meter } from './meter.jsx';
export { Card } from './card.jsx';
