-- Kosher Cookbook update 4: Fish gets its own section (it used to be inside Dairy Mains).
-- Paste into Supabase > SQL Editor and click Run. Safe to run more than once.

alter table public.recipes drop constraint if exists recipes_section_check;
alter table public.recipes add constraint recipes_section_check
  check (section in ('salads_appetizers','soups','fish','dairy_mains','chicken_mains','meat_mains','sides','desserts'));

-- Move the fish recipes that were in Dairy Mains.
update public.recipes set section = 'fish'
where section = 'dairy_mains'
  and title ~* '(salmon|tuna|fish|branzino|tilapia|cod|halibut|trout|flounder|sole|gefilte|lox|herring|sea bass|mackerel|snapper)';
