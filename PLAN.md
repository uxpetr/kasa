# Kasa: development plan

This is the living plan for building Kasa. Humans and Claude Code agents both read it, and agents update it after every task. It is the single source of truth for **what's next, what's done, and what was decided**. Since F-20 (D-212) it's split in four, so a session reads only what it needs:

- `PLAN.md` (this file): how to work, Current status, Open decisions, Architecture, and every task. Read it whole every session.
- [`docs/decisions.md`](docs/decisions.md): the Decision log. Search it for the decisions your task names; don't read it whole.
- [`docs/progress.md`](docs/progress.md): the Progress log, one line per finished task.
- [`docs/done-tasks.md`](docs/done-tasks.md): the full text of finished and dropped tasks. Here they keep only their heading line.

- Product source: [`docs/PRD.md`](docs/PRD.md), exported from Petr's Claude Doc. If this plan and the PRD disagree, the PRD wins for product behaviour; raise the conflict under [Open decisions](#open-decisions).
- Design source: [`design/`](design/). See [`design/README.md`](design/README.md) for what each screen is, the design tokens, and the mascot art. Petr's design decisions arrive in [`design/DESIGN_LOG.md`](design/DESIGN_LOG.md).
- Last updated: 2026-10-05 · by: Claude (F-20, split the plan)

---

## How agents use this file

Follow this loop for every task. It's short on purpose; don't skip steps.

