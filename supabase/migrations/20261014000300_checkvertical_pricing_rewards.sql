-- CheckVertical pricing and resale rewards, forward-only; tier launch remains disabled by default.
-- Existing bookings, inspections, purchases and ledger rows are never rewritten or deleted.

create table if not exists public.inspection_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 40),
  buyer_price integer not null check (buyer_price between 1 and 100000),
  resale_price integer not null check (resale_price between 1 and 100000),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.inspection_tiers enable row level security;
revoke all on public.inspection_tiers from public, anon, authenticated;
insert into public.inspection_tiers(name,buyer_price,resale_price,sort,active) values
 ('Basic',790,149,1,true),('Standard',1250,249,2,true),('Comprehensive',1650,329,3,true)
on conflict(name) do update set buyer_price=excluded.buyer_price,resale_price=excluded.resale_price,sort=excluded.sort;

alter table public.lc_settings
  add column if not exists take_rate_bp integer not null default 2000 check (take_rate_bp between 0 and 10000),
  add column if not exists payer_cap_bp integer not null default 10000 check (payer_cap_bp between 0 and 10000),
  add column if not exists hold_days integer not null default 7 check (hold_days between 0 and 90),
  add column if not exists reward_expiry_months integer not null default 24 check (reward_expiry_months between 1 and 120),
  add column if not exists payment_fee_bp integer not null default 350 check (payment_fee_bp between 0 and 2000),
  add column if not exists founding_limit integer not null default 200 check (founding_limit between 0 and 100000),
  add column if not exists founding_share_bp integer not null default 7000 check (founding_share_bp between 0 and 10000),
  add column if not exists founding_resales integer not null default 3 check (founding_resales between 0 and 100),
  add column if not exists tiers_enabled boolean not null default false;

update public.lc_settings
   set payer_share_bp=6000, platform_share_bp=4000, min_payout=200,
       take_rate_bp=2000, payer_cap_bp=10000, hold_days=7, reward_expiry_months=24,
       payment_fee_bp=350, founding_limit=200, founding_share_bp=7000, founding_resales=3,
       tiers_enabled=false
 where id=1;

alter table public.bookings
  add column if not exists tier_id uuid references public.inspection_tiers(id),
  add column if not exists inspector_payout integer check (inspector_payout is null or inspector_payout >= 0),
  add column if not exists platform_gross integer check (platform_gross is null or platform_gross >= 0),
  add column if not exists founding boolean not null default false;

create index if not exists bookings_tier_id on public.bookings(tier_id) where tier_id is not null;

create table if not exists public.resale_rewards (
  purchase_id uuid primary key references public.report_purchases(id),
  inspection_id uuid not null references public.inspections(id),
  first_buyer_id uuid references public.profiles(id),
  payer_amount integer not null default 0 check (payer_amount >= 0),
  platform_amount integer not null default 0 check (platform_amount >= 0),
  release_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check (payer_amount + platform_amount >= 0)
);
alter table public.resale_rewards enable row level security;
revoke all on public.resale_rewards from public, anon, authenticated;
create index if not exists resale_rewards_release_due on public.resale_rewards(release_at) where released_at is null;
create index if not exists resale_rewards_inspection on public.resale_rewards(inspection_id);

create or replace function public.list_active_inspection_tiers()
returns table(id uuid,name text,buyer_price integer,resale_price integer,sort integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='buyer') then
    raise exception 'Buyer sign-in required' using errcode='42501';
  end if;
  if not exists(select 1 from public.lc_settings s where s.id=1 and s.tiers_enabled) then return; end if;
  return query select t.id,t.name,t.buyer_price,t.resale_price,t.sort
    from public.inspection_tiers t where t.active order by t.sort,t.buyer_price;
end $;
revoke all on function public.list_active_inspection_tiers() from public, anon;
grant execute on function public.list_active_inspection_tiers() to authenticated, service_role;

