# Room data app

## What this is

A web app replacing the Excel-based room data sheet (RDS) process at Cox Architecture. Today, strict Excel templates go out to engineering consultants, come back broken, and have to be maintained as multiple per-discipline copies. When rooms are added they have to be added to every copy. Consultants also struggle to authenticate to Cox's Microsoft tenancy, so live SharePoint files aren't an option.

This app keeps **one** room list per project. Each consultant signs in with an emailed one-time code (no Cox account needed) and edits only their own discipline's columns in a shared live grid. Architects (admins) manage rooms, columns and people.

The owner is an architect, not a full-time developer. Prefer simple, readable solutions over clever ones, and explain trade-offs in plain language.

## Current state

Working prototype, being trialled on Supabase's free tier.

- `public/`: the whole front end. Vanilla JS as **native ES modules, still no build step and no bundler** — the browser loads `app/main.js` and follows the imports. `index.html` is a 20-line shell; `styles.css` holds every rule; `app/*.js` is the code. Loads `@supabase/supabase-js@2.45.4` UMD from jsDelivr and Archivo from Google Fonts.
- `supabase/migrations/20261019000000_init.sql`: full schema, RLS policies, triggers, realtime publication. Applied by pasting into the Supabase SQL Editor (CLI not yet set up).

Config (Supabase URL + publishable key) lives in `public/app/config.js` and nowhere else. The key is public by design; RLS is the security boundary.

## Architecture

```
Static page (index.html)  ──supabase-js──▶  Supabase
                                             ├─ Auth: email OTP / magic link
                                             ├─ Postgres + RLS (all permissions live here)
                                             └─ Realtime: postgres_changes on room_values etc.
```

There is no custom server. **All authorisation is enforced in Postgres via RLS and triggers.** The front end hides things for UX only; never rely on it for security.

## Where code goes

```
public/
  index.html        shell only: the two script tags and the two root divs
  styles.css        every rule, variables first, dark mode beside them
  app/
    config.js       Supabase URL + publishable key. Nothing else, ever.
    util.js         pure helpers. No imports at all, by design.
    state.js        the one mutable `state` object + every read-only question
                    you can ask about it. No network, no DOM writes.
    client.js       the Supabase client; auth and hash changes call the router
    bus.js          lets one module tell another something happened without
                    importing it: the redraw, plus 'selection' and 'painted'
    auth.js         the sign-in screen
    data.js         reads: loading a project, realtime, the project list
    grid.js         drawing the sheet + everything inside it (cells, freeze
                    zone, row selection, cell ranges). Owns its drag state.
    actions.js      writes: saving a cell, fill down, paste, export
    drawers.js      the admin drawers: rooms, columns, people
    presence.js     who else has this project open, and where they are in it
    tour.js         the guided tour: the steps, the spotlight, the arrow
    view.js         the project shell and the wiring outside the grid
    main.js         entry point: routing, and connecting the above
```

**The dependency rule: imports point one way only.** `config` and `util` import
nothing. `state` imports only `util`. `bus` imports nothing either, so anything
may import it. Everything else may import those four, plus: `grid` → `bus` and
no further; `presence` and `tour` → `client`/`state`/`util`/`bus`; `data` →
`grid` + `bus` + `presence`; `actions` and `drawers` → `grid` + `data`; `view`
→ all of them; `main` → everything. Nothing imports `view` or `main`. That is why `bus.js` exists — `data.js` must trigger a
redraw, and importing `view.js` to do it would make the two import each other,
which is where module cycles and half-initialised imports come from. It carries
two more topics for the same reason: `grid` announces `'selection'` and
`'painted'` without knowing that `presence` is listening, which keeps the sheet
ignorant of anything drawn on top of it.

**Deciding where something new belongs:** does it only transform its arguments
(`util`), answer a question about current state (`state`), read from Supabase
(`data`), write to Supabase (`actions`), draw inside the sheet (`grid`), draw
outside it (`view` / `drawers`)? If a function needs to both write and redraw,
it goes in `actions` and calls `paintGrid()`.

