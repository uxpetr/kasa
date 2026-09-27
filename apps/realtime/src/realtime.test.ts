import { randomUUID } from "node:crypto";
import { createTicket } from "@kasa/shared/realtime";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Hub } from "./hub";
import { CHANNEL, startRealtime } from "./server";

describe("Hub", () => {
  it("notifies only the clients of that project, with ids only", () => {
    const hub = new Hub();
    const got: Record<string, string[]> = { a: [], b: [] };
    const a = { send: (m: string) => got.a!.push(m) };
    const b = { send: (m: string) => got.b!.push(m) };
    hub.add("p1", a);
    hub.add("p2", b);
    hub.notify("p1");
    expect(got).toEqual({ a: ['{"type":"changed","projectId":"p1"}'], b: [] });
    hub.notifyAll();
    expect(got.b).toHaveLength(1);
    hub.remove("p1", a);
    hub.notify("p1");
    expect(got.a).toHaveLength(2);
    expect(hub.size).toBe(1);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("realtime server", () => {
  const secret = "test-secret";
  const origin = "http://localhost:3000";
  let server: Awaited<ReturnType<typeof startRealtime>>;
  let sql: postgres.Sql;

  beforeAll(async () => {
    server = await startRealtime({ secret, databaseUrl: process.env.DATABASE_URL!, allowedOrigins: [origin] });
    sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  });

  afterAll(async () => {
    await server?.close();
    await sql?.end();
  });

  /** Opens a socket and collects its messages; resolves once the server says ready. */
  function connect(projectId: string, opts: { ticket?: string; origin?: string } = {}) {
    const ticket = opts.ticket ?? createTicket(secret, { projectId, userId: randomUUID() });
    const ws = new WebSocket(`ws://localhost:${server.port}/?ticket=${encodeURIComponent(ticket)}`, { origin: opts.origin ?? origin });
    const messages: { type: string; projectId: string }[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(String(data))));
    const ready = new Promise<void>((resolve, reject) => {
      ws.on("message", () => resolve());
      ws.on("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
      ws.on("error", reject);
    });
    return { ws, messages, ready };
  }

  const notify = (projectId: string) => sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ projectId, entryId: randomUUID() })})`;

  it("tells members of the project within 2 seconds, and nobody else", async () => {
    const [p1, p2] = [randomUUID(), randomUUID()];
    const one = connect(p1);
    const other = connect(p2);
    await Promise.all([one.ready, other.ready]);
    const started = Date.now();
    await notify(p1);
    await expect.poll(() => one.messages.filter((m) => m.type === "changed")).toEqual([{ type: "changed", projectId: p1 }]);
    expect(Date.now() - started).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 150));
    expect(other.messages.filter((m) => m.type === "changed")).toEqual([]);
    one.ws.close();
    other.ws.close();
  });

  it("sends one message for a burst of changes", async () => {
    const p = randomUUID();
    const c = connect(p);
    await c.ready;
    await Promise.all(Array.from({ length: 5 }, () => notify(p)));
    await expect.poll(() => c.messages.filter((m) => m.type === "changed").length).toBe(1);
    await new Promise((r) => setTimeout(r, 150));
    expect(c.messages.filter((m) => m.type === "changed")).toHaveLength(1);
    c.ws.close();
  });

  it("refuses missing, forged, and expired tickets, and other origins", async () => {
    const p = randomUUID();
    await expect(connect(p, { ticket: "nope" }).ready).rejects.toThrow("401");
    await expect(connect(p, { ticket: createTicket("other-secret", { projectId: p, userId: "u" }) }).ready).rejects.toThrow("401");
    await expect(connect(p, { ticket: createTicket(secret, { projectId: p, userId: "u" }, Date.now() - 120_000) }).ready).rejects.toThrow("401");
    await expect(connect(p, { origin: "https://evil.example" }).ready).rejects.toThrow("403");
  });

  it("answers health checks", async () => {
    expect((await fetch(`http://localhost:${server.port}/health`)).status).toBe(200);
  });
});
