import { describe, expect, it } from "vitest";
import { allowedOriginsFrom } from "./origins";

describe("allowedOriginsFrom", () => {
  it("reads a comma-separated list", () => {
    expect(allowedOriginsFrom({ REALTIME_ALLOWED_ORIGINS: "https://a.test, https://b.test" })).toEqual(["https://a.test", "https://b.test"]);
  });

  it("falls back to BETTER_AUTH_URL, then the local web app", () => {
    expect(allowedOriginsFrom({ BETTER_AUTH_URL: "https://kasa.test" })).toEqual(["https://kasa.test"]);
    expect(allowedOriginsFrom({})).toEqual(["http://localhost:3000"]);
  });

  it("treats blank values as unset", () => {
    expect(allowedOriginsFrom({ REALTIME_ALLOWED_ORIGINS: "", BETTER_AUTH_URL: "" })).toEqual(["http://localhost:3000"]);
    expect(allowedOriginsFrom({ REALTIME_ALLOWED_ORIGINS: " , ", BETTER_AUTH_URL: "https://kasa.test" })).toEqual(["https://kasa.test"]);
  });
});
