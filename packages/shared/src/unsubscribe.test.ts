import { describe, expect, it } from "vitest";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

const claims = { projectId: "0b6f4c1e-8a57-4b61-9a1f-3a2d5e6f7a8b", userId: "5c9d2e3f-1a2b-4c3d-8e4f-5a6b7c8d9e0f" };

describe("unsubscribe tokens", () => {
  it("round-trips", () => {
    expect(verifyUnsubscribeToken("s3cret", createUnsubscribeToken("s3cret", claims))).toEqual(claims);
  });

  it("rejects other secrets, swapped ids, and tampering", () => {
    const token = createUnsubscribeToken("s3cret", claims);
    expect(verifyUnsubscribeToken("other", token)).toBeNull();
    const [p, u, sig] = token.split(".");
    expect(verifyUnsubscribeToken("s3cret", `${u}.${p}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken("s3cret", `${p}.${claims.projectId}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken("s3cret", `${token}x`)).toBeNull();
    expect(verifyUnsubscribeToken("s3cret", `${token}.x`)).toBeNull();
    expect(verifyUnsubscribeToken("s3cret", "nonsense")).toBeNull();
    expect(verifyUnsubscribeToken(undefined, token)).toBeNull();
    expect(verifyUnsubscribeToken("s3cret", 42)).toBeNull();
  });

  it("needs a secret to sign", () => {
    expect(() => createUnsubscribeToken("", claims)).toThrow(/UNSUBSCRIBE_SECRET/);
  });
});
