import { describe, expect, it } from "vitest";
import { distPointToLineString, distPointToSegment } from "./mapHit";

describe("distPointToSegment", () => {
  it("is zero on the segment", () => {
    expect(distPointToSegment({ x: 5, y: 2 }, { x: 0, y: 2 }, { x: 10, y: 2 })).toBe(0);
  });

  it("measures perpendicular distance to the interior", () => {
    expect(distPointToSegment({ x: 5, y: 6 }, { x: 0, y: 2 }, { x: 10, y: 2 })).toBe(4);
  });

  it("clamps to the nearest endpoint past the segment", () => {
    expect(distPointToSegment({ x: 13, y: 6 }, { x: 0, y: 2 }, { x: 10, y: 2 })).toBe(5);
  });
});

describe("distPointToLineString", () => {
  it("picks the closest segment", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
    ];
    expect(distPointToLineString({ x: 10, y: 4 }, line)).toBe(0);
    expect(distPointToLineString({ x: 5, y: 3 }, line)).toBe(3);
    expect(distPointToLineString({ x: 14, y: 8 }, line)).toBe(4);
  });

  it("handles a single vertex", () => {
    expect(distPointToLineString({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
  });
});
