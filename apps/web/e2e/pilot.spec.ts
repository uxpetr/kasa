import AxeBuilder from "@axe-core/playwright";
import { desc, eq, inArray, schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { PILOT_ADMIN_EMAIL } from "./support/pilot";
import { createUsers } from "./support/users";

type Who = "Petr" | "Mika";
type Setup = Awaited<ReturnType<typeof createUsers<Who>>>;

const WELCOME =
  "Welcome to Kasa. Paste a link, drop a photo, or write a note. Everything you add lands here, and people you invite can reply to it.";

test.describe("pilot", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let pileId: string;
  const feedbackIds: string[] = [];

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika"]);
    const { db, users } = setup;
    // As sign-up leaves it (D-144, D-180): My pile with Kasa Bot's welcome card.
    const [pile] = await db.insert(schema.projects).values({ name: "My pile", ownerId: users.Mika.id }).returning();
    pileId = pile!.id;
    await db.insert(schema.memberships).values({ projectId: pileId, userId: users.Mika.id, role: "owner" });
    await db.insert(schema.entries).values({ projectId: pileId, authorId: null, kind: "bot", body: WELCOME, botCard: "welcome" });
    // Petr can open /feedback in this run (playwright.config.ts).
    await db.update(schema.users).set({ email: PILOT_ADMIN_EMAIL }).where(eq(schema.users.id, users.Petr.id));
  });

  test.afterAll(async () => {
    if (feedbackIds.length) await setup?.db.delete(schema.feedback).where(inArray(schema.feedback.id, feedbackIds));
    await setup?.cleanup();
  });

  const signIn = (page: Page, who: Who) => page.context().setExtraHTTPHeaders(setup.users[who].headers);

  test("My pile opens with the welcome card, and Start a pile makes a new one", async ({ page }) => {
    await signIn(page, "Mika");
    await page.goto("/");
    // Kasa Bot's card isn't one of your things (D-180).
    await expect(page.getByRole("link", { name: /My pile/ })).toContainText("Just you");
    await page.goto(`/projects/${pileId}`);
    await page.locator("[data-hydrated]").waitFor();
    const card = page.getByRole("article", { name: "Kasa Bot", exact: true });
    await expect(card).toContainText(WELCOME);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await card.getByRole("button", { name: "Start a pile" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Wedding");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page).not.toHaveURL(`/projects/${pileId}`);
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Wedding" })).toBeVisible();
  });

  test("Send feedback from the account menu", async ({ page }) => {
    await signIn(page, "Mika");
    await page.goto("/");
    await page.getByRole("button", { name: "Your account" }).click();
    await page.getByRole("button", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "What's working, what isn't?" });
    await expect(page.locator("#account-menu")).toBeHidden();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole("textbox", { name: "What's working, what isn't?" }).fill("The polaroids are lovely.\nI'd like search.");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("dialog", { name: "Thanks! Petr reads every one." })).toBeVisible();

    const [row] = await setup.db.select().from(schema.feedback).where(eq(schema.feedback.userId, setup.users.Mika.id)).orderBy(desc(schema.feedback.createdAt));
    expect(row).toMatchObject({ body: "The polaroids are lovely.\nI'd like search.", page: "/" });
    feedbackIds.push(row!.id);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Only pilot admins can read it.
    expect((await page.request.get("/feedback")).status()).toBe(404);
    await signIn(page, "Petr");
    await page.goto("/feedback");
    await expect(page.getByRole("heading", { level: 1, name: "Feedback" })).toBeVisible();
    const item = page.getByRole("listitem").filter({ hasText: "The polaroids are lovely." });
    await expect(item).toContainText("Mika");
    await expect(item).toContainText("I'd like search.");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