create or replace function public.admin_list_tiers()
returns setof public.inspection_tiers
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query select * from public.inspection_tiers order by sort, buyer_price;
end $$;
revoke all on function public.admin_list_tiers() from public, anon;
grant execute on function public.admin_list_tiers() to authenticated, service_role;

create or replace function public.admin_update_tier(
  p_id uuid, p_name text, p_buyer_price integer, p_resale_price integer,
  p_sort integer, p_active boolean, p_reason text
) returns public.inspection_tiers
language plpgsql security definer set search_path = '' as $$
declare v_t public.inspection_tiers%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A reason is required' using errcode='22023'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 40
     or p_buyer_price is null or p_buyer_price not between 1 and 100000
     or p_resale_price is null or p_resale_price not between 1 and 100000
     or p_sort is null or p_sort not between 0 and 1000 or p_active is null then
    raise exception 'Invalid tier values' using errcode='22023';
  end if;
  if p_id is null then
    insert into public.inspection_tiers(name,buyer_price,resale_price,sort,active)
    values (btrim(p_name),p_buyer_price,p_resale_price,p_sort,p_active) returning * into v_t;
  else
    update public.inspection_tiers set name=btrim(p_name),buyer_price=p_buyer_price,resale_price=p_resale_price,
      sort=p_sort,active=p_active,updated_at=now() where id=p_id returning * into v_t;
    if not found then raise exception 'Tier not found' using errcode='P0002'; end if;
  end if;
  perform public.lc_audit('tier_updated','inspection_tier',v_t.id::text,
    jsonb_build_object('reason',p_reason,'name',v_t.name,'buyer_price',v_t.buyer_price,
      'resale_price',v_t.resale_price,'sort',v_t.sort,'active',v_t.active));
  return v_t;
end $$;
revoke all on function public.admin_update_tier(uuid,text,integer,integer,integer,boolean,text) from public, anon;
grant execute on function public.admin_update_tier(uuid,text,integer,integer,integer,boolean,text) to authenticated, service_role;

-- Extended settings signature. The legacy 8-argument signature remains callable for existing clients.
create or replace function public.admin_update_settings(
  p_travel_fee integer, p_platform_fee integer, p_resale_price_bp integer, p_payer_share_bp integer,
  p_platform_share_bp integer, p_min_payout integer, p_require_documents boolean, p_reason text,
  p_take_rate_bp integer, p_payer_cap_bp integer, p_hold_days integer, p_reward_expiry_months integer,
  p_payment_fee_bp integer, p_founding_limit integer, p_founding_share_bp integer,
  p_founding_resales integer, p_tiers_enabled boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_take_rate_bp not between 0 and 10000 or p_payer_cap_bp not between 0 and 10000
     or p_hold_days not between 0 and 90 or p_reward_expiry_months not between 1 and 120
     or p_payment_fee_bp not between 0 and 2000 or p_founding_limit not between 0 and 100000
     or p_founding_share_bp not between 0 and 10000 or p_founding_resales not between 0 and 100
     or p_tiers_enabled is null then
    raise exception 'Invalid pricing and rewards settings' using errcode='22023';
  end if;
  perform public.admin_update_settings(p_travel_fee,p_platform_fee,p_resale_price_bp,p_payer_share_bp,
    p_platform_share_bp,p_min_payout,p_require_documents,p_reason);
  update public.lc_settings set take_rate_bp=p_take_rate_bp,payer_cap_bp=p_payer_cap_bp,hold_days=p_hold_days,
    reward_expiry_months=p_reward_expiry_months,payment_fee_bp=p_payment_fee_bp,founding_limit=p_founding_limit,
    founding_share_bp=p_founding_share_bp,founding_resales=p_founding_resales,tiers_enabled=p_tiers_enabled,
    updated_at=now() where id=1;
  perform public.lc_audit('pricing_rewards_settings_updated','settings','1',
    jsonb_build_object('reason',p_reason,'take_rate_bp',p_take_rate_bp,'payer_cap_bp',p_payer_cap_bp,
      'hold_days',p_hold_days,'reward_expiry_months',p_reward_expiry_months,'payment_fee_bp',p_payment_fee_bp,
      'founding_limit',p_founding_limit,'founding_share_bp',p_founding_share_bp,
      'founding_resales',p_founding_resales,'tiers_enabled',p_tiers_enabled));
end $$;
revoke all on function public.admin_update_settings(integer,integer,integer,integer,integer,integer,boolean,text,integer,integer,integer,integer,integer,integer,integer,integer,boolean) from public, anon;
grant execute on function public.admin_update_settings(integer,integer,integer,integer,integer,integer,boolean,text,integer,integer,integer,integer,integer,integer,integer,integer,boolean) to authenticated, service_role;

-- Reject legacy price-based RPC calls only while tier mode is enabled; old 7-argument calls work while disabled.
create or replace function public.cv_guard_tiered_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select coalesce(tiers_enabled,false) from public.lc_settings where id=1) and new.tier_id is null then
    raise exception 'Choose an inspection tier before booking' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.cv_guard_tiered_booking() from public, anon;
