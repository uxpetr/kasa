# Kasa design log

Petr's design decisions, written down as they're made in the prototype. Claude Code agents read this file and fold each new entry into `PLAN.md`. Entries here are product and UX decisions by Petr, so agents may act on them without asking. Anything marked **Open** still needs him.

- Prototype: the Kasa prototype canvas, mirrored in `design/prototype/`. Its `CHANGELOG.md` lists every visual change; this log holds only the decisions that change what gets built.
- Statuses: `new` (not yet in the plan) · `folded` (in the plan, with references) · `reference` (no plan change needed) · `rejected`.

## How agents fold an entry

Do this at the start of a session, before picking a task, for every entry with status `new`:

1. Add one Decision log entry to `PLAN.md` per decision, with source "Petr, design log DL-xxx".
2. Update the affected tasks named in **Affects**: rewrite acceptance criteria, split tasks, or add new ones with the next free IDs. Keep any work already done.
3. Add every **Open** question to Open decisions, and block the tasks that depend on it.
4. Technical choices the entry leaves open (libraries, indexing, schema) are yours to make when you build the task. Log them as usual.
5. Set the entry's status to `folded` and list what it became, for example `folded → D-184, D-185, V-03a, V-03b, OD-10`.
6. Commit the design log and `PLAN.md` changes together, on their own, before starting other work.

Never edit the decision text of an entry. If the plan can't follow an entry, add an Open question instead.

---

## DL-003 · 2026-09-28 · AI-powered search · `new`

**Affects:** V-03, V-04, OD-05

**Decision**

- Search matches by meaning as well as by words. Searching "hotel", "airbnb", "where to stay", or "sleep" finds every place to stay in the pile: booking links, rental links, ryokans, and notes that talk about them. The same goes for food, getting around, sights, and other things the group collects. People can also ask questions, such as "who booked the train?".
- Exact matches come first, then related ones. A related result carries a small line under it: "✦ Related: places to stay".
- When Kasa recognises what someone is after, a Kasa Bot card sits above the results. It says how Kasa read the search ("Kasa understood 'Hotel' as places to stay") and gives a one- or two-sentence answer drawn only from this pile, for example "5 places to stay: 1 hotel, 2 rentals, and 2 ryokan mentions. Only the Gion ryokan has the private onsen Mika asked about."
- The search field shows a small "✦ Kasa" tag. Placeholder: "Search or ask: hotels, who booked the train, Kyoto food…".
- Search reads only the pile it's in, the same rule as Kasa Bot. The answer never mentions anything that isn't in the pile.
- Search never waits on the model. Results appear first, and the answer card can arrive a moment later. If the model is slow or unavailable, search still works on plain words, just without the related results and the answer card.

**Suggested split for the plan:** V-03a, plain text search with the search mode UI (DL-001) and calendar (DL-002), which doesn't need V-04. V-03b, meaning-based results and the answer card, after V-04 gives the app model access.

**Open**

- Is the answer card part of the free plan, or only for paid owners? It extends OD-05, since it uses the same model costs as Kasa Bot.

**Prototype:** `Main.dc.html`. Press Play, tap the magnifier, and try "Hotel", "airbnb", "dinner", "train", or "onsen".

## DL-002 · 2026-09-28 · Search: calendar view · `new`

**Affects:** V-03

**Decision**

- Search results can switch between Grid and Calendar with a two-button switch in the results header. Grid is the default.
- The calendar shows month grids starting on Monday, in date order, and it follows the current search: only days with matching entries light up.
- A day with matches becomes a round disc. It shows a photo from that day, darkened slightly so the day number stays readable, or, if the day has no photo, the paper colour of its first entry: yellow for notes, pine tint for Kasa Bot, white for links.
- Today's number is in the accent colour. Future days are muted.
- Tapping a day opens the grid filtered to that day, with a removable chip such as "12 Sep ×" next to the result count.

**Prototype:** `Main.dc.html`, in search mode, then Calendar.

## DL-001 · 2026-09-28 · Search mode in the project chat · `new`

**Affects:** V-03, D-148 (the project menu's placeholder Search item)

**Decision**

- Search is one of Kasa's core features. There are two ways in: a magnifier button in the composer next to +, and a "Search" item in the project menu, which replaces "Search (coming soon)".
- In search mode the composer becomes the search field, with a "Done" button. Escape also leaves search. The category row is replaced by the result count ("5 matches", or "17 things in this pile" with an empty search) and the Grid / Calendar switch.
- **Grid:** four columns on desktop, newest first. Each result is the same object as in the feed (postcard, polaroid, sticky note, index card, Kasa Bot card) but with no tilt, so the grid reads cleanly. Matched words are highlighted. Under each object: author · date · category stamp.
- An empty search shows everything in the pile, so search doubles as browsing.
- Tapping a result leaves search and scrolls the chat to that entry.
- No results: "Nothing matches “{query}”" with "Try another word, or search by a person's name or a category."

**Prototype:** `Main.dc.html`. Press Play and tap the magnifier.

## DL-000 · 2026-09-28 · Earlier prototype work since v0 · `new`

**Affects:** V-12, F-08

Mostly for reference, so agents know these designs exist. The only plan change is the open question below.

- **Screens synced with the code** (2026-09-27): feed states, menus and dialogs, invite and unsubscribe pages, and emails are in `design/prototype/`. Use them when building or restyling those parts.
- **Tokens and components** artboard: a visual reference for `@kasa/ui` and `design/tokens.json` (F-08).
- **Promo page v2**, a scroll story (`Promo2.dc.html`): messy group input piles up, Kasa pulls it in, and it comes out sorted. It ends with a use-cases screen. The hero reads "Planning anything as a group is *messy.*"

**Open**

- Which promo page ships in V-12: the original (`Promo.dc.html`) or the scroll story (`Promo2.dc.html`)? Blocks V-12.
