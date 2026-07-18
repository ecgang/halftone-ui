// The seven press dial props shared verbatim across every Vue component that forwards straight
// through to <Surface>: same names, same shapes, no component-specific behavior attached. Spread
// this into a component's `props` object rather than re-declaring the shapes inline — chart.js was
// already doing this ad hoc (dialProps, declared locally); this file is that pattern promoted so
// every component uses ONE definition. Components with a dial the others lack (`wash`) or a prop
// this set doesn't cover (`h`, `value`, `text`, `src`, `as`, `data`, …) keep those declared locally.
//
// NOTE: `screen`, `scale`, `r`, `ink`, `roll`, `seed`, `color` only — Text and Image deliberately do
// NOT accept `seed` in either adapter (Text has no seed-affected geometry to reseed; Image samples a
// fixed luminance grid), so they are NOT spread with this set — adding `seed` to their prop schema
// would be an observable API change, not just a dedup.
export const dialProps = {
  screen: { type: String, default: undefined },
  scale: { type: [Number, String], default: undefined },
  r: { type: [Number, String, Function], default: undefined },
  ink: { type: [Number, String], default: undefined },
  roll: { type: [Number, String], default: undefined },
  seed: { type: [Number, String], default: undefined },
  color: { type: String, default: undefined },
};

// Text and Image: same six dials, minus `seed` (see note above — neither adapter accepts it today).
// Derived from `dialProps` rather than re-declared, so the shapes can never drift from the canon set.
const { seed: _seed, ...dialPropsNoSeed } = dialProps;
export { dialPropsNoSeed };
