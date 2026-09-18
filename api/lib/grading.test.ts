import { describe, expect, it } from "vitest";
import { officialOf } from "./grading";

describe("officialOf", () => {
  it("always prefers a valid official answer over a conflicting AI answer", () => {
    expect(officialOf("b", "D")).toBe("B");
    expect(officialOf(" C ", "A")).toBe("C");
  });

  it("falls back to a valid AI answer only when the official answer is missing", () => {
    expect(officialOf(null, "a")).toBe("A");
    expect(officialOf(undefined, " d ")).toBe("D");
    expect(officialOf("", "B")).toBe("B");
  });

  it("falls back to AI when the official value is present but not a valid A-D key", () => {
    expect(officialOf("E", "c")).toBe("C");
    expect(officialOf("unknown", "A")).toBe("A");
  });

  it("returns an empty string when neither source contains a valid answer", () => {
    expect(officialOf(null, null)).toBe("");
    expect(officialOf("E", "F")).toBe("");
    expect(officialOf("A.", "B.")).toBe("");
  });
});
