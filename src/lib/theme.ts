import type { BasemapId } from "./space";

export type UiTheme = "light" | "dark" | "system";

const KEY = "ubr_ui_theme";

export function loadUiTheme(): UiTheme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function saveUiTheme(theme: UiTheme) {
  localStorage.setItem(KEY, theme);
}

export function resolveTheme(theme: UiTheme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

/** Aplică data-theme pe <html> + theme-color meta. */
export function applyDocumentTheme(theme: UiTheme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0c1410" : "#f4f1ea");
  return resolved;
}

/** Basemap light/dark aliniat cu tema UI. Nu forțează satellite. */
export function basemapForTheme(resolved: "light" | "dark", current: BasemapId): BasemapId | null {
  if (current === "satellite") return null;
  const next: BasemapId = resolved === "dark" ? "dark" : "light";
  return next === current ? null : next;
}

export function defaultBasemapForTheme(theme: UiTheme): BasemapId {
  return resolveTheme(theme) === "dark" ? "dark" : "light";
}
