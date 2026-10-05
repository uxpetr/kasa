// The views preview's service worker (F-19). It's registered with the scope /design/, so it only
// sees requests from /design pages, never from the app itself. It sends every /api request from
// those pages to the preview API at /design/views/api, which answers from sample data; nothing
// from the preview reaches the real API. It caches nothing.
const PREVIEW_API = "/design/views/api";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/")) return;
  event.respondWith(toPreview(event.request, url));
});

async function toPreview(request, url) {
  const target = `${PREVIEW_API}${url.pathname.slice("/api".length)}${url.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(target, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    credentials: "omit",
    redirect: "follow",
  });
}
