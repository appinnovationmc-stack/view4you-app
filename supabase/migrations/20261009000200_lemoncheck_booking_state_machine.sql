-- LemonCheck 20261009000200 — server-side booking state machine (forward-only).
--
-- Clients can no longer write bookings. Every transition goes through one of these functions, each of which
-- checks the caller's role, ownership and the current state inside a single statement or row lock:
--
--   create_booking   buyer      -> pending / unpaid, price computed from the inspector's profile
--   (payment)        PayFast ITN-> paid (20261009000300 apply_payfast_itn, service role only)
--   accept_booking   inspector  pending(paid) -> accepted          (race-safe: first writer wins)
--   decline_booking  inspector  pending       -> cancelled         (paid bookings become refund_due)
--   advance_booking  inspector  accepted -> en_route -> in_progress
--   cancel_booking   buyer      pending       -> cancelled         (paid bookings become refund_due)
--   (report submit)  inspector  accepted/en_route/in_progress -> done (20261009000300)
--
-- Fees are constants here, not client input. Change them in lc_travel_fee()/lc_platform_fee() only.

create or replace function public.lc_travel_fee() returns integer
language sql immutable set search_path = '' as $$ select 100 $$;
create or replace function public.lc_platform_fee() returns integer
language sql immutable set search_path = '' as $$ select 75 $$;

-- Resale split of a report. OPEN BUSINESS DECISION: today the platform keeps 0% of a resale
-- (18% of the inspection fee is the resale price; ~51.5% to the commissioning buyer, remainder to the inspector).
-- This function is the single place that policy lives.
create or replace function public.lc_report_split(p_inspection_fee integer)
returns table (report_price integer, payer_cut integer, inspector_cut integer)
language sql immutable set search_path = '' as $$
  select rp, pc, rp - pc
  from (select round(p_inspection_fee * 0.18)::integer as rp,
               round(round(p_inspection_fee * 0.18) * 0.515)::integer as pc) s;
$$;

