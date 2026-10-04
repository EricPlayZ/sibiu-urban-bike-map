import { describe, expect, it } from "vitest";
import { ApiError, conflictUpdatedAt, lockedHolder } from "./teamApi";

describe("conflictUpdatedAt", () => {
  it("reads the server timestamp from a 409", () => {
    const err = new ApiError(409, { error: "conflict", current: { points: [], updated_at: "2026-10-04T20:21:04.459Z" } });
    expect(conflictUpdatedAt(err)).toBe("2026-10-04T20:21:04.459Z");
  });

  it("ignores locks and conflicts without a timestamp", () => {
    expect(conflictUpdatedAt(new ApiError(423, { error: "locked", holder: "Ana" }))).toBeNull();
    expect(lockedHolder(new ApiError(423, { error: "locked", holder: "Ana" }))).toBe("Ana");
    expect(conflictUpdatedAt(new ApiError(409, { error: "conflict" }))).toBeNull();
    expect(conflictUpdatedAt(new Error("nope"))).toBeNull();
  });
});
