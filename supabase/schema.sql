-- Kosher Cookbook: database setup. Paste into Supabase > SQL Editor and click Run.
-- Safe to run more than once.

-- ========== Recipes ==========
create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  section       text check (section in ('salads_appetizers','soups','dairy_mains','chicken_mains','meat_mains','desserts')),
  kosher_type   text check (kosher_type in ('meat','dairy','pareve')),
  description   text,
  ingredients   jsonb not null default '[]',  -- [{group, amount, unit, item, note}]
  steps         jsonb not null default '[]',  -- ["step 1", "step 2", ...]
  servings      numeric,
  servings_text text,
  prep_time     text,
  cook_time     text,
  total_time    text,
  page_image    text,   -- shrunk copy of the recipe page (storage path)
  food_image    text,   -- shrunk copy of the food picture (storage path)
  thumb_image   text,
  drive_page_ids text[] not null default '{}',  -- full-size originals in Google Drive
  drive_food_id  text,
  batch         text,
  source        text,   -- 'photo' or 'typed'
  mixes_fish_and_meat boolean not null default false,
  needs_help    boolean not null default false,
  needs_help_reason text,
  original      jsonb,  -- exactly what was read from the clipping, never edited
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,  -- set = in Trash
  created_by    uuid,         -- for user accounts later
  updated_by    uuid
);

-- ========== Labels ==========
create table if not exists public.labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  built_in   boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);
insert into public.labels (name, built_in) values ('Favorites', true)
  on conflict (name) do nothing;

create table if not exists public.recipe_labels (
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  label_id   uuid not null references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipe_id, label_id)
);

-- ========== Family notes (separate from the original recipe) ==========
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references public.recipes(id) on delete cascade,
  body        text not null,
  author_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);

-- ========== Change history (so any edit can be undone) ==========
create table if not exists public.recipe_history (
  id         bigint generated always as identity primary key,
  recipe_id  uuid not null,
  changed_at timestamptz not null default now(),
  before     jsonb,
  after      jsonb,
  changed_by uuid
);

-- ========== "Needs my help" items that aren't a recipe yet ==========
create table if not exists public.help_items (
  id          uuid primary key default gen_random_uuid(),
  batch       text,
  drive_file_ids text[] not null default '{}',
  images      text[] not null default '{}',
  reason      text not null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ========== Batches already read ==========
create table if not exists public.batches (
  name            text primary key,
  drive_folder_id text,
  photo_count     int,
  recipes_added   int,
  help_count      int,
  processed_at    timestamptz not null default now()
);

-- ========== Automatic bookkeeping ==========
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before update on public.recipes
  for each row execute function public.touch_updated_at();
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

create or replace function public.log_recipe_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.recipe_history (recipe_id, before, after, changed_by)
  values (new.id, to_jsonb(old), to_jsonb(new), auth.uid());
  return new;
end $$;
drop trigger if exists recipes_history on public.recipes;
create trigger recipes_history after update on public.recipes
  for each row execute function public.log_recipe_change();

-- ========== Who can do what ==========
-- For now: anyone with the app link can view and edit (no passwords).
-- Recipes can't be permanently deleted from the app, only moved to Trash.
-- When accounts are added later, only these policies need to change.
alter table public.recipes        enable row level security;
alter table public.labels         enable row level security;
alter table public.recipe_labels  enable row level security;
alter table public.notes          enable row level security;
alter table public.recipe_history enable row level security;
alter table public.help_items     enable row level security;
alter table public.batches        enable row level security;

grant select, insert, update on public.recipes, public.notes, public.help_items, public.batches to anon, authenticated;
grant select, insert, update, delete on public.labels, public.recipe_labels to anon, authenticated;
grant select on public.recipe_history to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['recipes','labels','recipe_labels','notes','help_items','batches'] loop
    execute format('drop policy if exists family_read on public.%I', t);
    execute format('drop policy if exists family_add on public.%I', t);
    execute format('drop policy if exists family_edit on public.%I', t);
    execute format('create policy family_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy family_add on public.%I for insert to anon, authenticated with check (true)', t);
    execute format('create policy family_edit on public.%I for update to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

drop policy if exists family_remove on public.recipe_labels;
create policy family_remove on public.recipe_labels for delete to anon, authenticated using (true);
-- Built-in labels (Favorites) can't be deleted
drop policy if exists family_remove on public.labels;
create policy family_remove on public.labels for delete to anon, authenticated using (not built_in);
drop policy if exists family_read on public.recipe_history;
create policy family_read on public.recipe_history for select to anon, authenticated using (true);

-- ========== Picture storage ==========
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;

drop policy if exists photos_add on storage.objects;
create policy photos_add on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos');
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'photos');
