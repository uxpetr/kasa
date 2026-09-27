// Sending email (D-163): Resend's HTTP API, or a log line when no key is set (local, tests).
import type { Logger } from "@kasa/observability";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** The same key for a retried send, so Resend sends it once. */
  idempotencyKey: string;
}

export interface Mailer {
  readonly kind: "resend" | "log";
  send(email: Email): Promise<void>;
}

export function resendMailer(config: { apiKey: string; from: string; baseUrl?: string }): Mailer {
  const url = `${(config.baseUrl ?? "https://api.resend.com").replace(/\/$/, "")}/emails`;
  return {
    kind: "resend",
    async send(email) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": email.idempotencyKey,
        },
        body: JSON.stringify({ from: config.from, to: [email.to], subject: email.subject, html: email.html, text: email.text, headers: email.headers }),
        signal: AbortSignal.timeout(10_000),
      });
      // Never include the response body: it can echo the address.
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}

/** Without RESEND_API_KEY nothing is sent; the job still runs and marks notifications handled. */
export function logMailer(log?: Logger): Mailer {
  return {
    kind: "log",
    async send(email) {
      log?.info("email not sent (no RESEND_API_KEY)", { subject_length: email.subject.length });
    },
  };
}

export function mailerFromEnv(env: Record<string, string | undefined>, log?: Logger): Mailer {
  if (!env.RESEND_API_KEY) return logMailer(log);
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set. See .env.example.");
  if (!env.UNSUBSCRIBE_SECRET) throw new Error("UNSUBSCRIBE_SECRET is not set. See .env.example.");
  return resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, baseUrl: env.RESEND_BASE_URL });
}
