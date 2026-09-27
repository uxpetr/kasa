import AxeBuilder from "@axe-core/playwright";
import { eq, schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr" | "Mika" | "Vera">>>;

test.describe("zen chat feed", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika", "Vera"]);
    const { db, users } = setup;
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values([
      { projectId, userId: users.Petr.id, role: "owner", joinedAt: ago(9000) },
      { projectId, userId: users.Mika.id, role: "editor", joinedAt: ago(9000) },
      { projectId, userId: users.Vera.id, role: "viewer", joinedAt: ago(9000) },
    ]);
    // 45 older notes (more than one page), then Mika's latest.
    await db.insert(schema.entries).values([
      ...Array.from({ length: 45 }, (_, i) => ({ projectId, authorId: users.Mika.id, kind: "note" as const, body: `Idea ${i + 1}`, createdAt: ago(3000 - i) })),
      { projectId, authorId: users.Mika.id, kind: "note", body: "Yes! Let's make it our first evening in Tokyo.", createdAt: ago(5) },
    ]);
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const signIn = (page: Page, who: "Petr" | "Mika" | "Vera") => page.context().setExtraHTTPHeaders(setup.users[who].headers);
  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });
  /** Opens the feed and waits until React has wired up the menu and composer. */
  const openFeed = async (page: Page) => {
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  };

  test("opens at the newest entry, pages back through history, and marks the pile read", async ({ page }) => {
    await signIn(page, "Petr");
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Japan 2027/ })).toContainText("46 new");

    await page.getByRole("link", { name: /Japan 2027/ }).click();
    await page.locator("[data-hydrated]").waitFor();
    await expect(feed(page).getByText("Yes! Let's make it our first evening in Tokyo.")).toBeInViewport();
    await expect(feed(page).getByText("Idea 1", { exact: true })).toHaveCount(0);

    // Scrolling to the top loads the older page.
    await page.mouse.wheel(0, -100_000);
    await expect(feed(page).getByText("Idea 1", { exact: true })).toHaveCount(1);
    await expect(feed(page).getByRole("article")).toHaveCount(46);

    await page.getByRole("link", { name: "Back to your piles" }).click();
    await expect(page.getByRole("link", { name: /Japan 2027/ })).not.toContainText("new");
  });

  test("sends notes, links, and photos from the composer", async ({ page }) => {
    await signIn(page, "Mika");
    await openFeed(page);
    const composer = page.getByRole("combobox", { name: "Add to Japan 2027" });

    await composer.fill("Ramen at Fuunji?");
    await composer.press("Enter");
    await expect(feed(page).getByRole("article").last()).toContainText("Ramen at Fuunji?");
    await expect(composer).toHaveValue("");

    // Only a URL: a link entry (D-149).
    await composer.fill("https://www.booking.com/hotel/jp/gracery.html");
    await composer.press("Enter");
    const link = feed(page).getByRole("link", { name: /booking\.com/ }).last();
    await expect(link).toHaveAttribute("href", "https://www.booking.com/hotel/jp/gracery.html");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // Text around a URL: a note with the URL clickable.
    await composer.fill("see https://example.com/tips first");
    await composer.press("Enter");
    await expect(feed(page).getByRole("article").last().getByRole("link", { name: "https://example.com/tips" })).toBeVisible();

    // A photo with a caption: one photo entry (D-150), processed by the worker.
    await page.locator('input[type="file"]').setInputFiles("public/samples/higashiyama.jpg");
    await expect(page.getByRole("img", { name: "higashiyama.jpg" })).toBeVisible();
    await composer.fill("Kyoto lanes");
    await page.getByRole("button", { name: "Send" }).click();
    const photo = feed(page).getByRole("img", { name: "Kyoto lanes" });
    await expect(photo).toBeVisible({ timeout: 30_000 });
    // The thumbnail is at most 640px wide (the sample is 612px, and the worker never upscales).
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(612);

    // Everything survives a reload.
    await page.reload();
    await expect(feed(page).getByText("Kyoto lanes")).toBeVisible();
    await expect(feed(page).getByText("Ramen at Fuunji?")).toBeVisible();
  });

  test("refuses files that aren't supported images before uploading", async ({ page }) => {
    await signIn(page, "Mika");
    await openFeed(page);
    await page.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(page.getByRole("contentinfo").getByRole("alert")).toHaveText("Unsupported file type");
  });

  test("the menu lists members, renames, and has search coming soon", async ({ page }) => {
    await signIn(page, "Petr");
    await openFeed(page);
    await page.getByRole("button", { name: "Project menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Search (coming soon)" })).toBeDisabled();

    await page.getByRole("menuitem", { name: "Members" }).click();
    const members = page.getByRole("dialog", { name: "Members" });
    await expect(members.getByRole("listitem")).toHaveText([/Petr\s*Owner/, /Mika\s*Editor/, /Vera\s*Viewer/]);
    await members.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const rename = page.getByRole("dialog", { name: "Rename" });
    await rename.getByLabel("Name").fill("Japan 2028");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Japan 2028" })).toBeVisible();
    await setup.db.update(schema.projects).set({ name: "Japan 2027" }).where(eq(schema.projects.id, projectId));
  });

  test("viewers read without a composer", async ({ page }) => {
    await signIn(page, "Vera");
    await openFeed(page);
    await expect(page.getByText("You can view this pile but not add to it.")).toBeVisible();
    await expect(page.getByRole("combobox", { name: /Add to/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Project menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveCount(0);
  });

  test("archiving freezes the feed until the owner unarchives it", async ({ page }) => {
    await signIn(page, "Petr");
    await openFeed(page);
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("This pile is archived.")).toBeVisible();
    await expect(page.getByRole("combobox", { name: /Add to/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByRole("combobox", { name: "Add to Japan 2027" })).toBeVisible();
  });

  test("has no axe violations and fits a phone", async ({ page }) => {
    await signIn(page, "Petr");
    await openFeed(page);
    const report = (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
    expect(report).toEqual([]);
    await page.getByRole("button", { name: "Project menu" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await openFeed(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
