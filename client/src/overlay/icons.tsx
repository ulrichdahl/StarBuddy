import type { ReactElement, SVGProps } from "react";

/**
 * Overlay window control glyphs — 24-px grid, 1.5-px strokes, currentColor.
 * Filled shapes mean "where on the screen", line-only shapes mean "the window".
 * Source of truth for the design: the "Window modes" artifact.
 */

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": true } as const;

/** Free window; drag anywhere. Design 1. */
export const FloatingIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 3h10.5L22 6.5V14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="2 2.2"/><path d="M2 8h11.5L17 11.5V21H2z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M2 12.5h15" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
);

/** Pinned to the left edge; drag up and down. */
export const DockLeftIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><rect x="2" y="4" width="7" height="16" rx="1" fill="currentColor" stroke="none"/><path d="M15 9.5v5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="1 1.5" opacity=".6"/>
  </svg>
);

/** Pinned to the right edge; drag up and down. */
export const DockRightIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><rect x="15" y="4" width="7" height="16" rx="1" fill="currentColor" stroke="none"/><path d="M9 9.5v5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="1 1.5" opacity=".6"/>
  </svg>
);

/** Strip along the top edge; drag left and right. */
export const DockTopIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><rect x="6" y="4" width="12" height="6" rx="1" fill="currentColor" stroke="none"/>
  </svg>
);

/** Strip along the bottom edge; drag left and right. */
export const DockBottomIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><rect x="6" y="14" width="12" height="6" rx="1" fill="currentColor" stroke="none"/>
  </svg>
);

/** Everything the window has: title, header area, body, actions. */
export const FullIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 3h15l3 3v15H3z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M3 8h18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M6.5 12h11M6.5 15.5h8M6.5 19h5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
);

/** Per-window transparency; opens a slider, remembered for that window. */
export const OpacityIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 3h15l3 3v15H3z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M3 21L21 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M3 21V3h15L3 21z" fill="currentColor" stroke="none" opacity=".35"/>
  </svg>
);

/** Hide the window until its next trigger (new scan, new status update). */
export const CloseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
);

/** Title bar plus the first box only. */
export const MinimalIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 6h15l3 3v9H3z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M3 11h18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><rect x="6.5" y="13.5" width="7" height="2.5" rx=".5" fill="currentColor" stroke="none"/>
  </svg>
);

/** Screen with five zones — the placement picker's own glyph. */
export const PickerIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/><path d="M7 4v16M17 4v16M7 8.5h10M7 15.5h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round" opacity=".55"/><rect x="10" y="10.25" width="4" height="3.5" fill="currentColor" stroke="none"/>
  </svg>
);

export type PlacementMode = "floating" | "dock-left" | "dock-top" | "dock-right" | "dock-bottom";
export const PLACEMENT_ICONS: Record<PlacementMode, (p: P) => ReactElement> = {
  floating: FloatingIcon,
  "dock-left": DockLeftIcon,
  "dock-top": DockTopIcon,
  "dock-right": DockRightIcon,
  "dock-bottom": DockBottomIcon,
};
