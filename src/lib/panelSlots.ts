/** Panouri care stau în același colț și se înlocuiesc între ele. */
export const RIGHT_SLOT = ["filtersOpen", "basemapOpen", "themeOpen", "statsOpen", "editsOpen"] as const;

/**
 * Pe telefon importul stă și el deasupra dock-ului, deci înlocuiește panoul din dreapta.
 * Pe desktop importul e în stânga și rămâne deschis.
 */
export const MOBILE_SLOT = [...RIGHT_SLOT, "importReportOpen"] as const;

export type DockPanel =
  | (typeof MOBILE_SLOT)[number]
  | "editsOpen"
  | "csvEditorOpen"
  | "searchOpen";

export function dockPanelPatch(opening: DockPanel, currentlyOpen: boolean, mobile: boolean): Partial<Record<DockPanel, boolean>> {
  if (currentlyOpen) return { [opening]: false };
  const slot = mobile ? MOBILE_SLOT : RIGHT_SLOT;
  const shares = (slot as readonly string[]).includes(opening);
  const patch: Partial<Record<DockPanel, boolean>> = { [opening]: true };
  if (!shares) return patch;
  for (const id of slot) {
    if (id !== opening) patch[id] = false;
  }
  return patch;
}
