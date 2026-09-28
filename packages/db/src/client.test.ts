import { describe, expect, it } from "vitest";
import { directDatabaseUrl, isPooledUrl } from "./client";
import { deployDecision } from "./migrate";

const pooled = "postgresql://u:p@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const direct = "postgresql://u:p@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("connection URLs (F-09)", () => {
  it("spots Neon's pooled hosts, where prepared statements are off", () => {
    expect(isPooledUrl(pooled)).toBe(true);
    expect(isPooledUrl(direct)).toBe(false);
    expect(isPooledUrl("postgres://kasa:kasa@localhost:5432/kasa")).toBe(false);
    expect(isPooledUrl("not a url")).toBe(false);
  });

  it("prefers the unpooled URL for migrations and LISTEN", () => {
    expect(directDatabaseUrl({ DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct })).toBe(direct);
    expect(directDatabaseUrl({ DATABASE_URL: direct })).toBe(direct);
    expect(directDatabaseUrl({ DATABASE_URL_UNPOOLED: "" })).toBeUndefined();
  });

  it("migrates on deploy only where MIGRATE_ON_BUILD=1 and a database is attached", () => {
    expect(deployDecision({ DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct, MIGRATE_ON_BUILD: "1" })).toEqual({ run: true, url: direct });
    expect(deployDecision({ DATABASE_URL: pooled })).toMatchObject({ run: false });
    expect(deployDecision({ MIGRATE_ON_BUILD: "1" })).toEqual({ run: false, reason: "no DATABASE_URL" });
  });
});
