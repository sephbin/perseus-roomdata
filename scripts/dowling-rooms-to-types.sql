-- One-off data conversion for the DOWLING project (5d184911-a290-43da-ae29-2caf3d582f04).
--
-- Its 86 "rooms" are really room types -- AWC, Airlock, Cleaner, Court Lobby and
-- so on -- so this copies them into `room_types`, with their values. It adds
-- only; the rooms are left exactly as they are, to be cleared in the app.
--
-- Checked before writing this: the frozen column is Name, all 86 names are
-- distinct, none is blank, and 179 values will be copied.
--
-- Not a migration: it names one project, so it lives here rather than in
-- supabase/migrations. Run it once, in the Supabase SQL Editor.

begin;

-- The triggers on type_values would stamp every copied value as changed by
-- nobody, just now, losing who actually entered it. Off for the copy only.
alter table public.type_values disable trigger user;

with pin as (
  select id from public.fields
   where project_id = '5d184911-a290-43da-ae29-2caf3d582f04'
     and pin_order is not null
   order by pin_order limit 1
),
src as (
  select r.id as room_id, trim(v.value) as name, r.sort_order
    from public.rooms r
    join public.room_values v on v.room_id = r.id and v.field_id = (select id from pin)
   where r.project_id = '5d184911-a290-43da-ae29-2caf3d582f04'
     and trim(coalesce(v.value, '')) <> ''
),
made as (
  insert into public.room_types (project_id, name, sort_order)
  select '5d184911-a290-43da-ae29-2caf3d582f04', name, sort_order from src
  returning id, name
)
insert into public.type_values (type_id, field_id, project_id, value, updated_by, updated_at)
select m.id, v.field_id, v.project_id, v.value, v.updated_by, v.updated_at
  from made m
  join src s on s.name = m.name            -- names are unique, checked
  join public.room_values v on v.room_id = s.room_id;

alter table public.type_values enable trigger user;

commit;

-- ---------- Check it worked ----------
-- select (select count(*) from public.room_types  where project_id = '5d184911-a290-43da-ae29-2caf3d582f04') as types,
--        (select count(*) from public.type_values where project_id = '5d184911-a290-43da-ae29-2caf3d582f04') as type_values,
--        (select count(*) from public.rooms       where project_id = '5d184911-a290-43da-ae29-2caf3d582f04') as rooms_untouched;

-- ---------- Before you delete the rooms in the app ----------
-- Deleting a room cascades its value_history away, so the record of who
-- entered what disappears with it. Run this first to keep that history by
-- attaching it to the matching type instead:
--
-- update public.value_history h
--    set room_id = null, type_id = t.id
--   from public.rooms r
--   join public.room_values v on v.room_id = r.id
--   join public.fields f on f.id = v.field_id and f.pin_order is not null
--   join public.room_types t on t.project_id = r.project_id and t.name = trim(v.value)
--  where h.room_id = r.id
--    and r.project_id = '5d184911-a290-43da-ae29-2caf3d582f04';
