-- More than one column can be frozen beside the room id, and the frozen ones
-- keep their own order, independent of where they sit in the sheet.
--
-- `pinned boolean` becomes `pin_order int`: null means the column scrolls with
-- the rest, 1..n is its place in the freeze zone, left to right. No unique
-- constraint, because reordering renumbers the whole zone in sequence and a
-- constraint would trip over the intermediate states.

alter table public.fields add column if not exists pin_order int;

update public.fields set pin_order = 1 where pinned;

drop index if exists public.fields_one_pinned_per_project;
alter table public.fields drop column if exists pinned;

-- ---------- create_project() seeds Code into the freeze zone ----------

create or replace function public.create_project(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the project a name'; end if;
  insert into projects (name, created_by) values (trim(p_name), auth.uid()) returning id into pid;
  insert into project_members (project_id, email, role) values (pid, current_email(), 'admin');

  -- A starting point, not a fixture: an admin can rename, freeze or delete any of these.
  insert into fields (project_id, label, discipline, type, pin_order, sort_order) values
    (pid, 'Code',    'Room', 'text',   1,    1),
    (pid, 'Name',    'Room', 'text',   null, 2),
    (pid, 'Level',   'Room', 'text',   null, 3),
    (pid, 'Area m²', 'Room', 'number', null, 4);

  return pid;
end $$;

revoke execute on function public.create_project(text) from public, anon;
grant  execute on function public.create_project(text) to authenticated;
