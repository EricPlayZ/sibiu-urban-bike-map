import { describe, expect, it } from "vitest";
import { ApiError, loginFailureMessage } from "./teamApi";

describe("loginFailureMessage", () => {
  it("distinguishes 401, 429, 403, and network errors", () => {
    expect(loginFailureMessage(new ApiError(401, { error: "unauthorized" }))).toBe("Parolă greșită.");
    expect(loginFailureMessage(new ApiError(429, { error: "too_many", retryAfterSec: 120 }))).toMatch(/2 min/);
    expect(loginFailureMessage(new ApiError(429, { error: "too_many", retryAfterSec: 8 }))).toMatch(/8s/);
    expect(loginFailureMessage(new ApiError(403, { error: "forbidden" }))).toMatch(/adresa oficială/);
    expect(loginFailureMessage(new Error("failed to fetch"))).toMatch(/Serverul nu e disponibil/);
  });
});
