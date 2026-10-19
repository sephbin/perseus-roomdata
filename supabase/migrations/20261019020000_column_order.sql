-- Columns can be reordered, and so can the discipline bands they sit in.
--
-- Order within a band is `fields.sort_order`, which already existed. Order of
-- the bands themselves is `fields.discipline_order`: every field of a
-- discipline carries the same number, kept in step by the trigger below, so
-- moving a band is one update and adding a column never needs to think about it.

alter table public.fields add column if not exists discipline_order int not null default 0;

-- A new column joins its discipline's band. A brand new discipline goes last.
create or replace function public.fields_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare ord int;
begin
  if tg_op = 'INSERT' or new.discipline is distinct from old.discipline then
    select discipline_order into ord
      from fields
     where project_id = new.project_id and discipline = new.discipline and id <> new.id
     limit 1;
    if ord is null then
      select coalesce(max(discipline_order), 0) + 1 into ord
        from fields where project_id = new.project_id;
    end if;
    new.discipline_order := ord;
  end if;
  return new;
end $$;

drop trigger if exists fields_before on public.fields;
create trigger fields_before
before insert or update on public.fields
for each row execute function public.fields_before();

-- Backfill: keep the order people see today -- frozen column's band first, then alphabetical.
with ordered as (
  select project_id, discipline,
         row_number() over (partition by project_id order by bool_or(pinned) desc, discipline) as n
    from public.fields
   group by project_id, discipline
)
update public.fields f
   set discipline_order = o.n
  from ordered o
 where o.project_id = f.project_id and o.discipline = f.discipline;
