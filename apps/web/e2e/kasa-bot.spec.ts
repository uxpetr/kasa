import { eq, schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { BOT_CARD_TEXT } from "../lib/bot-cards";
import { createUsers } from "./support/users";

// P-17: tagging @kasa gets an answer on a bot card. The e2e worker runs the stub model, so no model is called.
test.describe("Kasa Bot", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Awaited<ReturnType<typeof createUsers<"Mika">>>;
  let projectId: string;

  test.beforeAll(async () => {
    setup = await createUsers(["Mika"]);
    const [project] = await setup.db.insert(schema.projects).values({ name: "Japan 2027", ownerId: setup.users.Mika.id }).returning();
    projectId = project!.id;
    await setup.db.insert(schema.memberships).values({ projectId, userId: setup.users.Mika.id, role: "owner" });
    await setup.db.insert(schema.entries).values({ projectId, authorId: setup.users.Mika.id, kind: "note", body: "Ramen at Fuunji?" });
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });
  const bot = (page: Page) => feed(page).getByRole("article", { name: "Kasa Bot", exact: true });

  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders(setup.users.Mika.headers);
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  });

  test("answers a tag on an untilted bot card", async ({ page }) => {
    const input = page.getByRole("combobox", { name: "Add to Japan 2027" });
    await input.fill("@kasa where should we eat?");
    await page.keyboard.press("Enter");
    await expect(feed(page).getByRole("article").filter({ hasText: "@kasa where should we eat?" })).toBeVisible();
    // The stub reports how much of the pile it read: the note, the question.
    await expect(bot(page)).toContainText("(Stub answer, no model.) I read 2 entries in this pile.", { timeout: 20_000 });
    await expect(bot(page)).not.toContainText(BOT_CARD_TEXT.pending!);
    expect(await bot(page).evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });

  test("says why when it can't answer", async ({ page }) => {
    for (const state of ["pending", "failed", "paused", "limited"] as const) {
      const [card] = await setup.db.insert(schema.entries).values({ projectId, authorId: null, kind: "bot", botCard: state }).returning();
      await page.reload();
      await expect(feed(page).getByText(BOT_CARD_TEXT[state]!)).toBeVisible();
      await setup.db.delete(schema.entries).where(eq(schema.entries.id, card!.id));
    }
  });
});
