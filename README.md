# Kasa

A web app plus Chrome extension where small groups collect things from around the web into a shared, chat-style pile, and discuss them in context. Kasa is Finnish for "a pile".

This folder is the starting point for building it with Claude Code.

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Instructions every Claude Code session loads automatically |
| `PLAN.md` | The living development plan: phases, tasks, decisions, progress. Agents update it after every task |
| `docs/PRD.md` | The product requirements |
| `design/` | Prototype screens, design tokens, and mascot art (see `design/README.md`) |

## Run it locally

Needs Node 22+, pnpm 11, and Docker.

```sh
pnpm install && cp .env.example .env
pnpm services    # local Postgres (5432) and S3-compatible storage (8333)
pnpm dev         # web app on http://localhost:3000, extension dev build in apps/extension/.output
pnpm test        # unit tests
pnpm lint && pnpm typecheck
```

`pnpm services:down` stops the local services (data is kept in Docker volumes). `pnpm build` builds the web app and the extension. To load the extension, open `chrome://extensions`, turn on Developer mode, and load `apps/extension/.output/chrome-mv3`.

## Layout

pnpm workspaces + Turborepo. See the Architecture section of `PLAN.md` for what each workspace is for.

```
apps/web  apps/realtime  apps/worker  apps/extension
packages/db  packages/shared  packages/ui  packages/bot
```

## Working on it

Start Claude Code in the repo and ask it to pick up the next task from `PLAN.md`.
