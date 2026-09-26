import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("component showcase", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/design");
  });

  test("shows every physical-object component", async ({ page }) => {
    for (const title of ["Note", "Photo", "Capture", "Drawing", "Kasa Bot", "Category stamp", "Filter chips", "Pins", "Composer"]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    await expect(page.locator(".kasa-sticky")).toHaveCount(1);
    await expect(page.locator(".kasa-lined")).toHaveCount(1);
    await expect(page.locator(".kasa-polaroid")).toHaveCount(2);
    await expect(page.locator(".kasa-tape").first()).toBeVisible();
    await expect(page.getByRole("article", { name: "Kasa Bot" })).toHaveCount(2);
  });

  test("uses the token fonts and never tilts past 2.5°", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-family", /Fraunces/);
    const angles = await page.locator(".kasa-object").evaluateAll((els) =>
      els.map((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI);
      }),
    );
    expect(angles.length).toBeGreaterThan(5);
    for (const a of angles) expect(a).toBeLessThanOrEqual(2.5001);
  });

  test("chips, pins, and the composer work from the keyboard with visible focus", async ({ page }) => {
    const sights = page.getByRole("button", { name: /^Sights/ });
    await sights.focus();
    await expect(sights).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(sights).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "false");

    const pin = page.getByRole("button", { name: "Pin 2" });
    await pin.focus();
    await page.keyboard.press("Space");
    await expect(pin).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Thread for pin 2 is open")).toBeVisible();

    const input = page.getByLabel("Add to Japan 2027");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await input.fill("  Let's book the ryokan  ");
    await input.press("Enter");
    await expect(page.getByRole("list", { name: "Sent notes" })).toContainText("Let's book the ryokan");
    await expect(input).toHaveValue("");
  });

  test("has no automatically detectable accessibility problems", async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
});
