// WebSocket service (P-06, D-103): Postgres NOTIFY -> "changed" messages to the members
// watching that project. Clients connect with a ticket signed by the web app for one project.
// When a member leaves or is removed (P-15), their sockets for that project get "removed" and close.
import { createServer, type IncomingMessage } from "node:http";
import { createLogger } from "@kasa/observability";
import { verifyTicket } from "@kasa/shared/realtime";
import postgres from "postgres";
import { WebSocketServer, type WebSocket } from "ws";
import { Hub } from "./hub";

export const CHANNEL = "kasa_changes";
const HEARTBEAT_MS = 30_000;
/** Bursts (a photo stack, a batch of bot receipts) become one message per project. */
const COALESCE_MS = 50;
/** Close code for a member who left or was removed; clients don't reconnect. */
export const REMOVED_CLOSE_CODE = 4403;

export interface RealtimeOptions {
  secret: string;
  databaseUrl: string;
  /** Browser origins allowed to connect (the web app). */
  allowedOrigins: string[];
  port?: number;
}

const log = createLogger("kasa-realtime");

export async function startRealtime({ secret, databaseUrl, allowedOrigins, port = 0 }: RealtimeOptions) {
  if (!secret) throw new Error("REALTIME_SECRET is not set. See .env.example.");
  const hub = new Hub<WebSocket>();
  const pending = new Map<string, NodeJS.Timeout>();
  const alive = new WeakSet<WebSocket>();

  // LISTEN holds its own connection; the other one checks membership on connect.
  const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });

  const evict = (client: WebSocket, projectId: string) => {
    client.send(JSON.stringify({ type: "removed", projectId }));
    client.close(REMOVED_CLOSE_CODE, "removed");
  };
  let listening = false;
  await sql.listen(
    CHANNEL,
    (payload) => {
      let projectId: unknown;
      let removedUserId: unknown;
      try {
        ({ projectId, removedUserId } = JSON.parse(payload) as { projectId?: unknown; removedUserId?: unknown });
      } catch {
        return;
      }
      if (typeof projectId !== "string") return;
      if (typeof removedUserId === "string") {
        const clients = hub.takeUser(projectId, removedUserId);
        for (const client of clients) evict(client, projectId);
        if (clients.length) log.info("member removed, sockets closed", { "project.id": projectId, "user.id": removedUserId, closed: clients.length });
        return;
      }
      if (pending.has(projectId)) return;
      pending.set(
        projectId,
        setTimeout(() => {
          pending.delete(projectId);
          hub.notify(projectId);
        }, COALESCE_MS),
      );
    },
    // Called on every (re)connection; after a reconnect, clients back-fill.
    () => {
      if (listening) {
        log.warn("database listener reconnected");
        hub.notifyAll();
      }
      listening = true;
    },
  );

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  http.on("upgrade", (req: IncomingMessage, socket, head) => {
    const refuse = (status: number) => {
      socket.write(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!req.headers.origin || !allowedOrigins.includes(req.headers.origin)) return refuse(403);
    const ticket = new URL(req.url ?? "/", "http://realtime").searchParams.get("ticket");
    const claims = verifyTicket(secret, ticket);
    if (!claims) return refuse(401);
    wss.handleUpgrade(req, socket, head, async (ws) => {
      alive.add(ws);
      hub.add(claims.projectId, ws, claims.userId);
      ws.on("pong", () => alive.add(ws));
      // Clients only listen; anything they send is ignored.
      ws.on("close", () => hub.remove(claims.projectId, ws));
      // A ticket lives 60s, so someone removed meanwhile could still hold one. Checked after
      // joining the hub, so a removal notice can't slip between the check and the join.
      const member = await sql`select 1 from memberships where project_id = ${claims.projectId} and user_id = ${claims.userId}`.catch(() => null);
      if (!member?.length) {
        hub.remove(claims.projectId, ws);
        return evict(ws, claims.projectId);
      }
      log.info("client connected", { "project.id": claims.projectId, "user.id": claims.userId, clients: hub.size });
      ws.send(JSON.stringify({ type: "ready", projectId: claims.projectId }));
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  await new Promise<void>((resolve) => http.listen(port, resolve));
  const address = http.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    port: boundPort,
    hub,
    async close() {
      clearInterval(heartbeat);
      for (const timer of pending.values()) clearTimeout(timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await sql.end({ timeout: 1 });
    },
  };
}
