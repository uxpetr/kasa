// Generates src/tokens.ts and src/tokens.css from design/tokens.json, the source of truth.
// Run `pnpm --filter @kasa/ui tokens` after changing design/tokens.json; a test fails if they drift.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const out = new URL("../src/", import.meta.url);

export function render(): { ts: string; css: string } {
  const { $comment: _comment, ...tokens } = JSON.parse(readFileSync(new URL("design/tokens.json", root), "utf8"));
  const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const vars: string[] = [];
  for (const [k, v] of Object.entries(tokens.color as Record<string, string>)) vars.push(`--kasa-color-${kebab(k)}: ${v};`);
  vars.push(`--kasa-gradient-cta: ${tokens.gradient.ctaPrimary};`);
  // next/font sets --font-fraunces / --font-instrument-sans; the token stacks are the fallbacks.
  vars.push(`--kasa-font-display: var(--font-fraunces, ${tokens.font.display});`);
  vars.push(`--kasa-font-body: var(--font-instrument-sans, ${tokens.font.body});`);
  for (const [k, v] of Object.entries(tokens.fontSize as Record<string, number>)) vars.push(`--kasa-font-size-${kebab(k)}: ${v}px;`);
  for (const [k, v] of Object.entries(tokens.radius as Record<string, number>)) vars.push(`--kasa-radius-${kebab(k)}: ${v}px;`);
  vars.push(`--kasa-shadow-object: ${tokens.shadow.object};`);
  vars.push(`--kasa-shadow-cta-glow: ${tokens.shadow.ctaGlow};`);
  vars.push(`--kasa-hit-target: ${tokens.hitTarget.min}px;`);

  const header = "/* Generated from design/tokens.json by packages/ui/scripts/generate-tokens.ts. Do not edit. */\n";
  return {
    ts: `${header}export const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`,
    css: `${header}:root {\n${vars.map((v) => `  ${v}`).join("\n")}\n}\n`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ts, css } = render();
  writeFileSync(new URL("tokens.ts", out), ts);
  writeFileSync(new URL("tokens.css", out), css);
  console.log("tokens generated");
}
