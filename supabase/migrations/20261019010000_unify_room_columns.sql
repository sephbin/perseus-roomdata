-- Every column in the sheet becomes a row in `fields`, including the four that
-- used to live on `rooms` (code, name, level, area). A room is now just its
-- primary key: `rooms.id`, the uuid Postgres already generated for it. Nothing
-- a person types is load-bearing any more, so a job that schedules room types
-- rather than rooms can delete Code and Area and still work.
--
-- `pinned` marks the one column frozen beside the room id while the sheet
-- scrolls sideways -- normally the code, or the room type.

alter table public.fields add column if not exists pinned boolean not null default false;

-- Only one pinned column per project.
create unique index if not exists fields_one_pinned_per_project
  on public.fields (project_id) where pinned;

-- ---------- Move existing room code/name/level/area into fields + room_values ----------

do $$
declare
  p  record;
  fc uuid;
  fn uuid;
  fl uuid;
  fa uuid;
begin
  for p in select id from public.projects loop
    insert into public.fields (project_id, label, discipline, type, pinned, sort_order)
      values (p.id, 'Code', 'Room', 'text', true, 1) returning id into fc;
    insert into public.fields (project_id, label, discipline, type, sort_order)
      values (p.id, 'Name', 'Room', 'text', 2) returning id into fn;
    insert into public.fields (project_id, label, discipline, type, sort_order)
      values (p.id, 'Level', 'Room', 'text', 3) returning id into fl;
    insert into public.fields (project_id, label, discipline, type, sort_order)
      values (p.id, 'Area m²', 'Room', 'number', 4) returning id into fa;

    insert into public.room_values (room_id, field_id, project_id, value)
      select r.id, fc, p.id, r.code
      from public.rooms r where r.project_id = p.id and coalesce(r.code, '') <> '';

    insert into public.room_values (room_id, field_id, project_id, value)
      select r.id, fn, p.id, r.name
      from public.rooms r where r.project_id = p.id and coalesce(r.name, '') <> '';

    insert into public.room_values (room_id, field_id, project_id, value)
      select r.id, fl, p.id, r.level
      from public.rooms r where r.project_id = p.id and coalesce(r.level, '') <> '';

    insert into public.room_values (room_id, field_id, project_id, value)
      select r.id, fa, p.id, r.area::text
      from public.rooms r where r.project_id = p.id and r.area is not null;
  end loop;
end $$;

-- A room is its id, its project and its place in the list. That is all.
alter table public.rooms
  drop column if exists code,
  drop column if exists name,
  drop column if exists level,
  drop column if exists area;

-- ---------- New projects start with the same four columns ----------

create or replace function public.create_project(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the project a name'; end if;
  insert into projects (name, created_by) values (trim(p_name), auth.uid()) returning id into pid;
  insert into project_members (project_id, email, role) values (pid, current_email(), 'admin');

  -- A starting point, not a fixture: an admin can rename, freeze or delete any of these.
  insert into fields (project_id, label, discipline, type, pinned, sort_order) values
    (pid, 'Code',    'Room', 'text',   true,  1),
    (pid, 'Name',    'Room', 'text',   false, 2),
    (pid, 'Level',   'Room', 'text',   false, 3),
    (pid, 'Area m²', 'Room', 'number', false, 4);

  return pid;
end $$;

revoke execute on function public.create_project(text) from public, anon;
grant  execute on function public.create_project(text) to authenticated;
