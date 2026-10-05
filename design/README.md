# Kasa designs

Reference designs from the Kasa prototype canvas. Treat them as the visual spec: match layout, spacing, colours, and object styles, but build real components rather than copying this markup.

## Screens (`prototype/`)

Each `.dc.html` file is one screen. They're written for the design canvas runtime, so they won't render fully if opened directly in a browser: `{{ … }}` holes, `<sc-if>` and `<sc-for>` tags, and the `<script type="text/x-dc">` block are canvas-only. Read them as HTML and CSS reference; the interactive logic in `Main.dc.html` shows intended behaviour.

| File | What it is |
| --- | --- |
| `Projects.dc.html` | "Your piles": project selection as stacks of paper, with the collapsed Archived section |
| `Main.dc.html` | Zen-mode project chat: project menu, sticky notes, photo stacks, paper-clip replies, reactions and the actions menu, Kasa Bot cards, and the composer with @mentions. **Search mode** (magnifier next to +): grid and calendar results, meaning-based matches and the Kasa answer card (DL-001 to DL-003). Interactive: press Play |
| `States.dc.html` | Feed states: first-run My pile, empty, viewer, archived, replying, @mentions, adding photos, errors, deleted outlines, touch actions, photo viewer, and six search states |
| `Dialogs.dc.html` | The project and account menus and every dialog: New project, Rename, Members, Remove and Leave, Invite people, Delete, Send feedback |
| `Pages.dc.html` | The invite page, unsubscribe page, interim signed-out home, and pilot feedback list |
| `Emails.dc.html` | Reply, mention, and batched notification emails (D-167) |
| `ContentTypes.dc.html` | Every chat content type with how it looks and behaves (same as the PRD section); Capture and Drawing are v2 |
| `Tokens.dc.html` | Every token and the key `@kasa/ui` components, drawn from `tokens.json` |
| `Promo.dc.html` | One-page marketing site; hero switches between trip, wedding, talk, and redesign |
| `Promo2.dc.html` | Promo page v2, a scroll story: scattered group input, pulled in by Kasa, sorted into piles. Which one ships is open (OD-16) |
| `Directions.dc.html` | One chat moment in four visual directions (Paper table, the current one, plus Hairline, Soft glass, Night bento). Exploration only, nothing decided |
| `Mascot.dc.html`, `Mascot2.dc.html` | Mascot explorations, rounds 1 and 2 |
| `Comment.dc.html`, `Draw.dc.html`, `Send.dc.html` | v2 Chrome extension (D-158): comment, draw, and check-and-send |
| `canvas.json` | Layout of the screens on the canvas |
| `CHANGELOG.md` | Every visual change since the locked v0, newest first |
| `img/` | Photos used in the screens (Japan trip). Some look like stock photos: check licences before public use |

Flow in the prototype: Projects → Main (project menu, search, dialogs) → the v2 extension screens at the end.

## Previews in the app

- `/design`: every `@kasa/ui` component, drawn from the tokens.
- `/design/views`: the real app views with sample data, at phone and desktop width, for checking token and component changes across the app (F-19, D-210). Menus, dialogs, replying and posting work; nothing is saved. With `pnpm dev` running, the frames update as you save a component or its CSS. After editing `tokens.json`, run `pnpm --filter @kasa/ui tokens` and they update too. New views and new sample content are added in `apps/web/app/design/views/`.

## Design log (`DESIGN_LOG.md`)

Petr's design decisions from the prototype. Each `new` entry gets folded into `PLAN.md` at the start of a session, following the steps at the top of the log, and then marked `folded` with what it became.

## Tokens (`tokens.json`)

Colours, fonts, radii, the one object shadow, the CTA gradient and glow, and the rotation limit. Use these for `packages/ui`.

## App icon (`icon/`)

`kasa-icon.svg`: a lowercase "k" in Fraunces 600 as a path, ink on the table colour (D-211). It's the home-screen icon and favicon; the PNGs in `apps/web/app/apple-icon.png` and `apps/web/public/icons/` are exported from it at 180, 192 and 512 px. Not the final mark: the mascot (OD-08) and the name (OD-18) are still open.

## Mascot (`mascot/`)

SVG and PNG exports. Round 2 (smooth white creature on pine) is the current direction; the final silhouette is still open (OD-08 in `PLAN.md`).

- `round2-heap`, `round2-pebble`, `round2-drop`, `round2-stack`: the four silhouettes
- `round2-heap-sleepy`, `-surprised`, `-thinking`, `-love`: expressions, each tied to a product moment (empty pile, new item, Kasa Bot working, decision made)
- `round1-*`: earlier outlined directions, kept for reference
