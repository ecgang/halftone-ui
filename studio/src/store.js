// Studio store — one useReducer for the whole scene. Frames are plain serializable objects (the
// scene IS the export format), so nothing in here may hold a closure or a DOM node; Surface fields
// are stored as preset NAMES and resolved at render time (presets.js).
//
// History model: `past`/`future` hold whole frames-array snapshots (frames are immutable, so a
// snapshot is one array reference — cheap). Discrete edits (`patch`, add, remove, …) push history
// themselves. Continuous gestures (drag, resize, slider scrubs) run begin -> transient* -> commit:
// `begin` parks the pre-gesture frames in `pending`, `transient` mutates freely with NO history,
// and `commit` pushes the parked snapshot once — so a 300-event drag costs one undo step.

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
const applyPatch = (f, a) => ({ ...f, ...(a.frame || {}), props: { ...f.props, ...(a.props || {}) } });

// "Roll a press" — the slot machine. Seed drives the entrance transient, roll the RESTING geometry
// (core: restSeed = base + off + roll), so roll MUST land on a new value or the frame would not
// re-seed. The screen must land on a DIFFERENT screen too: on a solid/binary field (button, meter,
// bars) the line/hatch/am geometries are rng-insensitive — every point inks regardless of jitter —
// so a re-roll that kept the screen could change nothing visible and the hero button would feel dead.
function rolled(f) {
  const others = SCREENS.filter((s) => s !== (f.props.screen ?? 'stipple'));
  let roll;
  do { roll = 1 + Math.floor(Math.random() * 99999); } while (roll === (f.props.roll ?? 0));
  return {
    ...f,
    props: {
      ...f.props,
      seed: 1 + Math.floor(Math.random() * 99999),
      roll,
      screen: others[Math.floor(Math.random() * others.length)],
    },
  };
}

export function reducer(state, a) {
  switch (a.type) {
    // ---- undoable, discrete ----
    case 'add': return step(state, [...state.frames, a.frame], { selectedId: a.frame.id });
    case 'patch': return step(state, withFrame(state.frames, a.id, (f) => applyPatch(f, a)));
    case 'remove':
      return step(state, state.frames.filter((f) => f.id !== a.id),
        { selectedId: state.selectedId === a.id ? null : state.selectedId });
    case 'duplicate': {
      const src = state.frames.find((f) => f.id === a.id);
      if (!src) return state;
      const copy = { ...src, id: newId(), x: src.x + 16, y: src.y + 16, name: `${src.name} copy`, props: { ...src.props } };
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
    case 'roll':
      return step(state, state.frames.map((f) => (a.id == null || f.id === a.id ? rolled(f) : f)));
    case 'import': return step(state, a.frames, { selectedId: null });

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
