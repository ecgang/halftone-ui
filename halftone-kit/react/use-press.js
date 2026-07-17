// usePress — THE core<->React bridge, and the whole reason blockers 1 and 5 die in a component
// tree. The caller owns the element (a ref); this hook mounts a press onto THAT element, so the
// engine never scans the DOM for its canvases (blocker 5). On unmount it calls handle.destroy(),
// which drops the surface out of the context registry (blocker 1 — the leak the docs engine could
// never fix because its surfaces pushed themselves into a module global and nothing removed them).
//
//   const ref = useRef(null);
//   const press = usePress(ref, { field, screen: 'stipple' }, [screen]);
//   <canvas ref={ref} />
//
// `deps` is a useEffect-style dependency list controlling when live prop changes are pushed to the
// surface via handle.set(). The latest opts are always read (an internal ref tracks them), so a
// change in `deps` applies whatever the current field/dials are — including a fresh field closure.

import { useEffect, useMemo, useRef } from 'react';
import { resolvePress, mount } from '../core/index.js';
import { useHalftoneContext } from './context.jsx';

export function usePress(ref, opts = {}, deps = []) {
  const ctx = useHalftoneContext();
  const handleRef = useRef(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Mount once per (context, element). mount() reads ref.current directly — no DOM lookup.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const handle = mount(el, resolvePress(optsRef.current, ctx), ctx);
    handleRef.current = handle;
    if (optsRef.current.animate) handle.pressIn();
    return () => { handle.destroy(); handleRef.current = null; };
    // ref is a stable ref object; opts are read live via optsRef; only ctx should force a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // Push live updates on dep change. Skip the first run — mount already applied the initial opts.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = handleRef.current;
    if (!h) return;
    // Only forward keys the caller actually set; an `undefined` would clobber a resolved default
    // (Object.assign(spec, {screen: undefined}) blanks the screen).
    const o = optsRef.current, patch = {};
    for (const k in o) if (o[k] !== undefined) patch[k] = o[k];
    h.set(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // A stable handle facade — safe to call before mount (each method no-ops until the surface exists).
  return useMemo(() => ({
    get current() { return handleRef.current; },
    set: (patch) => handleRef.current?.set(patch),
    rebuild: () => handleRef.current?.rebuild(),
    pressIn: (ms) => handleRef.current?.pressIn(ms),
    proof: () => handleRef.current?.proof() ?? null,
  }), []);
}
