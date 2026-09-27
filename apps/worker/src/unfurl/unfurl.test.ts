import { randomUUID } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { createStorage, keys, storageConfigFromEnv, type Storage } from "@kasa/media";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addressPolicyFromEnv, isAllowedAddress } from "./address";
import { unfurlEntry } from "./index";
import { parseOembed, parsePage } from "./parse";
import { checkUrl, guardedLookup, safeFetch, UnfurlRefusedError } from "./safe-fetch";

describe("address guard", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "64:ff9b::a00:1",
    "2002:a00:1::1",
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isAllowedAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "2a00:1450:4001::200e"])("allows public %s", (address) => {
    expect(isAllowedAddress(address)).toBe(true);
  });

  it("loopback-only allows only loopback", () => {
    expect(isAllowedAddress("127.0.0.1", "loopback-only")).toBe(true);
    expect(isAllowedAddress("::1", "loopback-only")).toBe(true);
    expect(isAllowedAddress("8.8.8.8", "loopback-only")).toBe(false);
    expect(isAllowedAddress("10.0.0.1", "loopback-only")).toBe(false);
  });

  it("the test switch can't be used in production", () => {
    expect(addressPolicyFromEnv({})).toBe("public");
    expect(addressPolicyFromEnv({ UNFURL_LOOPBACK_ONLY: "1" })).toBe("loopback-only");
    expect(() => addressPolicyFromEnv({ UNFURL_LOOPBACK_ONLY: "1", NODE_ENV: "production" })).toThrow();
  });
});

describe("checkUrl", () => {
  it.each([
    ["file:///etc/passwd", "scheme"],
    ["ftp://example.com/x", "scheme"],
    ["gopher://example.com/", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["http://user:pass@example.com/", "credentials"],
    ["http://127.0.0.1/", "blocked_address"],
    ["http://[::1]:8080/", "blocked_address"],
    ["http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["http://[::ffff:7f00:1]/", "blocked_address"],
    ["http://2130706433/", "blocked_address"], // 127.0.0.1 as a number; URL normalises it
    ["http://0x7f.1/", "blocked_address"],
    ["http://localhost:3000/", "blocked_address"],
    ["http://api.localhost/", "blocked_address"],
    ["not a url", "invalid_url"],
  ])("refuses %s (%s)", (url, reason) => {
    expect(() => checkUrl(url)).toThrow(new UnfurlRefusedError(reason));
  });

  it("allows ordinary web URLs", () => {
    expect(checkUrl("https://www.booking.com/hotel/jp/gracery.html").hostname).toBe("www.booking.com");
  });

  it("refuses host names that resolve to private addresses (checked at connect time)", async () => {
    const lookup = guardedLookup("public");
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => lookup("localhost", { all: true }, (e) => resolve(e)));
    expect(error).toBeInstanceOf(UnfurlRefusedError);
  });
});

describe("parsePage", () => {
  const base = new URL("https://example.com/articles/kyoto");

  it("reads Open Graph, resolving relative URLs", () => {
    const meta = parsePage(
      `<!doctype html><html><head>
        <title>Ignored when og:title is set</title>
        <meta property="og:title" content="Kyoto in autumn &amp; winter">
        <meta property="og:site_name" content="Travel Weekly">
        <meta property="og:image" content="/img/kyoto.jpg">
        <link rel="alternate" type="application/json+oembed" href="/oembed?url=x">
      </head><body><meta property="og:title" content="Not this"></body></html>`,
      base,
    );
    expect(meta).toEqual({
      title: "Kyoto in autumn & winter",
      documentTitle: "Ignored when og:title is set",
      siteName: "Travel Weekly",
      image: "https://example.com/img/kyoto.jpg",
      oembed: "https://example.com/oembed?url=x",
    });
  });

  it("falls back to Twitter tags and <title>", () => {
    const meta = parsePage(
      `<head><TITLE>  Plain
         title </TITLE><meta name="twitter:image" content="https://cdn.example.com/a.png"></head>`,
      base,
    );
    expect(meta).toMatchObject({ title: null, documentTitle: "Plain title", siteName: null, image: "https://cdn.example.com/a.png" });
  });

  it("drops non-http image URLs and caps long titles", () => {
    const meta = parsePage(`<meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="${"a".repeat(400)}">`, base);
    expect(meta.image).toBeNull();
    expect(meta.title).toHaveLength(300);
  });

  it("reads oEmbed without its html", () => {
    expect(
      parseOembed({ title: "A video", provider_name: "YouTube", thumbnail_url: "https://i.ytimg.com/x.jpg", html: "<iframe>" }, base),
    ).toEqual({ title: "A video", siteName: "YouTube", image: "https://i.ytimg.com/x.jpg" });
    expect(parseOembed("nonsense", base)).toEqual({ title: null, siteName: null, image: null });
  });
});

/** A local site to unfurl from. Tests use the loopback-only policy, so nothing leaves the machine. */
async function site(handler: RequestListener): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const photo = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: "#2f6f8f" } })
    .withExif({ IFD0: { Copyright: "someone" } })
    .jpeg()
    .toBuffer();

