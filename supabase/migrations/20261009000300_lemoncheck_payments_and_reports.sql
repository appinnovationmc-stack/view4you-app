-- LemonCheck 20261009000300 — payment integrity, report submission, report preview (forward-only).
--
-- * payment_events        append-only audit trail of every PayFast ITN received (valid or not).
-- * apply_payfast_itn()   the ONLY code path that marks a booking or report order paid. Service role only.
--                         Checks order exists, amount equals the server-stored amount, never downgrades a paid
--                         order, is idempotent per (pf_payment_id, payment_status), flags double payments.
-- * prepare_booking_payment / create_report_order_for   service-role helpers for the payment-start Edge Functions
--                         (the Edge Function authenticates the user, the DB decides the amount).
-- * submit_detailed_report  rewritten as SECURITY DEFINER with explicit checks (assigned inspector, paid booking,
--                         valid state), server-side price split and idempotent re-submits.
-- * report_preview()      what a non-purchaser may see (score, price, area pass/warn/fail) — enforced server-side.
-- * admin_* functions     operator actions (approve inspector, mark refund done), service role only.

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id             bigint generated always as identity primary key,
  provider       text not null default 'payfast',
  kind           text not null,
  order_id       uuid,
  pf_payment_id  text,
  payment_status text,
  amount_gross   numeric(12, 2),
  outcome        text not null,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
alter table public.payment_events enable row level security;  -- no policies: invisible to clients
revoke all on public.payment_events from anon, authenticated;
create unique index if not exists payment_events_applied_once
  on public.payment_events (provider, pf_payment_id, payment_status)
  where outcome = 'applied' and pf_payment_id is not null;
create index if not exists payment_events_order on public.payment_events (order_id);

