import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import AxeBuilder from "@axe-core/playwright";
import { schema } from "@kasa/db";
import { expect, test, type Page } from "@playwright/test";
import { createUsers } from "./support/users";

type Setup = Awaited<ReturnType<typeof createUsers<"Petr">>>;

test.describe("link unfurling", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  let setup: Setup;
  let projectId: string;
  let server: Server;
  let site: string;
  const requests: string[] = [];

  test.beforeAll(async () => {
    setup = await createUsers(["Petr"]);
    const { db, users } = setup;
    const [project] = await db.insert(schema.projects).values({ name: "Japan 2027", ownerId: users.Petr.id }).returning();
    projectId = project!.id;
    await db.insert(schema.memberships).values({ projectId, userId: users.Petr.id, role: "owner" });

    // A page to link to, served locally; the e2e worker only unfurls from loopback.
    const photo = readFileSync("public/samples/kinkakuji.jpg");
    server = createServer((req, res) => {
      requests.push(`${req.url} ${req.headers["user-agent"]}`);
      if (req.url === "/ryokan") {
        return res
          .writeHead(200, { "content-type": "text/html" })
          .end(
            `<html><head><title>Gion Hatanaka</title><meta property="og:title" content="Gion Hatanaka, a ryokan in Kyoto"><meta property="og:site_name" content="Ryokans of Kyoto"><meta property="og:image" content="/kinkakuji.jpg"></head><body></body></html>`,
          );
      }
      if (req.url === "/kinkakuji.jpg") return res.writeHead(200, { "content-type": "image/jpeg" }).end(photo);
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server?.close();
    await setup?.cleanup();
  });

  const feed = (page: Page) => page.getByRole("region", { name: "Feed" });

  test("a pasted link turns into an index card with the page's title and a re-hosted image", async ({ page }) => {
    await page.context().setExtraHTTPHeaders(setup.users.Petr.headers);
    await page.goto(`/projects/${projectId}`);
    await page.locator("[data-hydrated]").waitFor();

    const external: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(site)) external.push(request.url());
    });

    await page.getByRole("textbox").fill(`${site}/ryokan`);
    await page.keyboard.press("Enter");

    // First a plain link, then the unfurled card arrives through live updates.
    const card = feed(page).getByRole("link", { name: /Gion Hatanaka, a ryokan in Kyoto/ });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("href", `${site}/ryokan`);
    await expect(card).toContainText("Link · Ryokans of Kyoto");
    const image = card.locator("img");
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await image.getAttribute("src")).toMatch(/^\/api\/entries\/[0-9a-f-]+\/preview-image$/);

    // The worker fetched the page and image; the browser never touched the original site.
    expect(requests.map((r) => r.split(" ")[0])).toEqual(["/ryokan", "/kinkakuji.jpg"]);
    expect(requests[0]).toContain("KasaLinkPreview");
    expect(external).toEqual([]);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
