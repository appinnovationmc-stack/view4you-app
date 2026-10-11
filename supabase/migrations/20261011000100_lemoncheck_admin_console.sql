-- LemonCheck 20261011000100 — admin console backend (forward-only).
--
-- * admin_users        who may use the console. NO client access of any kind: rows are added only with the
--                      service role / SQL editor (see docs/ADMIN_CONSOLE.md). Roles: 'admin' (read + write),
--                      'support' (read only).
-- * admin_audit_log    append-only record of every admin write. No client access; read through admin_list_audit().
-- * admin_* functions  SECURITY DEFINER, callable by `authenticated` but each one checks admin_users itself and
--                      raises 42501 otherwise. The console never touches tables directly.
--
-- Nothing here deletes data. It does not change any existing table.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'support' check (role in ('admin', 'support')),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;     -- no policies: invisible to clients
revoke all on public.admin_users from anon, authenticated;

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid not null,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;  -- no policies: invisible to clients
revoke all on public.admin_audit_log from anon, authenticated;
create index if not exists admin_audit_log_created on public.admin_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.lc_admin_role() returns text
language sql stable security definer set search_path = '' as $$
  select a.role from public.admin_users a where a.user_id = auth.uid()
$$;

-- p_write = true requires the full 'admin' role; false allows 'support' too.
create or replace function public.lc_require_admin(p_write boolean) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.lc_admin_role();
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_role is null then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_write and v_role <> 'admin' then raise exception 'This action needs the admin role' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create or replace function public.lc_audit(p_action text, p_type text, p_id text, p_detail jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), p_action, p_type, p_id, coalesce(p_detail, '{}'::jsonb))
$$;

-- Role of the caller, or null. Never raises, so the console can decide whether to show itself.
create or replace function public.admin_whoami() returns text
language sql stable security definer set search_path = '' as $$
  select public.lc_admin_role()
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return jsonb_build_object(
    'inspectors_pending_approval', (select count(*) from public.profiles where role = 'inspector' and not approved),
    'inspectors_approved',         (select count(*) from public.profiles where role = 'inspector' and approved),
    'inspectors_online',           (select count(*) from public.profiles where role = 'inspector' and approved and online),
    'buyers',                      (select count(*) from public.profiles where role = 'buyer'),
    'bookings_by_status',          coalesce((select jsonb_object_agg(status, n) from
                                     (select status::text, count(*) n from public.bookings group by status) s), '{}'::jsonb),
    'bookings_awaiting_payment',   (select count(*) from public.bookings where status = 'pending' and payment_status = 'unpaid'),
    'refunds_due',                 (select count(*) from public.bookings where payment_status = 'refund_due'),
    'refunds_due_amount',          coalesce((select sum(amount_due) from public.bookings where payment_status = 'refund_due'), 0),
    'paid_bookings_amount',        coalesce((select sum(amount_due) from public.bookings where payment_status = 'paid'), 0),
    'reports',                     (select count(*) from public.inspections),
    'payment_problems_7d',         (select count(*) from public.payment_events
                                     where outcome not in ('applied', 'duplicate', 'refunded_by_operator', 'ignored_failed',
                                                           'ignored_cancelled', 'ignored_pending')
                                       and created_at > now() - interval '7 days')
  );
end $$;

create or replace function public.admin_list_inspectors(p_status text default 'all')
returns table (id uuid, name text, email text, phone text, cert text, licence text, region text, approved boolean,
               online boolean, jobs_completed integer, rating numeric, price integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'pending', 'approved') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select p.id, p.name, p.email, p.phone, p.cert, p.licence, p.region, p.approved, p.online,
           p.jobs_completed, p.rating, p.price, p.created_at
      from public.profiles p
     where p.role = 'inspector'
       and (p_status = 'all' or (p_status = 'pending' and not p.approved) or (p_status = 'approved' and p.approved))
     order by p.approved, p.created_at desc
     limit 500;
end $$;

create or replace function public.admin_list_bookings(p_status text default null, p_payment text default null,
                                                       p_search text default null, p_limit integer default 100)
