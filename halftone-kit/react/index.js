// @halftone-ui/react — the framework adapter. A thin, copy-in (degit/shadcn-style) layer over the
// framework-free ../core: a provider that owns one press context, the usePress bridge, and the
// pressed-canvas primitives. React authors JSX; the consumer's own bundler compiles this folder.
//
// v1 slice: Provider + usePress + Surface + Text. Image (luminance), Button/Meter/Card (Surface +
// real DOM + a11y) and the chart family are the next P3 slices.

export { HalftoneProvider, useHalftoneContext, HalftoneContext } from './context.jsx';
export { usePress } from './use-press.js';
export { Surface } from './surface.jsx';
export { Text } from './text.jsx';
