// Job runner (D-104). Each job type is registered here with its handler.
import { createDb, requireDatabaseUrl } from "@kasa/db";
import { startQueue, type JobPayloads } from "@kasa/jobs";
import { createStorage, storageConfigFromEnv } from "@kasa/media";
import { processUpload } from "./media";

const databaseUrl = requireDatabaseUrl();
const { db, close } = createDb(databaseUrl, { max: 5 });
const storage = createStorage(storageConfigFromEnv());
const { boss } = await startQueue(databaseUrl, "worker");

await boss.work<JobPayloads["media.process"]>("media.process", { localConcurrency: 2 }, async ([job]) => {
  if (job) await processUpload({ db, storage }, job.data.uploadId);
});

console.log(JSON.stringify({ type: "worker_started", jobs: ["media.process"] }));

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 20_000 });
  await close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