-- ---------------------------------------------------------------------------
-- Applying a verified PayFast notification
-- ---------------------------------------------------------------------------
create or replace function public.apply_payfast_itn(
  p_kind text, p_order_id uuid, p_pf_payment_id text, p_payment_status text,
  p_amount_gross numeric, p_raw jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  b public.bookings%rowtype;
  o public.report_orders%rowtype;
  i public.inspections%rowtype;
  v_status text := upper(coalesce(p_payment_status, ''));
  v_outcome text;
begin
  -- Recording helper (inline so every return path is audited).
  if p_kind not in ('booking', 'report') then
    insert into public.payment_events (kind, order_id, pf_payment_id, payment_status, amount_gross, outcome, raw)
    values ('unknown', p_order_id, p_pf_payment_id, v_status, p_amount_gross, 'rejected_kind', coalesce(p_raw, '{}'));
    return 'rejected_kind';
  end if;

  if p_kind = 'booking' then
    select * into b from public.bookings where id = p_order_id for update;
    if not found then
      insert into public.payment_events (kind, order_id, pf_payment_id, payment_status, amount_gross, outcome, raw)
      values (p_kind, p_order_id, p_pf_payment_id, v_status, p_amount_gross, 'unknown_order', coalesce(p_raw, '{}'));
      return 'unknown_order';
    end if;

    if p_pf_payment_id is not null and exists (
         select 1 from public.payment_events e
          where e.provider = 'payfast' and e.pf_payment_id = p_pf_payment_id
            and e.payment_status = v_status and e.outcome = 'applied') then
      v_outcome := 'duplicate';
    elsif b.amount_due is null or round(p_amount_gross, 2) <> round(b.amount_due::numeric, 2) then
      v_outcome := 'amount_mismatch';
    elsif v_status = 'COMPLETE' then
      if b.payment_status <> 'unpaid' then
        v_outcome := case when b.payment_reference is not distinct from p_pf_payment_id
                          then 'duplicate' else 'already_paid_other_reference' end;
      else
        update public.bookings
           set paid = true, paid_at = now(), payment_reference = p_pf_payment_id,
               payment_status = case when status = 'cancelled' then 'refund_due' else 'paid' end
         where id = b.id;
        if b.status <> 'cancelled' then
          -- The commissioning buyer earns resale cuts on this vehicle once their payment is confirmed.
          update public.vehicles set first_tracked_by = b.buyer_id
           where vin = b.vin and first_tracked_by is null;
          insert into public.notifications (user_id, type, icon, title, body)
          values (b.inspector_id, 'sys', '🔔', 'New inspection request',
                  'A paid inspection request for ' || b.vin || ' is waiting for you.'),
                 (b.buyer_id, 'sys', '✅', 'Payment received',
                  'Your payment for the ' || b.vin || ' inspection was confirmed.');
        end if;
        v_outcome := 'applied';
      end if;
    elsif v_status in ('FAILED', 'CANCELLED', 'PENDING') then
      v_outcome := 'ignored_' || lower(v_status);
    else
      v_outcome := 'ignored_unknown_status';
    end if;

  else  -- report
    select * into o from public.report_orders where id = p_order_id for update;
    if not found then
      insert into public.payment_events (kind, order_id, pf_payment_id, payment_status, amount_gross, outcome, raw)
      values (p_kind, p_order_id, p_pf_payment_id, v_status, p_amount_gross, 'unknown_order', coalesce(p_raw, '{}'));
      return 'unknown_order';
    end if;

    if p_pf_payment_id is not null and exists (
         select 1 from public.payment_events e
          where e.provider = 'payfast' and e.pf_payment_id = p_pf_payment_id
            and e.payment_status = v_status and e.outcome = 'applied') then
      v_outcome := 'duplicate';
    elsif round(p_amount_gross, 2) <> round(o.amount::numeric, 2) then
      v_outcome := 'amount_mismatch';
    elsif v_status = 'COMPLETE' then
      if o.status = 'paid' then
        v_outcome := case when o.provider_reference is not distinct from p_pf_payment_id
                          then 'duplicate' else 'already_paid_other_reference' end;
      else
        select * into i from public.inspections where id = o.inspection_id;
        update public.report_orders
           set status = 'paid', provider = 'payfast', provider_reference = p_pf_payment_id, paid_at = now()
         where id = o.id;
        -- Earnings are copied from the amounts the server stored when the report was submitted.
        insert into public.report_purchases (inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning)
        values (o.inspection_id, o.buyer_id, o.amount, i.payer_cut, i.inspector_cut)
        on conflict (inspection_id, buyer_id) do nothing;
        v_outcome := 'applied';
      end if;
    elsif v_status in ('FAILED', 'CANCELLED') then
      update public.report_orders
         set status = lower(v_status), provider = 'payfast', provider_reference = p_pf_payment_id
       where id = o.id and status = 'pending';
      v_outcome := 'ignored_' || lower(v_status);
    elsif v_status = 'PENDING' then
      v_outcome := 'ignored_pending';
    else
      v_outcome := 'ignored_unknown_status';
    end if;
  end if;

  insert into public.payment_events (kind, order_id, pf_payment_id, payment_status, amount_gross, outcome, raw)
  values (p_kind, p_order_id, p_pf_payment_id, v_status, p_amount_gross, v_outcome, coalesce(p_raw, '{}'));
  return v_outcome;
end $$;

-- ---------------------------------------------------------------------------
-- Payment-start helpers (service role only; the Edge Function passes the authenticated user's id)
-- ---------------------------------------------------------------------------
create or replace function public.prepare_booking_payment(p_user uuid, p_booking_id uuid)
returns table (booking_id uuid, amount_due integer, vin text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id and buyer_id = p_user;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if b.status <> 'pending' then
    raise exception 'This booking can no longer be paid (status %)', b.status using errcode = '55000';
  end if;
  if b.payment_status <> 'unpaid' then
    raise exception 'This booking is already paid' using errcode = '23505';
  end if;
  if b.amount_due is null or b.amount_due <= 0 then
    raise exception 'Booking has no payable amount' using errcode = '22023';
  end if;
  return query select b.id, b.amount_due, b.vin;
end $$;

drop function if exists public.create_report_order(uuid);
create or replace function public.create_report_order_for(p_user uuid, p_inspection_id uuid)
returns public.report_orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role;
  v_insp public.inspections%rowtype;
  v_buyer uuid;
  v_order public.report_orders%rowtype;
begin
  select role into v_role from public.profiles where id = p_user;
  if v_role is distinct from 'buyer' then
    raise exception 'Only buyers can purchase reports' using errcode = '42501';
  end if;
  select * into v_insp from public.inspections where id = p_inspection_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select buyer_id into v_buyer from public.bookings where id = v_insp.booking_id;
  if v_buyer = p_user then
    raise exception 'You already own this report' using errcode = '42501';
  end if;
  if exists (select 1 from public.report_purchases where inspection_id = p_inspection_id and buyer_id = p_user) then
    raise exception 'Report already purchased' using errcode = '23505';
  end if;
  if v_insp.report_price is null or v_insp.report_price <= 0 then
    raise exception 'This report is not for sale' using errcode = '55000';
  end if;
  insert into public.report_orders (inspection_id, buyer_id, amount)
  values (p_inspection_id, p_user, v_insp.report_price)
  on conflict (inspection_id, buyer_id) do update
    set amount = excluded.amount,
        status = case when public.report_orders.status = 'paid' then 'paid' else 'pending' end
  returning * into v_order;
  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- Report submission (replaces the SECURITY INVOKER version)
-- ---------------------------------------------------------------------------
create or replace function public.submit_detailed_report(
  p_booking_id uuid, p_score integer, p_verdict text, p_odometer_km integer, p_roadworthy text,
  p_faults jsonb, p_warnings jsonb, p_findings jsonb, p_items jsonb, p_measurements jsonb, p_tyres jsonb
) returns table (inspection_id uuid, report_number text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  b      public.bookings%rowtype;
  v_ex   public.inspections%rowtype;
  v_split record;
  v_id   uuid;
  v_num  text;
  v_try  integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.inspector_id is distinct from v_uid then
    raise exception 'Booking not found or not assigned to you' using errcode = '42501';
  end if;

  -- Idempotent re-submit by the same inspector (double tap, retry after a lost response).
  select * into v_ex from public.inspections i where i.booking_id = b.id;
  if found then
    return query select v_ex.id, v_ex.report_number;
    return;
  end if;

  if not b.paid then
    raise exception 'This booking has not been paid' using errcode = '55000';
  end if;
  if b.status not in ('accepted', 'en_route', 'in_progress') then
    raise exception 'This job is not open for a report (status %)', b.status using errcode = '55000';
  end if;

  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception 'Score must be between 0 and 100' using errcode = '22023';
  end if;
  if p_roadworthy is null or p_roadworthy not in ('pass', 'fail') then
    raise exception 'roadworthy must be pass or fail' using errcode = '22023';
  end if;
  if p_odometer_km is null or p_odometer_km < 0 or p_odometer_km > 2000000 then
    raise exception 'Odometer reading is required' using errcode = '22023';
  end if;
  if p_verdict is not null and length(p_verdict) > 4000 then
    raise exception 'Verdict is too long' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 400 then
    raise exception 'Checklist items are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings) = 0 or jsonb_array_length(p_findings) > 60 then
    raise exception 'Area findings are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_faults) is distinct from 'array' or jsonb_typeof(p_warnings) is distinct from 'array'
     or jsonb_typeof(p_measurements) is distinct from 'array' or jsonb_typeof(p_tyres) is distinct from 'array'
     or jsonb_array_length(p_measurements) > 30 or jsonb_array_length(p_tyres) > 10 then
    raise exception 'faults, warnings, measurements and tyres must be arrays within limits' using errcode = '22023';
  end if;

  select * into v_split from public.lc_report_split(b.inspection_fee);

  loop
    v_num := 'LC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD')
             || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.inspections i where i.report_number = v_num);
    v_try := v_try + 1;
    if v_try > 5 then raise exception 'Could not allocate a report number' using errcode = '55000'; end if;
  end loop;

  insert into public.inspections (
    booking_id, vin, inspector_id, score, verdict,
    full_price, report_price, payer_cut, inspector_cut,
    report_number, odometer_km, roadworthy_status, faults, warnings, submitted_at
  ) values (
    b.id, b.vin, v_uid, p_score, p_verdict,
    b.inspection_fee, v_split.report_price, v_split.payer_cut, v_split.inspector_cut,
    v_num, p_odometer_km, p_roadworthy, p_faults, p_warnings, now()
  ) returning id into v_id;

  insert into public.inspection_findings (inspection_id, area, status, note)
  select v_id, left(x->>'area', 80), x->>'status', left(nullif(x->>'note', ''), 2000)
    from jsonb_array_elements(p_findings) x;

  insert into public.report_items (inspection_id, section, component, condition, explanation, roadworthy_relevant)
  select v_id, left(x->>'section', 80), left(x->>'component', 120), x->>'condition',
         left(nullif(x->>'explanation', ''), 2000), coalesce((x->>'roadworthy_relevant')::boolean, false)
    from jsonb_array_elements(p_items) x;

  insert into public.report_measurements (inspection_id, test, position, right_value, left_value, diff_pct, result)
  select v_id, x->>'test', left(x->>'position', 60),
         (x->>'right_value')::numeric, (x->>'left_value')::numeric, (x->>'diff_pct')::numeric, left(x->>'result', 60)
    from jsonb_array_elements(p_measurements) x;

  insert into public.report_tyres (inspection_id, position, size, load_speed, make, model, tyre_type, tread_mm)
  select v_id, left(x->>'position', 60), left(nullif(x->>'size', ''), 40), left(nullif(x->>'load_speed', ''), 20),
         left(nullif(x->>'make', ''), 60), left(nullif(x->>'model', ''), 60), left(nullif(x->>'tyre_type', ''), 40),
         (x->>'tread_mm')::numeric
    from jsonb_array_elements(p_tyres) x;

  update public.bookings set status = 'done', completed_at = now() where id = b.id;
  update public.profiles set jobs_completed = coalesce(jobs_completed, 0) + 1 where id = v_uid;

  return query select v_id, v_num;
end $$;

-- ---------------------------------------------------------------------------
-- Report preview for non-purchasers (server-enforced paywall)
-- ---------------------------------------------------------------------------
create or replace function public.report_preview(p_vin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  i     public.inspections%rowtype;
  v_owned boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into i from public.inspections
   where vin = upper(btrim(p_vin)) order by created_at desc limit 1;
  if not found then return null; end if;
  v_owned := public.can_read_report(i.id);
  return jsonb_build_object(
    'inspection_id', i.id,
    'report_number', i.report_number,
    'score', i.score,
    'report_price', i.report_price,
    'inspected_at', coalesce(i.submitted_at, i.created_at),
    'roadworthy_status', i.roadworthy_status,
    'inspector_name', (select p.name from public.profiles p where p.id = i.inspector_id),
    'owned', v_owned,
    'verdict', case when v_owned then i.verdict else null end,
    'areas', coalesce((select jsonb_agg(jsonb_build_object('area', f.area, 'status', f.status,
                                                          'note', case when v_owned then f.note else null end)
                                        order by f.area)
                         from public.inspection_findings f where f.inspection_id = i.id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Operator actions (run from the Supabase SQL editor or an admin tool with the service role)
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_inspector(p_inspector_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set approved = true where id = p_inspector_id and role = 'inspector';
  if not found then raise exception 'No such inspector' using errcode = 'P0002'; end if;
end $$;

create or replace function public.admin_mark_booking_refunded(p_booking_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set payment_status = 'refunded'
   where id = p_booking_id and payment_status = 'refund_due';
  if not found then raise exception 'Booking is not awaiting a refund' using errcode = 'P0002'; end if;
  insert into public.payment_events (kind, order_id, outcome, raw)
  values ('booking', p_booking_id, 'refunded_by_operator', jsonb_build_object('reference', p_reference));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'apply_payfast_itn(text,uuid,text,text,numeric,jsonb)',
    'prepare_booking_payment(uuid,uuid)', 'create_report_order_for(uuid,uuid)',
    'admin_approve_inspector(uuid)', 'admin_mark_booking_refunded(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'submit_detailed_report(uuid,integer,text,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'report_preview(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
