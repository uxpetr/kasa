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
