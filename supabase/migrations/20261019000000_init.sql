-- ============================================================
-- Room data — Supabase schema
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run once on a fresh project.
-- ============================================================

-- ---------- Tables ----------

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Membership is keyed by email so you can add consultants
-- before they've ever signed in.
create table public.project_members (
  project_id   uuid not null references public.projects(id) on delete cascade,
  email        text not null check (email = lower(email)),
  role         text not null default 'consultant'
               check (role in ('admin', 'consultant', 'viewer')),
  disciplines  text[] not null default '{}',   -- which column groups a consultant can edit
  primary key (project_id, email)
);

create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null,
  name        text not null default '',
  level       text not null default '',
  area        numeric,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, code)
);

-- Each column in the room data sheet is a row here.
-- Adding a column never needs a schema change.
create table public.fields (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  label       text not null,
  discipline  text not null,
  type        text not null default 'text'
              check (type in ('text', 'number', 'select', 'checkbox')),
  options     text[] not null default '{}',     -- choices for 'select'
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- One row per filled-in cell.
create table public.room_values (
  room_id     uuid not null references public.rooms(id)  on delete cascade,
  field_id    uuid not null references public.fields(id) on delete cascade,
  project_id  uuid not null,                     -- set by trigger, used for filtering and realtime
  value       text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (room_id, field_id)
);

-- Every change, forever. Who changed what, when.
create table public.value_history (
  id          bigint generated always as identity primary key,
  project_id  uuid not null,
  room_id     uuid not null references public.rooms(id)  on delete cascade,
  field_id    uuid not null references public.fields(id) on delete cascade,
  old_value   text,
  new_value   text,
  changed_by  text,
  changed_at  timestamptz not null default now()
);

create index on public.rooms (project_id);
create index on public.fields (project_id);
create index on public.room_values (project_id);
create index on public.value_history (room_id, field_id);

-- ---------- Helper functions ----------

create or replace function public.current_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- security definer so policies can check membership without recursing
create or replace function public.is_member(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members
    where project_id = p and email = current_email()
  )
$$;

create or replace function public.is_admin(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members
    where project_id = p and email = current_email() and role = 'admin'
  )
$$;

-- Admins can edit any cell; consultants only cells in their disciplines.
create or replace function public.can_edit_value(r uuid, f uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from rooms ro
    join fields fi           on fi.id = f and fi.project_id = ro.project_id
    join project_members m   on m.project_id = ro.project_id and m.email = current_email()
    where ro.id = r
      and (m.role = 'admin'
           or (m.role = 'consultant' and fi.discipline = any (m.disciplines)))
  )
$$;

-- Creates a project and makes the caller its admin.
create or replace function public.create_project(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the project a name'; end if;
  insert into projects (name, created_by) values (trim(p_name), auth.uid()) returning id into pid;
  insert into project_members (project_id, email, role) values (pid, current_email(), 'admin');
  return pid;
end $$;

revoke execute on function public.create_project(text) from public, anon;
grant  execute on function public.create_project(text) to authenticated;

-- ---------- Validation + audit triggers ----------

-- Runs on every cell write. Enforces column types server-side,
-- so nobody can bypass the dropdowns the way they do in Excel.
create or replace function public.room_values_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f         fields%rowtype;
  r_project uuid;
begin
  select project_id into r_project from rooms where id = new.room_id;
  if not found then raise exception 'Unknown room'; end if;

  select * into f from fields where id = new.field_id;
  if not found then raise exception 'Unknown column'; end if;

  if f.project_id <> r_project then
    raise exception 'Room and column belong to different projects';
  end if;

  new.project_id := r_project;
  new.updated_by := current_email();
  new.updated_at := now();

  if new.value = '' then new.value := null; end if;

  if new.value is not null then
    if f.type = 'number' and new.value !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception '% needs a number', f.label;
    elsif f.type = 'select' and not (new.value = any (f.options)) then
      raise exception '% must be one of: %', f.label, array_to_string(f.options, ', ');
    elsif f.type = 'checkbox' and new.value not in ('true', 'false') then
      raise exception '% must be ticked or unticked', f.label;
    end if;
  end if;

  return new;
end $$;

create trigger room_values_before
before insert or update on public.room_values
for each row execute function public.room_values_before();

create or replace function public.room_values_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.value is distinct from old.value then
    insert into value_history (project_id, room_id, field_id, old_value, new_value, changed_by)
    values (new.project_id, new.room_id, new.field_id,
            case when tg_op = 'UPDATE' then old.value end,
            new.value, new.updated_by);
  end if;
  return null;
end $$;

create trigger room_values_after
after insert or update on public.room_values
for each row execute function public.room_values_after();

-- ---------- Row-level security ----------

alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.rooms           enable row level security;
alter table public.fields          enable row level security;
alter table public.room_values     enable row level security;
alter table public.value_history   enable row level security;

-- Projects: members can see; admins can rename/delete. Creation goes through create_project().
create policy "members read projects"  on public.projects for select to authenticated using (is_member(id));
create policy "admins update projects" on public.projects for update to authenticated using (is_admin(id)) with check (is_admin(id));
create policy "admins delete projects" on public.projects for delete to authenticated using (is_admin(id));

-- Members: everyone on the project can see the team; admins manage it
-- (but can't remove or demote themselves, so a project can't be orphaned by accident).
create policy "members read members"  on public.project_members for select to authenticated using (is_member(project_id));
create policy "admins add members"    on public.project_members for insert to authenticated with check (is_admin(project_id));
create policy "admins update members" on public.project_members for update to authenticated
  using (is_admin(project_id) and email <> current_email()) with check (is_admin(project_id));
create policy "admins remove members" on public.project_members for delete to authenticated
  using (is_admin(project_id) and email <> current_email());

-- Rooms and columns: everyone reads, admins write.
create policy "members read rooms"  on public.rooms for select to authenticated using (is_member(project_id));
create policy "admins insert rooms" on public.rooms for insert to authenticated with check (is_admin(project_id));
create policy "admins update rooms" on public.rooms for update to authenticated using (is_admin(project_id)) with check (is_admin(project_id));
create policy "admins delete rooms" on public.rooms for delete to authenticated using (is_admin(project_id));

create policy "members read fields"  on public.fields for select to authenticated using (is_member(project_id));
create policy "admins insert fields" on public.fields for insert to authenticated with check (is_admin(project_id));
create policy "admins update fields" on public.fields for update to authenticated using (is_admin(project_id)) with check (is_admin(project_id));
create policy "admins delete fields" on public.fields for delete to authenticated using (is_admin(project_id));

-- Cells: everyone on the project reads; you write only where you're allowed.
create policy "members read values" on public.room_values for select to authenticated using (is_member(project_id));
create policy "editors insert values" on public.room_values for insert to authenticated
  with check (can_edit_value(room_id, field_id));
create policy "editors update values" on public.room_values for update to authenticated
  using (can_edit_value(room_id, field_id)) with check (can_edit_value(room_id, field_id));
create policy "editors delete values" on public.room_values for delete to authenticated
  using (can_edit_value(room_id, field_id));

-- History: read-only for members; only the trigger writes it.
create policy "members read history" on public.value_history for select to authenticated using (is_member(project_id));

-- ---------- Realtime (live updates between users) ----------

alter publication supabase_realtime
  add table public.room_values, public.rooms, public.fields, public.project_members;
