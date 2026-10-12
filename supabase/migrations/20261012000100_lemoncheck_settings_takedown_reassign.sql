-- LemonCheck 20261012000100 — editable pricing, report takedown, booking reassignment (forward-only).
--
-- * lc_settings          one row of pricing/payout policy, editable only through admin_update_settings().
--                        lc_travel_fee()/lc_platform_fee()/lc_report_split() now read it, so booking creation and
--                        report submission pick up changes immediately. Existing bookings/reports keep the amounts
--                        that were stored on them; nothing is recalculated retroactively.
-- * inspections.taken_down_*  an operator can pull a report. It disappears for everyone except the operator,
--                        cannot be bought, and is restorable. The purchases already made are left untouched.
-- * admin_reassign_booking    move an unfinished booking to another approved inspector.
--
-- Nothing here deletes data.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table if not exists public.lc_settings (
  id                 smallint primary key default 1 check (id = 1),
  travel_fee         integer not null default 100 check (travel_fee between 0 and 5000),
  platform_fee       integer not null default 75  check (platform_fee between 0 and 5000),
  -- resale price of a report as basis points of the inspection fee (1800 = 18%)
  resale_price_bp    integer not null default 1800 check (resale_price_bp between 0 and 10000),
  -- shares of the resale price, basis points. payer + platform must not exceed 10000; the inspector gets the rest.
  payer_share_bp     integer not null default 5150 check (payer_share_bp between 0 and 10000),
  platform_share_bp  integer not null default 0    check (platform_share_bp between 0 and 10000),
  min_payout         integer not null default 100  check (min_payout between 0 and 100000),
  require_documents  boolean not null default false,
  updated_at         timestamptz not null default now(),
  constraint lc_settings_shares check (payer_share_bp + platform_share_bp <= 10000)
);
insert into public.lc_settings (id) values (1) on conflict (id) do nothing;
alter table public.lc_settings enable row level security;   -- no policies: invisible to clients
revoke all on public.lc_settings from anon, authenticated;

create or replace function public.lc_travel_fee() returns integer
language sql stable security definer set search_path = '' as $$
  select travel_fee from public.lc_settings where id = 1
$$;
create or replace function public.lc_platform_fee() returns integer
language sql stable security definer set search_path = '' as $$
  select platform_fee from public.lc_settings where id = 1
$$;

-- Same signature and result shape as before. The platform's cut is whatever is left of the resale price after
-- the payer and inspector cuts, so payer_cut + inspector_cut can be less than report_price when platform_share_bp > 0.
create or replace function public.lc_report_split(p_inspection_fee integer)
returns table (report_price integer, payer_cut integer, inspector_cut integer)
language sql stable security definer set search_path = '' as $$
  select s.rp, s.pc, s.rp - s.pc - s.plc
  from (select round(p_inspection_fee * c.resale_price_bp / 10000.0)::integer as rp,
               round(round(p_inspection_fee * c.resale_price_bp / 10000.0) * c.payer_share_bp / 10000.0)::integer as pc,
               round(round(p_inspection_fee * c.resale_price_bp / 10000.0) * c.platform_share_bp / 10000.0)::integer as plc
          from public.lc_settings c where c.id = 1) s
$$;

create or replace function public.admin_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return (select to_jsonb(s) - 'id' - 'updated_at' from public.lc_settings s where s.id = 1);
end $$;

