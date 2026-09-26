import AxeBuilder from "@axe-core/playwright";
import { schema } from "@kasa/db";
import { expect, test } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr" | "Mika">>>;

test.describe("projects screen", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  const ids = {} as { trip: string; solo: string; old: string };

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika"]);
    const { db, users } = setup;
    const ago = (min: number) => new Date(Date.now() - min * 60_000);
    const [trip, solo, old] = await db
      .insert(schema.projects)
      .values([
        { name: "Japan 2027", ownerId: users.Petr.id, createdAt: ago(600) },
        { name: "My pile", ownerId: users.Petr.id, createdAt: ago(900) },
        { name: "Lisbon 2025", ownerId: users.Petr.id, createdAt: ago(9000), archivedAt: ago(100) },
      ])
      .returning();
    Object.assign(ids, { trip: trip!.id, solo: solo!.id, old: old!.id });
    await db.insert(schema.memberships).values([
      { projectId: trip!.id, userId: users.Petr.id, role: "owner", joinedAt: ago(600), lastReadAt: ago(120) },
      { projectId: trip!.id, userId: users.Mika.id, role: "editor", joinedAt: ago(500) },
      { projectId: solo!.id, userId: users.Petr.id, role: "owner" },
      { projectId: old!.id, userId: users.Petr.id, role: "owner" },
    ]);
    await db.insert(schema.entries).values([
      { projectId: trip!.id, authorId: users.Mika.id, kind: "note", body: "Ramen at Fuunji?", createdAt: ago(60) },
      { projectId: trip!.id, authorId: users.Mika.id, kind: "note", body: "Yes! Let's make it our first evening in Tokyo.", createdAt: ago(30) },
      { projectId: solo!.id, authorId: users.Petr.id, kind: "note", body: "saved", createdAt: ago(800) },
    ]);
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  test.use({ extraHTTPHeaders: {} });

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(setup.users.Petr.headers);
  });

  test("shows each pile with its last message, unread count, and members", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Your piles" })).toBeVisible();

    const trip = page.getByRole("link", { name: /Japan 2027/ });
    await expect(trip).toContainText("2 new");
    await expect(trip).toContainText("Mika: Yes! Let's make it our first evening in Tokyo.");
    await expect(trip.getByRole("img", { name: "2 members: Petr, Mika" })).toBeVisible();
    await expect(trip).toHaveAttribute("href", `/projects/${ids.trip}`);

    // One member: a sticky that says how much is in it.
    const solo = page.getByRole("link", { name: /My pile/ });
    await expect(solo).toContainText("Just you · 1 thing saved");
    const grid = page.locator("main > ul");
    await expect(grid.locator(".kasa-pile[data-personal]")).toHaveCount(1);

    // Most recent activity first.
    await expect(grid.locator(".kasa-pile-title")).toHaveText(["Japan 2027", "My pile"]);
  });

  test("keeps archived piles in a collapsed section", async ({ page }) => {
    await page.goto("/");
    const lisbon = page.getByRole("link", { name: /Lisbon 2025/ });
    await expect(lisbon).toBeHidden();
    await page.getByText("Archived (1)").click();
    await expect(lisbon).toBeVisible();
  });

  test("creates a project from the dialog and opens it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "+ New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog.getByLabel("Name")).toBeFocused();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "+ New project" }).click();
    await dialog.getByLabel("Name").fill("Wedding planning");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Wedding planning" })).toBeVisible();

    await page.getByRole("link", { name: "← Your piles" }).click();
    await expect(page.getByRole("link", { name: /Wedding planning/ })).toBeVisible();
  });

  test("hides other people's projects", async ({ page, context }) => {
    await context.setExtraHTTPHeaders(setup.users.Mika.headers);
    expect((await page.goto(`/projects/${ids.solo}`))?.status()).toBe(404);
    expect((await page.goto(`/projects/${ids.trip}`))?.status()).toBe(200);
  });

  test("opens the account menu and never tilts past 2.5°", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Your account" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");

    const angles = await page.locator(".kasa-pile-top, .kasa-pile-sheet").evaluateAll((els) =>
      els.map((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI);
      }),
    );
    expect(angles.length).toBeGreaterThanOrEqual(4);
    for (const a of angles) expect(a).toBeLessThanOrEqual(2.5001);
  });

  test("has no axe violations, with the dialog open too", async ({ page }) => {
    await page.goto("/");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "+ New project" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("fits a phone screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your piles" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
