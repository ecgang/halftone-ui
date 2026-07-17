// usePress — THE core<->Vue bridge, and the whole reason blockers 1 and 5 die in a component tree.
// The caller owns the element (a template ref); this composable mounts a press onto THAT element, so
// the engine never scans the DOM for its canvases (blocker 5). On unmount it calls handle.destroy(),
// which drops the surface out of the context registry (blocker 1 — the leak the docs engine could
// never fix because its surfaces pushed themselves into a module global and nothing removed them).
//
//   const el = ref(null);
//   const press = usePress(el, () => ({ field, screen: 'stipple' }), () => [screen]);
//   h('canvas', { ref: el })
//
// `getOpts` is a thunk, not a plain object — it is called fresh every time opts are needed (mount,
// and each push), so a caller can close over live reactive state without usePress ever going stale.
// `watchSources` is a Vue watch source (getter/array/ref) controlling when live prop changes are
// pushed to the surface via handle.set(); mount already applied the initial opts, so the first watch
// firing is skipped by relying on Vue's default lazy `watch` (no `immediate`).

import { onMounted, onBeforeUnmount, watch } from 'vue';
import { resolvePress, mount } from '../core/index.js';
import { useHalftoneContext } from './context.js';

export function usePress(elRef, getOpts = () => ({}), watchSources = () => []) {
  const ctx = useHalftoneContext();
  let handle = null;

  // Mount once per (context, element). mount() reads elRef.value directly — no DOM lookup.
  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    const opts = getOpts();
    handle = mount(el, resolvePress(opts, ctx), ctx);
    if (opts.animate) handle.pressIn();
  });

  onBeforeUnmount(() => {
    handle?.destroy();
    handle = null;
  });

  // Push live updates on source change. Vue's `watch` (without `immediate`) never fires on setup —
  // only on a subsequent change — so mount's initial apply is naturally not double-applied.
  watch(watchSources, () => {
    if (!handle) return;
    // Only forward keys the caller actually set; an `undefined` would clobber a resolved default
    // (Object.assign(spec, {screen: undefined}) blanks the screen).
    const o = getOpts(), patch = {};
    for (const k in o) if (o[k] !== undefined) patch[k] = o[k];
    handle.set(patch);
  });

  // A stable handle facade — safe to call before mount (each method no-ops until the surface exists).
  return {
    get current() { return handle; },
    set: (patch) => handle?.set(patch),
    rebuild: () => handle?.rebuild(),
    pressIn: (ms) => handle?.pressIn(ms),
    proof: () => handle?.proof() ?? null,
  };
}
