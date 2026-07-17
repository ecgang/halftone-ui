// @halftone-ui/vue — the framework adapter. A thin, copy-in (degit/shadcn-style) layer over the
// framework-free ../core: a provider that owns one press context, the usePress bridge, and the
// pressed-canvas primitives. Authored as plain defineComponent + h() render functions — no .vue
// SFCs, no build step — the consumer's own bundler compiles this folder as-is.
//
// slice 1 (this file): Provider + useHalftoneContext + usePress + Surface.
// Text/Image/Button/Meter/Card/BarChart/LineChart land in the next slice — declared here already
// so call sites can settle on the final import shape early; importing them before they exist is a
// module-resolution error, same as the React barrel would give.

export { HalftoneProvider, useHalftoneContext, HALFTONE_KEY } from './context.js';
export { usePress } from './use-press.js';
export { Surface } from './surface.js';
export { Text } from './text.js';
export { Image } from './image.js';
export { Button } from './button.js';
export { Meter } from './meter.js';
export { Card } from './card.js';
export { BarChart, LineChart } from './chart.js';
