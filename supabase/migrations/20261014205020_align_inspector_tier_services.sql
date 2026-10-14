-- Align inspector service offerings with the paid inspection tier.
create table if not exists public.inspector_tier_services (
  inspector_id uuid not null references public.profiles(id) on delete cascade,
  tier_id uuid not null references public.inspection_tiers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (inspector_id, tier_id)
);
alter table public.inspector_tier_services enable row level security;
revoke all on table public.inspector_tier_services from anon, authenticated;

create or replace function public.sync_inspector_tier_services_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tiers jsonb;
begin
  if new.role is distinct from 'inspector' then return new; end if;
  select u.raw_user_meta_data -> 'inspection_tiers' into v_tiers from auth.users u where u.id = new.id;
  if jsonb_typeof(v_tiers) = 'array' then
    insert into public.inspector_tier_services(inspector_id, tier_id)
    select new.id, t.id
    from jsonb_array_elements_text(v_tiers) requested(tier_text)
    join public.inspection_tiers t on t.id::text = requested.tier_text and t.active
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.inspector_tier_services s where s.inspector_id = new.id) then
    insert into public.inspector_tier_services(inspector_id, tier_id)
    select new.id, t.id from public.inspection_tiers t
    where t.active and lower(t.name) = 'basic'
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists sync_inspector_tier_services_on_signup on public.profiles;
create trigger sync_inspector_tier_services_on_signup after insert on public.profiles
for each row execute function public.sync_inspector_tier_services_on_signup();

-- Existing approved inspectors retain a Basic-only offering until they explicitly opt into more.
insert into public.inspector_tier_services(inspector_id, tier_id)
select p.id, t.id from public.profiles p cross join public.inspection_tiers t
where p.role = 'inspector' and p.approved and t.active and lower(t.name) = 'basic'
on conflict do nothing;

create or replace function public.set_my_inspector_tiers(p_tier_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_active_count integer;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'inspector') then
    raise exception 'Only inspectors can update service tiers' using errcode = '42501';
  end if;
  if p_tier_ids is null or cardinality(p_tier_ids) < 1 or cardinality(p_tier_ids) > 3 then
    raise exception 'Select between one and three inspection tiers' using errcode = '22023';
  end if;
  select count(distinct t.id) into v_active_count from public.inspection_tiers t
  where t.id = any(p_tier_ids) and t.active;
  if v_active_count <> cardinality(p_tier_ids) then
    raise exception 'One or more selected inspection tiers are unavailable' using errcode = '22023';
  end if;
  delete from public.inspector_tier_services where inspector_id = v_uid;
  insert into public.inspector_tier_services(inspector_id, tier_id)
  select v_uid, t.id from public.inspection_tiers t where t.id = any(p_tier_ids) and t.active;
end;
$$;
revoke all on function public.set_my_inspector_tiers(uuid[]) from public, anon;
grant execute on function public.set_my_inspector_tiers(uuid[]) to authenticated;

create or replace function public.list_inspectors_with_tiers()
returns table (
  id uuid, name text, first_name text, init text, cert text, experience text,
  region text, specialty text, bio text, rating numeric, jobs_completed integer,
  price integer, eta_minutes integer, online boolean, top_rated boolean, tier_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  select d.id, d.name, d.first_name, d.init, d.cert, d.experience, d.region, d.specialty,
         d.bio, d.rating, d.jobs_completed, d.price, d.eta_minutes, d.online, d.top_rated,
         coalesce(array_agg(s.tier_id) filter (where s.tier_id is not null), '{}'::uuid[])
  from public.inspector_directory d
  left join public.inspector_tier_services s on s.inspector_id = d.id
  group by d.id, d.name, d.first_name, d.init, d.cert, d.experience, d.region, d.specialty,
           d.bio, d.rating, d.jobs_completed, d.price, d.eta_minutes, d.online, d.top_rated;
$$;
revoke all on function public.list_inspectors_with_tiers() from public;
grant execute on function public.list_inspectors_with_tiers() to anon, authenticated;

create or replace function public.enforce_booking_inspector_tier_service()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tier_id is not null and new.inspector_id is not null
     and not exists (select 1 from public.inspector_tier_services s
                     where s.inspector_id = new.inspector_id and s.tier_id = new.tier_id) then
    raise exception 'This inspector does not offer the selected inspection tier' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_inspector_tier_service_guard on public.bookings;
create trigger bookings_inspector_tier_service_guard before insert or update of inspector_id, tier_id
on public.bookings for each row execute function public.enforce_booking_inspector_tier_service();
