// WebSocket service for new entries, comments, and reactions (P-06).
import { createLogger } from "@kasa/observability";
import { allowedOriginsFrom } from "./origins";
import { startRealtime } from "./server";

const log = createLogger("kasa-realtime");
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
};

const port = Number(process.env.REALTIME_PORT ?? 3200);
const allowedOrigins = allowedOriginsFrom(process.env);

const server = await startRealtime({ secret: need("REALTIME_SECRET"), databaseUrl: need("DATABASE_URL"), allowedOrigins, port });
log.info("realtime started", { port: server.port, origins: allowedOrigins.join(",") });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
