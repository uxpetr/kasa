# Kasa finished tasks

The full text of finished and dropped tasks, moved from `PLAN.md` (F-20, D-212). `PLAN.md` keeps each one's heading line. Tasks finished later move here when they're done.

## Phase 0: Foundations

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

### F-04 · Database schema v0 · `done` · branch `f-04-db`
Depends on: F-01
- [x] Tables from the data model above, created by migration.
- [x] Seed script creates the "Japan 2027" demo project from the prototype (4 members, notes, photos, a capture, a bot reply).
- [x] Soft-delete columns and indexes for feed paging (project_id, created_at).

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

### F-07 · Observability baseline · `done` · branch `f-07-otel`
Depends on: F-01
- [x] OpenTelemetry traces across web, realtime, worker, and API calls from the extension. Extension calls are traced on the server (D-137); realtime has the bootstrap and gets real spans with P-06.
- [x] Structured logs with request IDs; no personal data or message bodies in logs.
- [x] Error reporting with alerts on staging and production. Dash0 check rule "Kasa: server errors" (error spans from `kasa-*` outside `local`, email to Petr) fired on a test burst of failed jobs. There is no production environment yet; the rule already covers it by environment name.

### F-08 · Design tokens and physical-object components · `done` · branch `f-08-ui`
Depends on: F-01
- [x] Tokens from `design/tokens.json`: colours, fonts, spacing, the one shadow, rotation limits (under 2.5°).
- [x] Components: Sticky, LinedSheet, Polaroid, Print (with tape), PinMarker, BotCard, CategoryStamp, Composer. (Also Note, BotButton, CategoryChip.)
- [x] Storybook (or equivalent) page showing every component, matching `design/prototype/ContentTypes.dc.html`. It's `/design` in the web app.

