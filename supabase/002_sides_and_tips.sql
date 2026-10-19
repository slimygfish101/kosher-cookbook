-- Kosher Cookbook update 2: add a "Sides" section, plus room for each clipping's
-- tips/variations and its credit line. Paste into Supabase > SQL Editor and click Run.
-- Safe to run more than once.

alter table public.recipes drop constraint if exists recipes_section_check;
alter table public.recipes add constraint recipes_section_check
  check (section in ('salads_appetizers','soups','dairy_mains','chicken_mains','meat_mains','sides','desserts'));

alter table public.recipes add column if not exists tips jsonb not null default '[]';  -- [{label, text}] e.g. Freezer Friendly, Variations
alter table public.recipes add column if not exists credit text;                       -- "Recipe by ... — magazine, page"
