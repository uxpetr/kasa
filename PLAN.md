# Kasa: development plan

This is the living plan for building Kasa. Humans and Claude Code agents both read it, and agents update it after every task. It is the single source of truth for **what's next, what's done, and what was decided**.

- Product source: [`docs/PRD.md`](docs/PRD.md), exported from Petr's Claude Doc. If this plan and the PRD disagree, the PRD wins for product behaviour; raise the conflict under [Open decisions](#open-decisions).
- Design source: [`design/`](design/). See [`design/README.md`](design/README.md) for what each screen is, the design tokens, and the mascot art.
- Last updated: 2026-09-26 · by: Claude (F-08)

---

## How agents use this file

Follow this loop for every task. It's short on purpose; don't skip steps.

1. **Read first.** Read this whole file, then the task you're picking up and everything it depends on.
2. **Pick the next task.** Take the first `todo` task in the current phase whose dependencies are all `done`. Don't start tasks in a later phase until the current phase's gate is passed.
3. **Claim it.** Set its status to `in-progress`, add your branch name, and commit that change on its own before writing code.
4. **Build it.** Stay inside the task's scope. If you find more work, add it as a new task (next free ID, status `todo`) rather than doing it now.
5. **Meet the Definition of Done** (below) and every acceptance criterion in the task.
6. **Update this file** in the same PR as the code:
   - set the task to `done` and tick its acceptance criteria;
   - add one line to the [Progress log](#progress-log);
   - add an entry to the [Decision log](#decision-log) for every technical choice you made that another agent would need to know;
   - update [Current status](#current-status).
7. **Stop and ask when it's a product question.** If a task needs a product, pricing, copy, or UX decision that isn't in the PRD or the decision log, don't guess. Set the task to `blocked`, add the question to [Open decisions](#open-decisions) with the options you see, and end your turn.

**Rules of the file**

- Never delete tasks or log entries. Mark tasks `dropped` with a one-line reason instead.
- The Decision log and Progress log are append-only. To reverse a decision, add a new entry that supersedes the old one by ID.
- Keep entries short. Link to PRs, files, or ADRs for detail.
- Statuses: `todo` · `in-progress` · `blocked` · `done` · `dropped`.

## Definition of Done (every task)

- [ ] Acceptance criteria in the task are all met.
- [ ] Typecheck, lint, and tests pass in CI; new logic has unit tests, and user-facing flows have at least one end-to-end test.
- [ ] No secrets in code or logs; new env vars added to `.env.example` with a comment.
- [ ] Database changes go through a migration, never manual edits.
- [ ] UI matches the screens in `design/prototype/` and the content-type rules (see [Design rules](#design-rules)).
- [ ] Accessible: keyboard reachable, visible focus, labelled controls, text contrast at least 4.5:1.
- [ ] Instrumented: key actions emit the analytics events listed in the task.
- [ ] This file is updated (status, progress log, decisions).

---

## Current status

| Phase | Goal | Status | Gate |
| --- | --- | --- | --- |
| 0. Foundations | Repo, CI, auth, database, storage | `in-progress` | none |
| 1. Prototype | The capture → discuss loop, tested with one trip-planning group | `todo` | G1: captures get replies |
| 2. v1 launch | Full web app, Kasa Bot, Telegram, billing | `todo` | G2: week-4 retention holds |
| 3. v2 | Pins on live sites, presence, export, WhatsApp if the idea flies | `todo` | G3: users ask for phone capture |
| 4. Mobile | iOS and Android with share-sheet capture | `todo` | none |

**Next up:** finish F-07 (Dash0 export and alerts), then P-01 (projects and invites). F-09, F-10, F-11, P-05, and P-08 are also unblocked.
**Blocked:** nothing.

---

## Product in one paragraph

Kasa is a web app plus Chrome extension where a small group collects ideas from around the web (a trip, a wedding, a talk, or design inspiration) and discusses them in context. Each project is a chat-style feed of physical-looking objects (sticky notes, polaroids, taped prints). The extension lets you comment on or draw over any website and send the result to a project. Kasa Bot lives in every project: it answers when tagged with `@kasa`, sorts entries into categories, and occasionally suggests things. Projects can sync two ways with a Telegram group.

---

## Decision log

Append-only. Product decisions come from the PRD and Petr; technical ones from agents. Format: `ID · date · decision · why/source`.

**Product (locked, from the PRD, 2026-09-26)**

- **D-001** · 2026-09-26 · The product is called **Kasa** (Finnish for "a pile"). · PRD
- **D-002** · 2026-09-26 · Audience is any small group (2–10) collecting toward a shared goal; design teams are one use case, not the target. · PRD
- **D-003** · 2026-09-26 · A project is one model with members; "personal" means one member. Roles: owner, editor, viewer. · PRD
- **D-004** · 2026-09-26 · Sign-in with **Google OAuth only** in v1. · PRD
- **D-005** · 2026-09-26 · The feed is **strictly chronological, oldest to newest**, like a group chat: it opens at the latest entry, and you scroll up for history. · PRD
- **D-006** · 2026-09-26 · A reply to an older entry posts at the bottom and quotes the original. · PRD
- **D-007** · 2026-09-26 · **Smart grouping**: consecutive same-kind entries from one person render as one visual group; order never changes. · PRD
- **D-008** · 2026-09-26 · Navigation: a separate projects screen, then a **zen mode** chat showing only the feed and the input, with a back button and a project menu. · PRD
- **D-009** · 2026-09-26 · **Pricing gates collaboration.** Free: unlimited personal projects and joining any shared project. Paid: owning a shared project. Billing is per owner, not per seat; members never pay. Options: owner plan (about €4–6/month) or a one-off project pass. · PRD
- **D-010** · 2026-09-26 · Extension targets **Chromium browsers only** (Chrome, Arc, Edge, Brave), uses `activeTab`, and has three modes: Comment, Draw, and Save page. A preview step with crop and blur is required before sending. · PRD
- **D-011** · 2026-09-26 · Every capture stores a full **anchor** (URL, DOM selector, element-relative coordinates, scroll position, screenshot) from day one, even though live-site pins ship in v2. · PRD
- **D-012** · 2026-09-26 · **Telegram two-way sync ships in v1.** WhatsApp only after v1 proves the idea; the Official Business Account application waits until then. · PRD
- **D-013** · 2026-09-26 · **Kasa Bot** is in every project: answers when tagged, recommends, categorizes, and can post unprompted. Proactivity is set per project (Off, Only when tagged, Proactive); the default is Only when tagged. The bot reads only its own project. · PRD
- **D-014** · 2026-09-26 · Kasa Bot categories are always **visible and editable**; members can rename, merge, or move, and the bot learns from those fixes. · PRD
- **D-015** · 2026-09-26 · **Deletion**: deleted projects are restorable for 30 days, then purged including screenshots. Authors delete their own entries; owners delete anyone's. Entries stay when a member leaves. Deleting in Kasa doesn't delete the Telegram copy. · PRD
- **D-016** · 2026-09-26 · **Content types** and the four rules (everything is an object; always chronological; same object from every source; one actions menu) as specified in the PRD section "Content types in the feed". · PRD
- **D-017** · 2026-09-26 · The pilot is **one group of friends planning a real trip**. · PRD
- **D-018** · 2026-09-26 · "Add to Chrome" is **not a call to action on the website**. It's offered after someone has an account. · Petr, design review
- **D-019** · 2026-09-26 · Visual language: near-white "table" background, physical objects, Fraunces + Instrument Sans, lingonberry red `#B3372A` accent, pine `#2E5B4F` for Kasa Bot. Values in `design/tokens.json`. · Prototype canvas

**Technical (proposed, confirm or replace in F-01)**

- **D-100** · 2026-09-26 · *Proposed:* TypeScript everywhere, pnpm workspaces + Turborepo monorepo. · Initial plan
- **D-101** · 2026-09-26 · *Proposed:* Web app on Next.js (App Router) and React; Postgres with Drizzle ORM; Auth.js for Google OAuth. · Initial plan
- **D-102** · 2026-09-26 · *Proposed:* S3-compatible object storage with a CDN for screenshots and images; uploads via presigned URLs. · Initial plan
- **D-103** · 2026-09-26 · *Proposed:* Realtime over WebSockets from a small Node service, fed by Postgres `LISTEN/NOTIFY`; a managed alternative is fine if it's simpler. · Initial plan
- **D-104** · 2026-09-26 · *Proposed:* Background jobs (link unfurling, image processing, bot, Telegram, purges) on a Postgres-backed queue such as pg-boss. · Initial plan
- **D-105** · 2026-09-26 · *Proposed:* Chrome extension on Manifest V3, built with Vite (WXT or CRXJS). · Initial plan
- **D-106** · 2026-09-26 · *Proposed:* Kasa Bot on the Anthropic API (Claude), with the web search tool for recommendations. · Initial plan
- **D-107** · 2026-09-26 · *Proposed:* Telegram bot with grammY on webhooks. · Initial plan
- **D-108** · 2026-09-26 · *Proposed:* OpenTelemetry tracing and structured logs from day one, exported over OTLP. · Initial plan
- **D-109** · 2026-09-26 · *Proposed:* Stripe for billing (phase 2). Transactional email through a provider such as Postmark or Resend. · Initial plan

**Technical (confirmed)**

- **D-110** · 2026-09-26 · D-100 to D-109 confirmed as proposed; each "Proposed" entry above is now locked. The extension uses **WXT** (resolves the WXT/CRXJS choice in D-105). · Petr, OD-01
- **D-111** · 2026-09-26 · Hosting in the **EU**: web app on Vercel (`fra1`), Postgres on Neon (EU region), object storage on an EU S3-compatible bucket (Cloudflare R2 EU jurisdiction or AWS `eu-central-1`, chosen in F-03), realtime and worker services on Fly.io or Railway in an EU region (chosen in F-03). · Petr, OD-02
- **D-112** · 2026-09-26 · Monorepo tooling: pnpm 11 workspaces, Turborepo 2, Node 22+ (`engines`). Internal packages are source-only TypeScript (`exports` points at `src/index.ts`); the web app transpiles them via `transpilePackages`. · F-01
- **D-113** · 2026-09-26 · TypeScript pinned to **6.0** through the pnpm `catalog:`, because typescript-eslint 8 doesn't support TS 7 yet. Revisit when it does. · F-01
- **D-114** · 2026-09-26 · Linting is one root ESLint 10 flat config (`eslint.config.js`, typescript-eslint recommended) run as `pnpm lint`; typecheck and test run per workspace through Turbo. Vitest 5 is the unit test runner. · F-01
- **D-115** · 2026-09-26 · Versions at scaffold time: Next.js 16, React 19, WXT (MV3, manifest permissions `["activeTab"]` only). Build scripts are allowed only for `esbuild` and `sharp` (`allowBuilds` in `pnpm-workspace.yaml`). · F-01
- **D-116** · 2026-09-26 · CI is GitHub Actions (`.github/workflows/ci.yml`): a checks job (lint, typecheck, test, build) and an e2e job, on every PR and on pushes to `main`, Node 24. · F-02
- **D-117** · 2026-09-26 · Playwright lives in `apps/web` (`e2e/*.spec.ts`) and runs against a production build via `pnpm test:e2e`; Vitest only picks up `*.test.ts(x)`. · F-02
- **D-118** · 2026-09-26 · No branch protection on `main` for now (it needs GitHub Pro on a private repo). Rule instead: merge only PRs whose CI is green. Revisit when a second person gets write access. · Petr, OD-10
- **D-119** · 2026-09-26 · Local services in `docker-compose.yml`: Postgres 18 and SeaweedFS 4.47 as the S3-compatible store (MinIO stopped publishing images), with a one-shot `s3-init` that creates the `kasa-media` bucket. `pnpm services` starts them. Dev credentials live in `infra/seaweedfs/s3.json` and `.env.example`. · F-03
- **D-120** · 2026-09-26 · Staging is the Vercel project `kasa` in the personal team (not Dash0): root `apps/web`, Next.js, Node 24, functions in `fra1` (`apps/web/vercel.json`). Vercel Authentication stays on, so staging is private. Deploys from `main`; PRs get preview URLs. Neon and the bucket come in F-09, realtime and worker hosting in F-10. · Petr, F-03
- **D-121** · 2026-09-26 · Supersedes the account part of D-120: the Vercel project `kasa` lives in Petr's **personal** Vercel account (`petrandrianov-9913`, team `petrandrianov-9913s-projects`), kept separate from his work account. Git-connected to `uxpetr/kasa`, production branch `main`. Run Vercel CLI commands for Kasa with `--global-config ~/.config/vercel-kasa` so they use that account. Settings from D-120 (root, Node, `fra1`, protection) are unchanged. · Petr, F-03
- **D-122** · 2026-09-26 · Database access: Drizzle ORM 0.45 with the `postgres` (postgres.js) driver, in `packages/db`. Migrations are SQL generated by drizzle-kit into `packages/db/migrations`; merged migrations are never edited. CI fails when the schema and migrations drift, then migrates and seeds a Postgres 18 service. · F-04
- **D-123** · 2026-09-26 · Schema conventions: UUID primary keys (`gen_random_uuid()`), `timestamptz` everywhere, Postgres enums for fixed sets (roles, bot mode, entry kind and source, media role). Bot entries have `kind = 'bot'` and a null author. Pin `x`/`y` are fractions of the screenshot size. Telegram ids are text. Additions beyond the v0 table, each needed by a PRD requirement: `projects.archived_at` (archive), `comments.resolved` (resolve), `entry_media.id` and `position` (photo stack order), `link_previews.id`, `reactions.created_at`. · F-04
- **D-124** · 2026-09-26 · Feed paging uses a keyset cursor on `(created_at, id)`, newest first, served by the ascending index `entries_feed_idx (project_id, created_at, id)` scanned backwards (a test asserts the plan). · F-04
- **D-125** · 2026-09-26 · Database tests create and drop a throwaway database next to `DATABASE_URL`; they skip when it isn't set. Turbo passes `DATABASE_URL` to `test` tasks. · F-04
- **D-126** · 2026-09-26 · The demo seed follows `Main.dc.html`: the photos there are place links with preview images, so they're seeded as `link` entries with `link_previews`, not `photo` entries. Seed links use `example.com`; image keys point at `seed/…`, uploaded later by F-11. Re-running the seed replaces the demo. · F-04
- **D-127** · 2026-09-26 · Supersedes the auth part of D-101: **Better Auth** 1.7 instead of Auth.js (next-auth v5 is still beta and in maintenance). Google is the only provider (D-004); sessions are stored in Postgres. Better Auth's tables are `users`, `sessions`, `accounts`, `verifications`; the Google account id moved from `users.google_sub` to `accounts.account_id`. Config lives in `apps/web/lib/create-auth.ts`. · Petr, F-05
- **D-128** · 2026-09-26 · Extension handoff: a signed-in page calls `GET /api/auth/one-time-token/generate`; the single-use code (3 minutes, stored hashed) goes to the extension, which calls `POST /api/auth/one-time-token/verify` and then uses `Authorization: Bearer <session token>`. The extension shares the web session, so signing out of either ends both. P-08 delivers the code via `externally_connectable` (a manifest key, not a host permission). · F-05
- **D-129** · 2026-09-26 · Analytics: `track()` in `@kasa/shared` with typed event names; ids and enums only, never names, emails, or message text. Until OD-11 picks a provider, events are JSON lines on stdout. `signed_up` fires when a user row is created; `signed_in` fires on every new session, including the first. · F-05
- **D-130** · 2026-09-26 · `apps/web` loads the repo-root `.env` in `next.config.ts`. Auth is built on first use, and pages hide sign-in when auth env is missing (as on staging until F-12), instead of failing. · F-05
- **D-131** · 2026-09-26 · Apps import query helpers (`eq`, `and`, …) from `@kasa/db`, not `drizzle-orm`, so there's one drizzle copy and its types line up. `@kasa/db/testing` provides `createTestDatabase()` for tests. · F-05
- **D-132** · 2026-09-26 · Uploads: `POST /api/uploads` checks membership (owner/editor), type (JPEG, PNG, WebP, GIF; no HEIC, which prebuilt sharp can't decode) and size (20 MB), then returns a presigned **PUT** valid 5 minutes with Content-Type and Content-Length signed (R2 has no presigned POST). `POST /api/uploads/:id/complete` checks the stored object matches and queues `media.process` once. The worker re-encodes with sharp (drops all metadata, applies orientation), writes `full` and a 640px WebP `thumb`, and deletes the raw upload. `GET /api/media/:id/:variant` redirects members, viewers included, to a signed URL valid 5 minutes; everyone else gets 404. Keys live under `projects/<id>/`. · F-06
- **D-133** · 2026-09-26 · Queue: pg-boss 12 in `@kasa/jobs`, with typed job names and payloads. The web app starts it as a producer (no maintenance); the worker runs maintenance. pg-boss manages its own `pgboss` schema outside the Drizzle migrations. · F-06
- **D-134** · 2026-09-26 · New packages: `@kasa/media` (storage client, keys, limits; image processing is in `@kasa/media/process` so the web bundle never loads sharp) and `@kasa/jobs`. CI starts Postgres and S3 with `pnpm services`, the same as local development. · F-06
- **D-135** · 2026-09-26 · UI: `@kasa/ui` holds React components styled with plain CSS (`kasa-*` classes in `styles.css`) and CSS variables generated from `design/tokens.json` by `pnpm --filter @kasa/ui tokens`; a test fails if they drift. Fonts are self-hosted with `next/font`. `/design` is the component showcase instead of Storybook. Details that were open in the prototype: rotation is clamped to 2.5° even where the prototype tilts photos up to 5° (the tokens and design rules win); a note becomes a lined sheet past 140 characters or 4 lines; chips, pins, and bot buttons get invisible padding so the tap area reaches 44px (`hitTarget`). The sample photos were copied to `apps/web/public/samples`; check their licences before anything public (V-12). · F-08
- **D-136** · 2026-09-26 · Traces, logs, and error alerts go to Petr's **personal Dash0 account** over OTLP (D-108), kept separate from his work Dash0 organization. Credentials live only in `.env` and Vercel env settings. · Petr, OD-12
- **D-137** · 2026-09-26 · Observability: `@kasa/observability` holds the JSON logger (every line carries `trace_id`/`span_id` and also goes out as an OTel log record), key-based redaction (tokens, secrets, cookies, emails, names, phone numbers, addresses, IPs, message bodies; nested objects are logged only by shape; exception messages are redacted too, only the type is kept), and trace-context helpers. Web uses `@vercel/otel` (`instrumentation.ts`, service `kasa-web`) and logs server errors from `onRequestError`; `proxy.ts` gives every request an `x-request-id` (kept from the caller if it looks sane) that routes log and responses return. Worker and realtime use the Node SDK (`kasa-worker`, `kasa-realtime`) preloaded with `--import`, with HTTP, undici and `pg` instrumentation through in-thread `module.registerHooks` loader hooks (async `module.register` fallback on older Node). Job payloads carry W3C trace context (`_trace`), so a worker span continues the request that queued it. The extension sends no telemetry of its own (it only has `activeTab`); its API calls are traced on the server. Nothing is exported unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; CI and tests never export. · F-07

---

## Open decisions

Questions only Petr can answer. Agents add to this list and don't guess. When one is answered, move the answer to the Decision log and tick it here.

- [x] **OD-01** → D-110. Confirm or change the proposed stack (D-100 to D-109). Blocks F-01.
- [x] **OD-02** → D-111. Hosting and region. Suggested: EU hosting, since users and the company are in Finland, for GDPR. Blocks F-03.
- [ ] **OD-03** Pilot length and the numeric pass bar for gate G1 (for example, share of captures with at least one reply). Blocks P-13.
- [ ] **OD-04** Positioning line for the product (PRD open question).
- [ ] **OD-05** Kasa Bot: free or paid, given model costs, and which phase it first ships in. The PRD has it in v1; confirm. Blocks V-04.
- [ ] **OD-06** Kasa Bot: what triggers an unprompted post, and the maximum frequency. Blocks V-06.
- [ ] **OD-07** Decisions (voting) and the Keep strip: v1 or after pilot feedback? Blocks V-02c.
- [ ] **OD-08** Mascot direction (Heap, Pebble, Drop, or Stack; art in `design/mascot/`). Blocks F-08 icon work, not the rest of F-08.
- [x] **OD-10** → D-118. Protecting `main` on a private repo needs GitHub Pro (about $4/month) on the `uxpetr` account. Options: upgrade to Pro; move the repo to a GitHub organization on a paid plan; or drop the criterion and rely on convention (merge only green PRs). Blocks the last F-02 criterion.
- [ ] **OD-11** Analytics provider. Options: PostHog EU Cloud (product analytics, EU hosting), Plausible (simple, EU, less product depth), self-hosted PostHog, or events in our own Postgres. Needs a privacy/cookie decision too. Events are already tracked (D-129). Blocks P-13's pilot dashboard.
- [x] **OD-12** → D-136. Where do traces, logs, and error alerts go? F-07 exports OpenTelemetry over OTLP, so any OTLP backend works. Options: a personal Dash0 account (you know it; keep it separate from work), Grafana Cloud free tier (EU region), Honeycomb, or Sentry for errors plus a separate trace backend. Blocks F-07's export and alerting criteria.
- [ ] **OD-09** Exact prices for the owner plan and project pass, and project pass duration. Blocks V-10.

---

## Architecture

```
apps/
  web/         Next.js app: projects screen, zen chat, settings, landing page, API routes
  realtime/    WebSocket service: pushes new entries, comments, reactions
  worker/      Job runner: unfurling, image processing, Kasa Bot, Telegram, purges, email
  extension/   Chrome MV3 extension: Comment, Draw, Save page, send step
packages/
  db/          Drizzle schema, migrations, seed
  shared/      Types, validation schemas (zod), content-type definitions, analytics event names
  ui/          Design tokens and physical-object components (sticky, polaroid, print, bot card)
  bot/         Kasa Bot prompts, tools, categorization logic
```

**Data model (v0, extend by migration)**

| Table | Key fields |
| --- | --- |
| `users` | id, google_sub, email, name, avatar_url, created_at |
| `projects` | id, name, owner_id, bot_mode (off / tagged / proactive), deleted_at, created_at |
| `memberships` | project_id, user_id, role (owner / editor / viewer), joined_at |
| `invites` | id, project_id, token, created_by, expires_at |
| `entries` | id, project_id, author_id (null for bot), kind, body, source (app / extension / telegram), reply_to_id, group_key, edited_at, deleted_at, created_at |
| `entry_media` | entry_id, storage_key, width, height, role (photo / screenshot / drawing-layer / file) |
| `link_previews` | entry_id, url, title, site_name, image_key, place_meta (json), video_meta (json) |
| `captures` | entry_id, page_url, page_title, selector, rel_x, rel_y, scroll_y, viewport (json) |
| `pins` | id, capture_entry_id, number, x, y |
| `comments` | id, entry_id, pin_id, author_id, body, created_at |
| `reactions` | entry_id, user_id, emoji |
| `categories` | id, project_id, name, created_by (bot / user) |
| `entry_categories` | entry_id, category_id, assigned_by (bot / user) |
| `telegram_links` | project_id, chat_id, linked_by, linked_at |
| `telegram_messages` | entry_id, chat_id, message_id, direction |
| `telegram_identities` | user_id, telegram_user_id |
| `subscriptions` | user_id, plan (free / owner), stripe_customer_id, status |
| `project_passes` | project_id, purchased_by, expires_at |

---

## Phase 0: Foundations

Goal: an empty but real product skeleton that every later task builds on.

### F-01 · Stack decision and monorepo · `done` · branch `setup-kasa-repo`
Depends on: OD-01
- [x] Record the confirmed stack as decisions (supersede D-100 to D-109 as needed).
- [x] Monorepo created with the layout under [Architecture](#architecture); `pnpm install`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all run from the root.
- [x] README explains how to run everything locally in under 5 commands.

### F-02 · CI pipeline · `done` · branch `f-02-ci` · [#2](https://github.com/uxpetr/kasa/pull/2)
Depends on: F-01
- [x] CI runs lint, typecheck, unit tests, and build on every PR.
- [x] End-to-end test runner (for example Playwright) wired in with one smoke test.
- [x] ~~Main branch is protected: CI must pass.~~ Deferred by D-118: needs GitHub Pro; merge only green PRs instead.

### F-03 · Environments and config · `done` · branch `f-03-envs`
Depends on: F-01, OD-02
- [x] Local Postgres and object storage via Docker Compose.
- [x] `.env.example` with every variable documented; secrets never committed.
- [x] Staging environment deploys automatically from main (Vercel project `kasa`, D-121).

### F-09 · Staging data services · `todo`
Depends on: F-03, F-04
- [ ] Neon Postgres in an EU region attached to the Vercel project; migrations run on deploy.
- [ ] EU S3-compatible bucket for staging media (pick R2 EU or AWS `eu-central-1`, D-111); credentials only in Vercel env settings.
- [ ] CDN in front of the bucket for media downloads (signed URLs, D-132); confirm the bucket enforces the signed Content-Type and Content-Length on presigned PUTs, as the local store does.

### F-10 · Host realtime and worker · `todo`
Depends on: F-03; needed by F-06 and P-06
- [ ] Deploy `apps/realtime` and `apps/worker` to Fly.io or Railway in an EU region (D-111), deploying from main.

### F-04 · Database schema v0 · `done` · branch `f-04-db`
Depends on: F-01
- [x] Tables from the data model above, created by migration.
- [x] Seed script creates the "Japan 2027" demo project from the prototype (4 members, notes, photos, a capture, a bot reply).
- [x] Soft-delete columns and indexes for feed paging (project_id, created_at).

### F-11 · Seed media in local storage · `todo`
Depends on: F-06
- [ ] `pnpm db:seed` uploads the prototype images (`design/prototype/img/`) to the local bucket under the `seed/` keys the seed data already uses, so the demo renders with pictures.

### F-12 · Sign-in on staging · `todo`
Depends on: F-05, F-09
- [ ] `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` set in the Vercel project (not in the repo); the staging callback URL added to the Google OAuth client.
- [ ] Sign in and out on staging works end to end.

### F-05 · Google sign-in and sessions · `done` · branch `f-05-auth`
Depends on: F-04
- [x] Sign in and out with Google; a user row is created on first sign-in. (Verified locally with a real Google client.)
- [x] Session design supports the extension: a short-lived token exchange from the web session, no separate extension login (D-010). See D-128.
- [x] Analytics: `signed_up`, `signed_in`.

### F-06 · Uploads and media pipeline · `done` · branch `f-06-media`
Depends on: F-03, F-04
- [x] Presigned uploads for images and screenshots; size and type limits enforced server-side.
- [x] Worker generates thumbnails and strips EXIF location data.
- [x] Media served through the CDN with private, signed URLs scoped to project members. Signed, member-scoped URLs are done; the CDN in front of the bucket comes with the staging bucket (F-09).

### F-07 · Observability baseline · `in-progress` · branch `f-07-otel`
Depends on: F-01
- [ ] OpenTelemetry traces across web, realtime, worker, and API calls from the extension.
- [ ] Structured logs with request IDs; no personal data or message bodies in logs.
- [ ] Error reporting with alerts on staging and production.

### F-08 · Design tokens and physical-object components · `done` · branch `f-08-ui`
Depends on: F-01
- [x] Tokens from `design/tokens.json`: colours, fonts, spacing, the one shadow, rotation limits (under 2.5°).
- [x] Components: Sticky, LinedSheet, Polaroid, Print (with tape), PinMarker, BotCard, CategoryStamp, Composer. (Also Note, BotButton, CategoryChip.)
- [x] Storybook (or equivalent) page showing every component, matching `design/prototype/ContentTypes.dc.html`. It's `/design` in the web app.

---

## Phase 1: Prototype

Goal: prove the core loop (capture on a website, discuss in a shared project, come back later) with one trip-planning group. Keep everything else bare.

### P-01 · Projects and invites · `todo`
Depends on: F-05
- [ ] Create, rename, and archive a project.
- [ ] Invite by link; accepting adds a membership as editor.
- [ ] Owner, editor, and viewer permissions enforced on the server for every action.
- [ ] Analytics: `project_created`, `invite_sent`, `invite_accepted`.

### P-02 · Projects screen ("Your piles") · `todo`
Depends on: P-01, F-08
- [ ] Grid of projects as paper stacks, with the last message, unread count, and members.
- [ ] "New project" flow.
- [ ] Matches `design/prototype/Projects.dc.html`.

### P-03 · Zen chat feed · `todo`
Depends on: P-01, F-08
- [ ] Opens at the newest entry; scroll up loads older entries in pages.
- [ ] Header has only back, project name, and a menu (members, settings, search placeholder).
- [ ] Composer: text, paste a link, drop or attach images. Enter sends.
- [ ] Analytics: `entry_created` with kind and source.

### P-04 · Core content types · `todo`
Depends on: P-03, F-06
- [ ] Note (sticky; lined sheet when long), Photo (polaroid), generic Link (index card), Capture (taped print with pins).
- [ ] Shared actions menu on every object: Reply, React, Delete (Move to category and Star come in phase 2).
- [ ] Same rendering regardless of source (D-016).

### P-05 · Link unfurling · `todo`
Depends on: F-06
- [ ] Worker fetches Open Graph and oEmbed data server-side with timeouts and size limits.
- [ ] SSRF protection: block private IP ranges and non-HTTP schemes.
- [ ] The preview image is re-hosted in our storage; the client never loads the original page.

### P-06 · Realtime updates · `todo`
Depends on: P-03
- [ ] New entries, replies, comments, and reactions appear for other members within 2 seconds.
- [ ] Reconnects cleanly and back-fills missed events.

### P-07 · Replies and capture threads · `todo`
Depends on: P-04, P-06
- [ ] Reply posts at the bottom with the quoted original (paper-clip style); tapping the clip scrolls to the original.
- [ ] Tapping a pin on a capture opens its thread; comments can be added per pin.
- [ ] Analytics: `reply_created`, `pin_comment_created`.

### P-08 · Extension scaffold · `todo`
Depends on: F-05
- [ ] MV3 extension with `activeTab` only, and no "all websites" permission.
- [ ] Toolbar with Comment, Draw, Save page, Close, as in the prototype.
- [ ] Signs in through the web session; shows a clear message on pages extensions can't access.

### P-09 · Extension: Comment mode · `todo`
Depends on: P-08
- [ ] Click any element to highlight it and drop a numbered pin with a note.
- [ ] Stores the full anchor (D-011) plus a screenshot of the visible area.
- [ ] Inline project picker, defaulting to the last project used.

### P-10 · Extension: Draw mode · `todo`
Depends on: P-08
- [ ] Pen, arrow, box, highlighter, text, three ink colours, undo.
- [ ] The drawing is saved as a separate layer as well as flattened into the screenshot.

### P-11 · Extension: Save page and send step · `todo`
Depends on: P-09, P-10
- [ ] Full-page screenshot for Save page.
- [ ] Send step with preview, crop, and blur (required), a note, and a searchable project picker.
- [ ] Upload continues in the background if the popup closes; capture to saved in under 5 seconds on a normal connection.
- [ ] Analytics: `capture_created` with mode.

### P-12 · Minimal notifications · `todo`
Depends on: P-07
- [ ] Email for replies and `@mentions`, batched to at most one email per 15 minutes per project.
- [ ] Unsubscribe link and per-project mute.

### P-13 · Pilot readiness · `todo`
Depends on: P-02 to P-12, OD-03
- [ ] Dashboard for the pilot metrics: captures per active user per week, share of captures with a reply, week-4 extension retention.
- [ ] Onboarding for the pilot group, with the extension offered after sign-up (D-018).
- [ ] A way for pilot users to send feedback from inside the app.

### G1 · Gate: captures get replies
Pass bar set in OD-03. Record the result and Petr's go/no-go in the Decision log. If it fails, stop and rethink the core loop with Petr before phase 2.

---

## Phase 2: v1 launch

Goal: the full product from the PRD, ready for real users and payments.

### V-01 · Smart grouping · `todo`
- [ ] Consecutive entries of the same kind by one person within a few minutes render as one spread (D-007).
- [ ] Tap spreads the group into a scrollable row; anyone can pull an item out.

### V-02 · Remaining content types · `todo`
Split into sub-tasks as you go:
- [ ] V-02a Place links (postcard, area, price and dates when available) and a Map view of all places.
- [ ] V-02b Article and video links (inline muted video, timestamps as chapters); photo stacks; screenshot detection.
- [ ] V-02c Decision (ballot with dot stickers) and Keep strip. Blocked by OD-07.
- [ ] V-02d File (folded-corner sheet, full-screen viewer).
- [ ] V-02e Reactions as stickers, edited and deleted states, Star.

### V-03 · Search and filters · `todo`
- [ ] Search across entries, comments, page titles, and text drawn with the text tool.
- [ ] Filter by category and source domain.

### V-04 · Kasa Bot: tagged answers · `todo`
Depends on: OD-05
- [ ] `@kasa` in the composer (and in Telegram, after V-07) triggers an answer using only this project's content as context.
- [ ] Answers render as bot cards; the bot never posts as a person.
- [ ] Per-project proactivity setting, defaulting to Only when tagged.
- [ ] Cost guardrails: per-project rate limits and a monthly spend alert.

### V-05 · Kasa Bot: categories · `todo`
Depends on: V-04
- [ ] New entries get a category from a project-specific set (for example Stays, Sights, Food, Transport).
- [ ] Filter chips above the feed; members can rename, merge, and move; the bot learns from fixes.
- [ ] Sorting receipts are batched: one card per burst, with Undo.

### V-06 · Kasa Bot: recommendations and unprompted tips · `todo`
Depends on: V-05, OD-06
- [ ] Recommendations use web search and post as normal entries with "Add to pile".
- [ ] Unprompted tips follow the OD-06 triggers and rate limit, and always have "Not now".

### V-07 · Telegram two-way sync · `todo`
- [ ] The owner links a Telegram group from project settings; one project maps to one group.
- [ ] App to Telegram: new entries post with image, link, and note; pins and drawings as a flattened image with a link back.
- [ ] Telegram to app: messages, photos, and links land in the feed with a "via Telegram" meta line.
- [ ] Replies map both ways; unlinked senders show as guests; synced messages never loop.

### V-08 · Notifications, complete · `todo`
- [ ] Daily digest per project.
- [ ] Slack notifications per project (Should).

### V-09 · Deletion and retention · `todo`
- [ ] Rules from D-015, including a 30-day restore and a purge job that deletes media from storage.
- [ ] Account deletion and data export (GDPR).

### V-10 · Billing · `todo`
Depends on: OD-09
- [ ] Owner plan (monthly and yearly) and a one-off project pass via Stripe.
- [ ] Creating or keeping a shared project requires the owner plan or a pass; joining is always free.
- [ ] Downgrade path: shared projects become read-only, never deleted.

### V-11 · Onboarding · `todo`
- [ ] First-run flow: create a pile, invite people, then offer the extension (D-018).
- [ ] Empty states use the mascot (after OD-08).

### V-12 · Landing page · `todo`
- [ ] Build the promo page from `design/prototype/Promo.dc.html`, including the use-case pills in the hero.
- [ ] Only "Start a pile" calls to action; no Chrome button (D-018).

### V-13 · Security and privacy review · `todo`
- [ ] Threat model for the extension, uploads, unfurling, the bot, and Telegram.
- [ ] Permission checks tested for every API route; the bot can't read other projects.
- [ ] Privacy policy and terms published.

### V-14 · Launch checklist · `todo`
- [ ] Chrome Web Store listing and review.
- [ ] Load test of the feed and realtime service at 10× pilot usage.
- [ ] Backups and restore tested.

### G2 · Gate: week-4 retention holds
Record the result and Petr's go/no-go in the Decision log.

---

## Phase 3: v2 (outline, detail when G2 passes)

- **L-01** Pins on live sites: collaborators see pins overlaid when they visit the same URL, using the stored anchors, with the screenshot as fallback.
- **L-02** Presence: who's viewing a project right now.
- **L-03** Export a project as a zip of images plus JSON.
- **L-04** Safari extension, if pilot users ask for it.
- **L-05** WhatsApp two-way sync (D-012), once an Official Business Account is in place.

### G3 · Gate: users ask for phone capture

## Phase 4: Mobile (outline)

- **M-01** iOS and Android apps on the same API; share-sheet capture is the first feature.

---

## Design rules

Short version of the PRD's content rules. Use these when building any UI.

- Everything is a physical object on a near-white table: sticky notes, polaroids, taped prints, index cards. No chat bubbles.
- One soft shadow; rotations under 2.5°; no textures or handwriting fonts.
- Kasa Bot always uses the pine index card with the `k` mark.
- Categories show as small green stamps and filter chips; they never reorder the feed.
- Match the screens in `design/prototype/`; when they and the PRD disagree, ask (Open decisions).

---

## Progress log

Append one line per finished task: `date · task ID · what shipped · PR link`.

- 2026-09-26 · — · Plan created from the PRD and prototype. · —
- 2026-09-26 · — · Handoff folder assembled: PRD, prototype screens, tokens, mascot art. · —
- 2026-09-26 · F-01 · Stack confirmed (D-110, D-111); pnpm + Turborepo monorepo with web, realtime, worker, extension, and db/shared/ui/bot packages; lint, typecheck, test, and build pass from the root. · [#1](https://github.com/uxpetr/kasa/pull/1)
- 2026-09-26 · F-02 · GitHub Actions CI (lint, typecheck, test, build, Playwright smoke test); branch protection deferred (D-118). · [#2](https://github.com/uxpetr/kasa/pull/2)
- 2026-09-26 · F-03 · Local Postgres and S3 storage via Docker Compose (`pnpm services`), documented `.env.example`, Vercel staging from `main` in `fra1`. · [#3](https://github.com/uxpetr/kasa/pull/3)
- 2026-09-26 · F-04 · Schema v0 with Drizzle migrations, "Japan 2027" seed, feed paging index, DB tests in CI. · [#4](https://github.com/uxpetr/kasa/pull/4)
- 2026-09-26 · F-05 · Google sign-in with Better Auth, extension one-time-code handoff, `signed_up`/`signed_in` events; verified with a real Google client locally. · [#5](https://github.com/uxpetr/kasa/pull/5)
- 2026-09-26 · F-06 · Presigned uploads with server-side limits, worker strips metadata and makes thumbnails, member-only signed media URLs; pg-boss queue. · [#6](https://github.com/uxpetr/kasa/pull/6)
- 2026-09-26 · F-08 · Tokens generated from `design/tokens.json`, `@kasa/ui` physical-object components, `/design` showcase with keyboard and axe checks. · [#7](https://github.com/uxpetr/kasa/pull/7)
