// Job runner (D-104). Each job type is registered here with its handler.
// Telemetry is preloaded via --import ./src/telemetry.ts (see package.json).
import { createDb, eq, requireDatabaseUrl, schema } from "@kasa/db";
import { sendSort, startQueue, type JobData } from "@kasa/jobs";
import { createStorage, storageConfigFromEnv } from "@kasa/media";
import { telemetry } from "./telemetry";
import { answerBot } from "./bot";
import { botModelFromEnv } from "./bot/model";
import { sortPile } from "./bot/sort";
import { emailFeedback } from "./feedback";
import { log, runJob } from "./jobs";
import { processUpload } from "./media";
import { sendNotifications } from "./notify";
import { mailerFromEnv } from "./notify/mailer";
import { unfurlEntry } from "./unfurl";
import { addressPolicyFromEnv } from "./unfurl/address";

const databaseUrl = requireDatabaseUrl();
const { db, close } = createDb(databaseUrl, { max: 5 });
const storage = createStorage(storageConfigFromEnv());
const { boss, queue } = await startQueue(databaseUrl, "worker");
const policy = addressPolicyFromEnv(process.env);
const mailer = mailerFromEnv(process.env, log);
const notifyDeps = {
  db,
  queue,
  mailer,
  appUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET,
  log,
};
const botDeps = { db, model: botModelFromEnv(process.env), log };
const feedbackDeps = { db, mailer, to: process.env.FEEDBACK_EMAIL || undefined, appUrl: notifyDeps.appUrl, log };

await boss.work<JobData<"media.process">>("media.process", { localConcurrency: 2 }, async ([job]) => {
  if (job) await runJob("media.process", job.id, job.data, () => processUpload({ db, storage, log }, job.data.uploadId));
});

await boss.work<JobData<"link.unfurl">>("link.unfurl", { localConcurrency: 4 }, async ([job]) => {
  if (job)
    await runJob("link.unfurl", job.id, job.data, async () => {
      await unfurlEntry({ db, storage, log, policy }, job.data.entryId);
      // Links are sorted once their title is known (P-19).
      const [entry] = await db.select({ projectId: schema.entries.projectId }).from(schema.entries).where(eq(schema.entries.id, job.data.entryId));
      if (entry) await sendSort(queue, entry.projectId);
    });
});

await boss.work<JobData<"notify.send">>("notify.send", { localConcurrency: 2 }, async ([job]) => {
  if (job) await runJob("notify.send", job.id, job.data, () => sendNotifications(notifyDeps, job.data.userId, job.data.projectId));
});

await boss.work<JobData<"feedback.send">>("feedback.send", async ([job]) => {
  if (job) await runJob("feedback.send", job.id, job.data, () => emailFeedback(feedbackDeps, job.data.feedbackId));
});

await boss.work<JobData<"bot.answer">>("bot.answer", { localConcurrency: 2 }, async ([job]) => {
  if (job) await runJob("bot.answer", job.id, job.data, () => answerBot(botDeps, job.data.entryId));
});

await boss.work<JobData<"bot.sort">>("bot.sort", async ([job]) => {
  if (job) await runJob("bot.sort", job.id, job.data, async () => {
      await sortPile(botDeps, job.data.projectId);
    });
});

log.info("worker started", {
  jobs: "media.process,link.unfurl,notify.send,feedback.send,bot.answer,bot.sort",
  unfurl_policy: policy,
  mailer: mailer.kind,
  bot_model: botDeps.model?.id ?? "none",
});

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 20_000 });
  await close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
