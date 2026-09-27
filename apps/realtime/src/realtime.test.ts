import { randomUUID } from "node:crypto";
import { createTicket } from "@kasa/shared/realtime";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Hub } from "./hub";
import { CHANNEL, REMOVED_CLOSE_CODE, startRealtime } from "./server";

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

  it("takes out one user's clients for one project", () => {
    const hub = new Hub();
    const [a1, a2, b, aElsewhere] = [0, 1, 2, 3].map(() => ({ send: () => {} }));
    hub.add("p1", a1!, "ann");
    hub.add("p1", a2!, "ann");
    hub.add("p1", b!, "bob");
    hub.add("p2", aElsewhere!, "ann");
    expect(hub.takeUser("p1", "ann")).toEqual([a1, a2]);
    expect(hub.size).toBe(2);
    expect(hub.takeUser("p1", "ann")).toEqual([]);
  });

  it("does not send changes to a client until membership is confirmed", () => {
    const hub = new Hub();
    const pendingGot: string[] = [];
    const readyGot: string[] = [];
    const pending = { send: (m: string) => pendingGot.push(m) };
    const ready = { send: (m: string) => readyGot.push(m) };
    hub.add("p1", pending, "ann", true);
    hub.add("p1", ready, "bob");
    hub.notify("p1");
    expect(pendingGot).toEqual([]);
    expect(readyGot).toEqual(['{"type":"changed","projectId":"p1"}']);
    hub.confirm(pending);
    hub.notify("p1");
    expect(pendingGot).toEqual(['{"type":"changed","projectId":"p1"}']);
  });

  it("lists distinct connected members", () => {
    const hub = new Hub();
    const [a, b, a2] = [0, 1, 2].map(() => ({ send: () => {} }));
    hub.add("p1", a!, "ann", true);
    hub.add("p1", a2!, "ann");
    hub.add("p2", b!, "bob");
    expect(hub.members()).toEqual([
      { projectId: "p1", userId: "ann" },
      { projectId: "p2", userId: "bob" },
    ]);
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

  const users: string[] = [];
  afterAll(async () => {
    await server?.close();
    if (users.length) {
      await sql`delete from projects where owner_id in ${sql(users)}`;
      await sql`delete from users where id in ${sql(users)}`;
    }
    await sql?.end();
  });

  /** A user who is a member of a new project. The service checks membership on connect (P-15). */
  async function member(projectId = randomUUID()) {
    const userId = randomUUID();
    users.push(userId);
    await sql`insert into users (id, name, email) values (${userId}, 'Rt', ${`rt-${userId}@example.com`})`;
    await sql`insert into projects (id, name, owner_id) values (${projectId}, 'Rt', ${userId}) on conflict do nothing`;
    await sql`insert into memberships (project_id, user_id, role) values (${projectId}, ${userId}, 'editor')`;
    return { projectId, userId };
  }

  /** Opens a socket and collects its messages; resolves on the server's first message. */
  function connect(projectId: string, opts: { ticket?: string; origin?: string; userId?: string } = {}) {
    const ticket = opts.ticket ?? createTicket(secret, { projectId, userId: opts.userId ?? randomUUID() });
    const ws = new WebSocket(`ws://localhost:${server.port}/?ticket=${encodeURIComponent(ticket)}`, { origin: opts.origin ?? origin });
    const messages: { type: string; projectId: string }[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(String(data))));
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    const ready = new Promise<void>((resolve, reject) => {
      ws.on("message", () => resolve());
      ws.on("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
      ws.on("error", reject);
    });
    return { ws, messages, ready, closed };
  }

  const notify = (projectId: string) => sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ projectId, entryId: randomUUID() })})`;

  it("tells members of the project within 2 seconds, and nobody else", async () => {
    const [m1, m2] = [await member(), await member()];
    const [p1, p2] = [m1.projectId, m2.projectId];
    const one = connect(p1, { userId: m1.userId });
    const other = connect(p2, { userId: m2.userId });
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
    const m = await member();
    const p = m.projectId;
    const c = connect(p, { userId: m.userId });
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

  it("closes a member's sockets when they leave or are removed, and only theirs", async () => {
    const stays = await member();
    const goes = await member(stays.projectId);
    const alsoElsewhere = await member();
    await sql`insert into memberships (project_id, user_id, role) values (${alsoElsewhere.projectId}, ${goes.userId}, 'viewer')`;
    const kept = connect(stays.projectId, { userId: stays.userId });
    const removed = connect(goes.projectId, { userId: goes.userId });
    const otherPile = connect(alsoElsewhere.projectId, { userId: goes.userId });
    await Promise.all([kept.ready, removed.ready, otherPile.ready]);

    await sql`delete from memberships where project_id = ${goes.projectId} and user_id = ${goes.userId}`;
    expect(await removed.closed).toBe(REMOVED_CLOSE_CODE);
    expect(removed.messages.at(-1)).toEqual({ type: "removed", projectId: goes.projectId });

    // Everyone else stays connected and keeps getting changes.
    await notify(stays.projectId);
    await expect.poll(() => kept.messages.some((m) => m.type === "changed")).toBe(true);
    expect(kept.ws.readyState).toBe(WebSocket.OPEN);
    expect(otherPile.ws.readyState).toBe(WebSocket.OPEN);
    kept.ws.close();
    otherPile.ws.close();
  });

  it("turns away a valid ticket whose holder is no longer a member", async () => {
    const m = await member();
    const outsider = connect(m.projectId, { userId: randomUUID() });
    expect(await outsider.closed).toBe(REMOVED_CLOSE_CODE);
    expect(outsider.messages).toEqual([{ type: "removed", projectId: m.projectId }]);
  });

  it("answers health checks", async () => {
    expect((await fetch(`http://localhost:${server.port}/health`)).status).toBe(200);
  });
});
