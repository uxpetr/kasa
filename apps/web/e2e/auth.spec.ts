import { expect, test } from "@playwright/test";

// Needs GOOGLE_CLIENT_ID set (a dummy value is fine); Google itself is never contacted.
test("Sign in with Google redirects to Google's consent screen", async ({ page }) => {
  test.skip(!process.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID not set");

  let googleUrl: URL | undefined;
  await page.route("https://accounts.google.com/**", async (route) => {
    googleUrl = new URL(route.request().url());
    await route.fulfill({ status: 200, body: "stubbed Google" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByText("stubbed Google")).toBeVisible();

  expect(googleUrl?.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
  expect(googleUrl?.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/google$/);
  expect(googleUrl?.searchParams.get("state")).toBeTruthy();
});
