import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Kasa",
    // activeTab only; never broad host permissions (CLAUDE.md, D-010).
    permissions: ["activeTab"],
    action: {},
  },
});
