// HTTP(S) GET for untrusted URLs (P-05). Every hop is checked: scheme, credentials,
// and the address actually connected to (checked at connect time, so DNS rebinding
// can't swap in a private address after the check). Bodies are capped after decompression.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isAllowedAddress, type AddressPolicy } from "./address";

/** A URL we won't fetch, or a response we won't use. Not worth retrying. */
export class UnfurlRefusedError extends Error {}

export interface SafeFetchOptions {
  accept: string;
  /** Content types (without parameters) we'll read; anything else is refused. */
  contentTypes: (type: string) => boolean;
  maxBytes: number;
  /** Stop reading at `maxBytes` and keep what arrived (HTML: the head is at the top), instead of refusing. */
  truncate?: boolean;
  timeoutMs?: number;
  maxRedirects?: number;
  policy?: AddressPolicy;
}

export interface SafeResponse {
  url: URL;
  contentType: string;
  charset: string | undefined;
  body: Buffer;
}

const USER_AGENT = "Mozilla/5.0 (compatible; KasaLinkPreview/1.0)";

/** Parses and checks a URL we're about to fetch. */
export function checkUrl(raw: string | URL, policy: AddressPolicy = "public"): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnfurlRefusedError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnfurlRefusedError("scheme");
  if (url.username || url.password) throw new UnfurlRefusedError("credentials");
  // IP literals skip DNS, so check them here. (URL keeps IPv6 hosts in brackets.)
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host) && !isAllowedAddress(host, policy)) throw new UnfurlRefusedError("blocked_address");
  if (!isIP(host) && policy === "public" && (host === "localhost" || host.endsWith(".localhost"))) {
    throw new UnfurlRefusedError("blocked_address");
  }
  return url;
}

/** A DNS lookup that fails when any resolved address isn't allowed. */
export function guardedLookup(policy: AddressPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      const list = addresses as unknown as LookupAddress[];
      if (error) return callback(error, "", 0);
      if (!list.length || list.some((a) => !isAllowedAddress(a.address, policy))) {
        return callback(Object.assign(new UnfurlRefusedError("blocked_address"), { code: "EBLOCKED" }), "", 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

function decoded(response: IncomingMessage): Readable {
  switch ((response.headers["content-encoding"] ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return response.pipe(createGunzip());
    case "deflate":
      return response.pipe(createInflate());
    case "br":
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

function request(url: URL, options: SafeFetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, {
      signal,
      lookup: guardedLookup(options.policy ?? "public"),
      headers: { accept: options.accept, "accept-encoding": "gzip, deflate, br", "user-agent": USER_AGENT },
      agent: false,
    });
    req.on("response", resolve);
    req.on("error", (error) => {
      const cause = (error as { cause?: unknown }).cause;
      reject(cause instanceof UnfurlRefusedError ? cause : error);
    });
  });
}

async function readBody(response: IncomingMessage, options: SafeFetchOptions): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (!options.truncate && Number.isFinite(declared) && declared > options.maxBytes) {
    response.destroy();
    throw new UnfurlRefusedError("too_large");
  }
  const stream = decoded(response);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > options.maxBytes) {
        if (!options.truncate) throw new UnfurlRefusedError("too_large");
        chunks.push(buffer.subarray(0, buffer.length - (size - options.maxBytes)));
        break;
      }
      chunks.push(buffer);
    }
  } finally {
    response.destroy();
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

/** GETs an untrusted URL, following up to `maxRedirects` redirects, each re-checked. */
export async function safeFetch(raw: string | URL, options: SafeFetchOptions): Promise<SafeResponse> {
  const policy = options.policy ?? "public";
  const signal = AbortSignal.timeout(options.timeoutMs ?? 5000);
  let url = checkUrl(raw, policy);
  for (let hop = 0; ; hop++) {
    const response = await request(url, options, signal);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.destroy();
      if (hop >= (options.maxRedirects ?? 5)) throw new UnfurlRefusedError("too_many_redirects");
      url = checkUrl(new URL(response.headers.location, url), policy);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      // Server errors may pass; anything else won't.
      if (status >= 500) throw new Error(`Upstream responded ${status}`);
      throw new UnfurlRefusedError(`status_${status}`);
    }
    const [type = "", ...params] = (response.headers["content-type"] ?? "").split(";").map((s) => s.trim());
    const contentType = type.toLowerCase();
    if (!options.contentTypes(contentType)) {
      response.destroy();
      throw new UnfurlRefusedError("content_type");
    }
    const charset = params.find((p) => p.toLowerCase().startsWith("charset="))?.slice(8).replace(/"/g, "");
    return { url, contentType, charset, body: await readBody(response, options) };
  }
}
