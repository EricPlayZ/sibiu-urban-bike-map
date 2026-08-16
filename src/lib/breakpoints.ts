/**
 * Desktop topbar vs mobile dock.
 *
 * Keep every `@media` in `src/styles/app.css` in lockstep with these values.
 * CSS cannot use `var()` in media queries, so the px numbers are duplicated
 * there with a pointer back to this file.
 *
 * 900px ≈ phone landscape / a 863px-wide map canvas. Wider than that stays
 * desktop: one topbar row (icon-only tools below DESKTOP_TOOL_LABELS_MIN_WIDTH_PX,
 * sideways scroll if they still overflow) — never a second tools row under panels.
 */
export const DESKTOP_MIN_WIDTH_PX = 900;
export const MOBILE_MAX_WIDTH_PX = DESKTOP_MIN_WIDTH_PX - 1;

/** Tool chips show Romanian labels from this width up. Below: icon-only + title. */
export const DESKTOP_TOOL_LABELS_MIN_WIDTH_PX = 1360;

export const DESKTOP_MEDIA = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;
export const MOBILE_MEDIA = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

export function isDesktopViewport() {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MEDIA).matches;
}

export function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MEDIA).matches;
}