### F-09 · Staging data services · `done` · branches `f-09-neon`, `f-09-bucket`
Depends on: F-03, F-04
- [x] Neon Postgres in an EU region attached to the Vercel project; migrations run on deploy. (PR #28, D-191. The first production build on 2026-09-28 applied all migrations. A signed-out invite lookup reads through the pooled connection. Sign-in waits on the auth env in F-12.)
- [x] EU S3-compatible bucket for staging media (pick R2 EU or AWS `eu-central-1`, D-111); credentials only in Vercel env settings. (Cloudflare R2 `kasa-staging-media` in the EU jurisdiction, D-192. The `S3_*` variables are set for Production and Preview.)
- [x] CDN in front of the bucket for media downloads (signed URLs, D-132); confirm the bucket enforces the signed Content-Type and Content-Length on presigned PUTs, as the local store does. (Enforcement confirmed: on 2026-09-28 `storage:check` got 403 for a changed type and a changed size, and 200 for the signed upload with the right stored type and size. The CDN needs a custom domain, so it moves to F-15, D-192.)

### F-11 · Seed media in local storage · `done` · branch `f-11-seed-media`
Depends on: F-06
- [x] `pnpm db:seed` uploads the prototype images (`design/prototype/img/`) to the local bucket under the `seed/` keys the seed data already uses, so the demo renders with pictures. (D-195. `e2e/seed-demo.spec.ts` checks that all 5 images load, and it fails when one is missing.)

### F-12 · Sign-in on staging · `done` · branch `f-12-staging-auth`
Depends on: F-05, F-09
- [x] `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` set in the Vercel project (not in the repo); the staging callback URL added to the Google OAuth client. (A separate "Kasa staging" client, D-193.)
- [x] Sign in and out on staging works end to end. (Petr, 2026-09-29, on https://kasa-zeta-rouge.vercel.app. He landed in his personal pile with the welcome card.)

### F-17 · Telegram bot for staging · `done` · branch `f-17-telegram-bot`
Needed by: P-18 (D-200)
- [x] Petr creates a Telegram bot with @BotFather for staging, and its token goes into Vercel as a sensitive variable (and into the worker in F-10). (`@kasa_piles_bot`; token, webhook secret and username are in Vercel Production. The worker gets the same values in F-10. D-206.)
- [x] Every new Telegram variable is in `.env.example` with a comment.

### F-18 · Stop Neon branches filling up from previews · `done`
Found in P-19: every Vercel preview made a Neon branch, and at the Free plan's 10 branches previews failed with "Resource provisioning failed". Petr deleted old branches on 2026-09-30.
- [x] Petr turns off Preview in the Neon integration's Deployments Configuration (Vercel → Storage → the database → Projects → kasa), keeping Production on. Neon deletes preview branches only when Vercel deletes the deployments, after 6 months by default.
- [x] A new preview deploys without creating a Neon branch. (Petr turned Preview off on 2026-10-05. The F-19 previews since then deployed normally and skipped migrations; one at 15:29 that day, while the setting was changing, failed before its build like the branch-limit failures. Checked from Vercel, not the Neon console.)

### F-19 · Views preview for design changes · `done` · branch `f-19-views`
Asked for by Petr on 2026-10-05: one page with the key views, with limited interactivity, to check how changes to tokens and components look across the app.
- [x] `/design/views` shows the real app views, not copies, with sample data: Your piles, a pile feed with every content type, the feed's states (empty, viewer, archived), the invite page, and the unsubscribe page. (Also Kasa Bot answering, first run, and an expired invite; D-210.)
- [x] Each view can be seen at phone and desktop width. (Framed at 390px and 1280px, scaled to fit; each also opens on its own.)
- [x] Menus, dialogs, replying, posting a note, category filters and the photo viewer work; nothing reaches the database or another user. (A service worker scoped to `/design/` answers every `/api` request from a stub; D-210.)
- [x] A check covers that every view renders. (`e2e/design-views.spec.ts`, which also fails if any `/api` request skips the preview worker.)

### F-20 · Split PLAN.md · `done` · branch `f-20-split-plan`
Asked for by Petr on 2026-10-05: PLAN.md reached 135 KB (about 35,000 tokens), and every session reads it whole. More than half was the Decision log.
- [x] The Decision log moves to `docs/decisions.md` and the Progress log to `docs/progress.md`, unchanged and still append-only; IDs stay the same. (131 decisions, 50 progress lines.)
- [x] Finished and dropped tasks keep their heading line in PLAN.md; their full text moves to `docs/done-tasks.md`. Finished tasks with criteria still open stay in full. (36 moved; F-14 and P-07 stay, their open items belong to other tasks.)
- [x] "How agents use this file", CLAUDE.md and `design/DESIGN_LOG.md` point at the new files.
- [x] Nothing is lost: every decision, progress line and task line is in one of the files. (Checked line by line against the old PLAN.md: all 713 non-empty lines are there.)

## Phase 1: Prototype

### P-01 · Projects and invites · `done` · branch `p-01-projects`
Depends on: F-05
- [x] Create, rename, and archive a project. API only (`/api/projects`); the screens are P-02 and P-14.
- [x] Invite by link; accepting adds a membership as editor.
- [x] Owner, editor, and viewer permissions enforced on the server for every action.
- [x] Analytics: `project_created`, `invite_sent`, `invite_accepted`.

### P-02 · Projects screen ("Your piles") · `done` · branch `p-02-projects-screen`
Depends on: P-01, F-08
- [x] Grid of projects as paper stacks, with the last message, unread count, and members.
- [x] "New project" flow.
- [x] Matches `design/prototype/Projects.dc.html`. Checked with screenshots at 1280px and 390px; project cards link to a placeholder page until P-03.

### P-03 · Zen chat feed · `done` · branch `p-03-zen-feed`
Depends on: P-01, F-08
- [x] Opens at the newest entry; scroll up loads older entries in pages.
- [x] Header has only back, project name, and a menu (members, settings, search placeholder).
- [x] Composer: text, paste a link, drop or attach images. Enter sends. (Images can also be pasted.)
- [x] Analytics: `entry_created` with kind and source.
- [x] Opening the feed sets `memberships.last_read_at`, which clears the unread count on the projects screen (added by P-02, D-147).

### P-04 · Core content types · `done` · branch `p-04-content-types`
Depends on: P-03, F-06
- [x] Note (sticky; lined sheet when long), Photo (polaroid), generic Link (index card), Capture (taped print with pins). P-03 already renders notes, single polaroids, a plain link card, and a one-line fallback for other kinds (`app/projects/[id]/feed-entry.tsx`); P-04 replaces the link card and adds photo stacks (fanned, with a count; tap opens full size). Drawing and File keep the one-line fallback until V-02.
- [x] Shared actions menu on every object: React and Delete (Reply moves to P-07, D-153; Move to category and Star come in phase 2).
- [x] React: six fixed reactions shown as small counts on the object (D-154).
- [x] Delete: authors delete their own entries and owners anyone's (D-015), after a confirmation; the entry leaves a dashed outline (D-155).
- [x] Same rendering regardless of source (D-016).

### P-05 · Link unfurling · `done` · branch `p-05-unfurl`
Depends on: F-06
- [x] Worker fetches Open Graph and oEmbed data server-side with timeouts and size limits.
- [x] SSRF protection: block private IP ranges and non-HTTP schemes.
- [x] The preview image is re-hosted in our storage; the client never loads the original page.

### P-06 · Realtime updates · `done` · branch `p-06-realtime`
Depends on: P-03
- [x] New entries, replies, comments, and reactions appear for other members within 2 seconds. (Replies and comments go through the same change triggers; their UI comes with P-07.)
- [x] Reconnects cleanly and back-fills missed events.

### P-12 · Minimal notifications · `done` · branch `p-12-notifications`
Depends on: P-07
- [x] Email for replies and `@mentions`, batched to at most one email per 15 minutes per project.
- [x] Unsubscribe link and per-project mute (D-165).
- [x] `@mention` autocomplete in the composer (D-164); email via Resend (D-163). (Real sending needs `RESEND_API_KEY`, `EMAIL_FROM`, and `UNSUBSCRIBE_SECRET` in each environment, see F-13.)

### P-13 · Pilot readiness · `done` · branch `p-13-pilot`
Depends on: P-02 to P-07, P-12, P-14, P-15, OD-03 (P-08 to P-11 dropped, D-158)
- [x] Dashboard for the pilot metrics: items added per active user per week, and the share of links and photos with a reply (G1, D-159). Week-4 extension retention moves to L-06. (Events go to PostHog EU, and the insights are defined in `docs/pilot-dashboard.md`. Building them in PostHog is F-14.)
- [x] Onboarding for the pilot group. The extension offer (D-018) comes with L-06. (A Kasa Bot welcome card in My pile, D-180.)
- [x] A way for pilot users to send feedback from inside the app. (Send feedback, D-181.)

### P-14 · Invite page · `done` · branch `p-14-invite-page`
Depends on: P-01, F-08
- [x] `/invite/<token>` shows the project name and member count (`GET /api/invites/:token`), asks the person to sign in first if needed, then joins (`POST /api/invites/:token/accept`) and opens the project.
- [x] Clear states for an expired or revoked link (410) and an unknown one (404).
- [x] Owner can copy, renew, and revoke the link from the project menu.
- [x] Copy and layout need a design; add an Open decision if the prototype doesn't cover it. (Decided with Petr: D-173 to D-176.)

### P-15 · Members · `done` · branch `p-15-members`
Depends on: P-01
- [x] Members list in the project menu, with roles. (From P-03.)
- [x] Owner changes a member's role (editor or viewer) and removes members.
- [x] Members can leave; their entries stay (D-015).
- [x] Removing a member or a member leaving also ends their live updates. P-06 tickets are only checked when connecting, so close that user's sockets for the project.
- [x] Permissions enforced on the server and tested, like P-01.

### P-17 · Kasa Bot: minimal tagged answers · `done` · branch `p-17-kasa-bot`
Depends on: P-03, P-07; on staging, the worker (F-10)
- [x] `@kasa` in the web composer makes Kasa Bot reply with a bot card, as a reply to the tagging entry. It answers from this pile only: notes, replies, link titles and descriptions, place details, and capture comments. There is no web search, categories or unprompted posts (D-196). (Links give their title, site name, URL, and place details; there is no description column yet. A typed `@kasa` counts as well as a picked one; an email address like `hi@kasa.com` doesn't. D-198.)
- [x] The bot is a separate service with read access to one pile per answer. Tests prove that it can't read another pile's entries, members or media, even when the question names one (CLAUDE.md hard rule). (It runs in the worker, not as its own deployment, and reads only through `apps/worker/src/bot/pile.ts`, where every query is filtered by the asking pile's id and media is never read. `bot.test.ts` asks about another pile by name, by id, and with an "ignore your rules" prompt, from a member of both piles, and checks that the model sees none of it, D-198.)
- [x] The answer runs as a worker job, not in the web request. The composer shows that Kasa Bot is answering, and a failed answer says so on a bot card instead of failing silently. (The "answering" state is a pending bot card in the feed, "On it. Looking through this pile…", which the answer replaces through live updates.)
- [x] The bot never posts as a person; answers are `kind` "bot" entries, like the welcome card.
- [x] Cost guardrails: a per-pile rate limit, plus a spending cap of **$20 a month** across all piles during the pilot. At the cap, the bot stops answering and says so on a bot card. The wording is Petr's to confirm in this task. (30 answers per pile in any 24 hours; the cap counts list-price cost per calendar month in UTC. Petr approved the card wording, D-198.)
- [x] Analytics: `bot_answered` and `bot_failed` with ids only. The model and token counts go in logs, not in PostHog. (`bot_failed` also has a `reason` enum.)

### P-18 · Telegram two-way sync · `done` · branch `p-18-telegram`
Depends on: P-07, P-17, F-17; on staging, the worker (F-10). Moved from V-07 (D-200).
- [x] The owner links a Telegram group from pile settings; one pile maps to one group. (Pile menu → "Telegram…" → "Add Kasa Bot to a group" opens Telegram's group picker with a one-time code; the dialog then shows "Linked to {group}" with Unlink. D-207, D-208.)
- [x] Members link their Telegram account in settings; unlinked senders show as guests. ("Link Telegram" in the account menu; guests show as "Kenji (guest)" and get one hint in the group on how to link.)
- [x] Kasa to Telegram: new entries post with image, link, and note; bot answers post like any other entry. (As Telegram's own kinds with the name first, "Mika: …"; photos and albums as photos; Kasa Bot's answers with their ideas. Not receipts or the welcome card.)
- [x] Telegram to Kasa: messages, photos, and links land in the feed with a "via Telegram" meta line. (Albums become one photo entry; edits update the note or caption. Stickers, voice and files that aren't images stay in Telegram.)
- [x] Replies map both ways; synced messages never loop. (Every message is mapped to its entry once; entries from Telegram are never sent back.)
- [x] `@kasa` in the group asks Kasa Bot, with the same one-pile rule, rate limit and cap as the web composer (from V-04). (Anyone in the group, guests included; `@kasa_piles_bot` works too.)
- [x] The Telegram bot token never reaches the browser, and incoming webhooks are verified. (The token is only in the worker's Bot API client and the server-side availability check; the webhook compares Telegram's secret header in constant time. Tested with a fake Bot API; the live check is in F-10.)

### P-19 · Kasa Bot: categories · `done` · branch `p-19-categories`
Depends on: P-17. Moved from V-05 (D-200).
- [x] New entries get a category from a pile-specific set (for example Stays, Sights, Food, Transport). (Kasa Bot proposes the set once a pile has 5 posts and adds one only when nothing fits, up to 7; a post can have several. Replies and bot cards aren't sorted. D-201, D-202.)
- [x] Filter chips above the feed; members can rename, merge, and move; the bot learns from fixes. The feed order never changes. (Also add and remove, from the Categories dialog behind "Edit" and a post's Categories… checklist. Members' own choices go to the model as examples, and a post a member has sorted is never re-sorted. A filter shows the category's posts and their replies, in feed order.)
- [x] Sorting receipts are batched: one card per burst, with Undo. (A burst ends after 10 quiet minutes; the receipt grows in place. The first sort's receipt names the categories and has Edit instead of Undo.)
- [x] Model spending counts toward the $20 monthly cap (D-200). (Sorting is recorded in `bot_usage` and stops at the cap; it doesn't count toward the 30 answers a day.)

### P-20 · Kasa Bot: recommendations · `done` · branch `p-20-recommendations`
Depends on: P-17. Moved from V-06 (D-200).
- [x] Asked with `@kasa` ("suggest dinner spots near the ryokan"), the bot uses web search and posts recommendations as normal entries with "Add to pile". (Up to 3 ideas on the answer card, each with a picture and "Add to pile", which posts it as the member's own link marked "from Kasa Bot" and filed into the suggested category; "More ideas" gives 3 different ones. D-204, D-205.)
- [x] The web search sees only the question and what the answer needs from this pile, never another pile. (The model gets only this pile, through `pile.ts`, and is told to keep members' names and messages out of queries. Tested.)
- [x] Web search and model spending count toward the $20 monthly cap (D-200). (Each search adds $0.005 to the answer's `bot_usage` cost; at most 2 per answer. More ideas counts as an answer toward the 30 a day.)

### P-22 · Kasa on the iPhone home screen · `done` · branch `p-22-home-screen`
Petr's choice on 2026-10-05 (D-211): test Kasa on phones with a small group as a home-screen web app, before any native app (M-01).
- [x] A web app manifest: name "Kasa", opens Your piles, full screen without Safari's bars, in the table colour. (`app/manifest.ts`; theme colour from the tokens.)
- [x] The icon is a lowercase "k" in Fraunces, ink on the table colour (D-211), as the home-screen icon, the manifest icons and the favicon. (Source `design/icon/kasa-icon.svg`, the glyph as a path; PNGs at 180, 192 and 512.)
- [x] The pages fill the screen and keep their controls clear of the notch and the home bar. (`viewport-fit=cover`; safe-area padding on Your piles, the feed, invite, unsubscribe and feedback pages. Not checkable on a desktop browser, so it's part of Petr's iPhone check.)
- [x] A check covers the manifest and icons. (`e2e/home-screen.spec.ts`)
- [x] Petr checks on an iPhone: Add to Home Screen, sign in with Google from the home-screen app, open a pile, post a note and a photo, and open an invite link. (2026-10-05 on staging: all work, and a second person joined by invite and posted. Photos stop at "Upload is taking too long" on every device, because staging has no worker to process uploads yet; that check moved to F-10.)

## Phase 2: v1 launch

### V-03 · Search and filters · `dropped` (split into V-03a and V-03b, D-185 to D-187)
- [ ] Search across entries, comments, and page titles. Text drawn with the text tool comes with L-06 (D-158). (Now in V-03a.)
- [ ] Filter by category and source domain. (Now in V-03a; category chips stay in V-05.)

### V-05 · Kasa Bot: categories · `dropped` (moved to P-19, D-200)
Depends on: V-04
- [ ] New entries get a category from a project-specific set (for example Stays, Sights, Food, Transport).
- [ ] Filter chips above the feed; members can rename, merge, and move; the bot learns from fixes.
- [ ] Sorting receipts are batched: one card per burst, with Undo.

### V-07 · Telegram two-way sync · `dropped` (moved to P-18, D-200)
- [ ] The owner links a Telegram group from project settings; one project maps to one group.
- [ ] App to Telegram: new entries post with image, link, and note; pins and drawings as a flattened image with a link back.
- [ ] Telegram to app: messages, photos, and links land in the feed with a "via Telegram" meta line.
- [ ] Replies map both ways; unlinked senders show as guests; synced messages never loop.

## Phase 3: v2 (outline, detail when G2 passes)

### P-08 · Extension scaffold · `dropped`
Moved to v2 as part of L-06 (D-158); the criteria below carry over unchanged. Listed here, out of Phase 1, since D-196.
Depends on: F-05
- [ ] MV3 extension with `activeTab` only, and no "all websites" permission.
- [ ] Toolbar with Comment, Draw, Save page, Close, as in the prototype.
- [ ] Signs in through the web session; shows a clear message on pages extensions can't access.

### P-09 · Extension: Comment mode · `dropped`
Moved to v2 as part of L-06 (D-158); the criteria below carry over unchanged. Listed here, out of Phase 1, since D-196.
Depends on: P-08
- [ ] Click any element to highlight it and drop a numbered pin with a note.
- [ ] Stores the full anchor (D-011) plus a screenshot of the visible area.
- [ ] Inline project picker, defaulting to the last project used.

### P-10 · Extension: Draw mode · `dropped`
Moved to v2 as part of L-06 (D-158); the criteria below carry over unchanged. Listed here, out of Phase 1, since D-196.
Depends on: P-08
- [ ] Pen, arrow, box, highlighter, text, three ink colours, undo.
- [ ] The drawing is saved as a separate layer as well as flattened into the screenshot.

### P-11 · Extension: Save page and send step · `dropped`
Moved to v2 as part of L-06 (D-158); the criteria below carry over unchanged. Listed here, out of Phase 1, since D-196.
Depends on: P-09, P-10
- [ ] Full-page screenshot for Save page.
- [ ] Send step with preview, crop, and blur (required), a note, and a searchable project picker.
- [ ] Upload continues in the background if the popup closes; capture to saved in under 5 seconds on a normal connection.
- [ ] Analytics: `capture_created` with mode.

