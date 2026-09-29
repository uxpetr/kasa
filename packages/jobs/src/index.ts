// Background job queue on Postgres (pg-boss, D-104). pg-boss manages its own
// `pgboss` schema; it is not part of the Drizzle migrations (D-133).
import { injectTraceContext, type TraceCarrier } from "@kasa/observability";
import { PgBoss } from "pg-boss";

/** Every job the worker runs, with its payload. Add new jobs here. */
export interface JobPayloads {
  "media.process": { uploadId: string };
  "link.unfurl": { entryId: string };
  "notify.send": { userId: string; projectId: string };
  "feedback.send": { feedbackId: string };
  /** Fills in a pending Kasa Bot answer; `entryId` is the bot's own entry (P-17). */
  "bot.answer": { entryId: string };
}
export type JobName = keyof JobPayloads;

/** What's stored: the payload plus the sender's trace context, so the job continues its trace (D-137). */
export type JobData<N extends JobName> = JobPayloads[N] & { _trace?: TraceCarrier };
export const JOB_NAMES = ["media.process", "link.unfurl", "notify.send", "feedback.send", "bot.answer"] as const satisfies readonly JobName[];

export interface SendOptions {
  /** Don't run before this moment. */
  startAfter?: Date;
  /**
   * With a `stately` queue, at most one job per key waits and one runs; sending
   * while one is already waiting is a no-op, since that job will see the new work.
   */
  singletonKey?: string;
}

/** What the web app needs from the queue: enqueue only. */
export interface JobQueue {
  send<N extends JobName>(name: N, payload: JobPayloads[N], options?: SendOptions): Promise<void>;
}

/** Per-queue settings; `notify.send` is stately so emails batch per person and project (P-12). */
const QUEUE_POLICY: Partial<Record<JobName, "stately">> = { "notify.send": "stately" };

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
    await boss.createQueue(name, { retryLimit: 3, retryDelay: 5, retryBackoff: true, policy: QUEUE_POLICY[name] ?? "standard" });
  }
  return {
    boss,
    queue: {
      async send(name, payload, options = {}) {
        const data: JobData<typeof name> = { ...payload, _trace: injectTraceContext() };
        const id = await boss.send(name, data, options);
        if (!id && !options.singletonKey) throw new Error(`Could not enqueue ${name}`);
      },
    },
  };
}

/** At most one notification email per person per project in this window (P-12). */
export const EMAIL_INTERVAL_MS = 15 * 60_000;

/** When a person's next notification email for a project may go out. */
export function nextEmailAt(lastEmailedAt: Date | null, now = new Date()): Date {
  const next = lastEmailedAt ? new Date(lastEmailedAt.getTime() + EMAIL_INTERVAL_MS) : now;
  return next > now ? next : now;
}

export const notifyKey = (userId: string, projectId: string) => `${userId}:${projectId}`;
