# Kasa prototype changelog

Every change to the Kasa prototype canvas after v0 is logged here, newest first. v0 is locked: its files are archived in `kasa-prototype-v0.zip` (checksums in `CHECKSUMS.txt` inside it), so any screen can be compared against or restored to the baseline.

**How to log a change.** Add an entry at the top of "Changes since v0" in this shape:

```
### YYYY-MM-DD · short title
- Screens: files that changed
- What: what changed, in a line or two
- Why: the feedback or decision behind it
```

When a set of changes is ready to become the next baseline, lock it as v1 the same way: archive the files, record the checksums, and start a new section.

---

## Changes since v0

### 2026-09-28 · Chat design directions

- **Screens:** new `Directions.dc.html`, placed after the mascot sheets. The v2 extension screens moved right.
- **What:** one static chat moment (Aiko's note, Mika's two links, Jonas's photo stack with the react and reply menu open, and a Kasa Bot tip) drawn in four languages side by side, each with pros and cons:
  - **A · Paper table**, the current direction.
  - **B · Hairline:** editorial minimalism. White, no shadows, an italic time rail, uppercase names, and a black pill menu.
  - **C · Soft glass:** spatial softness. A mesh gradient, frosted cards, a floating title chip, and a floating composer dock.
  - **D · Night bento:** dark mode with each day as a bento board, monospaced meta, and a keyboard-first menu (R, ⌫, ⌘K).
- **Why:** Petr asked for three more zen, minimal directions using current UI trends.

### 2026-09-28 · Feed states: search

- **Screens:** `States.dc.html`, `canvas.json` (board height).
- **What:**
  - Every mini composer now has the magnifier next to +.
  - Six new search states:
    - browse, with an empty search showing the whole pile untilted
    - results by meaning for "Hotel", with the Kasa answer card and ✦ Related lines
    - the answer card still loading while results already show
    - no results ("Nothing matches 'ski pass'")
    - the calendar for September with photo and paper discs, today in lingonberry, and future days muted
    - a single day (12 Sep) with its removable chip
  - The sheet grows from 12 to 18 panels.
- **Why:** bring the feed states in line with DL-001 to DL-003.

### 2026-09-28 · AI-powered search

- **Screens:** `Main.dc.html`.
- **What:**
  - Search now matches by meaning as well as by words. "Hotel", "airbnb", "where to stay", or "sleep" finds every place to stay: the hotel booking link, the rental flats, the ryokan links, and Mika's onsen note. The same works for food, trains and transport, sights, onsen, and sunset spots.
  - Exact matches still come first. Tiles found by meaning carry a small "✦ Related: places to stay" line.
  - When Kasa recognises what you're after, a Kasa Bot card above the grid says how it read the query ("Kasa understood 'Hotel' as places to stay") and gives a short answer from the pile ("5 places to stay: 1 hotel, 2 rentals, and 2 ryokan mentions. Only the Gion ryokan has the private onsen Mika asked about.").
  - The field has a "✦ Kasa" tag and the placeholder "Search or ask: hotels, who booked the train, Kyoto food…".
  - Added three stays to the demo pile: a hotel near Kyoto Station (booking site), a loft flat in Shinjuku (rental site), and a garden-view ryokan in Gion.
- **Why:** Petr wants search to understand intent, not just match text. In the prototype the understanding is a fixed concept map; in the product it would be Kasa Bot's model.

### 2026-09-28 · Search mode in the project chat

- **Screens:** `Main.dc.html` and `Dialogs.dc.html` (project menu panel).
- **What:**
  - The composer has a magnifier button next to +. It and the menu's new "Search" item (was "Search (coming soon)") put the chat into search mode.
  - In search mode the composer becomes a search field with Done (Escape also exits). The category row becomes a result count and a Grid / Calendar switch.
  - **Grid:** matches show newest first, four across, with no tilt. Each tile is the same object as in the feed (postcard, polaroid, sticky, index card, bot card) with the matched words highlighted, plus author, date, and category underneath. It searches text, people, categories, and link sites. Tapping a tile goes back to the chat. There's an empty state for no matches.
  - **Calendar:** month grids (Monday first, like the reference screenshot). Days with matches become discs showing a photo from that day, or the paper colour of the entry. Today is in lingonberry and future days are greyed. Tapping a day opens the grid filtered to it, with a removable day chip.
- **Why:** Petr asked for search as a core feature, modelled on a photos-style calendar.

### 2026-09-27 · Promo v2: hero copy

- **Screens:** `Promo2.dc.html`.
- **What:**
  - The headline is now "Planning anything as a group is *messy.*" (was "tough").
  - The subline says "Photos" instead of "Screenshots", to match the items below the fold.
  - Added a line in pine under it: "Kasa turns it into one shared pile. Scroll to see."
- **Why:** "Messy" sets up the pile-then-sort payoff. The new line tells people who don't scroll what Kasa is. Petr approved.

### 2026-09-27 · Promo v2: use-cases screen

- **Screens:** `Promo2.dc.html`.
- **What:** one more screen follows the story. It scrolls up after the sorted piles and the Kasa Bot recommendations, headed "One pile for anything you *plan together.*" with the glowing CTA. It shows six use cases as paper piles: a trip with friends, a wedding for two, a talk or a thesis, a redesign, moving in together, and a surprise party. Each has its own category stamps, a small object, and a one-line Kasa Bot suggestion. The story's scroll progress now counts only the story part, so the new screen scrolls normally.
- **Why:** Petr asked for a closing screen that shows more ways to use Kasa.

### 2026-09-27 · Promo v2: raw inputs before the transformation

- **Screens:** `Promo2.dc.html`.
- **What:** before Kasa pulls them in, the items now look like the places they really come from.
  - Messages are chat bubbles: grey with the sender's name for Mika and Aiko, blue for your own.
  - A phone note ("Japan!!" with a few loose lines) looks like a notes app.
  - Links are bare URLs with no preview.
  - Photos are rounded camera-roll images with file names like `IMG_4821.HEIC`.
  - Once they come back out of Kasa they turn into Kasa objects: postcards, polaroids, sticky notes, and index cards, sorted into piles. The switch happens while they're hidden inside the mascot.
- **Why:** Petr asked for the "before" state to show real, scattered group input rather than Kasa's own objects.

### 2026-09-27 · Promo page v2: scroll story

- **Screens:** new `Promo2.dc.html`, placed after the first promo page, which stays as it was. `canvas.json` moves later screens right.
- **What:** a single-viewport page that tells the story as you scroll. Press Play and scroll inside the artboard.
  1. The hero is only "Planning anything as a group is tough.", with links, photos, and notes from Mika, Aiko, Jonas, and Sam peeking up from below the fold.
  2. Scrolling brings them up into a messy, tilted pile ("…and it piles up fast.").
  3. Kasa (the Heap mascot on a pine disc, since the silhouette is still open under OD-08) grows in the centre, glows, and pulls everything in ("Kasa pulls it all together.").
  4. The mascot shrinks to the top and the items come back out, neat and within the 2.5° tilt, as small piles under five categories: Stays, Sights, Food, Getting around, and Tokyo.
  5. Two Kasa Bot recommendation cards and the glowing "Start a pile, free" button follow.
- **Why:** Petr's brief for a second promo version where the mascot turns scattered group input into sorted results.

### 2026-09-27 · Tokens and components artboard

- **Screens:** new `Tokens.dc.html`, placed after the content types. `canvas.json` moves the mascot and v2 extension screens right to make room.
- **What:**
  - Every colour token in groups, plus the avatar palette and the CTA gradient.
  - The type scale in Fraunces and Instrument Sans.
  - Radii, both shadows, the 2.5° rotation limit, and the 44px hit target.
  - 15 key components from `@kasa/ui`: Note, LinedSheet, Polaroid and its stack, IndexCard, Print with PinMarker, BotCard and BotButton, CategoryStamp and CategoryChip, Avatar and AvatarStack, Pile, Reply, DeletedOutline, Composer, buttons, and reactions with the actions menu.
- **Why:** Petr asked for an artboard of the tokens and key components. Values are read straight from the repo's `design/tokens.json`.

### 2026-09-27 · Synced with the code and PLAN.md (web-first)

Source: `uxpetr/kasa` at `7994c6a` (P-01 to P-07 and P-12 to P-15 done, extension moved to v2 by D-158).

- **New screens:**
  - `States.dc.html` has 12 feed states: first-run My pile with the welcome card, empty pile, viewer notice, archived for owner and member, replying, @mention list, adding photos, composer errors, deleted outlines, the touch actions sheet, and the photo viewer.
  - `Dialogs.dc.html` has the project menu, account menu, and the dialogs: New project, Rename, Members for owner and member, Remove and Leave confirmations, Invite people with and without a link, Delete, and Send feedback with its thank-you state.
  - `Pages.dc.html` has the invite page (signed out, signed in, expired, doesn't work), the unsubscribe page (muted, unmuted, bad link), the interim signed-out home, and the pilot feedback list.
  - `Emails.dc.html` has the reply, mention, and batched emails (D-167).
- **`Main.dc.html`:**
  - The header's "Capture from a site" button is replaced by the project menu: Members, Invite people, Rename, Archive, Mute emails, and Search (coming soon).
  - Jonas's capture is now a photo stack with a count that opens the photo viewer. Mika's reply uses the paper-clip reply design.
  - Added a deleted outline, an actions menu on objects (six reactions, Reply, Delete), reaction counts, the delete confirmation, the "Replying to…" banner, and the @mention list in the composer.
- **`Projects.dc.html`:** "+ New project" and the account button now open the dialogs sheet. Added the collapsed "Archived (1)" section (D-146), and the board is now 960px tall.
- **`Promo.dc.html`:**
  - Step 1 is now "Drop it in" (paste a link, drop a photo, write a note) instead of the extension.
  - Removed the pins from the hero collages and rewrote the use-case blurbs without extension features.
  - The free plan lists "Links, photos and notes" instead of "Chrome extension".
- **`ContentTypes.dc.html`:** Capture and Drawing are tagged "v2 · extension". Reactions note that they show as counts today (D-154).
- **Canvas:** Screens are reordered to follow the app. The three extension screens moved to the end under a "v2 · Chrome extension (D-158)" heading and are retitled "v2 · Extension: …".
- **Why:** Petr asked to bring the prototype in line with the code and the plan, adding the views and states the app already has.


---

## v0 · locked 2026-09-26

Artifact version at lock: `1790527330-e197` (the publish that added this changelog; the screens are unchanged from the last design edit).

| Screen | File | State at v0 |
| --- | --- | --- |
| Project selection | `Projects.dc.html` | "Your piles" as paper stacks; Japan 2027 with a tucked Higashiyama print |
| Project chat (zen mode) | `Main.dc.html` | Chronological feed of physical objects, category filters sorted by Kasa Bot, polaroid group, taped capture with pins, Telegram reply, Kasa Bot unprompted and tagged cards, composer with `@kasa`. Interactive: filters, dismiss, suggest, "Add to pile", sending notes |
| Extension: comment | `Comment.dc.html` | Element highlight, pin, comment box with project picker, floating toolbar |
| Extension: draw | `Draw.dc.html` | Freehand ink, arrow, highlight, tool palette |
| Extension: check and send | `Send.dc.html` | Preview with crop and blur, note, project picker, Telegram note |
| Promo page | `Promo.dc.html` | Hero "Plan it together, one pile at a time." with use-case pills (trip, wedding, talk, redesign) that swap the paragraph and collage; gradient and glow CTA; no Chrome button; no section labels |
| Content types | `ContentTypes.dc.html` | 12 types with how each looks and behaves, plus four ground rules |
| Mascot, round 1 | `Mascot.dc.html` | Pino, Kivi, Lappu, Ruska, Kasa Bot |
| Mascot, round 2 | `Mascot2.dc.html` | Smooth white creature on pine: Heap, Pebble, Drop, Stack, plus Heap's five expressions |

Photos in `img/`: kinkakuji, kiyomizu, osaka-castle, tokyo-fuji, higashiyama.
