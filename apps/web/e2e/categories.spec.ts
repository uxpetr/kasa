import { schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

// P-19 (D-201): Kasa Bot sorts posts into categories, shown as chips and stamps. The e2e worker
// runs the stub model, which files each post under its kind ("Notes"), so no model is called.
test.describe("Kasa Bot categories", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Awaited<ReturnType<typeof createUsers<"Mika" | "Aiko">>>;
  let projectId: string;

  test.beforeAll(async () => {
    setup = await createUsers(["Mika", "Aiko"]);
  });
  test.afterAll(async () => {
    await setup?.cleanup();
  });

  async function newPile(notes: string[]) {
    const [project] = await setup.db.insert(schema.projects).values({ name: "Kyoto", ownerId: setup.users.Mika.id }).returning();
    projectId = project!.id;
    await setup.db.insert(schema.memberships).values([
      { projectId, userId: setup.users.Mika.id, role: "owner" },
      { projectId, userId: setup.users.Aiko.id, role: "viewer" },
    ]);
    const rows = [];
    for (const body of notes) {
      const [row] = await setup.db.insert(schema.entries).values({ projectId, authorId: setup.users.Mika.id, kind: "note", body }).returning();
      rows.push(row!);
    }
    return rows;
  }
  async function open(page: Page, who: "Mika" | "Aiko" = "Mika") {
    await page.context().setExtraHTTPHeaders(setup.users[who].headers);
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  }
  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });
  const chips = (page: Page) => page.getByRole("group", { name: "Categories" });
  const post = async (page: Page, text: string) => {
    await page.getByRole("combobox", { name: "Add to Kyoto" }).fill(text);
    await page.keyboard.press("Enter");
    await expect(feed(page).getByText(text)).toBeVisible();
  };

  test("sets up categories at five posts, then sorts each burst with Undo", async ({ page }) => {
    await newPile(["Ramen at Fuunji", "Kiyomizu at dawn", "Train to Nara", "Ryokan near Gion"]);
    await open(page);
    await expect(chips(page)).toHaveCount(0);

    await post(page, "Tea in Uji");
    // The first sort names the pile's categories, then chips and stamps appear, all live.
    await expect(feed(page).getByText("I sorted this pile into Notes.")).toBeVisible({ timeout: 20_000 });
    await expect(chips(page).getByRole("button", { name: "All 5" })).toBeVisible();
    await expect(chips(page).getByRole("button", { name: "Notes 5" })).toBeVisible();
    await expect(feed(page).getByRole("article", { name: "You, note" }).filter({ hasText: "Tea in Uji" })).toContainText("Notes");

    await post(page, "Fushimi Inari hike");
    const receipt = feed(page).getByText("Sorted 1 new thing into Notes.");
    await expect(receipt).toBeVisible({ timeout: 20_000 });
    await expect(chips(page).getByRole("button", { name: "Notes 6" })).toBeVisible();
    await feed(page).getByRole("button", { name: "Undo" }).click();
    await expect(receipt).toBeHidden();
    await expect(chips(page).getByRole("button", { name: "Notes 5" })).toBeVisible();
    await expect(feed(page).getByRole("article", { name: "You, note" }).filter({ hasText: "Fushimi Inari hike" })).not.toContainText("Notes");
  });

  test("filters by a chip, and members move, rename, merge, and remove categories", async ({ page }) => {
    const [ramen, , ryokan] = await newPile(["Ramen at Fuunji", "Kiyomizu at dawn", "Ryokan near Gion"]);
    const [food, stays] = await setup.db
      .insert(schema.categories)
      .values([
        { projectId, name: "Food", createdBy: "bot" },
        { projectId, name: "Stays", createdBy: "bot", createdAt: new Date(Date.now() + 1000) },
      ])
      .returning();
    await setup.db.insert(schema.entryCategories).values([
      { entryId: ramen!.id, categoryId: food!.id, assignedBy: "bot" },
      { entryId: ryokan!.id, categoryId: stays!.id, assignedBy: "bot" },
    ]);
    await setup.db.insert(schema.entries).values({ projectId, authorId: setup.users.Mika.id, kind: "note", body: "Tsukemen instead?", replyToId: ramen!.id });
    await open(page);

    // A filter shows the category's posts with their replies; the order never changes.
    await chips(page).getByRole("button", { name: "Food 1" }).click();
    await expect(chips(page).getByRole("button", { name: "Food 1" })).toHaveAttribute("aria-pressed", "true");
    await expect(feed(page).getByText("Kiyomizu at dawn")).toBeHidden();
    await expect(feed(page).getByText("Tsukemen instead?")).toBeVisible();
    await chips(page).getByRole("button", { name: "All 3" }).click();
    await expect(feed(page).getByText("Kiyomizu at dawn")).toBeVisible();

    // Categories… on a post: tick one, or add a new one.
    const templeNote = feed(page).getByRole("article", { name: "You, note" }).filter({ hasText: "Kiyomizu at dawn" });
    await templeNote.getByRole("button", { name: "Actions for your note" }).click();
    await page.getByRole("menuitem", { name: "Categories…" }).click();
    const checklist = page.getByRole("dialog", { name: "Categories" });
    await checklist.getByPlaceholder("New category").fill("Sights");
    await checklist.getByRole("button", { name: "Add" }).click();
    await expect(checklist.getByRole("checkbox", { name: "Sights" })).toBeChecked();
    await checklist.getByRole("button", { name: "Done" }).click();
    await expect(templeNote).toContainText("Sights");
    await expect(chips(page).getByRole("button", { name: "Sights 1" })).toBeVisible();

    // Edit: rename, merge, remove.
    await page.getByRole("button", { name: "Edit" }).click();
    const editor = page.getByRole("dialog", { name: "Categories" });
    await editor.getByRole("button", { name: "Rename Food" }).click();
    await editor.getByRole("textbox", { name: "New name for Food" }).fill("Eats");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(chips(page).getByRole("button", { name: "Eats 1" })).toBeVisible();

    await editor.getByRole("button", { name: "Merge Sights into…" }).click();
    await editor.getByRole("combobox").selectOption({ label: "Stays" });
    await editor.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(chips(page).getByRole("button", { name: "Stays 2" })).toBeVisible();
    await expect(chips(page).getByRole("button", { name: /^Sights/ })).toHaveCount(0);

    await editor.getByRole("button", { name: "Remove Eats" }).click();
    await editor.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(chips(page).getByRole("button", { name: /^Eats/ })).toHaveCount(0);
    await editor.getByRole("button", { name: "Done" }).click();
    // Removing a category keeps its posts.
    await expect(feed(page).getByRole("article", { name: "You, note" }).filter({ hasText: "Ramen at Fuunji" }).first()).toBeVisible();
  });

  test("viewers see chips and stamps but can't change them", async ({ page }) => {
    const [ramen] = await newPile(["Ramen at Fuunji"]);
    const [food] = await setup.db.insert(schema.categories).values({ projectId, name: "Food", createdBy: "bot" }).returning();
    await setup.db.insert(schema.entryCategories).values({ entryId: ramen!.id, categoryId: food!.id, assignedBy: "bot" });
    await open(page, "Aiko");
    await expect(chips(page).getByRole("button", { name: "Food 1" })).toBeVisible();
    await expect(page.getByText("Sorted by Kasa Bot")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(feed(page).getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  });
});
