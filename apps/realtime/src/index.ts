// WebSocket service for new entries, comments, and reactions (P-06).
import { createLogger } from "@kasa/observability";
import { startRealtime } from "./server";

const log = createLogger("kasa-realtime");
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
};

const port = Number(process.env.REALTIME_PORT ?? 3200);
const allowedOrigins = (process.env.REALTIME_ALLOWED_ORIGINS ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const server = await startRealtime({ secret: need("REALTIME_SECRET"), databaseUrl: need("DATABASE_URL"), allowedOrigins, port });
log.info("realtime started", { port: server.port, origins: allowedOrigins.join(",") });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
