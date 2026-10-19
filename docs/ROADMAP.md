# Roadmap

Ordered roughly by priority. Each item is sized to be a single focused task.

## Before inviting real consultants

1. ~~**Move config out of index.html.**~~ Done: `public/app/config.js` holds the URL and publishable key and nothing else.
2. **Restrict project creation.** Add an allowlist (table of emails or an allowed email domain such as `@cox.com.au`) checked inside `create_project()`.
3. **Set up the Supabase CLI.** Link the repo to the project so migrations are applied with `supabase db push` instead of pasting SQL.
4. **Deploy.** Static hosting (Netlify, Cloudflare Pages or GitHub Pages). Add the deployed URL to Supabase Auth → URL Configuration.
5. **Custom SMTP.** Document the chosen provider and the template changes (`{{ .Token }}` in Magic Link and Confirm Signup).

## Core usability

6. ~~**Column reordering** in the Columns drawer.~~ Done: up/down buttons in the Columns drawer move a column within its discipline, and move whole discipline bands.
7. ~~**Edit columns**, not just add/delete.~~ Done: the Edit button opens label, discipline, type, list choices and the frozen flag, and counts the values that would no longer suit the column before changing it.
8. **Cell history view.** Click a cell (or a small icon) to see its `value_history`: who, when, old → new.
9. **Paste a block of values** into the grid from Excel (multi-row, multi-column), respecting edit permissions and validating per cell.
10. **Excel export (.xlsx)** with one sheet per discipline plus an "All" sheet, via SheetJS. Keep CSV too.
11. ~~**Filter by level**, and sort by any column.~~ Done: click a heading to sort, use the caret for an Excel-style value filter on any column.

## Data integrity

12. **Soft-delete rooms** (an `archived_at` column) instead of cascading deletes, with a restore option for admins.
13. **Fix realtime deletes:** handle DELETE payloads (which only carry the primary key) so other users see removed rooms and columns without a reload.
14. **Required columns / completeness.** Mark fields as required and show per-discipline completion percentages, so the architect can see who still owes data.

## Later

15. ~~**Room templates / room types.**~~ Done, and as live inheritance rather than a one-time apply: a room follows its type until you type something else into a cell, which overrides that column alone and tints the cell. Changing a type's value moves every room that still follows it.
16. **Revit round-trip.** Import rooms from a Revit schedule export and export values back in a format a Dynamo script can read.
17. **Per-project disciplines table** with a fixed colour per discipline, rather than colour by alphabetical position.
18. **Invitation emails** sent via an Edge Function when an admin adds someone.
19. **Comments on cells** for consultant ↔ architect queries, replacing email threads.