**Testing without a build step:** the modules put nothing on `window`. From the
browser console, `await import('./app/state.js')` returns the *same* instance
the running app uses, so state can be stubbed and functions called directly.

## Data model

- `projects`: created only via `create_project(p_name)` RPC (security definer), which also makes the caller admin. It raises unless `can_create_project()` says yes, so the gate holds for anyone calling the API directly. Admins rename a project with a plain update on `projects`, which its RLS policy limits to admins of that project.
- `project_creators (email)`: the allowlist of people who may start a project. `can_create_project()` returns true for an address in it **or** already an admin of some project, so an existing project's admin can't be locked out. A person can only select their own row.
- `project_members (project_id, email, role, disciplines text[])`: keyed by **lowercased email**, not user id, so people can be added before they've ever signed in. Roles: `admin`, `consultant`, `viewer`.
- `room_types (project_id, name unique per project, sort_order, parent_id)` and `type_values (type_id, field_id) PK, value`: a type carries a default for any column, and **types nest**. `rooms.type_id` is nullable, so a room without a type behaves exactly as it did before types existed.
- `project_members.edits_parent_types`: lets a consultant edit a type that has children. Admins always can.
- `rooms (project_id, sort_order, type_id)`: a room **is** its primary key. Nothing a person types identifies it, so a job can schedule room types with no codes at all, and renaming anything is safe.
- `fields`: one row per sheet column: `label, discipline, type (text|number|select|checkbox), options text[], sort_order, discipline_order, pin_order`. Code, Name, Level and Area are ordinary rows here, seeded by `create_project()` as a starting point an admin can rename or delete. Adding a column is an insert, never a migration. `pin_order` is null for an ordinary column, or 1..n for its place in the freeze zone beside the room id. No unique constraint on it: reordering renumbers the zone in sequence, and a constraint would trip over the intermediate states.
- `room_values (room_id, field_id) PK, value text, project_id, updated_by, updated_at`: one row per filled cell (EAV). All values stored as text; type is enforced by trigger.
- `value_history`: append-only audit log written by trigger.

## Key mechanics

