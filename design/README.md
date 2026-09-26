# Kasa designs

Reference designs from the Kasa prototype canvas. Treat them as the visual spec: match layout, spacing, colours, and object styles, but build real components rather than copying this markup.

## Screens (`prototype/`)

Each `.dc.html` file is one screen. They're written for the design canvas runtime, so they won't render fully if opened directly in a browser: `{{ … }}` holes, `<sc-if>` and `<sc-for>` tags, and the `<script type="text/x-dc">` block are canvas-only. Read them as HTML and CSS reference; the interactive logic in `Main.dc.html` shows intended behaviour.

| File | What it is |
| --- | --- |
| `Projects.dc.html` | "Your piles": project selection as stacks of paper |
| `Main.dc.html` | Zen-mode project chat: category filters, sticky notes, polaroid group, taped capture with pins, Telegram reply, Kasa Bot cards, composer. Interactive: filters, dismiss, "Add to pile", sending notes, `@kasa` reply |
| `Comment.dc.html` | Extension comment mode: element highlight, pin, comment box with project picker, floating toolbar |
| `Draw.dc.html` | Extension draw mode: freehand ink, arrow, highlight, tool palette |
| `Send.dc.html` | Extension check-and-send: preview with crop and blur, note, project picker |
| `ContentTypes.dc.html` | Every chat content type with how it looks and behaves (same as the PRD section) |
| `Promo.dc.html` | One-page marketing site; hero switches between trip, wedding, talk, and redesign |
| `Mascot.dc.html`, `Mascot2.dc.html` | Mascot explorations, rounds 1 and 2 |
| `canvas.json` | Layout of the screens on the canvas |
| `img/` | Photos used in the screens (Japan trip). Some look like stock photos: check licences before public use |

Flow in the prototype: Projects → Main → "Capture from a site" → Comment → Draw → Send → back to Main.

## Tokens (`tokens.json`)

Colours, fonts, radii, the one object shadow, the CTA gradient and glow, and the rotation limit. Use these for `packages/ui`.

## Mascot (`mascot/`)

SVG and PNG exports. Round 2 (smooth white creature on pine) is the current direction; the final silhouette is still open (OD-08 in `PLAN.md`).

- `round2-heap`, `round2-pebble`, `round2-drop`, `round2-stack`: the four silhouettes
- `round2-heap-sleepy`, `-surprised`, `-thinking`, `-love`: expressions, each tied to a product moment (empty pile, new item, Kasa Bot working, decision made)
- `round1-*`: earlier outlined directions, kept for reference
