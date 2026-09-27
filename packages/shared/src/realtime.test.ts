import { describe, expect, it } from "vitest";
import { createTicket, TICKET_TTL_SECONDS, verifyTicket } from "./realtime";

describe("realtime tickets", () => {
  const secret = "test-secret";
  const claims = { projectId: "p1", userId: "u1" };

  it("round-trips the project and user", () => {
    expect(verifyTicket(secret, createTicket(secret, claims))).toEqual(claims);
  });

  it("expires", () => {
    const now = Date.now();
    const ticket = createTicket(secret, claims, now);
    expect(verifyTicket(secret, ticket, now + (TICKET_TTL_SECONDS - 1) * 1000)).toEqual(claims);
    expect(verifyTicket(secret, ticket, now + TICKET_TTL_SECONDS * 1000)).toBeNull();
  });

  it("rejects other secrets, tampering, and junk", () => {
    const ticket = createTicket(secret, claims);
    expect(verifyTicket("other", ticket)).toBeNull();
    const [payload, sig] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "p2", u: "u1", exp: 9999999999 })).toString("base64url");
    expect(verifyTicket(secret, `${forged}.${sig}`)).toBeNull();
    expect(verifyTicket(secret, `${payload}.${sig}.x`)).toBeNull();
    for (const junk of [undefined, "", "a.b", 5, "x".repeat(2000)]) expect(verifyTicket(secret, junk)).toBeNull();
    expect(verifyTicket("", ticket)).toBeNull();
    expect(() => createTicket("", claims)).toThrow(/REALTIME_SECRET/);
  });
});
