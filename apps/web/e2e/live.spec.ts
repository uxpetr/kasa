import { schema } from "@kasa/db";
import { expect, test, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr" | "Mika">>>;

test.describe("live updates", () => {
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
    await db.insert(schema.entries).values({ projectId, authorId: users.Petr.id, kind: "note", body: "Starting a pile for the trip." });
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });

  /** Opens the feed; `ready` resolves once the live connection is up (defaults to watching the page's socket). */
  async function open(browser: Browser, who: "Petr" | "Mika", route?: (page: Page) => Promise<{ ready: Promise<void> }>) {
    const context = await browser.newContext({ extraHTTPHeaders: setup.users[who].headers });
    const page = await context.newPage();
    // Wait for the live connection before acting, so the test measures delivery, not connecting.
    // (Wrapped in an object: awaiting a promise of a promise would wait for the connection before loading.)
    const ready = route
      ? (await route(page)).ready
      : page
          .waitForEvent("websocket", (ws) => ws.url().includes("ticket="))
          .then((ws) => ws.waitForEvent("framereceived", (frame) => String(frame.payload).includes('"ready"')))
          .then(() => {});
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
    await ready;
    return page;
  }

  async function post(page: Page, text: string) {
    await page.getByRole("textbox").fill(text);
    await page.keyboard.press("Enter");
    await expect(feed(page).getByText(text)).toBeVisible();
  }

  test("new entries, reactions, and deletions reach other members within 2 seconds", async ({ browser }) => {
    const petr = await open(browser, "Petr");
    const mika = await open(browser, "Mika");

    await post(mika, "Ryokan with a private onsen");
    await expect(feed(petr).getByText("Ryokan with a private onsen")).toBeVisible({ timeout: 2000 });
    // Petr is at the bottom, so the feed follows the new entry.
    await expect(feed(petr).getByText("Ryokan with a private onsen")).toBeInViewport();

    const note = feed(petr).getByRole("article").filter({ hasText: "Starting a pile" });
    await note.hover();
    await note.getByRole("button", { name: "Actions for your note" }).click();
    await petr.getByRole("menuitemcheckbox", { name: "Party" }).click();
    await expect(feed(mika).getByRole("article").filter({ hasText: "Starting a pile" }).getByRole("button", { name: "Party, 1" })).toBeVisible({ timeout: 2000 });

    const mine = feed(mika).getByRole("article").filter({ hasText: "Ryokan with a private onsen" });
    await mine.hover();
    await mine.getByRole("button", { name: "Actions for your note" }).click();
    await mika.getByRole("menuitem", { name: "Delete" }).click();
    await mika.getByRole("dialog", { name: "Delete this note?" }).getByRole("button", { name: "Delete" }).click();
    await expect(feed(petr).getByText("Mika deleted a note")).toBeVisible({ timeout: 2000 });
    await expect(feed(petr).getByText("Ryokan with a private onsen")).toHaveCount(0);

    // Entries from other writers (the bot, Telegram, the extension) arrive the same way.
    await setup.db.insert(schema.entries).values({ projectId, authorId: null, kind: "bot", body: "Kinkaku-ji is best early in the morning." });
    await expect(feed(petr).getByText("Kinkaku-ji is best early in the morning.")).toBeVisible({ timeout: 2000 });
    await expect(feed(mika).getByText("Kinkaku-ji is best early in the morning.")).toBeVisible({ timeout: 2000 });
  });

  test("reconnects after a dropped connection and back-fills what was missed", async ({ browser }) => {
    let socket: WebSocketRoute | undefined;
    let offline = false;
    const petr = await open(browser, "Petr", async (page) => {
      let connected!: () => void;
      const ready = new Promise<void>((resolve) => (connected = resolve));
      await page.routeWebSocket((url) => url.searchParams.has("ticket"), (ws) => {
        if (offline) return void ws.close();
        socket = ws;
        const server = ws.connectToServer();
        server.onMessage((message) => {
          if (String(message).includes('"ready"')) connected();
          ws.send(message);
        });
      });
      return { ready };
    });
    const mika = await open(browser, "Mika");

    offline = true;
    await socket!.close();
    await post(mika, "Posted while Petr was offline");
    await setup.db.insert(schema.entries).values({ projectId, authorId: setup.users.Mika.id, kind: "note", body: "And another one" });
    await mika.waitForTimeout(500);
    await expect(feed(petr).getByText("Posted while Petr was offline")).toHaveCount(0);

    offline = false;
    await expect(feed(petr).getByText("Posted while Petr was offline")).toBeVisible({ timeout: 10_000 });
    await expect(feed(petr).getByText("And another one")).toBeVisible();

    // And live again afterwards.
    await post(mika, "Back online");
    await expect(feed(petr).getByText("Back online")).toBeVisible({ timeout: 2000 });
  });
});
