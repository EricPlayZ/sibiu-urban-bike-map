import { describe, expect, it } from "vitest";
import { filterByQuery } from "./listSearch";

const schools = [
  { slug: "goga", name: 'Colegiul Național "Octavian Goga"' },
  { slug: "nr-5", name: "Școala Gimnazială nr. 5" },
  { slug: "noica", name: 'Liceul Teoretic "Constantin Noica"' },
];

describe("filterByQuery", () => {
  it("returns the full list when the query is blank", () => {
    expect(filterByQuery(schools, "  ")).toEqual(schools);
  });

  it("matches Romanian names case-insensitively", () => {
    expect(filterByQuery(schools, "goga").map((s) => s.slug)).toEqual(["goga"]);
    expect(filterByQuery(schools, "ȘCOALA").map((s) => s.slug)).toEqual(["nr-5"]);
  });

  it("also matches slugs", () => {
    expect(filterByQuery(schools, "nr-5").map((s) => s.slug)).toEqual(["nr-5"]);
  });
});
