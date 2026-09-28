# Kasa: instructions for Claude Code

You are building Kasa. `PLAN.md` in the repo root is the living plan and the source of truth for what to do next.

- Product spec: `docs/PRD.md`
- Designs, tokens, and mascot art: `design/` (start with `design/README.md`)

## Every session

1. Read `PLAN.md` from top to bottom before doing anything else.
2. Fold every `new` entry in `design/DESIGN_LOG.md` into `PLAN.md`, following the steps at the top of that file, and commit it on its own before other work.
3. Follow its "How agents use this file" loop exactly: pick the next unblocked task, claim it, build it, meet the Definition of Done, then update `PLAN.md` in the same PR.
4. After every task, update `PLAN.md`: task status and ticked criteria, one line in the Progress log, any technical choices in the Decision log, and Current status.

## Hard rules

- Don't make product, pricing, copy, or UX decisions. If something isn't settled in the PRD or the Decision log, mark the task `blocked`, add the question to Open decisions, and stop.
- Never delete tasks or log entries; mark them `dropped` or supersede them.
- Stay inside the current task's scope. Log new work as new tasks.
- Merge only PRs with green CI (`main` is not protected, D-118).
- Never commit secrets. Every new env var goes in `.env.example` with a comment.
- Kasa Bot may only read the project it belongs to. Treat this as a security requirement and test it.
- The extension must only use `activeTab`, never broad host permissions.

## Commands

Keep these current:

- Install: `pnpm install`
- Dev: `pnpm dev`
- Test: `pnpm test`
- Lint and types: `pnpm lint && pnpm typecheck`
- Build: `pnpm build`
- Local services (Postgres, S3): `pnpm services` / `pnpm services:down`
- Database: `pnpm db:migrate`, `pnpm db:seed`; after editing `packages/db/src/schema.ts`, `pnpm db:generate` and commit the migration. Never edit a migration that has been merged. drizzle-kit prompts when a change looks like a rename; split such changes into two migrations.
- Vercel CLI: always pass `--global-config ~/.config/vercel-kasa` (personal account, D-121); the default CLI login is a different account.
- One workspace: `pnpm --filter @kasa/<name> <script>`
- Shared dependency versions (TypeScript) live in the `catalog:` in `pnpm-workspace.yaml`.