drop trigger if exists cv_guard_tiered_booking on public.bookings;
create trigger cv_guard_tiered_booking before insert on public.bookings
for each row execute function public.cv_guard_tiered_booking();

-- Tier-aware overload. Existing create_booking callers continue to use the prior 13-argument function.
create or replace function public.create_booking(
  p_vin text, p_make text, p_model text, p_year integer,
  p_location text, p_notes text, p_inspector_id uuid,
  p_venue_kind text, p_venue_name text, p_auction_at timestamptz,
  p_lot_number text, p_needed_by timestamptz, p_station_id uuid, p_tier_id uuid
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role;
  v_vin     text := upper(btrim(coalesce(p_vin, '')));
  v_insp    public.profiles%rowtype;
  v_open    integer;
  v_kind    text := coalesce(nullif(btrim(coalesce(p_venue_kind, '')), ''), 'private');
  v_venue   text := nullif(btrim(coalesce(p_venue_name, '')), '');
  v_lot     text := nullif(btrim(coalesce(p_lot_number, '')), '');
  v_needed  timestamptz := p_needed_by;
  v_station public.testing_stations%rowtype;
  v_addon   integer := 0;
  v_tier_mode boolean := false;
  v_tier public.inspection_tiers%rowtype;
  v_take_rate integer := 2000;
  v_platform_gross integer := 0;
  v_inspector_payout integer := 0;
  v_b       public.bookings%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'buyer' then
    raise exception 'Only buyers can book inspections' using errcode = '42501';
  end if;

  select coalesce(s.tiers_enabled, false), coalesce(s.take_rate_bp, 2000)
    into v_tier_mode, v_take_rate
    from public.lc_settings s where s.id = 1;
  if v_tier_mode then
    select * into v_tier from public.inspection_tiers where id = p_tier_id and active;
    if not found then raise exception 'Choose an active inspection tier' using errcode = '22023'; end if;
    v_platform_gross := round(v_tier.buyer_price * v_take_rate / 10000.0)::integer;
    v_inspector_payout := v_tier.buyer_price - v_platform_gross;
  elsif p_tier_id is not null then
    raise exception 'Tiers are not enabled' using errcode = '22023';
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

  if v_kind not in ('private', 'dealership', 'auction') then
    raise exception 'Unknown venue type' using errcode = '22023';
  end if;
  if v_kind <> 'private' and (v_venue is null or length(v_venue) not between 2 and 120) then
    raise exception 'Enter the dealership or auction house name' using errcode = '22023';
  end if;
  if v_kind = 'private' then v_venue := null; v_lot := null; end if;
  if v_lot is not null and length(v_lot) > 40 then
    raise exception 'Lot number is too long' using errcode = '22023';
  end if;
  if v_kind = 'auction' then
    if p_auction_at is null or p_auction_at <= now() + interval '1 hour' then
      raise exception 'Enter an auction start time that is still in the future' using errcode = '22023';
    end if;
    v_needed := coalesce(v_needed, p_auction_at);
    if v_needed > p_auction_at then
      raise exception 'The report must be needed by the time the auction starts' using errcode = '22023';
    end if;
  elsif v_needed is not null and v_needed <= now() then
    raise exception 'The deadline must be in the future' using errcode = '22023';
  end if;
  if v_needed is not null and v_needed <= now() then
    raise exception 'The deadline must be in the future' using errcode = '22023';
  end if;

  if p_station_id is not null then
    select * into v_station from public.testing_stations where id = p_station_id and active;
    if not found then raise exception 'That testing station is not available' using errcode = 'P0002'; end if;
    v_addon := public.lc_roadworthy_fee();
  end if;

  select * into v_insp from public.profiles
   where id = p_inspector_id and role = 'inspector' and approved and online;
  if not found or (not v_tier_mode and (v_insp.price is null or v_insp.price <= 0)) then
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
                               inspection_fee, travel_fee, platform_fee, addon_fee, amount_due, paid, payment_status,
                               venue_kind, venue_name, auction_at, lot_number, needed_by,
                               roadworthy_requested, station_id, station_fee_quote,
                               tier_id, inspector_payout, platform_gross, founding)
  values (v_uid, v_insp.id, v_vin, btrim(p_location), nullif(btrim(coalesce(p_notes, '')), ''), 'pending',
          case when v_tier_mode then v_tier.buyer_price else v_insp.price end,
          case when v_tier_mode then 0 else public.lc_travel_fee() end,
          case when v_tier_mode then 0 else public.lc_platform_fee() end, v_addon,
          case when v_tier_mode then v_tier.buyer_price + v_addon
               else v_insp.price + public.lc_travel_fee() + public.lc_platform_fee() + v_addon end,
          false, 'unpaid',
          v_kind, v_venue, case when v_kind = 'auction' then p_auction_at end, v_lot, v_needed,
          p_station_id is not null, p_station_id, case when p_station_id is not null then v_station.test_fee end,
          case when v_tier_mode then v_tier.id else null end,
          case when v_tier_mode then v_inspector_payout else null end,
          case when v_tier_mode then v_platform_gross else null end, false)
  returning * into v_b;

  return v_b;
