-- Taste Passport database: saved places and saved trips.
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run.
-- Every table has Row Level Security ON, and every rule says the same thing:
-- a signed-in person can only see and change their OWN rows. Visitors who aren't signed in get nothing.

-- ---------- Saved places: one list of favorites and dislikes per home city ----------
create table public.place_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  home_city text not null check (char_length(home_city) between 1 and 100),
  -- [{ "kind": "love" | "dislike", "name": "...", "note": "..." }, ...]
  places jsonb not null check (jsonb_typeof(places) = 'array' and octet_length(places::text) < 50000),
  updated_at timestamptz not null default now(),
  unique (user_id, home_city)
);

-- ---------- Saved trips: every guide a signed-in person makes ----------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  home_city text check (char_length(home_city) <= 100),
  destination text not null check (char_length(destination) between 1 and 100),
  purpose text check (char_length(purpose) <= 300),
  -- The guide as the app shows it: neighborhoods, eat, drink (with any booking links found)
  guide jsonb not null check (jsonb_typeof(guide) = 'object' and octet_length(guide::text) < 100000),
  created_at timestamptz not null default now()
);

create index place_lists_user_idx on public.place_lists (user_id);
create index trips_user_idx on public.trips (user_id, created_at desc);

-- ---------- Row Level Security: on for every table ----------
alter table public.place_lists enable row level security;
alter table public.trips enable row level security;

-- Only signed-in people may use these tables at all (no access for "anon", the not-signed-in role)...
revoke all on public.place_lists, public.trips from anon, authenticated;
grant select, insert, update, delete on public.place_lists to authenticated;
grant select, insert, update, delete on public.trips to authenticated;

-- ...and only their own rows. "with check" also stops anyone saving a row under someone else's id.
create policy "own place lists: read" on public.place_lists for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own place lists: add" on public.place_lists for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own place lists: change" on public.place_lists for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own place lists: delete" on public.place_lists for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "own trips: read" on public.trips for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own trips: add" on public.trips for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own trips: change" on public.trips for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own trips: delete" on public.trips for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- Size limits, so one account can't fill the free 500 MB database ----------
create function public.limit_rows_per_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  max_rows int := case tg_table_name when 'trips' then 100 else 20 end;
  current_rows int;
begin
  if tg_table_name = 'trips' then
    select count(*) into current_rows from public.trips where user_id = new.user_id;
  else
    -- Re-saving a city you already have replaces it, so it doesn't count against the limit.
    select count(*) into current_rows from public.place_lists
      where user_id = new.user_id and home_city <> new.home_city;
  end if;
  if current_rows >= max_rows then
    raise exception 'You can save up to % of these. Delete an old one first.', max_rows;
  end if;
  return new;
end $$;
revoke all on function public.limit_rows_per_user() from public, anon, authenticated;

create trigger place_lists_limit before insert on public.place_lists
  for each row execute function public.limit_rows_per_user();
create trigger trips_limit before insert on public.trips
  for each row execute function public.limit_rows_per_user();
