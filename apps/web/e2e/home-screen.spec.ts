import { expect, test } from "@playwright/test";
import { tokens } from "@kasa/ui";

// P-22 (D-211): Kasa can be added to the iPhone home screen as a web app.
test.describe("home screen", () => {
  test("the manifest opens Your piles full screen, with icons that load", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as { name: string; start_url: string; display: string; theme_color: string; icons: { src: string; sizes: string }[] };
    expect(manifest).toMatchObject({ name: "Kasa", short_name: "Kasa", start_url: "/", display: "standalone", theme_color: tokens.color.table });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of manifest.icons) {
      const image = await request.get(icon.src);
      expect(image.ok(), icon.src).toBe(true);
      expect(image.headers()["content-type"]).toBe("image/png");
    }
  });

  test("pages link the manifest and the icons, and use the whole screen", async ({ page, request }) => {
    await page.goto("/");
    const head = page.locator("head");
    await expect(head.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(head.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    await expect(head.locator('meta[name="theme-color"]')).toHaveAttribute("content", tokens.color.table);
    await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Kasa");
    for (const selector of ['link[rel="apple-touch-icon"]', 'link[rel="icon"][type="image/svg+xml"]']) {
      const href = await head.locator(selector).first().getAttribute("href");
      expect(href, selector).toBeTruthy();
      expect((await request.get(href!)).ok(), selector).toBe(true);
    }
  });
});
