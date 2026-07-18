// The standard sr-only recipe: visually hidden, still in the accessibility tree. Shared so the
// four call sites (chart.jsx, meter.jsx, and any future one) can't drift from each other again —
// this exact object had already diverged (numeric vs string vs raw-CSS-string) before this file
// existed. React inline styles want numbers for px-valued properties, so this is the numeric form;
// the Vue equivalent (string-valued, since Vue's style binding wants CSS strings) lives in
// ../vue/_a11y.js — same recipe, different shape per framework's style API.
export const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
};
