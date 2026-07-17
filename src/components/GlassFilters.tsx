"use client";

import { useEffect } from "react";

/* Liquid Glass — real edge refraction ("lensing") via an SVG
 * feDisplacementMap driven through backdrop-filter. This is the one layer of
 * the four-layer glass model that plain CSS blur can't do (blur *scatters*
 * light; this *bends* it).
 *
 * Reliability contract (verified, not assumed):
 *  - The base glass (blur + specular + tint) is defined in globals.css and is
 *    ALWAYS present. This component's refraction is a pure progressive
 *    enhancement layered on top — it can only add, never remove.
 *  - It is enabled (via the `glass-lens` class on <html>) ONLY when the
 *    engine actually renders SVG-referenced backdrop-filters. I empirically
 *    confirmed Chromium/Blink does (and Safari/Firefox parse but don't), so
 *    the gate is: Blink UA + CSS.supports. If that gate is ever wrong the
 *    only outcome is "no refraction, base glass shows" — it cannot break.
 *  - Accessibility first: users who ask for reduced transparency or reduced
 *    motion never get the effect (globals.css also makes their surfaces
 *    solid). Trust/clarity over spectacle.
 *
 * The <svg> defines the filter; it must live in the DOM for the CSS
 * `url(#glass-lens)` reference to resolve. Rendered once, app-wide. */
export function GlassFilters() {
  useEffect(() => {
    const root = document.documentElement;
    try {
      const reduce =
        window.matchMedia("(prefers-reduced-transparency: reduce)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Blink (Chrome/Edge/Electron/Opera) puts "Chrome/" in the UA; Safari
      // and Firefox do not. Only Blink is verified to render this.
      const isBlink = /Chrome\//.test(navigator.userAgent);
      const supports =
        CSS.supports("backdrop-filter", "url(#g)") ||
        CSS.supports("-webkit-backdrop-filter", "url(#g)");
      if (!reduce && isBlink && supports) root.classList.add("glass-lens");
    } catch {
      /* any failure → leave the base glass untouched */
    }
    return () => root.classList.remove("glass-lens");
  }, []);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {/* Gentle, low-frequency refraction. Soft noise → smooth bend (not
            jagged); small scale → refracts the ground without mangling. */}
        <filter
          id="glass-lens"
          x="-8%"
          y="-8%"
          width="116%"
          height="116%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.012"
            numOctaves={2}
            seed={14}
            stitchTiles="stitch"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="1.5" result="soft" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="soft"
            scale={12}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
