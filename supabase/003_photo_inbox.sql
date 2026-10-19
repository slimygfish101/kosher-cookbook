-- Kosher Cookbook update 3: upload clipping photos straight from the app.
-- Paste into Supabase > SQL Editor and click Run. Safe to run more than once.

-- Photos waiting to be read, grouped into batches by the app.
create table if not exists public.uploads (
  id           uuid primary key default gen_random_uuid(),
  batch        text not null,
  path         text not null,         -- storage path under photos/inbox/...
  file_name    text,
  size_bytes   bigint,
  taken_at     timestamptz,           -- when the photo was taken (from the photo itself, if available)
  position     int,                   -- order within the batch
  uploaded_by  text,
  uploaded_at  timestamptz not null default now(),
  processed_at timestamptz,
  created_by   uuid
);
alter table public.uploads enable row level security;
grant select, insert, update on public.uploads to anon, authenticated;
drop policy if exists family_read on public.uploads;
drop policy if exists family_add on public.uploads;
drop policy if exists family_edit on public.uploads;
create policy family_read on public.uploads for select to anon, authenticated using (true);
create policy family_add on public.uploads for insert to anon, authenticated with check (true);
create policy family_edit on public.uploads for update to anon, authenticated using (true) with check (true);

-- Uploaded photos may be cleared out of the inbox once they've been read (only inside inbox/).
drop policy if exists inbox_remove on storage.objects;
create policy inbox_remove on storage.objects for delete to anon, authenticated
  using (bucket_id = 'photos' and name like 'inbox/%');

-- Every original photo of a recipe, kept as a high-resolution copy you can always check.
alter table public.recipes add column if not exists photo_images text[] not null default '{}';