- Helper functions `current_email()`, `is_member(p)`, `is_admin(p)`, `can_edit_value(room, field)`. The latter three are `security definer` to avoid RLS recursion on `project_members`.
- `room_values_before` trigger: sets `project_id` from the room, overwrites `updated_by`/`updated_at` (can't be spoofed), converts `''` to null, validates value against the field type/options.
- `room_values_after` trigger: writes `value_history`.
- Consultants can edit a cell iff `field.discipline = any(member.disciplines)`. Admins can edit everything. Viewers read only.
- **`*` in a consultant's disciplines means every column**, including ones added later. It is the only wildcard — everything else matches exactly, because disciplines are free text and pattern matching would surprise people. It widens which *columns*, never which *types*: a type with children still needs `edits_parent_types`. `can_edit_value()`, `can_edit_type_value()` and `canEdit()` in `state.js` all have to say the same thing, so change them together. `state.disc` excludes it, or it would show as a discipline tab matching no columns.
- Membership is a row in `project_members`, not an account. Adding someone creates no sign-in and sends no email — the account lives in Supabase Auth and is made by hand in the dashboard. The People drawer edits role, disciplines and `edits_parent_types` in place; the role is the source of truth, so demoting someone clears the disciplines rather than leaving a lapsed reach on the row.
- Admins can't delete or demote their own membership row (prevents orphaned projects).
- Front end writes cells with `upsert(..., { onConflict: 'room_id,field_id' })`, which needs INSERT, UPDATE and SELECT policies.
- Reads paginate with `fetchAll()` because PostgREST caps responses at 1000 rows by default; a 300-room × 40-column project is 12k cells.
- Realtime: `room_values` changes patch cells in place (skipping the focused cell); changes to `rooms`/`fields`/`project_members` trigger a debounced full reload that preserves scroll and focus.
- Sign-in has two paths: `signInWithPassword` (the default) and `signInWithOtp` + `verifyOtp` behind "Email me a sign-in code instead". `renderLogin(sentTo, mode)` switches between them. Password accounts are created by hand in the Supabase dashboard; self-signup must stay disabled, or someone could register a consultant's address and inherit their access.
- Column order in **All columns** is `discipline_order` then `sort_order`. Every field of a discipline carries the same `discipline_order`, kept in step by the `fields_before` trigger, so moving a band is one update per band and adding a column never has to think about it. The Columns drawer renumbers a whole band on each move rather than swapping two rows, so ties can't accumulate.
- Editing a column (label, discipline, type, options, pin_order) doesn't rewrite values already in `room_values`. Values that no longer suit the new type stay in the sheet and are counted in a warning first, because the `room_values_before` trigger will reject the *next* save of those cells until someone corrects them.
- **Inheritance walks the tree.** `typeChain(id)` returns a type and its ancestors, nearest first; `inherited(id, f)` returns the first of them with something to say about that column. A room resolves own value → its type → that type's parent → up to the root. A *type's* own cell resolves the same way from its parent (`typeCell()`), so the Types sheet shows inherited values and override tints exactly as the Instance sheet does. Both walkers carry a `seen` set: the database has a trigger against loops, but this runs on every cell and must not be the thing that hangs.
- **Editing a type with children is a bigger act** than editing a leaf, because it moves everything beneath it. `can_edit_type_value()` in SQL and `canEditType()` in `state.js` both say: the ordinary discipline rule, *and* (admin, or `edits_parent_types`, or the type has no children). The elevation widens which **types** you may edit, never which **columns** — a consultant with it still can't touch another discipline.
- `typeTree()` orders types depth-first and carries a `depth` for the indent; a type whose parent has gone is shown at the top rather than dropped. `parentChoices(t)` excludes `t` and everything beneath it, so the UI can't offer a loop in the first place.
- **Inheritance.** A room's effective value for a column is its own `room_values` row if it has one, and its type's `type_values` row otherwise (`effectiveValue()`). An override *is* an own value that differs from the type's — there is no flag, so the gentle highlight can never disagree with the data. An own value that happens to equal the type's is not an override and isn't highlighted.
- **Clearing a room's cell deletes the row** rather than storing a blank, so the room goes back to following its type. That is why `saveValue` has a delete branch. The consequence is that "deliberately blank, unlike the type" can't be expressed; it was a deliberate trade for one simple rule.
- Setting a type default or changing a room's type moves many cells at once, so those paths call `paintGrid()` rather than patching one cell.
- **One grid, two subjects.** `sheet()` holds everything that differs between the Rooms and Types views — which rows, which table and id column, which value cache, how many lead cells sit before the first real column. `gridHTML`, `valueCell`, `saveValue`, paste, export and the range maths all go through it, so the Types tab gets cell copy/paste, the freeze zone and the discipline tabs for free.
- Type defaults follow the same permission rule as the sheet (`can_edit_type_value`): admins anything, consultants the columns of their own disciplines. One consultant filling in a type moves every room of that type, which is the point of types — and `value_history` records it, with `room_id` now nullable and `type_id` added.
- **The grid scrolls, not the page.** `#app` and `.shell` are pinned to the viewport height so `.grid-wrap` is the scrollport; both it and `.shell` carry `min-height: 0` so the `1fr` track can actually shrink. That is what makes the header rows stick: `position: sticky` needs a scrolling ancestor, and if the shell is allowed to grow to its content the page scrolls instead and nothing sticks. If headers ever stop sticking, check that before touching the `top` rules.
- The band row sits at `top: 0`; `layoutFrozen()` measures its height and sets the labels row's `top` to match, rather than trusting the 32px in the stylesheet.
- **Sorting and filtering** work off `cellText()`, the value a cell actually *reads* as, inheritance included — so a value a room takes from its type sorts and filters where it looks like it should rather than as a blank. Columns are addressed by field id, with two reserved keys for the fixed columns that aren't fields: `__name` (a type's own name) and `__type` (a room's type).
- **Sorting the Types sheet keeps the tree.** `orderedRows()` hands the comparator to `typeTree()`, which sorts each set of siblings among themselves and then walks depth-first, so a child never leaves its parent and the indent keeps meaning what it says. Only the Instance sheet sorts flat.
- **Filtering the Types sheet keeps ancestors.** `visibleIds()` adds the whole `typeChain` of every match, so a matching child is never left indented under a parent the filter has hidden. Both `gridHTML` and `paintSearch` ask `visibleIds()` rather than testing rows one at a time, so the two can't disagree.
- Sorting reorders `orderedRows()`, which `gridHTML` renders and `visibleRows()` filters, so the DOM order and the logical order can't drift. Anything that depends on row order — the drag-select range, cell ranges, paste layout, export — goes through one of those two and follows automatically.
- A **filter** is a set of allowed values per column; empty means "not filtered". It is applied as the `off` class by `paintSearch()`, the same cheap path as the search box, so filtering doesn't rebuild the grid. **Sorting does** rebuild, because the row order changes — that's a click, not a keystroke, so it costs ~140 ms on a full project.
- Both are cleared when the project loads or the sheet switches: the two sheets address their fixed columns with different reserved keys, and a filter left over from the other sheet would silently hide rows.
- **Every room is always in the DOM.** The search box filters by toggling one `off` class per row (`paintSearch()`), not by rebuilding the grid: at the 300-room x 40-column target that is the difference between 1.8 ms and 471 ms a keystroke. `visibleRooms()` remains the logical answer to "what is on screen" and is what the export, the drag range and the empty-state message use, so the model and the DOM can't drift. Rooms that fall out of a search are also dropped from the selection, so Delete can never reach a room nobody can see.
- Switching discipline tabs still rebuilds (~580 ms at that size). It changes which *columns* show, and the band header row uses `colspan`, so hiding columns in CSS would leave the spans wrong. It's a click rather than a keystroke, so it was left alone deliberately. If it ever needs to be fast, the fix is to drop `colspan` from the band row, not to add a second filtering mechanism.
- The remaining cost is the ~580 ms first render of a full-size project. The lever for that is row virtualisation, which is tractable because row heights are fixed, but it has to cope with the sticky columns and with preserving focus. Measure before reaching for it.
- **Cell ranges, copy and paste.** Drag across cells to select a rectangle (`state.cellA`/`cellB`, stored as room and field ids rather than indices so a filter or a reload can't silently move them); shift-click extends it. Copy and paste go through the browser's own `copy`/`paste` events rather than `navigator.clipboard`, which means no permission prompt and TSV that Excel reads and writes natively. `pasteInto()` lays the clipboard out from the anchor, down and to the right.
- The drag deliberately doesn't start until the pointer crosses into a *different* cell. Every cell holds a live `<input>`, so taking over on mousedown would break clicking into a cell to type, and dragging within one cell has to keep selecting text normally. Once it does take over it blurs the input, clears the document selection and suppresses `selectstart`.
- Two pastes are left to the browser: a single value with no tabs or newlines while a cell input is focused, and a copy while text is selected inside an input. Both are the user doing ordinary text editing.
- Bulk writes (paste, Ctrl+D) check `canEdit` on the target column and `valueFits` per value, skipping and counting what doesn't suit rather than letting the trigger reject the whole batch. Paste confirms only when it would overwrite cells that already hold a different value — not on every paste.
- **Ctrl+D** fills the focused cell's value into the same column of every *row*-selected room. It predates cell ranges and still uses the row selection, not the cell rectangle.
- Row selection (admins only): drag down the room id column, shift-click to extend from the last anchor, ctrl/cmd to keep what's selected, Escape to clear. The handler lives on the room id column because every other cell holds an input, and dragging across those fights the browser's own text selection. `paintSelection()` toggles row classes in place rather than rebuilding the grid — a rebuild mid-drag would lose both the drag and the scroll position — so it must also be called after any full render, or a selection that survives a reload would light up rows with no action bar to act on them.
- Frozen columns come from `frozenFields()`, which reads the whole column list rather than the filtered one, so they stay on screen through every discipline tab and through a consultant's "My columns" — read-only there if they don't own that discipline. They are excluded from the scrolling part of the grid, so they never appear twice.
- Sticky columns need explicit `left` offsets and the widths aren't known until layout. `layoutFrozen()` measures the header row and pushes the cumulative offsets onto every cell; it runs after `renderProject`, after `paintGrid` (the view tabs and the search box) and on window resize. Any new code path that rewrites the grid's HTML must call `paintGrid()` rather than setting `innerHTML` directly, or the freeze zone will stack on top of itself.
- The sheet's first column is a read-only handle: the first 8 characters of `rooms.id`, with the full uuid in the cell's `title` and as the leading `Room id` column of the CSV export.
- **Paste (Rooms drawer) is header-driven**, not positional. The first pasted row names the columns; `normHeader()` matches them to field labels ignoring case, spaces and punctuation, so a Revit export lines up without being rearranged. Headings that match nothing are skipped and named in the result. Tab or comma delimited, decided by the header line; `splitDelimited()` respects quotes, because a Revit schedule cheerfully contains commas inside names.
- **Which column identifies a room**: a `Room id` heading matches on `rooms.id` as the CSV export writes it, otherwise the column marked `fields.is_key` — the **import key**, one per project by partial unique index. It holds whatever the source system calls an id, typically a Revit element id. The room's own primary key is still `rooms.id`; `is_key` is an *external* key, which is what makes re-importing a schedule update rather than duplicate.
- A row whose key value is already present updates that room; anything else is added. Cells that don't suit their column are skipped and counted rather than failing the whole paste.
- **Presence has no database behind it.** Who is here lives in a second Realtime channel, `presence-<projectId>`, keyed by email, and vanishes with the tab — which is what "who is here" means. Where someone is selected rides along in the presence payload rather than on a separate broadcast, so a late arrival sees everyone's current selection at once instead of waiting for each of them to move. Nothing in it is authoritative and nothing is saved; the worst a wrong value can do is draw a circle in the wrong place.
- Outgoing presence is throttled to the trailing edge of a 250 ms window, because a drag fires on every cell it crosses: a 20-cell drag sends 5 updates, not 20, and the last one is always the truth. Selections travel as **ids, not positions** — the person reading has their own sort and filters, so a row number would point somewhere else on their screen. A peer whose cell is filtered out of my view simply isn't drawn, and nor is one on the other sheet.
- A peer's colour comes from a hash of their address, so everyone sees the same person in the same colour without anyone having to agree on it. Their cells get an outline rather than a fill, so it can sit on top of an override tint or my own range without either being lost.
- **The tour is data, not code.** `STEPS` in `tour.js` names things already on screen by selector; a step whose target is missing (an admin button for a consultant) or whose `when()` is false is skipped rather than being a bug. It renders nothing to point at and changes nothing, and it auto-starts once per page load — `renderProject` runs on every realtime change, and a tour that restarted itself at step one each time would be unescapable.
- Routing is hash-based: `#p=<project uuid>`. Supabase auth tokens also arrive in the hash after a magic link; `currentProjectId()` only matches the `#p=` form.
- Never `await` Supabase calls inside `onAuthStateChange`; the code defers with `setTimeout`.

## Known limitations / gotchas

- **Email:** Supabase's default SMTP only delivers to members of the Supabase org team and is limited to roughly 2 emails/hour. Custom SMTP (Resend, Brevo, etc.) is required before inviting real consultants. Until then, use password sign-in, which sends no email at all.
- Email templates (Magic Link and Confirm Signup) must include `{{ .Token }}` for the code-entry path to work. Corporate mail scanners sometimes consume magic links, so the code path matters.
- Free tier projects pause after a week of inactivity.
- Adding someone to a project doesn't give them a way in. Their Supabase Auth account has to exist — made by hand in the dashboard, since self-signup is off — and the password is whatever was set there. There's no "invite" and no password reset flow in the app yet.
- Realtime DELETE events on `rooms`/`fields` aren't filtered by `project_id`, so other users may not see deletions until their next reload.
- Room deletes cascade to all values. There's a confirm dialog, but no soft delete or undo.
- Adding a member doesn't email them; the admin shares the link manually.
- The app must be served over http(s), not opened via `file://` — both for magic-link redirects and because ES modules won't load from a file URL.

## Words

The UI calls a single room an **Instance** (the tab is Instance / Types). The
table is still `rooms` and the code still says room — only the user-facing word
changed. Don't rename the table to chase it.

## Design conventions

- **Type is Mark Offc Pro, referenced with `local()` only.** It is a licensed commercial face and this repo is published, so the file is never committed. Cox machines have it installed; everyone else falls through to **Figtree** from Google Fonts, chosen as a geometric humanist with much the same skeleton and x-height so proportions hold rather than merely not breaking. Light and Medium are separate families on Windows, which is why 300 and 500 are mapped by hand in `@font-face`.
- **How the sheet is set up is remembered per project, per browser** (`roomdata:ui:<projectId>` in localStorage): which tab, which discipline view, sort, filters and column widths, stored separately for the Instance and Types sheets. It is a view preference, not project data, so it stays out of the database where it would be imposed on everyone. `applyUI()` restores it on load and `saveUI()` is called by whatever changed it. Anything stale -- a filter on a deleted column, a discipline tab that no longer exists -- is left to the existing guards in `loadProject` rather than trusted.
- **Column widths are pinned on the header cell**, not the `<col>`. A `<col>` width is only a hint in an auto-layout table and the browser ignores it in favour of content; setting `width`/`min-width`/`max-width` on the `th` is what actually holds. `applyWidths()` runs after every render and calls `layoutFrozen()`, because changing a width moves the frozen columns' measured offsets.
- Theme via CSS custom properties on `:root`, with a `prefers-color-scheme: dark` override. Every colour comes from a variable.
- **Types run warm, instances run cool.** `renderProject` puts `body.warm` on while the Types sheet is showing, and the stylesheet rotates the same palette towards clay. Which half of the app you are in is legible before you read a tab. It is on `<body>` rather than `.shell` so the page behind the grid turns with it.
- **An override is blue in both halves**, with a solid left edge as well as a tint, so it survives a selection or range tint on top. Blue against the warm sheet is the point: a departure from the type should read as a departure, not as more of the same.
- Discipline colours come from `PALETTE`, assigned by alphabetical position of the discipline name.
- Room codes render as "room tags" (pill outline), echoing tags on architectural plans.
- UI copy: sentence case, plain verbs, buttons say exactly what they do ("Add room", not "Submit"). Typographic apostrophes (’) in user-facing text.
- Error toasts state what went wrong and how to fix it.

## Working on this repo

- Keep the front end build-free. Native ES modules, no bundler, no transpiler, no package.json for the front end. If a module passes roughly 300 lines, split it along the same lines as the map above rather than letting it sprawl.
- New code goes in an existing module if one fits. A new module needs a one-line answer to "what question does this file own?" and must respect the one-way import rule.
- Schema changes go in **new** timestamped files in `supabase/migrations/`; never edit an applied migration.
- Any new table needs RLS enabled and explicit policies in the same migration.
- Test permission changes as all three roles. A quick way: sign in as yourself (admin) and as a second address added as a consultant.
- Before committing, run a syntax check on the inline script (e.g. extract it and `node --check`).

See `docs/ROADMAP.md` for prioritised next steps.
