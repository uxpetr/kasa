// The Telegram Bot API, the few methods Kasa uses (P-18). Plain fetch rather than a framework:
// it's a handful of calls, and tests swap in a fake through the TelegramApi interface.
// The token is in the URL Telegram requires, so URLs are never logged.

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: { file_id: string; mime_type?: string; file_size?: number };
  media_group_id?: string;
  reply_to_message?: TgMessage;
  migrate_to_chat_id?: number;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  my_chat_member?: { chat: TgChat; from: TgUser; new_chat_member: { user: TgUser; status: string } };
}

export interface TgMe extends TgUser {
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
}

/** A Bot API error: `retryAfter` (seconds) on 429; 403 when the bot was removed from the chat. */
export class TelegramError extends Error {
  constructor(
    readonly status: number,
    description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${status}: ${description}`);
  }
  /** The chat is gone for the bot: kicked, left, deleted, or upgraded to a supergroup. */
  get chatGone(): boolean {
    return this.status === 403 || (this.status === 400 && /chat not found|upgraded to a supergroup/i.test(this.message));
  }
}

export interface SendOptions {
  /** Reply to this message in the same chat, if it still exists. */
  replyTo?: number;
}

export interface TelegramApi {
  getMe(): Promise<TgMe>;
  sendMessage(chatId: string, text: string, opts?: SendOptions): Promise<TgMessage>;
  sendPhoto(chatId: string, photo: { body: Buffer; contentType: string }, caption: string | undefined, opts?: SendOptions): Promise<TgMessage>;
  sendMediaGroup(chatId: string, photos: { body: Buffer; contentType: string }[], caption: string | undefined, opts?: SendOptions): Promise<TgMessage[]>;
  /** Downloads a file the bot received, up to Telegram's 20 MB limit for bots. */
  downloadFile(fileId: string): Promise<{ body: Buffer; path: string }>;
  getUpdates(offset: number, timeoutSeconds: number): Promise<TgUpdate[]>;
  setWebhook(url: string, secret: string): Promise<void>;
}

const API = "https://api.telegram.org";
/** Telegram's own limits: 4096 characters for a message, 1024 for a caption. */
export const MAX_TEXT = 4096;
export const MAX_CAPTION = 1024;
export const ALLOWED_UPDATES = ["message", "edited_message", "my_chat_member"];

const replyParams = (opts?: SendOptions) => (opts?.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {});
const extension = (contentType: string) => contentType.split("/")[1] ?? "jpg";

export function createTelegramApi(token: string, timeoutMs = 30_000): TelegramApi {
  async function call<T>(method: string, body: Record<string, unknown> | FormData, extraTimeoutMs = 0): Promise<T> {
    const form = body instanceof FormData;
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: form ? undefined : { "content-type": "application/json" },
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs + extraTimeoutMs),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | null;
    if (!json?.ok) throw new TelegramError(res.status, json?.description ?? res.statusText, json?.parameters?.retry_after);
    return json.result as T;
  }

  return {
    getMe: () => call<TgMe>("getMe", {}),
    sendMessage: (chatId, text, opts) =>
      call<TgMessage>("sendMessage", { chat_id: chatId, text: text.slice(0, MAX_TEXT), ...replyParams(opts) }),
    async sendPhoto(chatId, photo, caption, opts) {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("photo", new Blob([new Uint8Array(photo.body)], { type: photo.contentType }), `photo.${extension(photo.contentType)}`);
      if (caption) form.set("caption", caption.slice(0, MAX_CAPTION));
      const reply = replyParams(opts).reply_parameters;
      if (reply) form.set("reply_parameters", JSON.stringify(reply));
      return call<TgMessage>("sendPhoto", form);
    },
    async sendMediaGroup(chatId, photos, caption, opts) {
      const form = new FormData();
      form.set("chat_id", chatId);
      const media = photos.slice(0, 10).map((p, i) => {
        form.set(`p${i}`, new Blob([new Uint8Array(p.body)], { type: p.contentType }), `p${i}.${extension(p.contentType)}`);
        return { type: "photo", media: `attach://p${i}`, ...(i === 0 && caption ? { caption: caption.slice(0, MAX_CAPTION) } : {}) };
      });
      form.set("media", JSON.stringify(media));
      const reply = replyParams(opts).reply_parameters;
      if (reply) form.set("reply_parameters", JSON.stringify(reply));
      return call<TgMessage[]>("sendMediaGroup", form);
    },
    async downloadFile(fileId) {
      const file = await call<{ file_path?: string }>("getFile", { file_id: fileId });
      if (!file.file_path) throw new TelegramError(400, "file has no path");
      const res = await fetch(`${API}/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new TelegramError(res.status, "file download failed");
      return { body: Buffer.from(await res.arrayBuffer()), path: file.file_path };
    },
    getUpdates: (offset, timeoutSeconds) =>
      call<TgUpdate[]>("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ALLOWED_UPDATES }, timeoutSeconds * 1000),
    async setWebhook(url, secret) {
      await call("setWebhook", { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false });
    },
  };
}