end $$;
revoke all on function public.create_booking(text,text,text,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,uuid,uuid) from public, anon;
grant execute on function public.create_booking(text,text,text,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,uuid,uuid) to authenticated, service_role;

-- Assign founding status atomically to the first N tiered paid bookings after launch.
create or replace function public.cv_mark_founding_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  if new.paid and not old.paid and new.tier_id is not null then
    perform pg_advisory_xact_lock(hashtext('checkvertical-founding-bookings'));
    select founding_limit into v_limit from public.lc_settings where id=1;
    select count(*) into v_count from public.bookings where founding and tier_id is not null;
    new.founding := coalesce(v_count,0) < coalesce(v_limit,200);
  end if;
  return new;
end $$;
revoke all on function public.cv_mark_founding_booking() from public, anon;
drop trigger if exists cv_mark_founding_booking on public.bookings;
create trigger cv_mark_founding_booking before update of paid on public.bookings
for each row execute function public.cv_mark_founding_booking();

-- Tier bookings use the fixed inspector payout; legacy inspection rows keep their existing stored split.
create or replace function public.lc_credit_job_fee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_credit integer;
begin
  select b.inspector_payout into v_credit from public.bookings b where b.id=new.booking_id;
  v_credit := coalesce(v_credit,new.full_price,0);
  if v_credit > 0 then
    insert into public.ledger_entries (user_id,kind,amount,note,ref_type,ref_id)
    values (new.inspector_id,'job_fee',v_credit,'Inspection '||coalesce(new.report_number,new.vin),'inspection',new.id)
    on conflict (kind,ref_type,ref_id,user_id) where kind in ('job_fee','resale_inspector','resale_payer') do nothing;
  end if;
  return new;
