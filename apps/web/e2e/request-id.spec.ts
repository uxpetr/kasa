import { expect, test } from "@playwright/test";

test("every response carries a request id", async ({ request }) => {
  const page = await request.get("/");
  expect(page.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

  const api = await request.post("/api/uploads", { data: {}, headers: { "x-request-id": "e2e-request-0001" } });
  expect(api.status()).toBe(401);
  expect(api.headers()["x-request-id"]).toBe("e2e-request-0001");
});
