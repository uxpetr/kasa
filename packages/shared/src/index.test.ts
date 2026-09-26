import { describe, expect, it } from "vitest";
import { isEntrySource } from "./index";

describe("isEntrySource", () => {
  it("accepts known sources", () => {
    expect(isEntrySource("extension")).toBe(true);
  });

  it("rejects unknown sources", () => {
    expect(isEntrySource("email")).toBe(false);
  });
});