describe("safeFetch", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await site((req, res) => {
      const path = req.url ?? "/";
      if (path === "/redirect") return res.writeHead(302, { location: "/page" }).end();
      if (path === "/redirect-private") return res.writeHead(302, { location: "http://10.0.0.1/" }).end();
      if (path === "/redirect-file") return res.writeHead(302, { location: "file:///etc/passwd" }).end();
      if (path === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (path === "/page") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>Hi</title>");
      if (path === "/big") return res.writeHead(200, { "content-type": "text/html" }).end("x".repeat(3000));
      if (path === "/gzip") {
        return res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync("y".repeat(100_000)));
      }
      if (path === "/slow") return void setTimeout(() => res.writeHead(200, { "content-type": "text/html" }).end("late"), 2000);
      if (path === "/missing") return res.writeHead(404).end();
      if (path === "/json") return res.writeHead(200, { "content-type": "application/json" }).end("{}");
      res.writeHead(500).end();
    }));
  });

  afterAll(() => {
    server?.close();
  });

  const html = { accept: "text/html", contentTypes: (t: string) => t === "text/html", maxBytes: 1000, policy: "loopback-only" as const };

  it("follows redirects and reports the final URL and charset", async () => {
    const response = await safeFetch(`${url}/redirect`, html);
    expect(response.url.pathname).toBe("/page");
    expect(response.charset).toBe("utf-8");
    expect(response.body.toString()).toBe("<title>Hi</title>");
  });

  it("re-checks every redirect", async () => {
    await expect(safeFetch(`${url}/redirect-private`, html)).rejects.toThrow(new UnfurlRefusedError("blocked_address"));
    await expect(safeFetch(`${url}/redirect-file`, html)).rejects.toThrow(new UnfurlRefusedError("scheme"));
    await expect(safeFetch(`${url}/loop`, html)).rejects.toThrow(new UnfurlRefusedError("too_many_redirects"));
  });

  it("refuses loopback under the production policy", async () => {
    await expect(safeFetch(`${url}/page`, { ...html, policy: "public" })).rejects.toThrow(new UnfurlRefusedError("blocked_address"));
  });

  it("caps bodies after decompression: truncates HTML, refuses anything else", async () => {
    expect((await safeFetch(`${url}/big`, { ...html, truncate: true })).body).toHaveLength(1000);
    await expect(safeFetch(`${url}/big`, html)).rejects.toThrow(new UnfurlRefusedError("too_large"));
    await expect(safeFetch(`${url}/gzip`, html)).rejects.toThrow(new UnfurlRefusedError("too_large"));
    expect((await safeFetch(`${url}/gzip`, { ...html, maxBytes: 200_000 })).body.toString()).toBe("y".repeat(100_000));
  });

  it("times out, and refuses unwanted statuses and content types", async () => {
    await expect(safeFetch(`${url}/slow`, { ...html, timeoutMs: 300 })).rejects.toThrow(/abort|timeout/i);
    await expect(safeFetch(`${url}/missing`, html)).rejects.toThrow(new UnfurlRefusedError("status_404"));
    await expect(safeFetch(`${url}/json`, html)).rejects.toThrow(new UnfurlRefusedError("content_type"));
    await expect(safeFetch(`${url}/error`, html)).rejects.not.toBeInstanceOf(UnfurlRefusedError);
  });
});

const ready = Boolean(process.env.DATABASE_URL && process.env.S3_BUCKET);

