-- A column can be hidden from the sheet without being deleted. Meant for the
-- ones that carry data the project needs but nobody wants to read across --
-- the import key holding a Revit id, typically.
--
-- Hiding is a display decision, not a data one: a hidden column still holds
-- its values, still takes a paste by its heading, and still acts as the import
-- key. It simply isn't drawn.

alter table public.fields add column if not exists hidden boolean not null default false;