end $$;

-- Store tier resale price and zero inspector resale cut on reports created from tier bookings.
create or replace function public.cv_set_tier_report_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tier_id uuid; v_resale integer; v_payer_bp integer;
begin
  select b.tier_id into v_tier_id from public.bookings b where b.id=new.booking_id;
  if v_tier_id is not null then
    select t.resale_price into v_resale from public.inspection_tiers t where t.id=v_tier_id;
    select payer_share_bp into v_payer_bp from public.lc_settings where id=1;
    new.report_price := v_resale;
    new.payer_cut := round(v_resale * v_payer_bp / 10000.0)::integer;
    new.inspector_cut := 0;
  end if;
  return new;
end $$;
revoke all on function public.cv_set_tier_report_price() from public, anon;
drop trigger if exists cv_set_tier_report_price on public.inspections;
create trigger cv_set_tier_report_price before insert on public.inspections
for each row execute function public.cv_set_tier_report_price();

-- Each resale reserves the first buyer's capped share; nothing is credited until release_at.
create or replace function public.lc_credit_resale() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tracker uuid; v_booking public.bookings%rowtype; v_inspection public.inspections%rowtype;
  v_price integer; v_share_bp integer; v_cap integer; v_earned integer; v_payer integer; v_platform integer;
  v_expiry integer; v_hold integer; v_founding_count integer; v_found_share integer; v_found_count integer;
begin
  select i.* into v_inspection from public.inspections i where i.id=new.inspection_id;
  select b.* into v_booking from public.bookings b where b.id=v_inspection.booking_id;
  select first_tracked_by into v_tracker from public.vehicles where vin=v_inspection.vin;
  if v_tracker is null or v_tracker=new.buyer_id then return new; end if;

  select payer_share_bp,payer_cap_bp,hold_days,reward_expiry_months,founding_share_bp,founding_resales
    into v_share_bp,v_cap,v_hold,v_expiry,v_found_share,v_found_count
    from public.lc_settings where id=1;
  v_price := greatest(coalesce(new.amount_paid,0),0);
  if v_price <= 0 then return new; end if;

  if v_booking.founding then
    select count(*) into v_founding_count from public.resale_rewards rr
      join public.bookings b on b.id=v_inspection.booking_id
      where rr.inspection_id=new.inspection_id;
    if v_founding_count < coalesce(v_found_count,3) then v_share_bp := coalesce(v_found_share,7000); end if;
  end if;

  select coalesce(sum(rr.payer_amount),0) into v_earned
    from public.resale_rewards rr where rr.inspection_id=new.inspection_id and rr.first_buyer_id=v_tracker;
  v_cap := floor(coalesce(v_booking.amount_due,v_booking.inspection_fee,0) * coalesce(v_cap,10000) / 10000.0)::integer;
  if new.purchased_at > coalesce(v_inspection.submitted_at,v_inspection.created_at) + make_interval(months=>coalesce(v_expiry,24)) then
    v_payer := 0;
  else
    v_payer := least(round(v_price * coalesce(v_share_bp,6000) / 10000.0)::integer,greatest(v_cap-v_earned,0));
  end if;
  v_platform := greatest(v_price-v_payer,0);
  insert into public.resale_rewards(purchase_id,inspection_id,first_buyer_id,payer_amount,platform_amount,release_at)
  values (new.id,new.inspection_id,v_tracker,v_payer,v_platform,new.purchased_at + make_interval(days=>coalesce(v_hold,7)))
  on conflict (purchase_id) do nothing;
  return new;
end $$;
revoke all on function public.lc_credit_resale() from public, anon;
drop trigger if exists trg_credit_resale on public.report_purchases;
create trigger trg_credit_resale after insert on public.report_purchases
for each row execute function public.lc_credit_resale();

