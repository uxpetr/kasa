// Checks a real bucket behaves the way uploads rely on (D-132): a presigned PUT succeeds only
// with the signed Content-Type and Content-Length, and the browser origin passes CORS.
// Reads the usual S3_* variables; writes one small object under check/ and deletes it.
//
//   pnpm --filter @kasa/media storage:check [https://web-origin]
import { randomUUID } from "node:crypto";
import { createStorage, storageConfigFromEnv } from "./storage";

const config = storageConfigFromEnv();
const storage = createStorage(config);
const origin = process.argv[2];
const key = `check/${randomUUID()}.png`;
const body = Buffer.from("kasa storage check");
const url = await storage.presignUpload(key, "image/png", body.length);

let failed = false;
function expect(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name} (${detail})`);
  if (!ok) failed = true;
}

// The status, plus the storage error code and message when it refuses (no credentials in either).
async function put(contentType: string, payload: Buffer) {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": contentType }, body: payload });
  if (res.ok) return { status: res.status, detail: `HTTP ${res.status}` };
  const text = await res.text();
  const error = [/<Code>(.*?)<\/Code>/, /<Message>(.*?)<\/Message>/].map((re) => re.exec(text)?.[1]).filter(Boolean).join(": ");
  return { status: res.status, detail: `HTTP ${res.status} ${error}`.trim() };
}

try {
  const wrongType = await put("image/gif", body);
  expect("rejects a different Content-Type", wrongType.status === 403, wrongType.detail);
  const wrongSize = await put("image/png", Buffer.concat([body, Buffer.from("!")]));
  expect("rejects a different Content-Length", wrongSize.status >= 400, wrongSize.detail);
  const signed = await put("image/png", body);
  expect("accepts the signed upload", signed.status === 200, signed.detail);
  if (signed.status !== 200) throw new Error("stopping: the signed upload failed");
  const stored = await storage.head(key);
  expect("stored the signed type and size", stored?.contentType === "image/png" && stored.size === body.length, JSON.stringify(stored));

  if (origin) {
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "PUT", "access-control-request-headers": "content-type" },
    });
    const allowed = preflight.headers.get("access-control-allow-origin");
    expect(`CORS allows ${origin}`, preflight.ok && allowed === origin, `HTTP ${preflight.status}, allow-origin ${allowed}`);
  }
} catch (error) {
  failed = true;
  console.log(`FAIL  ${(error as Error).message}`);
} finally {
  await storage.remove(key).catch(() => {});
}

process.exit(failed ? 1 : 0);
