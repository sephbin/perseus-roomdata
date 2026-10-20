-- Who may start a project. Until now anyone who could sign in could create one,
-- which is how this database ended up with a stray project nobody wanted.
--
-- "Admin" is a role within a project, and someone starting their first project
-- isn't in one yet, so the right to create is held in its own table. It is
-- seeded with everyone who already administers a project, and anyone on that
-- list can add the next person.

create table public.project_creators (
  email      text primary key,
  added_by   text,
  added_at   timestamptz not null default now()
);

insert into public.project_creators (email, added_by)
select distinct lower(email), 'seeded from existing admins'
  from public.project_members
 where role = 'admin'
on conflict (email) do nothing;

alter table public.project_creators enable row level security;

-- You may see whether you're on the list; the list itself isn't public.
create policy "see your own entry" on public.project_creators
  for select to authenticated using (email = current_email());

create or replace function public.can_create_project()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_creators where email = current_email())
      or exists (select 1 from project_members
                  where email = current_email() and role = 'admin')
$$;

revoke execute on function public.can_create_project() from public, anon;
grant  execute on function public.can_create_project() to authenticated;

-- ---------- create_project now checks ----------

create or replace function public.create_project(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not can_create_project() then
    raise exception 'Only a project administrator can start a project. Ask one of them to add you.';
  end if;
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
