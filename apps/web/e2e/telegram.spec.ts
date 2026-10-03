import { schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { E2E_TELEGRAM_SECRET } from "../playwright.config";
import { createUsers } from "./support/users";

// P-18 (D-207): the app side of Telegram sync. The e2e worker has no bot token, so nothing is
// sent to Telegram; group messages are written straight to the database as the worker would.
test.describe("Telegram", () => {
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
      { projectId, userId: setup.users.Aiko.id, role: "editor" },
    ]);
  });

  async function open(page: Page, who: "Mika" | "Aiko" = "Mika") {
    await page.context().setExtraHTTPHeaders(setup.users[who].headers);
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
  }

  test("the owner adds Kasa Bot to a group, sees it linked, and unlinks it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Telegram…" }).click();
    const dialog = page.getByRole("dialog", { name: "Telegram" });
    await expect(dialog).toContainText("Post this pile to a Telegram group, and the group to here.");
    await expect(dialog.getByRole("link", { name: "Add Kasa Bot to a group" })).toHaveAttribute("href", /^https:\/\/t\.me\/kasa_e2e_bot\?startgroup=[\w-]{20,}$/);

    // The bot joins the group (the worker's part), and the open dialog notices.
    await setup.db.insert(schema.telegramLinks).values({ projectId, chatId: `-100${Date.now()}`, chatTitle: "Kyoto trip 🇯🇵", linkedBy: setup.users.Mika.id });
    await expect(dialog).toContainText("Linked to Kyoto trip 🇯🇵", { timeout: 10_000 });
    await dialog.getByRole("button", { name: "Unlink" }).click();
    await expect(dialog).toBeHidden();
  });

  test("only the owner sees Telegram in the pile menu", async ({ page }) => {
    await open(page, "Aiko");
    await page.getByRole("button", { name: "Project menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Telegram…" })).toHaveCount(0);
  });

  test("group messages show as via Telegram, guests by their Telegram name", async ({ page }) => {
    await setup.db.insert(schema.entries).values([
      { projectId, authorId: null, guestName: "Kenji", kind: "note", body: "Count me in for ramen", source: "telegram" },
      { projectId, authorId: setup.users.Aiko.id, kind: "note", body: "Booked the ryokan", source: "telegram" },
    ]);
    await open(page);
    const feed = page.getByRole("region", { name: "Feed" });
    const guest = feed.getByRole("article", { name: "Kenji (guest), note" });
    await expect(guest).toContainText("Kenji (guest)");
    await expect(guest).toContainText("via Telegram");
    await expect(feed.getByRole("article", { name: "Aiko, note" })).toContainText("via Telegram");
  });

  test("people link their Telegram from the account menu", async ({ page }) => {
    await page.context().setExtraHTTPHeaders(setup.users.Aiko.headers);
    await page.goto("/");
    await page.getByRole("button", { name: "Your account" }).click();
    await expect(page.getByRole("button", { name: "Link Telegram" })).toBeVisible();
  });

  test("the webhook takes only Telegram's secret", async ({ request }) => {
    const update = { update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, date: 0, text: "hi" } };
    expect((await request.post("/api/telegram/webhook", { data: update })).status()).toBe(401);
    expect((await request.post("/api/telegram/webhook", { data: update, headers: { "x-telegram-bot-api-secret-token": "wrong" } })).status()).toBe(401);
    expect((await request.post("/api/telegram/webhook", { data: update, headers: { "x-telegram-bot-api-secret-token": E2E_TELEGRAM_SECRET } })).status()).toBe(200);
  });
});
