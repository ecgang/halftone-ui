// Image — any raster re-printed as tone. It loads the source once, cover-fits it into a small
// luminance grid, and reads that grid back as the press field: dark ink where the photo is dark
// (tone = (1 - luminance)^gamma * gain), exactly as the docs portrait does. Retheme and it re-inks
// itself, because the ink color is resolved lazily by the press, not baked into these samples.
//
// The canvas is aria-hidden decoration — give the picture a real accessible element (a visually
// hidden <img alt> or a labelled <figure>) alongside it. By default the canvas takes the image's
// own aspect ratio so nothing distorts; pass `h` to pin a height instead (the docs behavior).

import React, { useEffect, useRef } from 'react';
import { usePress } from './use-press.js';

export function Image({
  src,
  gamma = 1.3, gain = 1.35, resolution = 160,
  screen, scale, r, ink, wash, roll, h,
  animate, pressMs,
  className, style,
  ...rest
}) {
  const ref = useRef(null);
  const lum = useRef(null);       // { data: Float32Array, gw, gh }
  const gammaRef = useRef(gamma); gammaRef.current = gamma;
  const gainRef = useRef(gain); gainRef.current = gain;

  // Stable field: sample the luminance grid at the normalized point. 0 (blank) until the load lands.
  const field = useRef((u, v) => {
    const L = lum.current;
    if (!L) return 0;
    const gx = Math.min(L.gw - 1, Math.max(0, Math.floor(u * L.gw)));
    const gy = Math.min(L.gh - 1, Math.max(0, Math.floor(v * L.gh)));
    return Math.pow(1 - L.data[gy * L.gw + gx], gammaRef.current) * gainRef.current;
  }).current;

  const press = usePress(
    ref,
    { field, screen, scale, r, ink, wash, roll, h, pressMs },
    [screen, scale, r, ink, wash, roll, h],
  );

  // Load + rasterise luminance (browser only). Cover-fit into a grid sized to `resolution` on the
  // long side at the image's own aspect, so grid aspect == display aspect == no distortion.
  useEffect(() => {
    if (typeof document === 'undefined' || !src || typeof window.Image !== 'function') return undefined;
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';   // allow getImageData when the host sends CORS headers
    img.onload = () => {
      if (cancelled) return;
      const ar = (img.width / img.height) || 1;
      const gw = ar >= 1 ? resolution : Math.max(1, Math.round(resolution * ar));
      const gh = ar >= 1 ? Math.max(1, Math.round(resolution / ar)) : resolution;
      const oc = document.createElement('canvas'); oc.width = gw; oc.height = gh;
      const g = oc.getContext('2d', { willReadFrequently: true });
      const sc = Math.max(gw / img.width, gh / img.height);
      g.drawImage(img, (gw - img.width * sc) / 2, (gh - img.height * sc) / 2, img.width * sc, img.height * sc);
      let d;
      try { d = g.getImageData(0, 0, gw, gh).data; } catch (e) { return; } // CORS-tainted → stay blank
      const data = new Float32Array(gw * gh);
      for (let i = 0; i < gw * gh; i++) {
        data[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
      }
      lum.current = { data, gw, gh };
      const el = ref.current;
      if (el && h == null) el.style.aspectRatio = String(ar); // undistorted unless caller pinned h
      press.rebuild();
      if (animate) press.pressIn();
    };
    img.src = src;
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, resolution]);

  // gamma/gain change the tone, not the geometry — a plain redraw (field reads the refs live).
  useEffect(() => { press.rebuild(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gamma, gain]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ display: 'block', width: '100%', ...style }}
      {...rest}
    />
  );
}
