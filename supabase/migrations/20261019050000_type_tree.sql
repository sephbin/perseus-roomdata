-- Room types nest. A type may have a parent, and a value not set on a type is
-- taken from its parent, then that parent's parent, and so on. So a "Toilet"
-- type can carry everything common to toilets, and "Toilet, accessible" below
-- it need only carry what differs.
--
-- Editing a type that has children sets values for everything beneath it, so
-- that takes more than ordinary editing rights: admins always, and consultants
-- only if they've been given `edits_parent_types`. A leaf type follows the
-- normal discipline rule.

alter table public.room_types
  add column if not exists parent_id uuid references public.room_types(id) on delete set null;

create index if not exists room_types_parent on public.room_types (parent_id);

alter table public.project_members
  add column if not exists edits_parent_types boolean not null default false;

-- ---------- The tree has to stay a tree ----------

create or replace function public.room_types_check_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p     uuid;
  depth int := 0;
  p_project uuid;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'A room type cannot be its own parent'; end if;

  select project_id into p_project from room_types where id = new.parent_id;
  if not found then raise exception 'Unknown parent room type'; end if;
  if p_project <> new.project_id then
    raise exception 'A room type and its parent must be in the same project';
  end if;

  p := new.parent_id;
  while p is not null loop
    depth := depth + 1;
    if p = new.id then raise exception 'That would make a loop of room types'; end if;
    if depth > 20 then raise exception 'Room types are nested too deeply'; end if;
    select parent_id into p from room_types where id = p;
  end loop;

  return new;
end $$;

drop trigger if exists room_types_check_parent on public.room_types;
create trigger room_types_check_parent
before insert or update of parent_id on public.room_types
for each row execute function public.room_types_check_parent();

-- ---------- Editing a type with children needs the extra right ----------

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
      and (m.role = 'admin'
           or m.edits_parent_types
           or not exists (select 1 from room_types c where c.parent_id = rt.id))
  )
$$;
