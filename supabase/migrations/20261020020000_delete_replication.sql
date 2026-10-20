-- Make DELETE events usable over Realtime.
--
-- Postgres sends only the replica identity with a delete, which by default is
-- the primary key. Two things follow, and both were biting:
--
--   1. A subscription filtered by project_id never matches a delete, because
--      project_id isn't in the primary key -- so the event is dropped before
--      it reaches anyone. Edits appeared on other screens; clearing a cell did
--      not, and the cell sat there holding a value that no longer existed.
--   2. Even unfiltered, the payload carries no project_id to check.
--
-- REPLICA IDENTITY FULL puts the whole old row in the WAL, so a delete arrives
-- with project_id and the existing per-project filters work on it. The cost is
-- WAL volume on update and delete: these rows are a handful of short columns,
-- and a big project is tens of thousands of them, not millions.
--
-- rooms and fields get it too. Their deletes were failing to reach other
-- people for exactly the same reason, which until now was written down as a
-- known limitation rather than fixed.

alter table public.room_values  replica identity full;
alter table public.type_values  replica identity full;
alter table public.rooms        replica identity full;
alter table public.fields       replica identity full;
alter table public.room_types   replica identity full;