1. **Read first.** Read this whole file, then the task you're picking up and everything it depends on, including the decisions it names (search `docs/decisions.md` by ID). If [`design/DESIGN_LOG.md`](design/DESIGN_LOG.md) has entries marked `new`, fold them in first, following the steps at the top of that file, and commit that on its own.
2. **Pick the next task.** Take the first `todo` task in the current phase whose dependencies are all `done`. Don't start tasks in a later phase until the current phase's gate is passed.
3. **Claim it.** Set its status to `in-progress`, add your branch name, and commit that change on its own before writing code.
4. **Build it.** Stay inside the task's scope. If you find more work, add it as a new task (next free ID, status `todo`) rather than doing it now.
5. **Meet the Definition of Done** (below) and every acceptance criterion in the task.
6. **Update this file** in the same PR as the code:
   - set the task to `done` and tick its acceptance criteria;
   - add one line to [`docs/progress.md`](docs/progress.md);
   - add an entry to [`docs/decisions.md`](docs/decisions.md) for every technical choice you made that another agent would need to know, with the next free ID, and update the next free ID under [Decision log](#decision-log);
   - update [Current status](#current-status);
   - once a task is `done` with every criterion ticked, move its text below the heading line to [`docs/done-tasks.md`](docs/done-tasks.md), under its phase, and leave the heading line here.
7. **Stop and ask when it's a product question.** If a task needs a product, pricing, copy, or UX decision that isn't in the PRD or `docs/decisions.md`, don't guess. Set the task to `blocked`, add the question to [Open decisions](#open-decisions) with the options you see, and end your turn.

**Rules of the file**

- Never delete tasks or log entries. Mark tasks `dropped` with a one-line reason instead.
- The Decision log (`docs/decisions.md`) and the Progress log (`docs/progress.md`) are append-only. To reverse a decision, add a new entry that supersedes the old one by ID.
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
| 1. Prototype | The collect → discuss loop in the web app and Telegram, with Kasa Bot answers, categories and recommendations (D-200), tested with one trip-planning group | `in-progress` | G1: shared items get replies (D-159) |
| 2. v1 launch | Full web app, Kasa Bot tips, search, billing | `todo` | G2: week-4 retention holds |
| 3. v2 | Chrome extension (D-158), pins on live sites, presence, export, WhatsApp if the idea flies | `todo` | G3: users ask for phone capture |
| 4. Mobile | iOS and Android with share-sheet capture | `todo` | none |

**Next up:** the prototype's features are built. Before the pilot: staging (F-10, which also switches on real Kasa Bot answers and Telegram), F-16 (publish the Google consent screen before inviting testers) before the pilot starts; then set `pilot_start` on the pilot dashboard (D-194) once the first day is fixed. Kasa works from the iPhone home screen (P-22); photos on staging wait for the worker (F-10). The next build tasks Claude can take are P-21 (paper clip over the sticky header) and P-23 (jump to a reply's original). `/design/views` previews the key views for design changes (F-19).
**Blocked:** P-16, on OD-14 (privacy note). In phase 2: V-12 until Petr finishes the scroll story (D-189), V-12, V-14 and F-15 (media CDN) on OD-18 (clear or change the name). F-13 (Resend) is blocked on OD-18 too: there's no sender domain until the name is settled (D-209), so the pilot runs without emails, including feedback emails.

---

## Product in one paragraph

Kasa is a web app where a small group collects ideas from around the web (a trip, a wedding, a talk, or design inspiration) and discusses them in context. Each project is a chat-style feed of physical-looking objects (sticky notes, polaroids, index cards). People paste links, drop photos, and write notes. A Chrome extension for commenting on or drawing over any website comes in v2 (D-158). Kasa Bot lives in every project: it answers when tagged with `@kasa`, sorts entries into categories, and occasionally suggests things. Projects can sync two ways with a Telegram group.

---

## Decision log

Every product and technical decision is in [`docs/decisions.md`](docs/decisions.md), append-only, with IDs D-001 to D-212. The next free ID is **D-213**. Search it for a decision a task mentions (`grep -n "D-167" docs/decisions.md`) rather than reading it whole.

---

## Open decisions

Questions only Petr can answer. Agents add to this list and don't guess. When one is answered, move the answer to the Decision log (`docs/decisions.md`) and tick it here.

- [x] **OD-01** → D-110. Confirm or change the proposed stack (D-100 to D-109). Blocks F-01.
- [x] **OD-02** → D-111. Hosting and region. Suggested: EU hosting, since users and the company are in Finland, for GDPR. Blocks F-03.
- [x] **OD-03** (resolved by D-178) Pilot length and the numeric pass bar for gate G1 (the share of links and photos with at least one reply, D-159). Blocks P-13.
- [ ] **OD-04** Positioning line for the product (PRD open question).
- [ ] **OD-05** Kasa Bot: free or paid, given model costs, and which phase it first ships in. The PRD has it in v1; confirm. Blocks V-04. (Phase answered by D-196: minimal tagged answers ship in the prototype, P-17. Still open, to decide after the pilot using its usage and costs: free or paid after the pilot.)
- [ ] **OD-06** Kasa Bot: what triggers an unprompted post, and the maximum frequency. Blocks V-06.
- [ ] **OD-07** Decisions (voting) and the Keep strip: v1 or after pilot feedback? Blocks V-02c.
- [ ] **OD-08** Mascot direction (Heap, Pebble, Drop, or Stack; art in `design/mascot/`). Blocks F-08 icon work, not the rest of F-08.
- [x] **OD-10** → D-118. Protecting `main` on a private repo needs GitHub Pro (about $4/month) on the `uxpetr` account. Options: upgrade to Pro; move the repo to a GitHub organization on a paid plan; or drop the criterion and rely on convention (merge only green PRs). Blocks the last F-02 criterion.
- [x] **OD-11** (resolved by D-179) Analytics provider. Options: PostHog EU Cloud (product analytics, EU hosting), Plausible (simple, EU, less product depth), self-hosted PostHog, or events in our own Postgres. Needs a privacy/cookie decision too. Events are already tracked (D-129). Blocks P-13's pilot dashboard.
- [x] **OD-12** → D-136. Where do traces, logs, and error alerts go? F-07 exports OpenTelemetry over OTLP, so any OTLP backend works. Options: a personal Dash0 account (you know it; keep it separate from work), Grafana Cloud free tier (EU region), Honeycomb, or Sentry for errors plus a separate trace backend. Blocks F-07's export and alerting criteria.
- [x] **OD-13** (resolved by D-167) Email wording for P-12, provided by Petr: subject and body for the reply and `@mention` emails (including the batched form, several in one email), the unsubscribe confirmation page, and the "Mute emails" state in the app if it needs more than the toggle label. Blocks P-12.
- [ ] **OD-14** Privacy note for the pilot: what Kasa tells pilot users about the data it keeps and the analytics it sends to PostHog (D-179), what goes to Telegram when a pile is linked and to web search for recommendations (D-200), and where it shows. Blocks P-16, not the P-13 build.
- [ ] **OD-09** Exact prices for the owner plan and project pass, and project pass duration. Blocks V-10.
- [x] **OD-15** (resolved by D-188) Is the search answer card (D-187) part of the free plan, or only for paid owners? It extends OD-05, since it uses the same model costs as Kasa Bot. Blocks V-03b. (From design log DL-003.)
- [x] **OD-16** (resolved by D-189) Which promo page ships in V-12: the original (`design/prototype/Promo.dc.html`) or the scroll story (`Promo2.dc.html`)? Blocks V-12. (From design log DL-000.)
- [x] **OD-17** (resolved by D-190) The search field's placeholder before AI search exists. D-187's "Search or ask: hotels, who booked the train, Kyoto food…" promises questions and meaning, which V-03a can't answer yet. Options: use D-187's text from the start; a plain one such as "Search this pile"; or something else. Blocks V-03a's search field only.
- [ ] **OD-18** Clear or change the name before launch. A trademark search on 2026-09-28 found no "Kasa" mark for planning or collaboration software, but TP-Link holds "Kasa" for smart-home software in the US (reg. 4992874) and the EU (018015313, plus "Kasa Smart"), and its "Kasa Smart" app is in both app stores. Kasa, Inc. holds "Kasa" for hotels and short-term rentals in the US (classes 36 and 43). Finland has no "Kasa" mark. Options: keep "Kasa" after a trademark attorney's clearance opinion (a few hundred euros), a distinctive variant (for example "Kasa Pile"), or a new name. The private pilot can run as "Kasa". Blocks V-12, V-14 and F-15.

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

### F-02 · CI pipeline · `done` · branch `f-02-ci` · [#2](https://github.com/uxpetr/kasa/pull/2)

### F-03 · Environments and config · `done` · branch `f-03-envs`

### F-04 · Database schema v0 · `done` · branch `f-04-db`

### F-05 · Google sign-in and sessions · `done` · branch `f-05-auth`

### F-06 · Uploads and media pipeline · `done` · branch `f-06-media`

### F-07 · Observability baseline · `done` · branch `f-07-otel`

### F-08 · Design tokens and physical-object components · `done` · branch `f-08-ui`

### F-09 · Staging data services · `done` · branches `f-09-neon`, `f-09-bucket`

### F-10 · Host realtime and worker · `todo`
Depends on: F-03; needed by F-06 and P-06
- [ ] Deploy `apps/realtime` and `apps/worker` to Fly.io or Railway in an EU region (D-111), deploying from main.
- [ ] Realtime env: `REALTIME_SECRET` (shared with the web app), `REALTIME_ALLOWED_ORIGINS` (the web origin), `DATABASE_URL` on a direct, non-pooled connection (LISTEN needs one); web gets `REALTIME_SECRET` and `REALTIME_PUBLIC_URL` (`wss://…`), added by P-06.
- [ ] Worker env also has the `S3_*` variables for the staging bucket (D-192), with the same values as the web app.
- [ ] Switch the Neon plan from Free to Launch before the worker and realtime service run all the time (D-191).
- [ ] Worker env also includes `FEEDBACK_EMAIL` (`petr.andrianov@gmail.com`), so pilot feedback is emailed (D-182, from F-14).
- [ ] Kasa Bot answers for real (D-198): Petr creates an AI Gateway key on his personal Vercel team, and the worker gets it as `AI_GATEWAY_API_KEY`, with `KASA_BOT_MODEL` unset (Claude Haiku 4.5). Check the gateway's monthly free credit and that the model id works. A tag on staging gets a real answer.
- [ ] Worker env also has `POSTHOG_API_KEY`, because `bot_answered` and `bot_failed` are sent from the worker (D-198, changing D-183's "the worker sends no events").
- [ ] Photos post on staging, including from the iPhone home-screen app (P-22): until the worker runs there, uploads reach storage but never finish processing, and the composer gives up with "Upload is taking too long".
- [ ] Telegram goes live (P-18, D-208): the worker gets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` with the staging values (D-206). Run `pnpm --filter @kasa/worker telegram:setup` with those and `TELEGRAM_WEBHOOK_SECRET` and `BETTER_AUTH_URL`; it must report privacy mode off and set the webhook. Then link a test group and check both directions, a photo album, a reply, `@kasa`, and a guest.

### F-11 · Seed media in local storage · `done` · branch `f-11-seed-media`

### F-12 · Sign-in on staging · `done` · branch `f-12-staging-auth`

### F-13 · Email sending on staging and production · `blocked` (OD-18, D-209)
Depends on: P-12, F-10; OD-18 (the product name, so there is a sender domain, D-209)
- [ ] Petr creates a Resend account and verifies a sender domain he controls (D-163).
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, and `UNSUBSCRIBE_SECRET` set for the worker, and `UNSUBSCRIBE_SECRET` for the web app, in each environment (not in the repo).
- [ ] A reply on staging sends a real email whose unsubscribe link and one-click header both mute the project.

### F-14 · PostHog project · `done` · branch `f-14-dashboard`
Depends on: P-13; the dashboard also needs staging sign-in (F-09, F-12)
- [x] Petr creates a PostHog EU Cloud project for Kasa (personal, not a work account) and sets `POSTHOG_API_KEY` for the web app and worker in each environment (not in the repo). (Web app, Production only; the worker sends no events, D-183. Set 2026-09-27; the key is accepted by the EU host and refused by the US one.)
- [x] The pilot dashboard from `docs/pilot-dashboard.md` is built in that project and shows real events from staging. ([Kasa pilot](https://eu.posthog.com/project/286043/dashboard/982136), D-194. Petr's staging sign-in on 2026-09-29 shows as one active user this week, and the G1 tile is at 0 of 0 shared items.)
- [ ] `FEEDBACK_EMAIL` (where feedback is emailed) and `PILOT_ADMIN_EMAILS` (who can open `/feedback`) are set for production (D-182). (`PILOT_ADMIN_EMAILS` is set in Vercel for Production and Preview. `FEEDBACK_EMAIL` is a worker setting, so it moves to F-10.)

### F-15 · Media CDN on a custom domain · `blocked` (OD-18)
Depends on: F-09; OD-18 (the product name, so there is a domain to use)
- [ ] Put the R2 media bucket behind a Cloudflare custom domain, keeping downloads private and member-scoped (D-132). Signed URLs on the R2 S3 endpoint don't pass through Cloudflare's cache, so this needs a signing scheme the CDN can check.
- [ ] Add the app's final web origin to the bucket's CORS policy.

### F-16 · Publish the Google consent screen · `todo` (waiting on Petr)
Depends on: F-12; needed before pilot testers are invited
- [ ] Petr publishes the "Kasa staging" OAuth consent screen, which is in Testing mode now (D-193), so that pilot testers can sign in without being listed as test users.
- [ ] A Google account that isn't a test user can sign in on staging.

### F-17 · Telegram bot for staging · `done` · branch `f-17-telegram-bot`

### F-18 · Stop Neon branches filling up from previews · `done`

### F-19 · Views preview for design changes · `done` · branch `f-19-views`

### F-20 · Split PLAN.md · `done` · branch `f-20-split-plan`

---

## Phase 1: Prototype

Goal: prove the core loop (collect in a shared project, discuss, come back later) in the web app with one trip-planning group. Keep everything else bare. The extension is v2 (D-158).

### P-01 · Projects and invites · `done` · branch `p-01-projects`

### P-02 · Projects screen ("Your piles") · `done` · branch `p-02-projects-screen`

### P-03 · Zen chat feed · `done` · branch `p-03-zen-feed`

### P-04 · Core content types · `done` · branch `p-04-content-types`

### P-05 · Link unfurling · `done` · branch `p-05-unfurl`

### P-06 · Realtime updates · `done` · branch `p-06-realtime`

### P-07 · Replies · `done` · branch `p-07-replies`
Depends on: P-04, P-06
- [x] Reply in the actions menu (D-153); the reply posts at the bottom with the quoted original (paper-clip style); tapping the clip scrolls to the original.
- [ ] ~~Tapping a pin on a capture opens its thread; comments can be added per pin.~~ Moved to L-06 (D-160).
- [x] Analytics: `reply_created` (`pin_comment_created` moved to L-06, D-160).

### P-12 · Minimal notifications · `done` · branch `p-12-notifications`

### P-13 · Pilot readiness · `done` · branch `p-13-pilot`

### P-16 · Privacy note for the pilot · `blocked` (OD-14)
Depends on: P-13, OD-14
- [ ] Pilot users can read what Kasa keeps and what it sends to PostHog, worded as decided in OD-14.

### P-14 · Invite page · `done` · branch `p-14-invite-page`

### P-15 · Members · `done` · branch `p-15-members`

### P-17 · Kasa Bot: minimal tagged answers · `done` · branch `p-17-kasa-bot`

### P-18 · Telegram two-way sync · `done` · branch `p-18-telegram`

### P-19 · Kasa Bot: categories · `done` · branch `p-19-categories`

### P-20 · Kasa Bot: recommendations · `done` · branch `p-20-recommendations`

### P-21 · Paper clip shows over the sticky header · `todo`
Found in F-19: scrolling the feed, a reply's paper clip is drawn over the sticky header and the category bar. `.kasa-clip` and the header both have `z-index: 2`, and the clip comes later in the page.
- [ ] Scrolled under the header or the category bar, objects and their clips stay behind them, at phone and desktop width.
- [ ] A check covers it.

### P-22 · Kasa on the iPhone home screen · `done` · branch `p-22-home-screen`

### P-23 · Jumping to a reply's original sometimes doesn't stay there · `todo`
Found in P-22: `replies.spec.ts` "tapping the clipped print jumps to the original, loading older entries if needed" fails every time on Petr's Mac, on `main` too, and passes in CI. The original loads but isn't scrolled into view. Likely a race: once older entries load, the top sentinel's "load older" runs and restores the previous scroll position after the jump.
- [ ] Find the cause and fix it, so the jump lands on the original every time.
- [ ] The test passes locally and in CI.

### G1 · Gate: shared items get replies (D-159)
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
- [ ] V-02e Reactions as stickers, edited and deleted states, Star. (P-04 already ships plain reaction counts, D-154, and the deleted outline, D-155.)

### V-03 · Search and filters · `dropped` (split into V-03a and V-03b, D-185 to D-187)

### V-03a · Search mode: plain-text search, grid, and calendar · `todo`
Depends on: P-03, P-07. Designs: `design/prototype/Main.dc.html` (search mode) and the search states in `States.dc.html`.
- [ ] The magnifier next to + in the composer and a "Search" item in the project menu (replacing "Search (coming soon)", D-148) enter search mode. The composer becomes the search field, with the placeholder "Search this pile" (D-190) and "Done"; Escape also leaves (D-185).
- [ ] The category row becomes the result count ("5 matches", or "17 things in this pile" for an empty search) and a Grid / Calendar switch; an empty search shows the whole pile.
- [ ] Words match entry text, comments, link page titles and sites, and author names, so searching a site such as booking.com finds its links. Matching is fuzzy: typos and partial words still find results (D-188). This is the search every pile gets, free or paid. Categories become searchable once V-05 assigns them. Text drawn with the text tool comes with L-06 (D-158).
- [ ] Grid: newest first, four columns on desktop and fewer on narrow screens. Each result is the feed object untilted, with matched words highlighted and author · date · category stamp under it (the stamp once V-05 exists).
- [ ] Tapping a result leaves search and scrolls the chat to that entry, loading older pages if needed (as replies do, P-07).
- [ ] No results: "Nothing matches “{query}”" with "Try another word, or search by a person's name or a category."
- [ ] Calendar (D-186): Monday-first month grids following the search, with discs for matching days (a darkened photo, or the first entry's paper colour). Today is in the accent colour and future days are muted. Tapping a day filters the grid, with a removable "12 Sep ×" chip.
- [ ] Members only, and only the pile it's in: tested as a security requirement, like Kasa Bot.
- [ ] Emits `search_used` (`projectId`, `view`: grid or calendar; never the query text). No horizontal scroll at 390px; axe passes in search mode.

### V-03b · AI-powered search: meaning-based results and the answer card · `todo`
Depends on: V-03a, V-04 (model access), V-10 (knowing which piles are paid, D-188). Designs: `Main.dc.html` (try "Hotel", "airbnb", "dinner", "train", "onsen") and the search states in `States.dc.html`.
- [ ] Search matches by meaning as well as words: "hotel", "airbnb", "where to stay", or "sleep" find booking and rental links, ryokans, and notes about them; the same for food, getting around, sights, and more (D-187).
- [ ] Exact matches first, then related ones, each with "✦ Related: {concept}" under it.
- [ ] A Kasa Bot answer card above the results when Kasa recognises the intent: "Kasa understood '{query}' as {concept}" plus a one- or two-sentence answer from this pile only. Questions such as "who booked the train?" work too.
- [ ] In paid piles the field shows the "✦ Kasa" tag and the placeholder "Search or ask: hotels, who booked the train, Kyoto food…" instead of "Search this pile" (D-190).
- [ ] Never waits on the model: results render first and the card may arrive later; if the model is slow or down, plain-word search from V-03a still works, without related results or the card.
- [ ] Reads only its own pile, and the answer never mentions anything outside it: tested as a security requirement.
- [ ] Only in paid piles (D-188): the owner has the owner plan or a project pass for the pile, and then every member gets it. Free piles keep V-03a's search, with no related results, answer card, "✦ Kasa" tag, or question placeholder. Model spend counts toward V-04's guardrails.

### V-04 · Kasa Bot: tagged answers · `todo`
Depends on: P-17, OD-05 (pricing only, D-196)
- [ ] `@kasa` in the composer (and in Telegram, after V-07) triggers an answer using only this project's content as context. (The web composer part ships in P-17, D-196; the Telegram part moves to P-18, D-200.)
- [ ] Answers render as bot cards; the bot never posts as a person.
- [ ] Per-project proactivity setting, defaulting to Only when tagged.
- [ ] Cost guardrails: per-project rate limits and a monthly spend alert. They also cover V-03b's search answers (D-187). (P-17 adds the pilot's rate limit and spending cap; this item sets them for launch pricing.)

### V-05 · Kasa Bot: categories · `dropped` (moved to P-19, D-200)

### V-06 · Kasa Bot: recommendations and unprompted tips · `todo`
Depends on: P-19, OD-06. Recommendations moved to P-20 (D-200); this task keeps unprompted tips.
- [ ] Recommendations use web search and post as normal entries with "Add to pile". (Moved to P-20, D-200.)
- [ ] Unprompted tips follow the OD-06 triggers and rate limit, and always have "Not now".

### V-07 · Telegram two-way sync · `dropped` (moved to P-18, D-200)

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
- [ ] First-run flow: create a pile, invite people. Offering the extension (D-018) comes with L-06.
- [ ] Empty states use the mascot (after OD-08).

### V-12 · Landing page · `blocked` (waiting for Petr's final scroll story, D-189, and OD-18)
Depends on: a design log entry marking `Promo2.dc.html` final; OD-18 (the product name)
- [ ] Build the scroll story from `design/prototype/Promo2.dc.html` (D-189), in its final version.
- [ ] Only "Start a pile" calls to action; no Chrome button (D-018).

### V-13 · Security and privacy review · `todo`
- [ ] Threat model for uploads, unfurling, the bot, and Telegram (the extension's comes with L-06).
- [ ] Permission checks tested for every API route; the bot can't read other projects.
- [ ] Privacy policy and terms published.

### V-14 · Launch checklist · `blocked` (OD-18)
Depends on: OD-18
- [ ] The product name is cleared or changed (OD-18) before any public listing, domain, or trademark filing.
- [ ] ~~Chrome Web Store listing and review.~~ Moved to L-06 (D-158).
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
- **L-06** Chrome extension (D-158): the dropped P-08 to P-11 with their criteria (scaffold, Comment, Draw, Save page and send step, `capture_created`), plus pin threads on captures and `pin_comment_created` (D-160), the extension offer after sign-up (D-018), the extension threat model, the Chrome Web Store listing, searchable drawn text, and week-4 extension retention in the metrics dashboard. Split into tasks when phase 3 starts.

Extension tasks dropped from Phase 1 (D-158), kept here for L-06 until phase 3 is split into tasks:

### P-08 · Extension scaffold · `dropped`

### P-09 · Extension: Comment mode · `dropped`

### P-10 · Extension: Draw mode · `dropped`

### P-11 · Extension: Save page and send step · `dropped`

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

One line per finished task, in [`docs/progress.md`](docs/progress.md), append-only.
