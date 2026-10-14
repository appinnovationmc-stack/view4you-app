-- Approximate inspector positions for the buyer map.
--
-- Privacy rules built into the database, not the app:
--   * A position exists only while an approved inspector is online. Going offline, being suspended
--     or being un-approved deletes it immediately (trigger below).
--   * Positions are rounded to 3 decimal places (~110 m) before they are stored. The exact GPS fix
--     never reaches the database.
--   * Positions older than 30 minutes are never returned, so a phone that died while "online" does
--     not leave a stale pin on the map.
--   * Only signed-in buyers can list positions, and only through list_inspector_locations(). The
--     table itself is closed to direct API access.

create table if not exists public.inspector_locations (
  inspector_id uuid primary key references public.profiles (id) on delete cascade,
  lat numeric(8, 3) not null check (lat between -90 and 90),
  lng numeric(8, 3) not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);

alter table public.inspector_locations enable row level security;
drop policy if exists deny_direct_api_access on public.inspector_locations;
create policy deny_direct_api_access on public.inspector_locations
  for all to anon, authenticated using (false) with check (false);
revoke all on public.inspector_locations from public, anon, authenticated;
grant select, insert, update, delete on public.inspector_locations to service_role;

-- ---------------------------------------------------------------------------
-- An approved, online inspector shares an approximate position.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null
     or p_lat <> p_lat or p_lng <> p_lng                       -- NaN
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_uid and role = 'inspector'::public.user_role and approved and online) then
    raise exception 'Go online before sharing your location' using errcode = '42501';
  end if;

  insert into public.inspector_locations (inspector_id, lat, lng, updated_at)
  values (v_uid, round(p_lat::numeric, 3), round(p_lng::numeric, 3), now())
  on conflict (inspector_id) do update
    set lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at;
end $$;

-- ---------------------------------------------------------------------------
-- Buyers see where online inspectors are, nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.list_inspector_locations()
returns table (inspector_id uuid, lat numeric, lng numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
       select 1 from public.profiles where id = auth.uid() and role = 'buyer'::public.user_role) then
    raise exception 'Buyer sign-in required' using errcode = '42501';
  end if;
  return query
    select l.inspector_id, l.lat, l.lng
      from public.inspector_locations l
      join public.profiles p on p.id = l.inspector_id
     where p.role = 'inspector'::public.user_role and p.approved and p.online
       and l.updated_at > now() - interval '30 minutes';
end $$;

-- ---------------------------------------------------------------------------
-- The position is removed the moment the inspector stops being online and approved.
-- ---------------------------------------------------------------------------
create or replace function public.cv_clear_inspector_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(new.online, false) or not coalesce(new.approved, false)
     or new.role <> 'inspector'::public.user_role then
    delete from public.inspector_locations where inspector_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists cv_clear_inspector_location on public.profiles;
create trigger cv_clear_inspector_location
after update of online, approved, role on public.profiles
for each row execute function public.cv_clear_inspector_location();

revoke all on function public.set_my_location(double precision, double precision) from public, anon;
grant execute on function public.set_my_location(double precision, double precision) to authenticated, service_role;
revoke all on function public.list_inspector_locations() from public, anon;
grant execute on function public.list_inspector_locations() to authenticated, service_role;
revoke all on function public.cv_clear_inspector_location() from public, anon, authenticated;
