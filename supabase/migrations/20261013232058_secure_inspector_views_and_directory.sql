-- Keep inspector listings curated and prevent SECURITY DEFINER views from bypassing RLS.
-- This migration was applied to production directly; keeping it in the repository makes fresh
-- test/staging databases reproduce the same security boundary.

create table if not exists public.inspector_directory_public (
  id uuid primary key,
  name text not null,
  first_name text not null,
  init text not null,
  cert text,
  experience text,
  region text,
  specialty text,
  bio text,
  rating numeric,
  jobs_completed integer,
  price integer,
  eta_minutes integer,
  online boolean,
  top_rated boolean,
  approved boolean not null default false
);

alter table public.inspector_directory_public enable row level security;
revoke all on public.inspector_directory_public from public, anon;
grant select on public.inspector_directory_public to authenticated, service_role;
drop policy if exists "approved inspector directory readable" on public.inspector_directory_public;
create policy "approved inspector directory readable"
  on public.inspector_directory_public for select to authenticated
  using (approved = true);

create or replace function public.cv_sync_inspector_directory_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.inspector_directory_public where id = old.id;
    return old;
  end if;

  if new.role = 'inspector'::public.user_role and new.approved then
    insert into public.inspector_directory_public (
      id, name, first_name, init, cert, experience, region, specialty, bio,
      rating, jobs_completed, price, eta_minutes, online, top_rated, approved
    )
    values (
      new.id, new.name, new.first_name, new.init, new.cert, new.experience, new.region, new.specialty, new.bio,
      new.rating, new.jobs_completed, new.price, new.eta_minutes, new.online, new.top_rated, new.approved
    )
    on conflict (id) do update set
      name = excluded.name,
      first_name = excluded.first_name,
      init = excluded.init,
      cert = excluded.cert,
      experience = excluded.experience,
      region = excluded.region,
      specialty = excluded.specialty,
      bio = excluded.bio,
      rating = excluded.rating,
      jobs_completed = excluded.jobs_completed,
      price = excluded.price,
      eta_minutes = excluded.eta_minutes,
      online = excluded.online,
      top_rated = excluded.top_rated,
      approved = excluded.approved;
  else
    delete from public.inspector_directory_public where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.cv_sync_inspector_directory_public() from public, anon, authenticated;

drop trigger if exists cv_sync_inspector_directory_public on public.profiles;
create trigger cv_sync_inspector_directory_public
after insert or delete or update of role, name, first_name, init, cert, experience, region, specialty, bio,
  rating, jobs_completed, price, eta_minutes, online, top_rated, approved
on public.profiles
for each row execute function public.cv_sync_inspector_directory_public();

insert into public.inspector_directory_public (
  id, name, first_name, init, cert, experience, region, specialty, bio,
  rating, jobs_completed, price, eta_minutes, online, top_rated, approved
)
select id, name, first_name, init, cert, experience, region, specialty, bio,
       rating, jobs_completed, price, eta_minutes, online, top_rated, approved
from public.profiles
where role = 'inspector'::public.user_role and approved = true
on conflict (id) do update set
  name = excluded.name,
  first_name = excluded.first_name,
  init = excluded.init,
  cert = excluded.cert,
  experience = excluded.experience,
  region = excluded.region,
  specialty = excluded.specialty,
  bio = excluded.bio,
  rating = excluded.rating,
  jobs_completed = excluded.jobs_completed,
  price = excluded.price,
  eta_minutes = excluded.eta_minutes,
  online = excluded.online,
  top_rated = excluded.top_rated,
  approved = excluded.approved;

create or replace view public.inspector_directory with (security_invoker = true) as
select id, name, first_name, init, cert, experience, region, specialty, bio,
       rating, jobs_completed, price, eta_minutes, online, top_rated
from public.inspector_directory_public
where approved = true;

create or replace view public.inspector_jobs with (security_invoker = true) as
select b.id, b.inspector_id, b.vin, b.location, b.notes, b.status, b.inspection_fee,
       b.travel_fee, b.platform_fee, b.paid, b.payment_status, b.created_at, b.accepted_at, b.completed_at,
       v.make, v.model, v.year, v.colour, p.first_name as buyer_first_name
from public.bookings b
join public.vehicles v on v.vin = b.vin
left join public.profiles p on p.id = b.buyer_id
where b.inspector_id = (select auth.uid()) and b.paid;

revoke all on public.inspector_directory from public, anon;
grant select on public.inspector_directory to authenticated, service_role;
revoke all on public.inspector_jobs from public, anon;
grant select on public.inspector_jobs to authenticated, service_role;
