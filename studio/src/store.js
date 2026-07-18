// Studio store — one useReducer for the whole scene. Frames are plain serializable objects (the
// scene IS the export format), so nothing in here may hold a closure or a DOM node; Surface fields
// are stored as preset NAMES and resolved at render time (presets.js).
//
// History model: `past`/`future` hold whole frames-array snapshots (frames are immutable, so a
// snapshot is one array reference — cheap). Discrete edits (`patch`, add, remove, …) push history
// themselves. Continuous gestures (drag, resize, slider scrubs) run begin -> transient* -> commit:
// `begin` parks the pre-gesture frames in `pending`, `transient` mutates freely with NO history,
// and `commit` pushes the parked snapshot once — so a 300-event drag costs one undo step.

import { grainCost } from '../../halftone-kit/core/screens.js';

export const SCREENS = ['stipple', 'lines', 'waves', 'hatch', 'am'];
const HISTORY_MAX = 64;

let idTick = 0;
export const newId = () => `f${Date.now().toString(36)}${(idTick += 1)}`;

export function initialState() {
  return {
    frames: [],            // [{ id, type, name, x, y, w, h, visible, props }] — render order = z-order
    selectedId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    theme: 'dark',
    replayTick: 0,         // bumping it re-presses every live surface (App effect); not undoable
    past: [], future: [],
    pending: null,         // frames snapshot parked by `begin`, consumed by `commit`
  };
}

const cap = (arr) => (arr.length > HISTORY_MAX ? arr.slice(arr.length - HISTORY_MAX) : arr);
// An undoable step: the CURRENT frames go into the past, the future dies, any open gesture is voided.
const step = (state, frames, extra = {}) =>
  ({ ...state, ...extra, frames, past: cap([...state.past, state.frames]), future: [], pending: null });
const withFrame = (frames, id, fn) => frames.map((f) => (f.id === id ? fn(f) : f));

// Geometry bounds shared by EVERY mutation path — every action that writes frame geometry
// (add, import, patch, transient, duplicate) passes boundGeom before the frame enters state, so
// nothing upstream (a panned-out camera feeding starterFrame, a caller skipping sanitizeScene)
// can land out-of-range geometry. Frame dimensions reach the canvas backing store and the Poisson
// allocator (ceil(w/cell)*ceil(h/cell) Int32Array), so an unbounded W is a terabyte allocation
// whichever door it came through. Non-finite values (NaN/Infinity) fall to safe defaults rather
// than passing through Math.min/max as NaN.
export const GEOM = { MIN_DIM: 40, MAX_DIM: 4096, MAX_POS: 100000 };
const lim = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
export const boundGeom = (f) => ({
  ...f,
  x: lim(f.x, -GEOM.MAX_POS, GEOM.MAX_POS, 0), y: lim(f.y, -GEOM.MAX_POS, GEOM.MAX_POS, 0),
  w: lim(f.w, GEOM.MIN_DIM, GEOM.MAX_DIM, GEOM.MIN_DIM), h: lim(f.h, GEOM.MIN_DIM, GEOM.MAX_DIM, GEOM.MIN_DIM),
});
const applyPatch = (f, a) => boundGeom({ ...f, ...(a.frame || {}), props: { ...f.props, ...(a.props || {}) } });

// Work accounting shared by scene ADMISSION (sanitizeScene charges imported frames) and the
// roll MUTATION below. One frame's generation cost at the pitch the press will actually use
// (spec r*0.8*scale), estimated by core's own grainCost so it can't drift from the generator.
export const frameCost = (f, screen) =>
  grainCost(f.w, f.h, (f.props.r ?? 2.5) * 0.8 * (f.props.scale ?? 1), screen ?? f.props.screen ?? 'stipple');
// Two worst legal frames' worth — computed from the estimator, not a constant.
export const MAX_WORK = 2 * grainCost(GEOM.MAX_DIM, GEOM.MAX_DIM, 1 * 0.8 * 0.4, 'hatch');

