import { randomBytes } from "node:crypto";
import { createDb, eq, schema } from "@kasa/db";
import { SEED } from "@kasa/db/seed";
import { expect, test } from "@playwright/test";

// The seeded "Japan 2027" demo (CI runs `pnpm db:seed` first) shows its pictures from the bucket (F-11).
test("the seeded demo renders its pictures", async ({ browser }) => {
  const conn = createDb(process.env.DATABASE_URL!);
  const token = randomBytes(24).toString("base64url");
  await conn.db.insert(schema.sessions).values({ userId: SEED.users.petr, token, expiresAt: new Date(Date.now() + 3_600_000) });
  const context = await browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  try {
    const page = await context.newPage();
    await page.goto(`/projects/${SEED.projectId}`);
    await expect(page.getByRole("heading", { name: "Japan 2027" })).toBeVisible();
    const images = page.locator('img[src^="/api/entries/"]');
    await expect(images).toHaveCount(5);
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    }
  } finally {
    await context.close();
    await conn.db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    await conn.close();
  }
});
