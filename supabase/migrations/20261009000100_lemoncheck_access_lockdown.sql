-- LemonCheck 20261009000100 — access lockdown (forward-only).
--
-- Fixes the live exploits found in the 2026-10-07 audit:
--   * profiles: any user could UPDATE their own role / rating / jobs_completed / top_rated.
--   * bookings: a buyer could INSERT/UPDATE paid, status, fee, inspector.
--   * inspections + findings + report_* : an inspector could INSERT a report with self-chosen prices;
--     every signed-in user could read every inspection.
--   * report_purchases: a buyer could INSERT their own purchase row.
--   * vehicles: any user could UPDATE first_tracked_by (steals resale earnings).
--   * can_read_report() was revoked from `authenticated`, so every RLS policy that calls it failed
--     with "permission denied for function can_read_report" (detailed reports unreadable for everyone).
--
-- Approach: remove client write access to every privileged table and funnel changes through
-- SECURITY DEFINER functions (migration 20261009000200 / 20261009000300). Column-level grants keep the
-- few self-service edits (profile text fields, notification read flag) working.
--
-- Safe to apply to live: no data is deleted. Existing inspectors are grandfathered as approved;
-- existing bookings with paid = true are labelled 'legacy_unverified' (no payment record exists for them).

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'approved') then
    alter table public.profiles add column approved boolean not null default false;
    update public.profiles set approved = true where role = 'inspector';  -- grandfather existing inspectors
  end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'bookings' and column_name = 'payment_status') then
    alter table public.bookings
      add column payment_status    text not null default 'unpaid',
      add column amount_due        integer,
      add column paid_at           timestamptz,
      add column payment_reference text,
      add column cancel_reason     text,
      add column en_route_at       timestamptz,
      add column started_at        timestamptz;
    update public.bookings
       set amount_due = inspection_fee + travel_fee + platform_fee,
           payment_status = case when paid then 'legacy_unverified' else 'unpaid' end;
    alter table public.bookings
      add constraint bookings_payment_status_check
      check (payment_status in ('unpaid', 'paid', 'legacy_unverified', 'refund_due', 'refunded')),
      add constraint bookings_amount_due_check check (amount_due is null or amount_due >= 0);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_price_range check (price is null or (price between 0 and 10000)) not valid;

-- ---------------------------------------------------------------------------
-- 2. Remove every blanket grant, then grant back only what the app needs
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.profiles, public.vehicles, public.vehicle_history, public.vehicle_accidents,
  public.vehicle_odometer_readings, public.bookings, public.inspections, public.inspection_findings,
  public.report_purchases, public.notifications, public.report_items, public.report_measurements,
  public.report_tyres, public.report_photos, public.report_orders
  to authenticated;

-- Self-service profile edits: text fields and the inspector's own asking price only.
-- role, approved, rating, jobs_completed, top_rated, online, email, id are NOT updatable by clients.
grant update (name, first_name, init, phone, cert, licence, experience, region, specialty, bio, price, eta_minutes)
  on public.profiles to authenticated;
-- A user may only flip the read flag on their own notifications.
grant update (read) on public.notifications to authenticated;
-- Photos are registered by the owning inspector after upload (policy below).
grant insert on public.report_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Entitlement helper (the live revoke from `authenticated` broke every policy using it)
-- ---------------------------------------------------------------------------
create or replace function public.can_read_report(p_inspection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.inspections i
    left join public.bookings b on b.id = i.booking_id
    where i.id = p_inspection and (
      i.inspector_id = (select auth.uid())
      or b.buyer_id = (select auth.uid())
      or exists (select 1 from public.report_purchases rp
                 where rp.inspection_id = i.id and rp.buyer_id = (select auth.uid()))
    )
  );