// "Roll a press" — the slot machine. Seed drives the entrance transient, roll the RESTING geometry
// (core: restSeed = base + off + roll), so roll MUST land on a new value or the frame would not
// re-seed. The screen must land on a DIFFERENT screen too: on a solid/binary field (button, meter,
// bars) the line/hatch/am geometries are rng-insensitive — every point inks regardless of jitter —
// so a re-roll that kept the screen could change nothing visible and the hero button would feel dead.
// `remaining` is the scene work budget still unspent: a global roll re-screens EVERY frame in one
// click, and on thin geometry the lattice families cost ~6x what am does, so an admitted
// near-budget scene could amplify well past MAX_WORK. The new screen is drawn from the candidates
// that fit; when none fit, the cheapest different screen (the contract still holds, and the
// overshoot is bounded by one frame's cost).
function rolled(f, remaining) {
  const others = SCREENS.filter((s) => s !== (f.props.screen ?? 'stipple'));
  const fits = others.filter((s) => frameCost(f, s) <= remaining);
  const pool = fits.length ? fits
    : [others.reduce((a, b) => (frameCost(f, a) <= frameCost(f, b) ? a : b))];
  let roll;
  do { roll = 1 + Math.floor(Math.random() * 99999); } while (roll === (f.props.roll ?? 0));
  return {
    ...f,
    props: {
      ...f.props,
      seed: 1 + Math.floor(Math.random() * 99999),
      roll,
      screen: pool[Math.floor(Math.random() * pool.length)],
    },
  };
}

export function reducer(state, a) {
  switch (a.type) {
    // ---- undoable, discrete ----
    case 'add': return step(state, [...state.frames, boundGeom(a.frame)], { selectedId: a.frame.id });
    case 'patch': return step(state, withFrame(state.frames, a.id, (f) => applyPatch(f, a)));
    case 'remove':
      return step(state, state.frames.filter((f) => f.id !== a.id),
        { selectedId: state.selectedId === a.id ? null : state.selectedId });
    case 'duplicate': {
      const src = state.frames.find((f) => f.id === a.id);
      if (!src) return state;
      const copy = boundGeom({ ...src, id: newId(), x: src.x + 16, y: src.y + 16, name: `${src.name} copy`, props: { ...src.props } });
      return step(state, [...state.frames, copy], { selectedId: copy.id });
    }
    case 'rename': return step(state, withFrame(state.frames, a.id, (f) => ({ ...f, name: a.name })));
    case 'visible': return step(state, withFrame(state.frames, a.id, (f) => ({ ...f, visible: !f.visible })));
    case 'reorder': {
      const i = state.frames.findIndex((f) => f.id === a.id);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= state.frames.length) return state;
      const frames = [...state.frames];
      [frames[i], frames[j]] = [frames[j], frames[i]];
      return step(state, frames);
    }
    case 'roll': {
      // Sequential accounting: frames not being rolled keep charging their current cost, and
      // each rolled frame spends from what's left.
      const target = (f) => a.id == null || f.id === a.id;
      let remaining = MAX_WORK - state.frames.reduce((s, f) => s + (target(f) ? 0 : frameCost(f)), 0);
      return step(state, state.frames.map((f) => {
        if (!target(f)) return f;
        const nf = rolled(f, remaining);
        remaining -= frameCost(nf);
        return nf;
      }));
    }
    case 'import': return step(state, a.frames.map(boundGeom), { selectedId: null });

    // ---- gestures: one history entry for the whole stroke ----
    case 'begin': return state.pending ? state : { ...state, pending: state.frames };
    case 'transient': return { ...state, frames: withFrame(state.frames, a.id, (f) => applyPatch(f, a)) };
    case 'commit': {
      if (!state.pending) return state;
      if (state.pending === state.frames) return { ...state, pending: null }; // nothing moved
      return { ...state, past: cap([...state.past, state.pending]), future: [], pending: null };
    }

    // ---- not undoable ----
    case 'select': return state.selectedId === a.id ? state : { ...state, selectedId: a.id };
    case 'camera': return { ...state, camera: a.camera };
    case 'theme': return { ...state, theme: a.theme };
    case 'replay': return { ...state, replayTick: state.replayTick + 1 };

    case 'undo': {
      if (!state.past.length) return state;
      const frames = state.past[state.past.length - 1];
      return {
        ...state, frames,
        past: state.past.slice(0, -1),
        future: [state.frames, ...state.future],
        // a restored scene may no longer contain the selection (undo of add/duplicate)
        selectedId: frames.some((f) => f.id === state.selectedId) ? state.selectedId : null,
        pending: null,
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const frames = state.future[0];
      return {
        ...state, frames,
        past: cap([...state.past, state.frames]),
        future: state.future.slice(1),
        selectedId: frames.some((f) => f.id === state.selectedId) ? state.selectedId : null,
        pending: null,
      };
    }
    default: return state;
  }
}
