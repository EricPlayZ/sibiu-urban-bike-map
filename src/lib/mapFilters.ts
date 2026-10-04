/**
 * Stradă în filtrul de cartiere.
 * Fără cartier rămâne vizibilă (nu e „în afara” unei selecții).
 * Lista goală înseamnă niciun cartier bifat, nu „toate”.
 */
export function streetMatchesNeighborhood(cartier: string, selected: ReadonlySet<string>) {
  const slug = cartier.trim();
  return !slug || selected.has(slug);
}

/**
 * Clădire în filtrul de cartiere.
 * Fără cartier, sau în afara tuturor poligoanelor, rămâne vizibilă:
 * închiderea unui cartier ascunde doar clădirile din acel cartier.
 */
export function buildingMatchesNeighborhood(
  cartier: string | null | undefined,
  hasCartier: boolean,
  selected: readonly string[],
  _allSlugs: readonly string[] = []
) {
  if (!hasCartier) return true;
  const slug = String(cartier ?? "").trim();
  if (!slug) return true;
  return selected.includes(slug);
}

/** Aceeași regulă, ca filtru MapLibre. */
export function buildingLayerFilter(selected: readonly string[], _allSlugs: readonly string[], typeExpr: unknown[]) {
  const slugs = [...selected, ""];
  return [
    "all",
    typeExpr,
    ["any", ["!", ["has", "cartier"]], ["in", ["get", "cartier"], ["literal", slugs]]],
  ];
}
