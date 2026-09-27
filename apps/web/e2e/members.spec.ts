import AxeBuilder from "@axe-core/playwright";
import { and, eq, schema } from "@kasa/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Who = "Petr" | "Mika" | "Aiko" | "Vera";
type Setup = Awaited<ReturnType<typeof createUsers<Who>>>;

test.describe("members", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika", "Aiko", "Vera"]);
    const { db, users } = setup;
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values([
      { projectId, userId: users.Petr.id, role: "owner" },
      { projectId, userId: users.Mika.id, role: "editor" },
      { projectId, userId: users.Aiko.id, role: "editor" },
      { projectId, userId: users.Vera.id, role: "viewer" },
    ]);
    await db.insert(schema.entries).values({ projectId, authorId: users.Mika.id, kind: "note", body: "Mika's ryokan idea" });
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const roleOf = async (who: Who) =>
    (
      await setup.db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, setup.users[who].id)))
    )[0]?.role ?? null;

  async function open(browser: Browser, who: Who, live = false) {
    const context = await browser.newContext({ extraHTTPHeaders: setup.users[who].headers });
    const page = await context.newPage();
    const ready = live
      ? page
          .waitForEvent("websocket", (ws) => ws.url().includes("ticket="))
          .then((ws) => ws.waitForEvent("framereceived", (frame) => String(frame.payload).includes('"ready"')))
      : null;
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
    await ready;
    return page;
  }

  async function openMembers(page: Page) {
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Members" }).click();
    const dialog = page.getByRole("dialog", { name: "Members" });
    await expect(dialog.getByRole("listitem")).not.toHaveCount(0);
    return dialog;
  }

  test("others see the list read-only, and can leave", async ({ browser }) => {
    const vera = await open(browser, "Vera");
    const dialog = await openMembers(vera);
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(dialog.getByRole("listitem").filter({ hasText: "Petr" })).toContainText("Owner");

    await dialog.getByRole("button", { name: "Leave this pile" }).click();
    const confirm = vera.getByRole("dialog", { name: "Leave Japan 2027?" });
    await expect(confirm).toContainText("Your entries stay in the pile. You'll need a new invite to come back.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    expect(await roleOf("Vera")).toBe("viewer");

    await dialog.getByRole("button", { name: "Leave this pile" }).click();
    await confirm.getByRole("button", { name: "Leave" }).click();
    await expect(vera).toHaveURL("/");
    expect(await roleOf("Vera")).toBeNull();
    await vera.goto(`/projects/${projectId}`);
    await expect(vera.getByText("Mika's ryokan idea")).toHaveCount(0);
  });

  test("the owner changes roles and removes members; a removed member's open feed closes", async ({ browser }) => {
    const petr = await open(browser, "Petr");
    const mika = await open(browser, "Mika", true);
    const dialog = await openMembers(petr);

    // The owner can't leave, and their own row has no controls (D-169).
    await expect(dialog.getByRole("button", { name: "Leave this pile" })).toHaveCount(0);
    await expect(dialog.getByRole("listitem").filter({ hasText: "Petr" }).getByRole("combobox")).toHaveCount(0);

    await dialog.getByRole("combobox", { name: "Role for Aiko" }).selectOption("viewer");
    await expect.poll(() => roleOf("Aiko")).toBe("viewer");

    const results = await new AxeBuilder({ page: petr }).analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole("listitem").filter({ hasText: "Mika" }).getByRole("button", { name: "Remove" }).click();
    const confirm = petr.getByRole("dialog", { name: "Remove Mika from Japan 2027?" });
    await expect(confirm).toContainText("Their entries stay in the pile.");
    await confirm.getByRole("button", { name: "Remove" }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "Mika" })).toHaveCount(0);
    expect(await roleOf("Mika")).toBeNull();

    // Mika had the feed open: she's sent to Your piles right away (D-171).
    await expect(mika).toHaveURL("/", { timeout: 5000 });

    // Her entries stay.
    await petr.keyboard.press("Escape");
    await expect(petr.getByText("Mika's ryokan idea")).toBeVisible();
  });

  test("fits a phone", async ({ browser }) => {
    const petr = await open(browser, "Petr");
    await petr.setViewportSize({ width: 390, height: 844 });
    await openMembers(petr);
    expect(await petr.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
