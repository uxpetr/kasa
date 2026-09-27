// Job runner (D-104). Each job type is registered here with its handler.
// Telemetry is preloaded via --import ./src/telemetry.ts (see package.json).
import { createDb, requireDatabaseUrl } from "@kasa/db";
import { startQueue, type JobData } from "@kasa/jobs";
import { createStorage, storageConfigFromEnv } from "@kasa/media";
import { telemetry } from "./telemetry";
import { log, runJob } from "./jobs";
import { processUpload } from "./media";
import { unfurlEntry } from "./unfurl";
import { addressPolicyFromEnv } from "./unfurl/address";

const databaseUrl = requireDatabaseUrl();
const { db, close } = createDb(databaseUrl, { max: 5 });
const storage = createStorage(storageConfigFromEnv());
const { boss } = await startQueue(databaseUrl, "worker");
const policy = addressPolicyFromEnv(process.env);

await boss.work<JobData<"media.process">>("media.process", { localConcurrency: 2 }, async ([job]) => {
  if (job) await runJob("media.process", job.id, job.data, () => processUpload({ db, storage, log }, job.data.uploadId));
});

await boss.work<JobData<"link.unfurl">>("link.unfurl", { localConcurrency: 4 }, async ([job]) => {
  if (job) await runJob("link.unfurl", job.id, job.data, () => unfurlEntry({ db, storage, log, policy }, job.data.entryId));
});

log.info("worker started", { jobs: "media.process,link.unfurl", unfurl_policy: policy });

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 20_000 });
  await close();
  await telemetry.shutdown();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
