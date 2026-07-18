// The standard sr-only recipe: visually hidden, still in the accessibility tree. Shared so the
// call sites (chart.js, meter.js, and any future one) can't drift from each other again — meter.js
// carried a raw CSS string with the same recipe while chart.js carried this object form before this
// file existed. Vue's style binding accepts either shape; the object form is canon here so there is
// exactly one representation per framework. The React equivalent (numeric-valued, since React
// inline styles want numbers for px-valued properties) lives in ../react/_a11y.js.
export const SR_ONLY = {
  position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px',
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: '0',
};
