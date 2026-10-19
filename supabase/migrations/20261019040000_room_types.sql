-- Room types carry default values that rooms inherit.
--
-- A room's effective value for a column is its own value if it has one, and the
-- value from its type otherwise. An override is simply the existence of a
-- `room_values` row that differs from the type's -- there is no flag to keep in
-- step, so the two can never disagree. Clearing a room's cell deletes that row
-- and the room inherits again.
--
-- Who may set a type's defaults follows the same rule as the sheet itself:
-- admins anything, consultants the columns of their own disciplines.

create table public.room_types (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create table public.type_values (
  type_id     uuid not null references public.room_types(id) on delete cascade,
  field_id    uuid not null references public.fields(id)     on delete cascade,
  project_id  uuid not null,                   -- set by trigger, for filtering and realtime
  value       text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (type_id, field_id)
);

-- A room needn't have a type. One without a type behaves exactly as before.
alter table public.rooms
  add column if not exists type_id uuid references public.room_types(id) on delete set null;

create index on public.room_types (project_id);
create index on public.type_values (project_id);
create index on public.rooms (type_id);

-- The audit log now covers type defaults too, so room_id gives way to one or the other.
alter table public.value_history alter column room_id drop not null;
alter table public.value_history
  add column if not exists type_id uuid references public.room_types(id) on delete cascade;

-- ---------- Permissions ----------

create or replace function public.can_edit_type_value(t uuid, f uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from room_types rt
    join fields fi         on fi.id = f and fi.project_id = rt.project_id
    join project_members m on m.project_id = rt.project_id and m.email = current_email()
    where rt.id = t
      and (m.role = 'admin'
           or (m.role = 'consultant' and fi.discipline = any (m.disciplines)))
  )
$$;

-- ---------- Validation + audit, mirroring room_values ----------

create or replace function public.type_values_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f         fields%rowtype;
  t_project uuid;
begin
  select project_id into t_project from room_types where id = new.type_id;
  if not found then raise exception 'Unknown room type'; end if;

  select * into f from fields where id = new.field_id;
  if not found then raise exception 'Unknown column'; end if;

  if f.project_id <> t_project then
    raise exception 'Room type and column belong to different projects';
  end if;

  new.project_id := t_project;
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

create trigger type_values_before
before insert or update on public.type_values
for each row execute function public.type_values_before();

create or replace function public.type_values_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.value is distinct from old.value then
    insert into value_history (project_id, type_id, field_id, old_value, new_value, changed_by)
    values (new.project_id, new.type_id, new.field_id,
            case when tg_op = 'UPDATE' then old.value end,
            new.value, new.updated_by);
  end if;
  return null;
end $$;

create trigger type_values_after
after insert or update on public.type_values
for each row execute function public.type_values_after();

-- ---------- Row-level security ----------

alter table public.room_types  enable row level security;
alter table public.type_values enable row level security;

create policy "members read types"  on public.room_types for select to authenticated using (is_member(project_id));
create policy "admins insert types" on public.room_types for insert to authenticated with check (is_admin(project_id));
create policy "admins update types" on public.room_types for update to authenticated using (is_admin(project_id)) with check (is_admin(project_id));
create policy "admins delete types" on public.room_types for delete to authenticated using (is_admin(project_id));

create policy "members read type values"  on public.type_values for select to authenticated using (is_member(project_id));
create policy "editors insert type values" on public.type_values for insert to authenticated
  with check (can_edit_type_value(type_id, field_id));
create policy "editors update type values" on public.type_values for update to authenticated
  using (can_edit_type_value(type_id, field_id)) with check (can_edit_type_value(type_id, field_id));
create policy "editors delete type values" on public.type_values for delete to authenticated
  using (can_edit_type_value(type_id, field_id));

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.room_types, public.type_values;
