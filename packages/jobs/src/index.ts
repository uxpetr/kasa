// Background job queue on Postgres (pg-boss, D-104). pg-boss manages its own
// `pgboss` schema; it is not part of the Drizzle migrations (D-133).
import { injectTraceContext, type TraceCarrier } from "@kasa/observability";
import { PgBoss } from "pg-boss";

/** Every job the worker runs, with its payload. Add new jobs here. */
export interface JobPayloads {
  "media.process": { uploadId: string };
}
export type JobName = keyof JobPayloads;

/** What's stored: the payload plus the sender's trace context, so the job continues its trace (D-137). */
export type JobData<N extends JobName> = JobPayloads[N] & { _trace?: TraceCarrier };
export const JOB_NAMES = ["media.process"] as const satisfies readonly JobName[];

/** What the web app needs from the queue: enqueue only. */
export interface JobQueue {
  send<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void>;
}

/**
 * `producer` (web app, short-lived functions) only sends jobs; `worker` also runs
 * pg-boss maintenance and scheduling.
 */
export async function startQueue(
  connectionString: string,
  role: "producer" | "worker",
): Promise<{ boss: PgBoss; queue: JobQueue }> {
  const boss = new PgBoss({
    connectionString,
    max: role === "worker" ? 5 : 2,
    supervise: role === "worker",
    schedule: role === "worker",
  });
  boss.on("error", (error) => console.error(JSON.stringify({ type: "queue_error", message: error.message })));
  await boss.start();
  for (const name of JOB_NAMES) {
    await boss.createQueue(name, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
  }
  return {
    boss,
    queue: {
      async send(name, payload) {
        const data: JobData<typeof name> = { ...payload, _trace: injectTraceContext() };
        const id = await boss.send(name, data);
        if (!id) throw new Error(`Could not enqueue ${name}`);
      },
    },
  };
}
