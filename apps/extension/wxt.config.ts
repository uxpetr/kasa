import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Kasa",
    // activeTab only; never broad host permissions (CLAUDE.md, D-010).
    permissions: ["activeTab"],
    action: {},
  },
  // The web app owns port 3000; WXT would otherwise race it for the same port under `pnpm dev`.
  dev: { server: { port: 3010, origin: "http://localhost:3010" } },
});
