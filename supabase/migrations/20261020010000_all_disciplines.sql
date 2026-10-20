-- "*" in a consultant's disciplines means every column, present and future.
--
-- Until now it was stored as a literal discipline name, so it matched nothing
-- and the person could edit nothing -- the opposite of what it reads as. It is
-- the only wildcard: a discipline is otherwise matched exactly, because
-- disciplines are free text and pattern matching would be a surprise.
--
-- Admins already edit everything, so this is for a consultant who works across
-- the whole sheet (a project architect, say) without the right to manage
-- rooms, columns and people.

create or replace function public.can_edit_value(r uuid, f uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from rooms ro
    join fields fi           on fi.id = f and fi.project_id = ro.project_id
    join project_members m   on m.project_id = ro.project_id and m.email = current_email()
    where ro.id = r
      and (m.role = 'admin'
           or (m.role = 'consultant'
               and ('*' = any (m.disciplines) or fi.discipline = any (m.disciplines))))
  )
$$;

create or replace function public.can_edit_type_value(t uuid, f uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from room_types rt
    join fields fi         on fi.id = f and fi.project_id = rt.project_id
    join project_members m on m.project_id = rt.project_id and m.email = current_email()
    where rt.id = t
      and (m.role = 'admin'
           or (m.role = 'consultant'
               and ('*' = any (m.disciplines) or fi.discipline = any (m.disciplines))))
      -- A type with children sets values for all of them, so that stays a
      -- separate right: holding "*" widens which columns, never which types.
      and (m.role = 'admin'
           or m.edits_parent_types
           or not exists (select 1 from room_types c where c.parent_id = rt.id))
  )
$$;

notify pgrst, 'reload schema';
