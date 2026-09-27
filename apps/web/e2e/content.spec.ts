import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { schema } from "@kasa/db";
import { createStorage, storageConfigFromEnv } from "@kasa/media";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr" | "Mika" | "Vera">>>;

test.describe("content types and the actions menu", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika", "Vera"]);
    const { db, users } = setup;
    const storage = createStorage(storageConfigFromEnv());
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values([
      { projectId, userId: users.Petr.id, role: "owner", joinedAt: ago(9000) },
      { projectId, userId: users.Mika.id, role: "editor", joinedAt: ago(9000) },
      { projectId, userId: users.Vera.id, role: "viewer", joinedAt: ago(9000) },
    ]);

    const image = (name: string) => readFileSync(`public/samples/${name}`);
    const put = async (key: string, name: string) => {
      await storage.write(key, image(name), "image/jpeg");
      return key;
    };

    const [photo, capture, link] = await db
      .insert(schema.entries)
      .values([
        { projectId, authorId: users.Mika.id, kind: "photo", body: "Kyoto lanes", createdAt: ago(60) },
        { projectId, authorId: users.Mika.id, kind: "capture", source: "extension", createdAt: ago(50) },
        { projectId, authorId: users.Mika.id, kind: "link", source: "telegram", createdAt: ago(40) },
      ])
      .returning();
    await db.insert(schema.entries).values([
      { projectId, authorId: users.Petr.id, kind: "note", body: "Petr's own note", createdAt: ago(30) },
      { projectId, authorId: users.Mika.id, kind: "note", body: "Ryokan with a private onsen", createdAt: ago(20) },
    ]);

    // A stack of three processed photos.
    for (const [position, name] of ["kinkakuji.jpg", "kiyomizu.jpg", "osaka-castle.jpg"].entries()) {
      const base = `e2e/${projectId}/${position}`;
      const [upload] = await db
        .insert(schema.uploads)
        .values({
          projectId,
          uploaderId: users.Mika.id,
          contentType: "image/jpeg",
          size: 1,
          status: "ready",
          fullKey: await put(`${base}/full.jpg`, name),
          thumbKey: await put(`${base}/thumb.jpg`, name),
          width: 612,
          height: 408,
        })
        .returning();
      await db.insert(schema.entryMedia).values({ entryId: photo!.id, uploadId: upload!.id, storageKey: upload!.fullKey!, role: "photo", position, width: 612, height: 408 });
    }

    // A capture from the extension, with two pins and a comment on pin 1.
    await db.insert(schema.captures).values({ entryId: capture!.id, pageUrl: "https://example.com/tokyo-tower-guide", pageTitle: "A Tokyo Tower guide" });
    await db.insert(schema.entryMedia).values({
      entryId: capture!.id,
      storageKey: await put(`e2e/${projectId}/shot.jpg`, "tokyo-fuji.jpg"),
      role: "screenshot",
      width: 1440,
      height: 900,
    });
    const [pin1] = await db
      .insert(schema.pins)
      .values([
        { captureEntryId: capture!.id, number: 1, x: 0.42, y: 0.31 },
        { captureEntryId: capture!.id, number: 2, x: 0.7, y: 0.18 },
      ])
      .returning();
    await db.insert(schema.comments).values({ entryId: capture!.id, pinId: pin1!.id, authorId: users.Mika.id, body: "Go at sunset?" });

    // A link that came in from Telegram.
    await db.insert(schema.linkPreviews).values({ entryId: link!.id, url: "https://example.com/jr-pass", title: "How to use a JR Pass in Kyoto" });
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const signIn = (page: Page, who: "Petr" | "Mika" | "Vera") => page.context().setExtraHTTPHeaders(setup.users[who].headers);
  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });
  const openFeed = async (page: Page) => {
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  };
  const loaded = (scope: Page | Locator, name: string) =>
    expect.poll(() => scope.getByRole("img", { name }).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  test("renders notes, index cards, taped captures with pins, and photo stacks the same from every source", async ({ page }) => {
    await signIn(page, "Vera");
    await openFeed(page);

    await expect(feed(page).locator(".kasa-sticky").filter({ hasText: "Ryokan with a private onsen" })).toBeVisible();

    const card = feed(page).getByRole("link", { name: /How to use a JR Pass in Kyoto/ });
    await expect(card).toHaveAttribute("href", "https://example.com/jr-pass");
    await expect(card).toContainText("Link · example.com");

    await loaded(page, "Capture of A Tokyo Tower guide");
    const print = feed(page).locator(".kasa-print");
    await expect(print.locator(".kasa-pin")).toHaveText(["1", "2"]);
    await expect(print).toContainText("Go at sunset?");
    await expect(print.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "https://example.com/tokyo-tower-guide");

    await loaded(feed(page), "Kyoto lanes");
    await expect(feed(page).getByLabel("2 more photos")).toBeVisible();
    await feed(page).getByRole("button", { name: "Open 3 photos" }).click();
    const viewer = page.getByRole("dialog", { name: "Photo 1 of 3" });
    await expect(viewer).toBeVisible();
    await loaded(viewer, "Kyoto lanes");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "Photo 2 of 3" })).toBeVisible();
    await page.getByRole("button", { name: "Next photo" }).click();
    await page.getByRole("button", { name: "Next photo" }).click();
    await expect(page.getByRole("dialog", { name: "Photo 1 of 3" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Viewers read but have no actions menu.
    await expect(feed(page).getByRole("button", { name: /^Actions for/ })).toHaveCount(0);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("reacts from the actions menu and toggles from the count", async ({ page }) => {
    await signIn(page, "Mika");
    await openFeed(page);
    const note = feed(page).getByRole("article").filter({ hasText: "Petr's own note" });

    await note.hover();
    await note.getByRole("button", { name: "Actions for Petr's note" }).click();
    const menu = page.getByRole("menu", { name: "Actions for Petr's note" });
    // Mika can react to Petr's note but not delete it.
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await menu.getByRole("menuitemcheckbox", { name: "Heart" }).click();
    await expect(note.getByRole("button", { name: "Heart, 1" })).toHaveAttribute("aria-pressed", "true");

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await signIn(page, "Petr");
    await openFeed(page);
    const petrNote = feed(page).getByRole("article").filter({ hasText: "Petr's own note" });
    await expect(petrNote.getByRole("button", { name: "Heart, 1" })).toHaveAttribute("aria-pressed", "false");
    await petrNote.getByRole("button", { name: "Heart, 1" }).click();
    await expect(petrNote.getByRole("button", { name: "Heart, 2" })).toHaveAttribute("aria-pressed", "true");
    await petrNote.getByRole("button", { name: "Heart, 2" }).click();
    await expect(petrNote.getByRole("button", { name: "Heart, 1" })).toHaveAttribute("aria-pressed", "false");

    // Viewers see the counts but can't change them.
    await signIn(page, "Vera");
    await openFeed(page);
    const veraNote = feed(page).getByRole("article").filter({ hasText: "Petr's own note" });
    await expect(veraNote.getByLabel("Heart, 1")).toBeVisible();
    await expect(veraNote.getByRole("button", { name: /Heart/ })).toHaveCount(0);
  });

  test("long-press opens the actions menu on touch", async ({ page }) => {
    await signIn(page, "Mika");
    await openFeed(page);
    const sticky = feed(page).locator(".kasa-sticky").filter({ hasText: "Petr's own note" });
    await sticky.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect(page.getByRole("menu", { name: "Actions for Petr's note" })).toBeVisible();
    await page.keyboard.press("Escape");
    // A tap that ends quickly doesn't open it.
    await sticky.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await sticky.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(700);
    await expect(page.getByRole("menu", { name: "Actions for Petr's note" })).toBeHidden();
  });

  test("deletes after a confirmation and leaves a dashed outline", async ({ page }) => {
    await signIn(page, "Mika");
    await openFeed(page);
    const note = feed(page).getByRole("article").filter({ hasText: "Ryokan with a private onsen" });
    await note.hover();
    await note.getByRole("button", { name: "Actions for your note" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog", { name: "Delete this note?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(note).toContainText("Ryokan with a private onsen");

    await note.hover();
    await note.getByRole("button", { name: "Actions for your note" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(feed(page).locator(".kasa-deleted")).toHaveText("You deleted a note");
    await expect(feed(page).getByText("Ryokan with a private onsen")).toHaveCount(0);

    // The owner sees who deleted it, and can delete anyone's entry.
    await signIn(page, "Petr");
    await openFeed(page);
    await expect(feed(page).getByText("Mika deleted a note")).toBeVisible();
    const link = feed(page).getByRole("article").filter({ has: page.getByRole("link", { name: /JR Pass/ }) });
    await link.hover();
    await link.getByRole("button", { name: "Actions for Mika's link" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete this link?" }).getByRole("button", { name: "Delete" }).click();
    await expect(feed(page).getByText("You deleted Mika's link")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await signIn(page, "Mika");
    await openFeed(page);
    await expect(feed(page).getByText("Petr deleted your link")).toBeVisible();
  });
});