$$;
revoke all on function public.can_read_report(uuid) from public, anon;
grant execute on function public.can_read_report(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Policies
-- ---------------------------------------------------------------------------
-- profiles: own row only. Other users' public inspector info comes from the inspector_directory view.
drop policy if exists "profiles: buyers can view online inspectors" on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- vehicles: readable, never client-writable (created by create_booking; owner set by payment confirmation).
drop policy if exists "vehicles: insert by authenticated users" on public.vehicles;
drop policy if exists "vehicles: update by authenticated users" on public.vehicles;

-- bookings: read-only for clients. Inspectors only see jobs that are assigned to them AND paid.
drop policy if exists "bookings: buyer inserts own" on public.bookings;
drop policy if exists "bookings: buyer updates own" on public.bookings;
drop policy if exists "bookings: inspector updates assigned" on public.bookings;
drop policy if exists "bookings: inspector reads assigned/pending" on public.bookings;
create policy "bookings: inspector reads assigned paid" on public.bookings for select to authenticated
  using ((select auth.uid()) = inspector_id and paid);

-- inspections / findings: only the inspector, the commissioning buyer and report purchasers.
drop policy if exists "inspections: inspector inserts own" on public.inspections;
drop policy if exists "inspections: readable by authenticated users" on public.inspections;
create policy "inspections: readable by report entitlement" on public.inspections for select to authenticated
  using (public.can_read_report(id));

drop policy if exists "findings: insert via own inspection" on public.inspection_findings;
drop policy if exists "findings: readable by authenticated users" on public.inspection_findings;
create policy "findings: readable by report entitlement" on public.inspection_findings for select to authenticated
  using (public.can_read_report(inspection_id));

-- report detail tables: read by entitlement, written only by submit_detailed_report().
drop policy if exists "report_items_write" on public.report_items;
drop policy if exists "report_measurements_write" on public.report_measurements;
drop policy if exists "report_tyres_write" on public.report_tyres;
drop policy if exists "report_photos_write" on public.report_photos;

create policy "report_photos_insert_owner" on public.report_photos for insert to authenticated
  with check (
    storage_path like inspection_id::text || '/%'
    and exists (select 1 from public.inspections i
                where i.id = report_photos.inspection_id
                  and i.inspector_id = (select auth.uid())
                  and i.submitted_at > now() - interval '48 hours')
  );

-- report_purchases / report_orders: server-written only. (Existing SELECT policies stay.)
drop policy if exists "purchases: buyer inserts own" on public.report_purchases;

-- notifications: own rows, `read` column only (grant above). Inserts happen in SECURITY DEFINER code.
drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own" on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 5. Storage: private bucket, size/type limits, safe path parsing
-- ---------------------------------------------------------------------------
update storage.buckets
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'report-photos';

drop policy if exists "report photos read" on storage.objects;
create policy "report photos read" on storage.objects for select to authenticated
  using (
    bucket_id = 'report-photos'
    and case
          when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.can_read_report(((storage.foldername(name))[1])::uuid)
          else false
        end
  );

drop policy if exists "report photos upload" on storage.objects;
create policy "report photos upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and exists (select 1 from public.inspections i
                where i.id::text = (storage.foldername(objects.name))[1]
                  and i.inspector_id = (select auth.uid())
                  and i.submitted_at > now() - interval '48 hours')
  );

-- ---------------------------------------------------------------------------
-- 6. Public views (definer-owned, so they bypass RLS but expose only safe columns)
-- ---------------------------------------------------------------------------
-- Approved inspectors visible to buyers while booking. No email, phone or licence number.
create or replace view public.inspector_directory with (security_invoker = false) as
  select id, name, first_name, init, cert, experience, region, specialty, bio,
         rating, jobs_completed, price, eta_minutes, online, top_rated
    from public.profiles
   where role = 'inspector' and approved;
revoke all on public.inspector_directory from public, anon;
grant select on public.inspector_directory to authenticated;

-- The signed-in inspector's own paid jobs, with the buyer's first name and the vehicle (buyers' profiles are
-- otherwise unreadable by inspectors).
create or replace view public.inspector_jobs with (security_invoker = false) as
  select b.id, b.inspector_id, b.vin, b.location, b.notes, b.status, b.inspection_fee, b.travel_fee,
         b.platform_fee, b.paid, b.payment_status, b.created_at, b.accepted_at, b.completed_at,
         v.make, v.model, v.year, v.colour, p.first_name as buyer_first_name
    from public.bookings b
    join public.vehicles v on v.vin = b.vin
    left join public.profiles p on p.id = b.buyer_id
   where b.inspector_id = (select auth.uid()) and b.paid;
revoke all on public.inspector_jobs from public, anon;
grant select on public.inspector_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Function hygiene
-- ---------------------------------------------------------------------------
-- The direct report-order RPC and the old SECURITY INVOKER report submit are replaced in 20261009000300.
-- Trigger functions must never be callable from the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.notify_report_completed() from public, anon, authenticated;
revoke all on function public.notify_report_purchased() from public, anon, authenticated;
