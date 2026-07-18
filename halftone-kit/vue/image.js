// Image — any raster re-printed as tone. It loads the source once, cover-fits it into a small
// luminance grid, and reads that grid back as the press field: dark ink where the photo is dark
// (tone = (1 - luminance)^gamma * gain), exactly as the docs portrait does. Retheme and it re-inks
// itself, because the ink color is resolved lazily by the press, not baked into these samples.
//
// The canvas is aria-hidden decoration — give the picture a real accessible element (a visually
// hidden <img alt> or a labelled <figure>) alongside it. By default the canvas takes the image's
// own aspect ratio so nothing distorts; pass `h` to pin a height instead (the docs behavior).

import { defineComponent, h, ref, mergeProps, onMounted, onBeforeUnmount, watch } from 'vue';
import { usePress } from './use-press.js';
import { dialPropsNoSeed } from './_props.js';

export const Image = defineComponent({
  name: 'Image',
  inheritAttrs: false,
  props: {
    src: { type: String, default: undefined },
    gamma: { type: Number, default: 1.3 },
    gain: { type: Number, default: 1.35 },
    resolution: { type: Number, default: 160 },
    ...dialPropsNoSeed,
    wash: { type: [Number, String], default: undefined },
    h: { type: [Number, String], default: undefined }, // canvas height dial (not the `h()` render fn)
    animate: { type: Boolean, default: undefined },
    pressMs: { type: Number, default: undefined },
  },
  setup(props, { attrs }) {
    const el = ref(null);
    const lum = ref(null); // { data: Float32Array, gw, gh }

    // Stable field: sample the luminance grid at the normalized point. 0 (blank) until the load lands.
    // gamma/gain are read live off props so a dial change repaints without re-sampling the grid.
    const field = (u, v) => {
      const L = lum.value;
      if (!L) return 0;
      const gx = Math.min(L.gw - 1, Math.max(0, Math.floor(u * L.gw)));
      const gy = Math.min(L.gh - 1, Math.max(0, Math.floor(v * L.gh)));
      return Math.pow(1 - L.data[gy * L.gw + gx], props.gamma) * props.gain;
    };

    const getOpts = () => ({
      field, screen: props.screen, scale: props.scale, r: props.r, ink: props.ink,
      wash: props.wash, roll: props.roll, h: props.h, color: props.color, pressMs: props.pressMs,
    });
    const watchSource = () => [
      props.screen, props.scale, props.r, props.ink, props.wash, props.roll, props.h, props.color,
    ];

    const press = usePress(el, getOpts, watchSource);

    // Load + rasterise luminance (browser only). Cover-fit into a grid sized to `resolution` on the
    // long side at the image's own aspect, so grid aspect == display aspect == no distortion. Returns
    // a cancel function; the caller invalidates the PRIOR in-flight load before starting a new one so
    // a stale load can never publish over a newer one.
    const load = () => {
      let cancelled = false;
      const cancel = () => { cancelled = true; };

      // A source change must NEVER keep showing the old image. Drop the prior luminance and rebuild
      // to a blank field FIRST, before any early return — so removing the src (falsy), an SSR/no-Image
      // environment, or a slow/errored/CORS-tainted new load all leave the surface blank rather than
      // displaying stale (possibly sensitive) prior content.
      lum.value = null;
      press.rebuild();
      if (typeof document === 'undefined' || !props.src || typeof window.Image !== 'function') {
        return cancel;
      }
      const img = new window.Image();
      img.crossOrigin = 'anonymous'; // allow getImageData when the host sends CORS headers
      const fail = () => { if (cancelled) return; lum.value = null; press.rebuild(); };
      img.onerror = fail; // broken/removed src -> blank, not stale
      img.onload = () => {
        if (cancelled) return;
        const resolution = props.resolution;
        const ar = (img.width / img.height) || 1;
        const gw = ar >= 1 ? resolution : Math.max(1, Math.round(resolution * ar));
        const gh = ar >= 1 ? Math.max(1, Math.round(resolution / ar)) : resolution;
        const oc = document.createElement('canvas'); oc.width = gw; oc.height = gh;
        const g = oc.getContext('2d', { willReadFrequently: true });
        const sc = Math.max(gw / img.width, gh / img.height);
        g.drawImage(img, (gw - img.width * sc) / 2, (gh - img.height * sc) / 2, img.width * sc, img.height * sc);
        let d;
        try { d = g.getImageData(0, 0, gw, gh).data; } catch (e) { fail(); return; } // CORS-tainted → blank, not stale
        const data = new Float32Array(gw * gh);
        for (let i = 0; i < gw * gh; i++) {
          const j = i * 4;
          // Composite over paper (luminance 1) by alpha, THEN take luminance. Canvas returns (0,0,0,0)
          // for transparent pixels, so without this a transparent region reads as luminance 0 -> max
          // tone -> a solid black halo. Compositing makes transparent -> luminance 1 -> tone 0 -> no
          // ink (the page shows through); opaque pixels (a=1) are unchanged, so photos are unaffected.
          const a = d[j + 3] / 255;
          const rgb = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
          data[i] = rgb * a + (1 - a);
        }
        lum.value = { data, gw, gh };
        const node = el.value;
        if (node && props.h == null) node.style.aspectRatio = String(ar); // undistorted unless caller pinned h
        press.rebuild();
        if (props.animate) press.pressIn();
      };
      img.src = props.src;
      return cancel;
    };

    let unload = null;
    onMounted(() => { unload = load(); });
    watch(() => [props.src, props.resolution], () => { unload?.(); unload = load(); });
    onBeforeUnmount(() => { unload?.(); });

    // gamma/gain change the tone, not the geometry — draw() repaints without re-running the Poisson
    // point sampling that rebuild() would (field reads props live).
    watch(() => [props.gamma, props.gain], () => { press.draw(); });

    return () => h('canvas', mergeProps(
      { style: 'display:block;width:100%' },
      attrs,
      // AFTER the $attrs merge so it can't be overridden: the canvas is decorative, always.
      { ref: el, 'aria-hidden': 'true' },
    ));
  },
});
