-- Inspector location sharing is explicit (going online) and directory coordinates are coarse.
-- The table may already exist in production; define it here too so fresh/test databases replay cleanly.
create table if not exists public.inspector_locations (
  inspector_id uuid primary key references public.profiles(id) on delete cascade,
  lat numeric not null check (lat between -90 and 90),
  lng numeric not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);
alter table public.inspector_locations enable row level security;
revoke all on public.inspector_locations from public, anon, authenticated;
create or replace function public.update_my_inspector_location(p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'A valid location is required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id=v_uid and p.role='inspector' and p.approved) then
    raise exception 'Only approved inspectors can publish a location.' using errcode = '42501';
  end if;
  insert into public.inspector_locations(inspector_id,lat,lng,updated_at)
  values (v_uid,p_lat,p_lng,now())
  on conflict (inspector_id) do update set lat=excluded.lat,lng=excluded.lng,updated_at=now();
end;
$$;
revoke all on function public.update_my_inspector_location(numeric,numeric) from public, anon;
grant execute on function public.update_my_inspector_location(numeric,numeric) to authenticated;

create or replace function public.list_inspectors_with_tiers_and_locations()
returns table(
 id uuid, name text, first_name text, init text, cert text, experience text, region text,
 specialty text, bio text, rating numeric, jobs_completed integer, price integer,
 eta_minutes integer, online boolean, top_rated boolean, tier_ids uuid[], lat numeric, lng numeric
)
language sql
stable
security definer
set search_path = ''
as $$
 select d.id,d.name,d.first_name,d.init,d.cert,d.experience,d.region,d.specialty,d.bio,
        d.rating,d.jobs_completed,d.price,d.eta_minutes,d.online,d.top_rated,
        coalesce(array_agg(s.tier_id) filter (
          where s.tier_id is not null and (lower(t.name)<>'comprehensive' or s.can_measure)
        ),'{}'::uuid[]),
        case when d.online and l.updated_at > now()-interval '4 hours' then round(l.lat,3) else null end,
        case when d.online and l.updated_at > now()-interval '4 hours' then round(l.lng,3) else null end
 from public.inspector_directory d
 left join public.inspector_tier_services s on s.inspector_id=d.id
 left join public.inspection_tiers t on t.id=s.tier_id
 left join public.inspector_locations l on l.inspector_id=d.id
 group by d.id,d.name,d.first_name,d.init,d.cert,d.experience,d.region,d.specialty,d.bio,
          d.rating,d.jobs_completed,d.price,d.eta_minutes,d.online,d.top_rated,l.lat,l.lng,l.updated_at;
$$;
revoke all on function public.list_inspectors_with_tiers_and_locations() from public, anon;
grant execute on function public.list_inspectors_with_tiers_and_locations() to authenticated;
