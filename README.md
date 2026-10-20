# Room data

A shared, live room data sheet for architects and their consultants. One room list per project, each consultant edits only their discipline's columns, and nobody needs a Cox Microsoft account.

Built on Supabase (Postgres, auth, realtime) with a single static HTML page as the front end.

## Setup

1. Create a Supabase project (Sydney region).
2. In the SQL Editor, run `supabase/migrations/20261019000000_init.sql`.
3. From Project Settings → API, copy the Project URL and publishable key into `public/app/config.js`.
4. Serve the `public` folder over http, for example `npx serve public` or `python -m http.server -d public`.
5. In Authentication → URL Configuration, set the Site URL to wherever it's served.
6. In Authentication → Email Templates, add `{{ .Token }}` to the Magic Link and Confirm Signup templates so people can sign in with a code.
7. Before inviting anyone outside your Supabase team, configure custom SMTP under Authentication → SMTP. The built-in sender only emails team members and is heavily rate-limited.

## Signing in

Two ways in:

- **Password.** Add each person under Authentication → Users → Add user, tick *Auto Confirm User* and set a password. No email is sent, so the sender rate limit doesn't apply. Turn off "Allow new users to sign up" under Authentication → Providers → Email, so nobody can register as somebody else's address.
- **Emailed code.** "Email me a sign-in code instead" on the sign-in screen. Needs steps 6 and 7 above.

## Room types

The **Types** tab holds a list of room types, each with default values for any column. The **Instance** tab is the room list; give a room a type and it picks up those values.

Type something different into a room and it overrides the type for that column only, and the cell is tinted to show it departs from the type — hover it to see what the type says. Clear the cell and the room follows the type again.

**Types can sit inside types.** A "Toilet" type can hold everything common to toilets, with "Toilet, accessible" beneath it carrying only what differs — a room takes the nearest answer, looking up the tree until it finds one. The Types tab shows the nesting indented, and the *Inherits from* column is where you change it.

Consultants can fill in type defaults for their own disciplines, so the electrical engineer sets "Consult room" once and every consult room follows. But a type with others beneath it sets values for all of them, so editing one of those needs **Can edit shared room types**, ticked per person in the People drawer. Admins always can.

## Using it

Sign in, create a project, then use the admin buttons:

- **Rooms:** add one at a time, or paste a block straight from Excel or a Revit schedule — **include the header row**. Columns are matched by their headings in any order, and headings that don't match a column are skipped and listed back to you. Tab or comma separated, quotes respected.
- **Re-importing from Revit:** mark one column as the **import key** (Columns → Edit → *Use as the import key*) and put the Revit element id in it. Rows whose key is already in the sheet update that room; anything else is added. So the same schedule can be exported from Revit and pasted again as the model changes, without duplicating anything. A `Room id` heading works too, matching on the room's own id as the CSV export writes it.
- **Columns:** every column lives here, including Code, Name, Level and Area. Add, rename, retype, reorder or delete any of them, and reorder the discipline bands too — the order in the drawer is the order of the sheet in **All columns**. Columns can be text, number, dropdown list or tick box. Any number of them can be frozen beside the room id, in their own order — frozen columns stay on screen whichever discipline tab you're on.
- **People:** add consultants by email with their disciplines, then send them the link. **Edit** reopens anyone but you, to change their role, their disciplines or whether they can edit shared room types. Tick **Every discipline** for someone who works across the whole sheet — a project architect, say — and they can edit every column, including ones added later, without the right to manage rooms, columns and people. You can't change or remove your own row; that's what stops a project losing its last admin, so another admin has to do it.
  Adding someone here puts their address on the project — it doesn't create a sign-in or send them anything. Their account has to be made in the Supabase dashboard first, where the password is set.
- **Sorting and filtering:** click a column heading to sort by it — again for descending, a third time back to the sheet's own order. The small caret beside the heading opens that column's value list, Excel style: untick *All*, tick the values you want, and the heading stays marked while the filter is on. Filters combine across columns and with the search box, and *Clear filter* removes one. On the **Types** tab both respect the nesting: sorting orders each set of siblings without pulling a child away from its parent, and filtering keeps a match's parents on screen so you can still see where it sits.
- **Copying cells:** drag across cells to select a block, **Ctrl+C**, then click the top-left cell you want it in and **Ctrl+V** — the same as Excel, and it copies and pastes to and from Excel too. Handy when a code, a name and an acronym should start out identical and be corrected afterwards. Cells you can't edit and values that don't suit their column are skipped and counted, and you're asked first before anything already filled in gets overwritten. Dragging *within* one cell still selects text as usual.
- **Filling down:** put the cursor in a cell and press **Ctrl+D** to push its value into that column for every selected room.
- **Selecting rooms:** drag down the room id column to select a run, shift-click to extend, ctrl-click to add more, or click the **Room** heading to take every row on screen (it respects whatever filter is on). Escape clears.
- **Giving many rooms a type:** select them, then pick from **Set type** in the bar at the bottom. Every selected room takes that type at once, and *— no type —* takes it away again. Cells where a room has its own value are left alone; only inherited ones change.
- **Deleting rooms:** select them, then *Delete rooms*.
- **Who else is here:** a coloured circle appears beside your name for everyone with the job open — hover one to see who. While they work you'll see their cells outlined in their colour, so two people don't quietly type over each other. It's live and none of it is saved; close the tab and the circle goes.
- **The tour:** runs itself the first time you open a project. The gear in the top right has it again whenever you want it, along with sign out.

Every change is recorded in the `value_history` table.

## Repo layout

```
public/index.html          page shell (two script tags)
public/styles.css          every style rule
public/app/                 the front end, as ES modules (no build step)
public/app/config.js       Supabase URL + publishable key
supabase/migrations/       database schema, security rules, triggers
docs/ROADMAP.md            prioritised next steps
CLAUDE.md                  context for Claude Code
```
