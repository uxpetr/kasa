// Load with `--import @kasa/observability/register` (or from a service's own preload file)
// so instrumentations can patch ES modules before the app imports them.
import { register as registerAsync } from "node:module";

// The package ships register-hooks.d.ts, which TypeScript doesn't pair with the .mjs file.
const hooks: { register(): void; supportsSyncHooks(): boolean } = await import(
  "import-in-the-middle/register-hooks.mjs" as string
);

// In-thread hooks (module.registerHooks) where Node supports them; module.register is deprecated.
if (hooks.supportsSyncHooks()) hooks.register();
else registerAsync("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
