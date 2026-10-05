import { expect, test, type Page } from "@playwright/test";
import { VIEWS } from "../app/design/views/registry";

// F-19: /design/views shows the real views with sample data. The preview worker answers every
// /api request from those pages, so none reaches the real API (or needs a database or sign-in).

/** Fails the test if any /api request from the page wasn't answered by the preview worker. */
function guardApi(page: Page) {
  const leaked: string[] = [];
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/api/") && !res.fromServiceWorker()) leaked.push(url.pathname);
  });
  return leaked;
}

const shows: Record<string, (page: Page) => Promise<void>> = {
  piles: (page) => expect(page.getByRole("heading", { name: "Your piles" })).toBeVisible(),
  feed: (page) => expect(page.getByRole("link", { name: /Ryokan Sakura/ }).first()).toBeVisible(),
  answering: (page) => expect(page.getByText("Kasa Bot is answering…")).toBeVisible(),
  "first-run": (page) => expect(page.getByRole("button", { name: "Start a pile" })).toBeVisible(),
  empty: (page) => expect(page.getByText("Nothing here yet.", { exact: false })).toBeVisible(),
  viewer: (page) => expect(page.getByText("You can view this pile but not add to it.")).toBeVisible(),
  archived: (page) => expect(page.getByText("This pile is archived.")).toBeVisible(),
  invite: (page) => expect(page.getByRole("heading", { name: "Join Japan 2027" })).toBeVisible(),
  "invite-expired": (page) => expect(page.getByRole("heading", { name: "This invite has expired" })).toBeVisible(),
  unsubscribe: (page) => expect(page.getByRole("heading", { name: "Emails muted" })).toBeVisible(),
};

test.describe("views preview", () => {
  test("every view renders with sample data, and no request reaches the real API", async ({ page }) => {
    const leaked = guardApi(page);
    expect(Object.keys(shows).sort()).toEqual(VIEWS.map((v) => v.id).sort());
    for (const view of VIEWS) {
      await page.goto(`/design/views/${view.id}`);
      await shows[view.id]!(page);
    }
    expect(leaked).toEqual([]);
  });

  test("the feed takes a note, filters by a chip, opens a photo and the menu, all in the preview", async ({ page }) => {
    const leaked = guardApi(page);
    await page.goto("/design/views/feed");
    await expect(page.locator("[data-hydrated]")).toBeVisible();

    await page.getByRole("combobox", { name: "Add to Japan 2027" }).fill("Trying the preview");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("article").filter({ hasText: "Trying the preview" })).toBeVisible();

    await page.getByRole("button", { name: /^Stays/ }).click();
    await expect(page.getByText("Ramen tip from my cousin", { exact: false })).toBeHidden();
    await expect(page.getByRole("link", { name: /Ryokan Sakura/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^All 9/ })).toBeVisible();

    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByRole("button", { name: "Open photo" }).first().click();
    await expect(page.getByRole("dialog").locator('img[src="/api/media/kinkakuji/full"]')).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Members" }).click();
    await expect(page.getByRole("dialog", { name: "Members" }).getByText("Mika")).toBeVisible();
    expect(leaked).toEqual([]);
  });

  test("app links stay in the preview", async ({ page }) => {
    await page.goto("/design/views/piles");
    await page.getByRole("link", { name: /Japan 2027/ }).click();
    await expect(page).toHaveURL(/\/design\/views\/feed$/);
    await page.getByRole("link", { name: "Back to your piles" }).click();
    await expect(page).toHaveURL(/\/design\/views\/piles$/);
  });

  test("the gallery frames a view at phone and desktop width", async ({ page }) => {
    await page.goto("/design/views#unsubscribe");
    await expect(page.getByRole("heading", { name: "Unsubscribe", level: 2 })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(2);
    for (const title of ["Unsubscribe, phone", "Unsubscribe, desktop"]) {
      await expect(page.frameLocator(`iframe[title="${title}"]`).getByRole("heading", { name: "Emails muted" })).toBeVisible();
    }
    await page.getByRole("button", { name: "Phone", exact: true }).click();
    await expect(page.locator("iframe")).toHaveCount(1);
  });
});