create or replace function public.admin_update_settings(
  p_travel_fee integer, p_platform_fee integer, p_resale_price_bp integer, p_payer_share_bp integer,
  p_platform_share_bp integer, p_min_payout integer, p_require_documents boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_travel_fee is null or p_platform_fee is null or p_resale_price_bp is null or p_payer_share_bp is null
     or p_platform_share_bp is null or p_min_payout is null or p_require_documents is null then
    raise exception 'Every setting is required' using errcode = '22023';
  end if;
  if p_travel_fee not between 0 and 5000 or p_platform_fee not between 0 and 5000 then
    raise exception 'Fees must be between R0 and R5000' using errcode = '22023';
  end if;
  if p_resale_price_bp not between 0 and 10000 or p_payer_share_bp not between 0 and 10000
     or p_platform_share_bp not between 0 and 10000 then
    raise exception 'Percentages must be between 0 and 100' using errcode = '22023';
  end if;
  if p_payer_share_bp + p_platform_share_bp > 10000 then
    raise exception 'Payer and platform shares cannot add up to more than 100%%' using errcode = '22023';
  end if;
  if p_min_payout not between 0 and 100000 then
    raise exception 'Minimum payout must be between R0 and R100000' using errcode = '22023';
  end if;
  select to_jsonb(s) - 'id' - 'updated_at' into v_old from public.lc_settings s where s.id = 1 for update;
  update public.lc_settings
     set travel_fee = p_travel_fee, platform_fee = p_platform_fee, resale_price_bp = p_resale_price_bp,
         payer_share_bp = p_payer_share_bp, platform_share_bp = p_platform_share_bp, min_payout = p_min_payout,
         require_documents = p_require_documents, updated_at = now()
   where id = 1;
  perform public.lc_audit('settings_updated', 'settings', '1', jsonb_build_object(
    'reason', p_reason, 'before', v_old,
    'after', jsonb_build_object('travel_fee', p_travel_fee, 'platform_fee', p_platform_fee,
      'resale_price_bp', p_resale_price_bp, 'payer_share_bp', p_payer_share_bp,
      'platform_share_bp', p_platform_share_bp, 'min_payout', p_min_payout, 'require_documents', p_require_documents)));
end $$;

-- ---------------------------------------------------------------------------
-- Report takedown
-- ---------------------------------------------------------------------------
alter table public.inspections
  add column if not exists taken_down_at     timestamptz,
  add column if not exists taken_down_reason text,
  add column if not exists taken_down_by     uuid;

-- A taken-down report is unreadable through every policy that uses can_read_report().
create or replace function public.can_read_report(p_inspection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.inspections i
    left join public.bookings b on b.id = i.booking_id
    where i.id = p_inspection and i.taken_down_at is null and (
      i.inspector_id = (select auth.uid())
      or b.buyer_id = (select auth.uid())
      or exists (select 1 from public.report_purchases rp
                 where rp.inspection_id = i.id and rp.buyer_id = (select auth.uid()))
    )
  );
$$;

-- The paywall preview skips taken-down reports (the next-newest live report for the VIN is shown, if any).
create or replace function public.report_preview(p_vin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  i     public.inspections%rowtype;
  v_owned boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into i from public.inspections
   where vin = upper(btrim(p_vin)) and taken_down_at is null order by created_at desc limit 1;
  if not found then return null; end if;
  v_owned := public.can_read_report(i.id);
  return jsonb_build_object(
    'inspection_id', i.id,
    'report_number', i.report_number,
    'score', i.score,
    'report_price', i.report_price,
    'payer_cut', i.payer_cut,
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

-- A taken-down report cannot be ordered. (create_report_order_for() inserts into report_orders.)
create or replace function public.lc_block_order_for_taken_down() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.inspections where id = new.inspection_id and taken_down_at is not null) then
    raise exception 'This report is not available' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_order_for_taken_down on public.report_orders;
create trigger trg_block_order_for_taken_down before insert on public.report_orders
  for each row execute function public.lc_block_order_for_taken_down();

create or replace function public.admin_list_reports(p_status text default 'all', p_search text default null,
                                                     p_limit integer default 100)
returns table (id uuid, report_number text, vin text, score integer, report_price integer, inspector_name text,
               buyer_email text, purchases bigint, created_at timestamptz, taken_down_at timestamptz,
               taken_down_reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'live', 'taken_down') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select i.id, i.report_number, i.vin, i.score, i.report_price, ins.name, bu.email,
           (select count(*) from public.report_purchases rp where rp.inspection_id = i.id),
           i.created_at, i.taken_down_at, i.taken_down_reason
      from public.inspections i
      left join public.profiles ins on ins.id = i.inspector_id
      left join public.bookings b   on b.id = i.booking_id
      left join public.profiles bu  on bu.id = b.buyer_id
     where (p_status = 'all' or (p_status = 'live' and i.taken_down_at is null)
            or (p_status = 'taken_down' and i.taken_down_at is not null))
       and (v_search is null
            or position(v_search in lower(coalesce(i.report_number, ''))) > 0
            or position(v_search in lower(i.vin)) > 0
            or position(v_search in lower(coalesce(ins.name, ''))) > 0)
     order by i.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

create or replace function public.admin_takedown_report(p_inspection_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_i public.inspections%rowtype; v_buyer uuid;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into v_i from public.inspections where id = p_inspection_id for update;
  if not found then raise exception 'No such report' using errcode = 'P0002'; end if;
  if v_i.taken_down_at is not null then raise exception 'Report is already taken down' using errcode = '55000'; end if;
  update public.inspections
     set taken_down_at = now(), taken_down_reason = trim(p_reason), taken_down_by = auth.uid()
   where id = p_inspection_id;
  -- cancel orders that were started but not paid
  update public.report_orders set status = 'cancelled' where inspection_id = p_inspection_id and status = 'pending';
  select b.buyer_id into v_buyer from public.bookings b where b.id = v_i.booking_id;
  insert into public.notifications (user_id, type, icon, title, body)
  select u, 'sys', 'ℹ️', 'A report was taken down',
         'Report ' || coalesce(v_i.report_number, '') || ' for ' || v_i.vin || ' is under review and is not available right now.'
    from (select v_i.inspector_id as u union select v_buyer) x where u is not null;
  perform public.lc_audit('report_taken_down', 'report', p_inspection_id::text,
                          jsonb_build_object('reason', p_reason, 'report_number', v_i.report_number, 'vin', v_i.vin));
end $$;

create or replace function public.admin_restore_report(p_inspection_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_i public.inspections%rowtype;
begin
  perform public.lc_require_admin(true);
  select * into v_i from public.inspections where id = p_inspection_id for update;
  if not found then raise exception 'No such report' using errcode = 'P0002'; end if;
  if v_i.taken_down_at is null then raise exception 'Report is not taken down' using errcode = '55000'; end if;
  update public.inspections set taken_down_at = null, taken_down_reason = null, taken_down_by = null
   where id = p_inspection_id;
  perform public.lc_audit('report_restored', 'report', p_inspection_id::text,
                          jsonb_build_object('was_reason', v_i.taken_down_reason, 'report_number', v_i.report_number));
end $$;

-- ---------------------------------------------------------------------------
-- Reassign a booking
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_assignable_inspectors()
returns table (id uuid, name text, region text, online boolean, rating numeric, price integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query
    select p.id, p.name, p.region, p.online, p.rating, p.price
      from public.profiles p where p.role = 'inspector' and p.approved
     order by p.online desc, p.name limit 500;
end $$;

-- The new inspector must accept the job again: the booking goes back to 'pending'. The buyer's price is unchanged.
create or replace function public.admin_reassign_booking(p_booking_id uuid, p_inspector_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_b public.bookings%rowtype; v_new public.profiles%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'No such booking' using errcode = 'P0002'; end if;
  if v_b.status not in ('pending', 'accepted', 'en_route', 'in_progress') then
    raise exception 'A % booking cannot be reassigned', v_b.status using errcode = '55000';
  end if;
  if v_b.payment_status not in ('paid', 'legacy_unverified') then
    raise exception 'Only paid bookings can be reassigned' using errcode = '55000';
  end if;
  select * into v_new from public.profiles where id = p_inspector_id and role = 'inspector' and approved;
  if not found then raise exception 'That inspector is not approved' using errcode = '22023'; end if;
  if v_b.inspector_id is not distinct from p_inspector_id then
    raise exception 'That inspector already has this booking' using errcode = '22023';
  end if;
  update public.bookings set inspector_id = p_inspector_id, status = 'pending', accepted_at = null
   where id = p_booking_id;
  insert into public.notifications (user_id, type, icon, title, body) values
    (p_inspector_id, 'sys', '📋', 'New job assigned', 'Support assigned you an inspection for ' || v_b.vin || ' in ' || v_b.location || '. Please accept it.'),
    (v_b.buyer_id,  'sys', 'ℹ️', 'Your inspector changed', 'Your inspection for ' || v_b.vin || ' has a new inspector. They will confirm shortly.');
  if v_b.inspector_id is not null then
    insert into public.notifications (user_id, type, icon, title, body)
    values (v_b.inspector_id, 'sys', 'ℹ️', 'Job reassigned', 'The inspection for ' || v_b.vin || ' was reassigned by support.');
  end if;
  perform public.lc_audit('booking_reassigned', 'booking', p_booking_id::text,
    jsonb_build_object('reason', p_reason, 'from', v_b.inspector_id, 'to', p_inspector_id, 'was_status', v_b.status));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'admin_get_settings()', 'admin_update_settings(integer,integer,integer,integer,integer,integer,boolean,text)',
    'admin_list_reports(text,text,integer)', 'admin_takedown_report(uuid,text)', 'admin_restore_report(uuid)',
    'admin_list_assignable_inspectors()', 'admin_reassign_booking(uuid,uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- trigger function and fee helpers: internal only except the helpers the app already calls
  revoke all on function public.lc_block_order_for_taken_down() from public, anon, authenticated;
  revoke all on function public.lc_travel_fee() from public, anon;
  revoke all on function public.lc_platform_fee() from public, anon;
  revoke all on function public.lc_report_split(integer) from public, anon;
  grant execute on function public.lc_travel_fee() to authenticated, service_role;
  grant execute on function public.lc_platform_fee() to authenticated, service_role;
  grant execute on function public.lc_report_split(integer) to authenticated, service_role;
  revoke all on function public.report_preview(text) from public, anon;
  grant execute on function public.report_preview(text) to authenticated, service_role;
  revoke all on function public.can_read_report(uuid) from public, anon;
  grant execute on function public.can_read_report(uuid) to authenticated, service_role;
end $$;
