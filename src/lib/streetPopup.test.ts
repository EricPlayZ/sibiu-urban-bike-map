import { describe, expect, it } from "vitest";
import { buildingPopupHtml, streetPopupHtml } from "./streetPopup";

const schools: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [24.15, 45.79] },
      properties: { slug: "pedagogic", denumire: "Colegiul Național Pedagogic 'Andrei Șaguna'" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [24.16, 45.79] },
      properties: { slug: "noica", denumire: "Liceul Teoretic 'Constantin Noica'" },
    },
  ],
};

describe("streetPopupHtml", () => {
  it("lists assigned schools as separate names, not a comma-joined blob", () => {
    const html = streetPopupHtml({ name: "Bulevardul Mihai Viteazul", arondat: "pedagogic,noica" }, schools);
    expect(html).toContain("mp-school-names");
    expect(html.match(/class="mp-school-name"/g)?.length).toBe(2);
    expect(html).toContain("Colegiul Național Pedagogic");
    expect(html).toContain("Constantin Noica");
    expect(html).not.toMatch(/Șaguna',\s*Liceul/);
  });
});

describe("buildingPopupHtml", () => {
  it("puts the legend name in Tip, and maps leftover bloc to 4 etaje", () => {
    const casa = buildingPopupHtml("casa");
    expect(casa).toMatch(/mp-value">Casă individuală</);
    expect(casa).not.toContain("Casă unifamilială");
    expect(buildingPopupHtml("casa_multi")).toMatch(/mp-value">Casă cu mai multe locuințe</);
    expect(buildingPopupHtml("bloc_4")).toMatch(/mp-value">Bloc 4 etaje</);
    expect(buildingPopupHtml("bloc_10")).toMatch(/mp-value">Bloc 10 etaje</);
    expect(buildingPopupHtml("bloc")).toMatch(/mp-value">Bloc 4 etaje</);
    expect(buildingPopupHtml("apartments")).toMatch(/mp-value">Necunoscut</);
  });
});
