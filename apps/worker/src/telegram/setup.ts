// pnpm --filter @kasa/worker telegram:setup: checks the bot and points its webhook at the web app
// (P-18). Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and BETTER_AUTH_URL. Never prints them.
import { createTelegramApi } from "./api";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.BETTER_AUTH_URL;
if (!token || !secret || !appUrl) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and BETTER_AUTH_URL. See .env.example.");
  process.exit(1);
}
const api = createTelegramApi(token);
const me = await api.getMe();
console.log(`Bot: @${me.username}`);
console.log(`Can join groups: ${me.can_join_groups ? "yes" : "NO (BotFather: /setjoingroups → Enable)"}`);
console.log(`Reads all group messages: ${me.can_read_all_group_messages ? "yes" : "NO (BotFather: /setprivacy → Disable)"}`);
const url = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
await api.setWebhook(url, secret);
console.log(`Webhook set to ${url}`);
