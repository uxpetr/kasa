import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Kasa");
  await expect(page.getByRole("main")).toContainText("Kasa");
});