create or replace function public.lc_release_resale_rewards()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_count integer := 0;
begin
  -- EXECUTE is granted only to service_role; this function is intended for the scheduled worker.
  for r in
    select rr.*, i.report_number, i.vin
      from public.resale_rewards rr join public.inspections i on i.id=rr.inspection_id
     where rr.released_at is null and rr.release_at <= now() and rr.payer_amount > 0
     order by rr.release_at for update of rr skip locked
  loop
    insert into public.ledger_entries(user_id,kind,amount,note,ref_type,ref_id)
    values (r.first_buyer_id,'resale_payer',r.payer_amount,'Earn-back reward for '||coalesce(r.report_number,r.vin),'purchase',r.purchase_id)
    on conflict (kind,ref_type,ref_id,user_id) where kind in ('job_fee','resale_inspector','resale_payer') do nothing;
    if found then
      insert into public.notifications(user_id,type,icon,title,body,read)
      values (r.first_buyer_id,'reward','wallet','Your CheckVertical reward is ready',
        'R'||r.payer_amount||' is now available toward your inspection cost.',false);
      v_count := v_count + 1;
    end if;
    update public.resale_rewards set released_at=now() where purchase_id=r.purchase_id and released_at is null;
  end loop;
  -- Mark zero-payer rewards released too, so they do not remain pending forever.
  update public.resale_rewards set released_at=now()
   where released_at is null and release_at<=now() and payer_amount=0;
  return v_count;
end $$;
revoke all on function public.lc_release_resale_rewards() from public, anon, authenticated;
grant execute on function public.lc_release_resale_rewards() to service_role;

-- Run by pg_cron when the extension exists. Edge-function scheduling can call the same service-only RPC otherwise.
do $
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    execute 'select cron.schedule(''checkvertical-release-resale-rewards'', ''*/15 * * * *'', ''select public.lc_release_resale_rewards();'')';
  end if;
exception when undefined_table or undefined_function or insufficient_privilege or duplicate_object then
  raise notice 'pg_cron unavailable or job already scheduled; schedule lc_release_resale_rewards from a service-role Edge Function.';
end $;

create or replace function public.get_earn_back_progress(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_booking public.bookings%rowtype; v_earned integer; v_pending integer; v_cap integer;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and buyer_id=auth.uid();
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  v_cap := coalesce(v_booking.amount_due,0);
  select coalesce(sum(rr.payer_amount) filter(where rr.released_at is not null),0),
         coalesce(sum(rr.payer_amount) filter(where rr.released_at is null),0)
    into v_earned,v_pending
    from public.resale_rewards rr join public.inspections i on i.id=rr.inspection_id
   where i.booking_id=p_booking_id and rr.first_buyer_id=auth.uid();
  return jsonb_build_object('cap',v_cap,'earned',v_earned,'pending',v_pending,
    'percent',case when v_cap<=0 then 0 else least(100,round(v_earned*100.0/v_cap)) end);
end $;
revoke all on function public.get_earn_back_progress(uuid) from public, anon;
grant execute on function public.get_earn_back_progress(uuid) to authenticated, service_role;

-- Net platform revenue, calculated from stored gross values; no historic rows are re-priced.
create or replace view public.platform_revenue with (security_invoker=true) as
select
  coalesce((select sum(b.platform_gross) from public.bookings b where b.paid and b.tier_id is not null),0)
  + coalesce((select sum(rr.platform_amount) from public.resale_rewards rr),0)
  - coalesce((select sum(round(b.amount_due * s.payment_fee_bp / 10000.0)::integer)
                from public.bookings b cross join public.lc_settings s where b.paid and s.id=1),0)
  - coalesce((select sum(round(rp.amount_paid * s.payment_fee_bp / 10000.0)::integer)
                from public.report_purchases rp cross join public.lc_settings s where s.id=1),0)
  as net_platform_revenue;
revoke all on public.platform_revenue from public, anon, authenticated;
grant select on public.platform_revenue to service_role;