revoke all on function public.lc_travel_fee() from public, anon;
revoke all on function public.lc_platform_fee() from public, anon;
revoke all on function public.lc_report_split(integer) from public, anon;
grant execute on function public.lc_travel_fee() to authenticated, service_role;
grant execute on function public.lc_platform_fee() to authenticated, service_role;
grant execute on function public.lc_report_split(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
create or replace function public.create_booking(
  p_vin text, p_make text, p_model text, p_year integer,
  p_location text, p_notes text, p_inspector_id uuid
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role;
  v_vin   text := upper(btrim(coalesce(p_vin, '')));
  v_insp  public.profiles%rowtype;
  v_open  integer;
  v_b     public.bookings%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'buyer' then
    raise exception 'Only buyers can book inspections' using errcode = '42501';
  end if;

  if v_vin !~ '^[A-Z0-9]{6,17}$' then
    raise exception 'Enter a valid VIN or registration (6-17 letters/numbers)' using errcode = '22023';
  end if;
  if p_make is null or length(btrim(p_make)) not between 1 and 60
     or p_model is null or length(btrim(p_model)) not between 1 and 60 then
    raise exception 'Make and model are required' using errcode = '22023';
  end if;
  if p_year is null or p_year not between 1950 and extract(year from now())::integer + 1 then
    raise exception 'Enter a valid vehicle year' using errcode = '22023';
  end if;
  if p_location is null or length(btrim(p_location)) not between 3 and 300 then
    raise exception 'Enter the inspection location' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Notes are too long (max 1000 characters)' using errcode = '22023';
  end if;

  select * into v_insp from public.profiles
   where id = p_inspector_id and role = 'inspector' and approved and online;
  if not found or v_insp.price is null or v_insp.price <= 0 then
    raise exception 'That inspector is not available right now' using errcode = 'P0002';
  end if;

  select count(*) into v_open from public.bookings
   where buyer_id = v_uid and payment_status = 'unpaid' and status = 'pending'
     and created_at > now() - interval '1 day';
  if v_open >= 5 then
    raise exception 'You have too many unpaid bookings. Pay or cancel one first.' using errcode = '54000';
  end if;

  -- Vehicle row is created if new, never modified if it exists (a client cannot rewrite vehicle data).
  insert into public.vehicles (vin, make, model, year)
  values (v_vin, btrim(p_make), btrim(p_model), p_year)
  on conflict (vin) do nothing;

  insert into public.bookings (buyer_id, inspector_id, vin, location, notes, status,
                               inspection_fee, travel_fee, platform_fee, amount_due, paid, payment_status)
  values (v_uid, v_insp.id, v_vin, btrim(p_location), nullif(btrim(coalesce(p_notes, '')), ''), 'pending',
          v_insp.price, public.lc_travel_fee(), public.lc_platform_fee(),
          v_insp.price + public.lc_travel_fee() + public.lc_platform_fee(), false, 'unpaid')
  returning * into v_b;

  return v_b;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.accept_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_b   public.bookings%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'inspector' and approved) then
    raise exception 'Only approved inspectors can accept jobs' using errcode = '42501';
  end if;

  -- Single conditional UPDATE: of two concurrent accepts exactly one matches the WHERE clause.
  update public.bookings
     set status = 'accepted', accepted_at = now()
   where id = p_booking_id and inspector_id = v_uid and status = 'pending' and paid
  returning * into v_b;
  if not found then
    raise exception 'This inspection request is no longer available' using errcode = 'P0002';
  end if;

  insert into public.notifications (user_id, type, icon, title, body)
  values (v_b.buyer_id, 'track', '🚗', 'Inspector accepted your booking',
          'Your inspector has accepted the inspection for ' || v_b.vin || '.');
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.decline_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_b   public.bookings%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.bookings
     set status = 'cancelled', cancel_reason = 'declined_by_inspector',
         payment_status = case when payment_status in ('paid', 'legacy_unverified') then 'refund_due' else payment_status end
   where id = p_booking_id and inspector_id = v_uid and status = 'pending' and paid
  returning * into v_b;
  if not found then
    raise exception 'This inspection request is no longer available' using errcode = 'P0002';
  end if;

  insert into public.notifications (user_id, type, icon, title, body)
  values (v_b.buyer_id, 'sys', '⚠️', 'Inspector unavailable',
          'Your inspector could not take the job for ' || v_b.vin || '. A refund has been queued; please book another inspector.');
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.advance_booking(p_booking_id uuid, p_status public.booking_status)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_b   public.bookings%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_status not in ('en_route', 'in_progress') then
    raise exception 'Invalid status change' using errcode = '22023';
  end if;

  update public.bookings
     set status = p_status,
         en_route_at = case when p_status = 'en_route' then now() else en_route_at end,
         started_at  = case when p_status = 'in_progress' then now() else started_at end
   where id = p_booking_id and inspector_id = v_uid and paid
     and ((p_status = 'en_route'     and status = 'accepted')
       or (p_status = 'in_progress'  and status in ('accepted', 'en_route')))
  returning * into v_b;
  if not found then
    raise exception 'This job cannot move to that status' using errcode = 'P0002';
  end if;

  insert into public.notifications (user_id, type, icon, title, body)
  values (v_b.buyer_id, 'track', case when p_status = 'en_route' then '🚗' else '🔧' end,
          case when p_status = 'en_route' then 'Your inspector is on the way' else 'Inspection started' end,
          'Booking for ' || v_b.vin || ' is now ' || replace(p_status::text, '_', ' ') || '.');
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_b   public.bookings%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.bookings
     set status = 'cancelled', cancel_reason = 'cancelled_by_buyer',
         payment_status = case when payment_status in ('paid', 'legacy_unverified') then 'refund_due' else payment_status end
   where id = p_booking_id and buyer_id = v_uid and status = 'pending'
  returning * into v_b;
  if not found then
    raise exception 'Only a booking that has not been accepted yet can be cancelled' using errcode = 'P0002';
  end if;
  return v_b;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.set_online(p_online boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.profiles set online = coalesce(p_online, false)
   where id = v_uid and role = 'inspector' and approved;
  if not found then
    raise exception 'Your inspector account is awaiting approval' using errcode = '42501';
  end if;
  return coalesce(p_online, false);
end $$;

-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'create_booking(text,text,text,integer,text,text,uuid)',
    'accept_booking(uuid)', 'decline_booking(uuid)',
    'advance_booking(uuid,public.booking_status)', 'cancel_booking(uuid)', 'set_online(boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
