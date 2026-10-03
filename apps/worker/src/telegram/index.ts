// Telegram sync in the worker (P-18). Off unless TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME are
// set. Updates come through the web app's webhook as telegram.update jobs; for local development,
// TELEGRAM_POLLING=true reads them with getUpdates instead, which needs a bot with no webhook.
import type { JobQueue } from "@kasa/jobs";
import type { Logger } from "@kasa/observability";
import { createTelegramApi, type TelegramApi } from "./api";

export { handleUpdate, type TelegramDeps } from "./inbound";
export { sendEntry } from "./outbound";

export interface TelegramConfig {
  api: TelegramApi;
  botUsername: string;
  polling: boolean;
}

export function telegramFromEnv(env: NodeJS.ProcessEnv): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  const botUsername = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!token || !botUsername) return null;
  return { api: createTelegramApi(token), botUsername, polling: env.TELEGRAM_POLLING === "true" };
}

/** Long polling for local development: each update becomes a telegram.update job, as from the webhook. */
export function pollUpdates(api: TelegramApi, queue: JobQueue, log: Logger, signal: AbortSignal): Promise<void> {
  return (async () => {
    let offset = 0;
    while (!signal.aborted) {
      try {
        const updates = await api.getUpdates(offset, 25);
        for (const update of updates) {
          await queue.send("telegram.update", { update: update as unknown as Record<string, unknown> });
          offset = update.update_id + 1;
        }
      } catch (error) {
        log.error("telegram polling failed", { error: (error as Error).message });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  })();
}
