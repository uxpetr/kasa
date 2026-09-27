import { expect, test } from "@playwright/test";

// Every media route needs a session (cookie or extension bearer token).
test("upload and media routes reject anonymous requests", async ({ request }) => {
  const id = "00000000-0000-4000-8000-000000000001";
  expect((await request.post("/api/uploads", { data: { projectId: id, contentType: "image/png", size: 1 } })).status()).toBe(401);
  expect((await request.post(`/api/uploads/${id}/complete`)).status()).toBe(401);
  expect((await request.get(`/api/media/${id}/thumb`, { maxRedirects: 0 })).status()).toBe(401);
  expect(
    (await request.post("/api/uploads", { headers: { authorization: "Bearer not-a-real-token" }, data: {} })).status(),
  ).toBe(401);
});

test("project and invite routes reject anonymous requests", async ({ request }) => {
  const id = "00000000-0000-4000-8000-000000000001";
  const token = "x".repeat(43);
  expect((await request.get("/api/projects")).status()).toBe(401);
  expect((await request.post("/api/projects", { data: { name: "x" } })).status()).toBe(401);
  expect((await request.patch(`/api/projects/${id}`, { data: { name: "x" } })).status()).toBe(401);
  expect((await request.get(`/api/projects/${id}/invites`)).status()).toBe(401);
  expect((await request.post(`/api/projects/${id}/invites`)).status()).toBe(401);
  expect((await request.delete(`/api/projects/${id}/invites`)).status()).toBe(401);
  // The preview is public, for the invite page (D-174): an unknown token is simply not found.
  expect((await request.get(`/api/invites/${token}`)).status()).toBe(404);
  expect((await request.post(`/api/invites/${token}/accept`)).status()).toBe(401);
  expect((await request.patch(`/api/projects/${id}/members/${id}`, { data: { role: "viewer" } })).status()).toBe(401);
  expect((await request.delete(`/api/projects/${id}/members/${id}`)).status()).toBe(401);
  expect((await request.put(`/api/projects/${id}/email-mute`, { data: { muted: true } })).status()).toBe(401);
});
