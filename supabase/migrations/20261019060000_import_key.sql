-- One column per project can be marked as the import key: the column a pasted
-- file is matched on, so re-importing a Revit schedule updates the rooms it
-- already made rather than duplicating them. Typically holds the Revit element
-- id, but it is an ordinary column like any other.
--
-- The room's real primary key is still rooms.id. This is an external key: a
-- value supplied by whatever system the data came from.

alter table public.fields add column if not exists is_key boolean not null default false;

create unique index if not exists fields_one_key_per_project
  on public.fields (project_id) where is_key;
