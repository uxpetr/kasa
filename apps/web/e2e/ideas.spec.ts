import { schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

// P-20 (D-204): asked for suggestions, Kasa Bot answers with up to three ideas from the web, each
// with "Add to pile", and "More ideas". The e2e worker runs the stub model, whose ideas are made
// up and never fetched, so no model or search is called.
test.describe("Kasa Bot ideas", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Awaited<ReturnType<typeof createUsers<"Mika" | "Aiko">>>;
  let projectId: string;

  test.beforeAll(async () => {
    setup = await createUsers(["Mika", "Aiko"]);
  });
  test.afterAll(async () => {
    await setup?.cleanup();
  });
  test.beforeEach(async () => {
    const [project] = await setup.db.insert(schema.projects).values({ name: "Kyoto", ownerId: setup.users.Mika.id }).returning();
    projectId = project!.id;
    await setup.db.insert(schema.memberships).values([
      { projectId, userId: setup.users.Mika.id, role: "owner" },
      { projectId, userId: setup.users.Aiko.id, role: "viewer" },
    ]);
  });

  async function open(page: Page, who: "Mika" | "Aiko" = "Mika") {
    await page.context().setExtraHTTPHeaders(setup.users[who].headers);
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  }
  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });

  test("adds an idea to the pile as the member's link, and asks for more", async ({ page }) => {
    await open(page);
    await page.getByRole("combobox", { name: "Add to Kyoto" }).fill("@kasa suggest dinner spots near the ryokan");
    await page.keyboard.press("Enter");

    const first = feed(page).getByRole("listitem").filter({ hasText: "Stub idea 1" });
    await expect(first).toBeVisible({ timeout: 20_000 });
    await expect(feed(page).getByRole("link", { name: "Stub idea 3" })).toHaveAttribute("href", "https://example.com/stub-idea-3");

    await first.getByRole("button", { name: "Add Stub idea 1 to pile" }).click();
    await expect(first).toContainText("Added to pile");
    // The link is Mika's, marked as Kasa Bot's idea.
    const link = feed(page).getByRole("article", { name: "You, link" });
    await expect(link).toContainText("from Kasa Bot");
    await expect(link).toContainText("Stub idea 1");

    await feed(page).getByRole("button", { name: "More ideas" }).click();
    await expect(feed(page).getByRole("link", { name: "Stub idea 4" })).toBeVisible({ timeout: 20_000 });
    // The first card keeps its ideas and what was added.
    await expect(first).toContainText("Added to pile");

    // Still added after a reload.
    await page.reload();
    await expect(feed(page).getByRole("listitem").filter({ hasText: "Stub idea 1" })).toContainText("Added to pile");
  });

  test("viewers see the ideas but can't add them", async ({ page }) => {
    const [question] = await setup.db
      .insert(schema.entries)
      .values({ projectId, authorId: setup.users.Mika.id, kind: "note", body: "@kasa suggest a day trip" })
      .returning();
    const [card] = await setup.db.insert(schema.entries).values({ projectId, authorId: null, kind: "bot", replyToId: question!.id, body: "Try these:" }).returning();
    await setup.db.insert(schema.botIdeas).values({ entryId: card!.id, position: 0, url: "https://example.com/nara", title: "Nara Park", note: "Deer, 45 minutes away" });
    await open(page, "Aiko");
    await expect(feed(page).getByRole("link", { name: "Nara Park" })).toBeVisible();
    await expect(feed(page).getByText("Deer, 45 minutes away")).toBeVisible();
    await expect(feed(page).getByRole("button", { name: /to pile$/ })).toHaveCount(0);
    await expect(feed(page).getByRole("button", { name: "More ideas" })).toHaveCount(0);
  });
});