returns table (id uuid, vin text, status text, payment_status text, amount_due integer, location text,
               buyer_name text, buyer_email text, inspector_name text, created_at timestamptz,
               accepted_at timestamptz, completed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public.lc_require_admin(false);
  return query
    select b.id, b.vin, b.status::text, b.payment_status, b.amount_due, b.location,
           bu.name, bu.email, ins.name, b.created_at, b.accepted_at, b.completed_at
      from public.bookings b
      left join public.profiles bu  on bu.id  = b.buyer_id
      left join public.profiles ins on ins.id = b.inspector_id
     where (p_status  is null or b.status::text = p_status)
       and (p_payment is null or b.payment_status = p_payment)
       and (v_search is null
            or position(v_search in lower(b.vin)) > 0
            or position(v_search in lower(coalesce(bu.email, ''))) > 0
            or position(v_search in lower(coalesce(ins.name, ''))) > 0)
     order by b.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- Raw ITN payloads are deliberately NOT returned (they can hold personal data); use the SQL editor for those.
create or replace function public.admin_list_payment_events(p_only_problems boolean default true, p_limit integer default 100)
returns table (id bigint, kind text, order_id uuid, pf_payment_id text, payment_status text,
               amount_gross numeric, outcome text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query
    select e.id, e.kind, e.order_id, e.pf_payment_id, e.payment_status, e.amount_gross, e.outcome, e.created_at
      from public.payment_events e
     where not p_only_problems
        or e.outcome not in ('applied', 'duplicate', 'refunded_by_operator', 'ignored_failed',
                             'ignored_cancelled', 'ignored_pending')
     order by e.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

create or replace function public.admin_list_audit(p_limit integer default 100)
returns table (id bigint, admin_email text, action text, target_type text, target_id text, detail jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query
    select l.id, u.email::text, l.action, l.target_type, l.target_id, l.detail, l.created_at
      from public.admin_audit_log l
      left join auth.users u on u.id = l.admin_id
     order by l.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- ---------------------------------------------------------------------------
-- Writes (admin role only; every one is audited)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_inspector_approval(p_inspector_id uuid, p_approved boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_approved is null then raise exception 'approved is required' using errcode = '22023'; end if;
  if not p_approved and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when suspending an inspector' using errcode = '22023';
  end if;
  update public.profiles
     set approved = p_approved,
         online   = case when p_approved then online else false end   -- a suspended inspector goes offline at once
   where id = p_inspector_id and role = 'inspector';
  if not found then raise exception 'No such inspector' using errcode = 'P0002'; end if;
  perform public.lc_audit(case when p_approved then 'inspector_approved' else 'inspector_suspended' end,
                          'profile', p_inspector_id::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_mark_refunded(p_booking_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reference, '')), '') is null then
    raise exception 'The PayFast refund reference is required' using errcode = '22023';
  end if;
  update public.bookings set payment_status = 'refunded'
   where id = p_booking_id and payment_status = 'refund_due';
  if not found then raise exception 'Booking is not awaiting a refund' using errcode = 'P0002'; end if;
  insert into public.payment_events (kind, order_id, outcome, raw)
  values ('booking', p_booking_id, 'refunded_by_operator', jsonb_build_object('reference', p_reference, 'by', auth.uid()));
  perform public.lc_audit('booking_refund_recorded', 'booking', p_booking_id::text, jsonb_build_object('reference', p_reference));
end $$;

-- Cancels a stuck booking that is not finished. A paid booking is queued for refund, never silently dropped.
create or replace function public.admin_cancel_booking(p_booking_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'No such booking' using errcode = 'P0002'; end if;
  if v_b.status in ('done', 'cancelled') then
    raise exception 'A % booking cannot be cancelled', v_b.status using errcode = '55000';
  end if;
  update public.bookings
     set status = 'cancelled',
         payment_status = case when payment_status in ('paid', 'legacy_unverified') then 'refund_due' else payment_status end
   where id = p_booking_id;
  insert into public.notifications (user_id, type, icon, title, body)
  values (v_b.buyer_id, 'sys', 'ℹ️', 'Your booking was cancelled',
          'Support cancelled your booking for ' || v_b.vin || '.'
          || case when v_b.payment_status in ('paid', 'legacy_unverified') then ' A refund has been queued.' else '' end);
  perform public.lc_audit('booking_cancelled', 'booking', p_booking_id::text,
                          jsonb_build_object('reason', p_reason, 'was_status', v_b.status, 'was_payment', v_b.payment_status));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: callable by signed-in users (each function enforces admin_users itself), never by anon.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'admin_whoami()', 'admin_overview()', 'admin_list_inspectors(text)',
    'admin_list_bookings(text,text,text,integer)', 'admin_list_payment_events(boolean,integer)',
    'admin_list_audit(integer)', 'admin_set_inspector_approval(uuid,boolean,text)',
    'admin_mark_refunded(uuid,text)', 'admin_cancel_booking(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- helpers are internal only
  foreach f in array array['lc_admin_role()', 'lc_require_admin(boolean)', 'lc_audit(text,text,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