describe.skipIf(!ready)("link.unfurl", () => {
  let testDb: TestDatabase;
  let storage: Storage;
  let server: Server;
  let url: string;
  const userId = randomUUID();
  const projectId = randomUUID();
  const hits: string[] = [];

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    storage = createStorage(storageConfigFromEnv());
    await testDb.db.insert(schema.users).values({ id: userId, name: "Aiko", email: `aiko-${userId}@example.com` });
    await testDb.db.insert(schema.projects).values({ id: projectId, name: "Trip", ownerId: userId });
    const image = await photo();
    const pixel = await photo(1, 1);
    ({ server, url } = await site((req, res) => {
      const path = req.url ?? "/";
      hits.push(path);
      const page = (head: string) => res.writeHead(200, { "content-type": "text/html" }).end(`<html><head>${head}</head><body></body></html>`);
      if (path === "/ryokan") {
        return page(
          `<title>Doc title</title><meta property="og:title" content="Gion Hatanaka"><meta property="og:site_name" content="Ryokans of Kyoto"><meta property="og:image" content="/photo.jpg">`,
        );
      }
      if (path === "/video") return page(`<title>Watch</title><link rel="alternate" type="application/json+oembed" href="/oembed">`);
      if (path === "/oembed") {
        return res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ title: "Walking Kyoto at night", provider_name: "VideoSite", thumbnail_url: `${url}/photo.jpg` }));
      }
      if (path === "/pixel-page") return page(`<title>Tracked</title><meta property="og:image" content="/pixel.jpg">`);
      if (path === "/svg-page") return page(`<title>Vector</title><meta property="og:image" content="/logo.svg">`);
      if (path === "/private-image") return page(`<title>Sneaky</title><meta property="og:image" content="http://169.254.169.254/latest/meta-data/">`);
      if (path === "/photo.jpg") return res.writeHead(200, { "content-type": "image/jpeg" }).end(image);
      if (path === "/pixel.jpg") return res.writeHead(200, { "content-type": "image/jpeg" }).end(pixel);
      if (path === "/logo.svg") return res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg/>");
      res.writeHead(404).end();
    }));
  });

  afterAll(async () => {
    server?.close();
    await testDb?.drop();
  });

  async function linkEntry(link: string) {
    const [entry] = await testDb.db
      .insert(schema.entries)
      .values({ projectId, authorId: userId, kind: "link", updatedAt: new Date(Date.now() - 60_000) })
      .returning();
    await testDb.db.insert(schema.linkPreviews).values({ entryId: entry!.id, url: link });
    return entry!;
  }
  const preview = async (entryId: string) =>
    (await testDb.db.select().from(schema.linkPreviews).where(eq(schema.linkPreviews.entryId, entryId)))[0]!;
  const unfurl = (entryId: string) => unfurlEntry({ db: testDb.db, storage, policy: "loopback-only" }, entryId);

  it("stores the title and site name and re-hosts the image without metadata", async () => {
    const entry = await linkEntry(`${url}/ryokan`);
    await unfurl(entry.id);

    const row = await preview(entry.id);
    expect(row).toMatchObject({ title: "Gion Hatanaka", siteName: "Ryokans of Kyoto", imageKey: keys.preview(projectId, entry.id) });
    const stored = await sharp(await storage.read(row.imageKey!)).metadata();
    expect(stored).toMatchObject({ format: "webp", width: 1200 });
    expect(stored.exif).toBeUndefined();

    // Live clients hear about it (D-157).
    const [after] = await testDb.db.select().from(schema.entries).where(eq(schema.entries.id, entry.id));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(entry.updatedAt.getTime());
  });

  it("uses oEmbed when the page has no Open Graph", async () => {
    const entry = await linkEntry(`${url}/video`);
    await unfurl(entry.id);
    expect(await preview(entry.id)).toMatchObject({ title: "Walking Kyoto at night", siteName: "VideoSite", imageKey: keys.preview(projectId, entry.id) });
  });

  it("skips tracking pixels, SVGs, and images on private addresses, but keeps the title", async () => {
    for (const path of ["/pixel-page", "/svg-page", "/private-image"]) {
      const entry = await linkEntry(`${url}${path}`);
      await unfurl(entry.id);
      const row = await preview(entry.id);
      expect(row.imageKey).toBeNull();
      expect(row.title).not.toBeNull();
    }
  });

  it("leaves blocked or missing pages as plain links", async () => {
    const entry = await linkEntry(`${url}/missing`);
    await unfurl(entry.id);
    expect(await preview(entry.id)).toMatchObject({ title: null, siteName: null, imageKey: null });

    // Under the production policy the local site is off limits: nothing is fetched.
    const before = hits.length;
    const blocked = await linkEntry(`${url}/ryokan`);
    await unfurlEntry({ db: testDb.db, storage }, blocked.id);
    expect(hits.length).toBe(before);
    expect((await preview(blocked.id)).title).toBeNull();
  });

  it("does nothing for deleted entries", async () => {
    const entry = await linkEntry(`${url}/ryokan`);
    await testDb.db.update(schema.entries).set({ deletedAt: new Date() }).where(eq(schema.entries.id, entry.id));
    const before = hits.length;
    await unfurl(entry.id);
    expect(hits.length).toBe(before);
  });
});
