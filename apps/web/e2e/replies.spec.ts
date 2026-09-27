import AxeBuilder from "@axe-core/playwright";
import { schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr" | "Mika">>>;

test.describe("replies", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika"]);
    const { db, users } = setup;
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values([
      { projectId, userId: users.Petr.id, role: "owner" },
      { projectId, userId: users.Mika.id, role: "editor" },
    ]);
    // An old note, more than a page back, then filler, then a reply to the old note.
    const [first] = await db
      .insert(schema.entries)
      .values({ projectId, authorId: users.Petr.id, kind: "note", body: "The very first idea: Kyoto in autumn", createdAt: ago(5000) })
      .returning();
    await db.insert(schema.entries).values([
      ...Array.from({ length: 40 }, (_, i) => ({ projectId, authorId: users.Mika.id, kind: "note" as const, body: `Filler ${i + 1}`, createdAt: ago(4000 - i) })),
      { projectId, authorId: users.Mika.id, kind: "note", body: "Still the best plan", replyToId: first!.id, createdAt: ago(30) },
      { projectId, authorId: users.Petr.id, kind: "note", body: "Ryokan with a private onsen", createdAt: ago(10) },
    ]);
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });
  const openFeed = async (page: Page, who: "Petr" | "Mika") => {
    await page.context().setExtraHTTPHeaders(setup.users[who].headers);
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  };

  test("replies from the actions menu; the answer is clipped to a print of the original", async ({ page }) => {
    await openFeed(page, "Mika");
    const note = feed(page).getByRole("article").filter({ hasText: "Ryokan with a private onsen" }).first();

    // Escape backs out of a reply.
    await note.hover();
    await note.getByRole("button", { name: "Actions for Petr's note" }).click();
    await page.getByRole("menuitem", { name: "Reply" }).click();
    await expect(page.getByText("Replying to Petr's note")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reply to Petr's note" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Replying to Petr's note")).toHaveCount(0);

    await note.hover();
    await note.getByRole("button", { name: "Actions for Petr's note" }).click();
    await page.getByRole("menuitem", { name: "Reply" }).click();
    await page.keyboard.type("Yes! Let's book it.");
    await page.keyboard.press("Enter");

    const reply = feed(page).getByRole("article").filter({ hasText: "Yes! Let's book it." });
    await expect(reply.getByRole("button", { name: "Go to Petr's note" })).toContainText("Ryokan with a private onsen");
    await expect(page.getByText("Replying to Petr's note")).toHaveCount(0);

    // It stays a reply after a reload, and Petr sees it the same way.
    await openFeed(page, "Petr");
    await expect(
      feed(page).getByRole("article").filter({ hasText: "Yes! Let's book it." }).getByRole("button", { name: "Go to your note" }),
    ).toContainText("Ryokan with a private onsen");

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("tapping the clipped print jumps to the original, loading older entries if needed", async ({ page }) => {
    await openFeed(page, "Petr");
    // The reply's print quotes the same words, so leave out articles with a print.
    const original = feed(page).getByRole("article").filter({ hasText: "The very first idea", hasNot: page.getByRole("button", { name: /^Go to/ }) });
    await expect(original).toHaveCount(0);

    const reply = feed(page).getByRole("article").filter({ hasText: "Still the best plan" });
    await reply.getByRole("button", { name: "Go to your note" }).click();
    await expect(original.first()).toBeInViewport();
    await expect(original.first()).toBeFocused();
  });

  test("fits a phone, with the print above the answer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFeed(page, "Mika");
    await expect(feed(page).getByText("Still the best plan")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
