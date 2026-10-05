// The preview API (F-19). The preview worker sends every /api request from a /design/views page
// here instead. It answers from the sample data and keeps no state: nothing reaches the database,
// auth, storage or the job queue, so it's safe for anyone who opens the preview.
import { NextResponse } from "next/server";
import type { FeedEntry } from "@/lib/entries";
import { isReaction } from "@/lib/reactions";
import { categories, entriesFor, entry, members, page, people, PILE_ID, PILE_NAME, SAMPLE_PHOTOS } from "../../fixtures";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const notInPreview = () => json({ error: "Not available in the preview" }, 503);
const sample = (name: string) => new NextResponse(null, { status: 302, headers: { location: `/samples/${name}.jpg` } });

function findEntry(id: string): FeedEntry | undefined {
  return entriesFor(PILE_ID, Date.now()).find((e) => e.id === id);
}

/** An entry the sample data doesn't have, e.g. one posted in the preview: a note of yours. */
const standIn = (id: string, fields: Partial<FeedEntry> = {}) =>
  entry({ id, kind: "note", author: people.you, createdAt: new Date().toISOString(), ...fields });
const newId = () => `preview-${crypto.randomUUID()}`;

async function body(request: Request): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

async function handle(request: Request, path: string[]): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);
  const [area, id, part, subId, subPart] = path;

  if (area === "media" && id && (SAMPLE_PHOTOS as readonly string[]).includes(id)) return sample(id);

  if (area === "projects" && id) {
    if (part === "entries" && method === "GET") {
      const all = entriesFor(id, Date.now());
      if (url.searchParams.has("since")) {
        return json({ entries: [], syncedAt: new Date().toISOString(), truncated: false, categories: id === PILE_ID ? categories : [], postCount: page(all).postCount });
      }
      if (url.searchParams.has("before")) return json({ ...page([]), categories: id === PILE_ID ? categories : [] });
      const category = url.searchParams.get("category");
      const has = (e: FeedEntry | null) => !!e && e.categories.some((c) => c.id === category);
      // "All" keeps counting every post while a chip is picked.
      return json({ ...page(category ? all.filter((e) => has(e) || has(e.replyTo)) : all, { withCategories: id === PILE_ID }), postCount: page(all).postCount });
    }
    if (part === "entries" && method === "POST") {
      const input = await body(request);
      if (Array.isArray(input.uploadIds) && input.uploadIds.length) return notInPreview();
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return json({ error: "Write something first" }, 400);
      const replyTo = typeof input.replyToId === "string" ? (findEntry(input.replyToId) ?? null) : null;
      return json(standIn(newId(), { body: text, replyTo: replyTo && { ...replyTo, replyTo: null } }), 201);
    }
    if (part === "read") return json({ ok: true });
    // Live updates: "not set up", so the feed doesn't retry.
    if (part === "realtime") return json({ error: "Live updates are off in the preview" }, 503);
    if (part === "members" && method === "GET") return json({ members });
    if (part === "categories" && method === "GET") return json(id === PILE_ID ? categories : []);
    if (part === "invites") return json(method === "DELETE" ? { ok: true } : { url: `${url.origin}/design/views/invite` });
    if (part === "email-mute" && method === "PUT") return json({ muted: (await body(request)).muted === true });
    if (part === "telegram") {
      if (method === "GET") return json({ available: true, linked: null, canLink: true });
      if (method === "POST") return json({ url: "https://t.me/" });
    }
  }

  if (area === "entries" && id) {
    const target = findEntry(id) ?? standIn(id);
    if (part === "preview-image") return sample("kiyomizu");
    if (part === "ideas" && subId && subPart === "image") return sample(subId === "idea-1" ? "higashiyama" : "kiyomizu");
    if (part === "reactions" && (method === "PUT" || method === "DELETE")) {
      const { emoji } = await body(request);
      if (!isReaction(emoji)) return json({ error: "Unknown reaction" }, 400);
      const others = target.reactions.filter((r) => r.emoji !== emoji);
      const current = target.reactions.find((r) => r.emoji === emoji);
      const othersCount = (current?.count ?? 0) - (current?.mine ? 1 : 0);
      const next = method === "PUT" ? { emoji, count: othersCount + 1, mine: true } : othersCount > 0 ? { emoji, count: othersCount, mine: false } : null;
      return json({ reactions: next ? [...others, next] : others });
    }
    if (part === "more-ideas" && method === "POST") {
      return json(standIn(newId(), { kind: "bot", author: null, botCard: "pending", botEntriesRead: 12, replyTo: target.replyTo }));
    }
    if (!part && method === "DELETE") return json({ ...target, deleted: true, deletedBy: people.you, body: null, photos: [], link: null, reactions: [], ideas: [] });
  }

  if (area === "ideas" && id && part === "add" && method === "POST") {
    const idea = findEntry("e-answer")?.ideas.find((i) => i.id === id);
    if (!idea) return json({ error: "Not found" }, 404);
    return json(
      standIn(newId(), { kind: "link", link: { url: idea.url, title: idea.title, siteName: idea.siteName, hasImage: idea.hasImage }, fromBot: true }),
      201,
    );
  }

  if (area === "telegram" && id === "account" && method === "POST") return json({ url: "https://t.me/" });
  if (area === "unsubscribe" && method === "POST") return json({ projectId: PILE_ID, projectName: PILE_NAME, muted: (await body(request)).muted === true });

  return method === "GET" ? json({ error: "Not found" }, 404) : notInPreview();
}

type Context = { params: Promise<{ path: string[] }> };
const route = async (request: Request, { params }: Context) => handle(request, (await params).path);

export { route as DELETE, route as GET, route as PATCH, route as POST, route as PUT };
