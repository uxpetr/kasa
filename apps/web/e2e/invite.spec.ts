import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { and, eq, schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Who = "Petr" | "Mika" | "Aiko" | "Vera" | "Noor";
type Setup = Awaited<ReturnType<typeof createUsers<Who>>>;

test.describe("invite page", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

  test.beforeAll(async () => {
    setup = await createUsers(["Petr", "Mika", "Aiko", "Vera", "Noor"]);
    const { db, users } = setup;
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values([
      { projectId, userId: users.Petr.id, role: "owner" },
      { projectId, userId: users.Mika.id, role: "editor" },
    ]);
    await db.insert(schema.entries).values({ projectId, authorId: users.Mika.id, kind: "note", body: "Ryokan with a private onsen" });
  });

  test.afterAll(async () => {
    await setup?.cleanup();
  });

  /** A working link, or one that expired or was turned off. */
  async function link(state: "live" | "expired" | "revoked" = "live") {
    const token = randomBytes(32).toString("base64url");
    await setup.db.insert(schema.invites).values({
      projectId,
      token,
      createdBy: setup.users.Petr.id,
      expiresAt: state === "expired" ? ago(1) : new Date(Date.now() + 7 * 86_400_000),
      revokedAt: state === "revoked" ? ago(0) : null,
    });
    return token;
  }
  const signIn = (page: Page, who: Who) => page.context().setExtraHTTPHeaders(setup.users[who].headers);
  const roleOf = async (who: Who) =>
    (
      await setup.db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, setup.users[who].id)))
    )[0]?.role ?? null;

  test("signed out: shows what you'd join, and nothing else", async ({ page }) => {
    const token = await link();
    await page.goto(`/invite/${token}`);
    await expect(page.getByRole("heading", { level: 1, name: "Join Japan 2027" })).toBeVisible();
    await expect(page.getByText("Petr invited you. 2 people are in this pile.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Google to join" })).toBeVisible();
    await expect(page.getByText("You'll join as an editor.")).toBeVisible();
    await expect(page).toHaveTitle("Join Japan 2027 · Kasa");
    // No member names or entries (D-174).
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("Mika");
    expect(text).not.toContain("Ryokan");

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    const api = await page.request.get(`/api/invites/${token}`);
    expect(Object.keys(await api.json()).sort()).toEqual(["alreadyMember", "avatars", "inviterName", "memberCount", "projectName"]);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("signed in: Join pile opens the pile; members go straight there", async ({ page }) => {
    const token = await link();
    await signIn(page, "Aiko");
    await page.goto(`/invite/${token}`);
    await page.getByRole("button", { name: "Join pile" }).click();
    await expect(page).toHaveURL(`/projects/${projectId}`);
    await expect(page.getByText("Ryokan with a private onsen")).toBeVisible();
    expect(await roleOf("Aiko")).toBe("editor");

    await page.goto(`/invite/${token}`);
    await expect(page).toHaveURL(`/projects/${projectId}`);
  });

  test("back from signing in to join, it joins straight away", async ({ page }) => {
    const token = await link();
    await signIn(page, "Vera");
    await page.goto(`/invite/${token}?join=1`);
    await expect(page).toHaveURL(`/projects/${projectId}`);
    expect(await roleOf("Vera")).toBe("editor");
  });

  test("expired, turned-off, and unknown links say so", async ({ page }) => {
    await signIn(page, "Noor");
    for (const state of ["expired", "revoked"] as const) {
      await page.goto(`/invite/${await link(state)}`);
      await expect(page.getByRole("heading", { level: 1, name: "This invite has expired" })).toBeVisible();
      await expect(page.getByText("Ask the person who sent it for a new link.")).toBeVisible();
    }
    await page.goto(`/invite/${randomBytes(32).toString("base64url")}`);
    await expect(page.getByRole("heading", { level: 1, name: "This invite link doesn't work" })).toBeVisible();
    await expect(page.getByText("Check that you copied the whole link.")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await page.getByRole("link", { name: "Go to Kasa" }).click();
    await expect(page).toHaveURL("/");
    expect(await roleOf("Noor")).toBeNull();
  });

  test("the owner creates, copies, renews, and turns off the link", async ({ page, context }) => {
    await setup.db.update(schema.invites).set({ revokedAt: new Date() }).where(eq(schema.invites.projectId, projectId));
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, "Petr");
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Invite people" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite people" });
    await expect(dialog).toContainText("Anyone with this link can join as an editor. It works for 7 days.");

    await dialog.getByRole("button", { name: "Create link" }).click();
    const field = dialog.getByRole("textbox", { name: "Invite link" });
    await expect(field).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const first = await field.inputValue();

    await dialog.getByRole("button", { name: "Copy link" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole("button", { name: "New link" }).click();
    await expect(field).not.toHaveValue(first);
    expect((await page.request.get(`/api/invites/${first.split("/").pop()}`)).status()).toBe(410);

    const second = await field.inputValue();
    await dialog.getByRole("button", { name: "Turn off link" }).click();
    await expect(dialog.getByRole("button", { name: "Create link" })).toBeVisible();
    expect((await page.request.get(`/api/invites/${second.split("/").pop()}`)).status()).toBe(410);

    // Editors don't invite (D-139).
    await signIn(page, "Mika");
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();
    await page.getByRole("button", { name: "Project menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Invite people" })).toHaveCount(0);
  });
});
