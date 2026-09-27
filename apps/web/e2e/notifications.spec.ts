import AxeBuilder from "@axe-core/playwright";
import { and, eq, schema } from "@kasa/db";
import { createUnsubscribeToken } from "@kasa/shared/unsubscribe";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr" | "Mika">>>;

test.describe("notifications", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika"]);
    const { db, users } = setup;
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values([
      { projectId, userId: users.Petr.id, role: "owner" },
      { projectId, userId: users.Mika.id, role: "editor" },
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
  const membership = async (who: "Petr" | "Mika") =>
    (
      await setup.db
        .select()
        .from(schema.memberships)
        .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, setup.users[who].id)))
    )[0]!;

  test("@ suggests members and Kasa Bot; picking someone notifies them", async ({ page }) => {
    await openFeed(page, "Mika");
    const input = page.getByRole("combobox", { name: "Add to Japan 2027" });
    await input.pressSequentially("Should we book it, @");
    const list = page.getByRole("listbox", { name: "Mention someone" });
    const options = (names: string[]) =>
      expect.poll(() => list.getByRole("option").evaluateAll((els) => els.map((el) => el.textContent?.slice(1)))).toEqual(names);
    await options(["Petr", "Kasa Bot"]);
    await expect(list.getByRole("option", { name: "Petr", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute("aria-expanded", "true");

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await input.pressSequentially("pe");
    await options(["Petr"]);
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await expect(input).toHaveValue("Should we book it, @Petr ");
    await input.pressSequentially("?");
    await page.keyboard.press("Enter");
    const sent = feed(page).getByRole("article").filter({ hasText: "Should we book it, @Petr ?" });
    await expect(sent).toBeVisible();

    // Petr is notified; the worker (without a Resend key) handles it within moments.
    const notification = async () =>
      (await setup.db.select().from(schema.notifications).where(eq(schema.notifications.userId, setup.users.Petr.id)))[0];
    await expect.poll(async () => (await notification())?.kind).toBe("mention");
    await expect.poll(async () => Boolean((await notification())?.handledAt), { timeout: 15_000 }).toBe(true);

    // Escape closes the list; typing "@Petr" by hand notifies no one (D-164).
    await input.pressSequentially("@ka");
    await options(["Kasa Bot"]);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await input.fill("Typed by hand: @Petr today");
    await page.keyboard.press("Enter");
    await expect(feed(page).getByText("Typed by hand: @Petr today")).toBeVisible();
    expect(await setup.db.select().from(schema.notifications).where(eq(schema.notifications.userId, setup.users.Petr.id))).toHaveLength(1);
  });

  test("mute and unmute emails from the project menu", async ({ page }) => {
    await openFeed(page, "Petr");
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Mute emails" }).click();
    await expect.poll(async () => (await membership("Petr")).emailsMuted).toBe(true);

    await page.reload();
    await page.locator("[data-hydrated]").waitFor();
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Unmute emails" }).click();
    await expect.poll(async () => (await membership("Petr")).emailsMuted).toBe(false);
    await page.getByRole("button", { name: "Project menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Mute emails" })).toBeVisible();
  });

  test("the unsubscribe link mutes in one click, without signing in", async ({ page }) => {
    const token = createUnsubscribeToken(process.env.UNSUBSCRIBE_SECRET!, { userId: setup.users.Mika.id, projectId });
    await page.goto(`/unsubscribe?token=${encodeURIComponent(token)}`);
    await expect(page.getByRole("heading", { name: "Emails muted" })).toBeVisible();
    await expect(page.getByText("You won't get emails about Japan 2027 anymore. Everything is still in the pile.")).toBeVisible();
    expect((await membership("Mika")).emailsMuted).toBe(true);
    await expect(page.getByRole("link", { name: "Open Japan 2027" })).toHaveAttribute("href", `/projects/${projectId}`);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole("button", { name: "Unmute" }).click();
    await expect(page.getByRole("status")).toHaveText("Emails are on again for Japan 2027.");
    expect((await membership("Mika")).emailsMuted).toBe(false);

    // Mail apps' one-click unsubscribe (RFC 8058) posts straight to the API.
    const res = await page.request.post(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
      form: { "List-Unsubscribe": "One-Click" },
    });
    expect(res.ok()).toBe(true);
    expect((await membership("Mika")).emailsMuted).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/unsubscribe?token=forged");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("This link isn't valid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
