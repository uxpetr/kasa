import "server-only";
import { startQueue, type JobQueue } from "@kasa/jobs";
import { createStorage, storageConfigFromEnv, type Storage } from "@kasa/media";
import { requireDatabaseUrl } from "@kasa/db";

let storage: Storage | undefined;
let queue: Promise<JobQueue> | undefined;

export function getStorage(): Storage {
  storage ??= createStorage(storageConfigFromEnv());
  return storage;
}

export function getQueue(): Promise<JobQueue> {
  queue ??= startQueue(requireDatabaseUrl(), "producer").then(
    (q) => q.queue,
    (error: unknown) => {
      queue = undefined; // try again on the next request
      throw error;
    },
  );
  return queue;
}
