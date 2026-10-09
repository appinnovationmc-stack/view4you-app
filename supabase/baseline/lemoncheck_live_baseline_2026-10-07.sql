-- ============================================================================
-- LemonCheck — SNAPSHOT of the live `public` schema as observed on 2026-10-07 (23:30 UTC),
-- project "view4you", AFTER its migration 20261007233040 (lemoncheck_drop_duplicate_purchase_index).
--
-- WHY THIS FILE EXISTS
--   The repository's SQL files (schema.sql, report_schema.sql, submit_report_rpc.sql,
--   lemoncheck_hardening.sql, migrations/) do not reproduce the live database: the live project
--   has migrations that were applied through the dashboard/MCP and never committed
--   (init_schema, reset_view4you_for_lemoncheck, lemoncheck_schema, lock_down_can_read_report,
--   submit_detailed_report_rpc, lemoncheck_close_direct_purchase_insert, lemoncheck_lock_order_rpc, ...).
--   This file captures the live state so that (a) a fresh environment can be bootstrapped
--   and (b) the forward-only migrations dated 20261009* can be tested against the real starting point.
--
-- HOW TO USE
--   * Tests:  supabase/tests/helpers/supabase_stub.sql  ->  this file  ->  migrations/20261009*.sql
--   * Fresh Supabase project: run this file, then every migration dated after 20261007233040.
--   * LIVE project: DO NOT run this file. Live already has this state. Apply only the new migrations.
--
-- It deliberately preserves the live weaknesses (open grants, unrestricted profile updates, etc.).
-- Those are what the 20261009* migrations fix, and the regression tests prove it.
-- ============================================================================

create type public.user_role as enum ('buyer', 'inspector');
create type public.booking_status as enum ('pending', 'accepted', 'en_route', 'in_progress', 'done', 'cancelled');

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            public.user_role not null,
  name            text not null,
  first_name      text not null,
  init            text not null,
  email           text not null,
  phone           text,
  cert            text,
  licence         text,
  experience      text,
  region          text,
  specialty       text,
  bio             text,
  rating          numeric(3,2) default 5.00,
  jobs_completed  integer default 0,
  price           integer,
  eta_minutes     integer,
  online          boolean default false,
  top_rated       boolean default false,
  created_at      timestamptz not null default now()
);

create table public.vehicles (
  vin              text primary key,
  make             text not null,
  model            text not null,
  year             integer not null,
  colour           text,
  mileage          integer,
  engine           text,
  transmission     text,
  first_tracked_by uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);

create table public.vehicle_history (
  vin                 text primary key references public.vehicles(vin) on delete cascade,
  found               boolean not null default true,
  source              text default 'eNaTIS + TransUnion',
  owners              integer,
  first_registered    text,
  province            text,
  stolen              boolean default false,
  taxi_history        boolean default false,
  colour_changes      integer default 0,
  outstanding_finance boolean default false,
  finance_house       text,
  fetched_at          timestamptz not null default now()
);

create table public.vehicle_accidents (
  id          uuid primary key default gen_random_uuid(),
  vin         text not null references public.vehicles(vin) on delete cascade,
  date        date not null,
  severity    text not null check (severity in ('Minor', 'Major')),
  description text
);

create table public.vehicle_odometer_readings (
  id   uuid primary key default gen_random_uuid(),
  vin  text not null references public.vehicles(vin) on delete cascade,
  date date not null,
  km   integer not null
);

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  buyer_id       uuid not null references public.profiles(id),
  inspector_id   uuid references public.profiles(id),
  vin            text not null references public.vehicles(vin),
  location       text not null,
  notes          text,
  status         public.booking_status not null default 'pending',
  inspection_fee integer not null,
  travel_fee     integer not null default 100,
  platform_fee   integer not null default 75,
  paid           boolean not null default false,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  completed_at   timestamptz
);

create table public.inspections (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null unique references public.bookings(id) on delete cascade,
  vin               text not null references public.vehicles(vin),
  inspector_id      uuid not null references public.profiles(id),
  score             integer not null check (score between 0 and 100),
  verdict           text,
  full_price        integer not null,
  report_price      integer not null,
  payer_cut         integer not null,
  inspector_cut     integer not null,
  created_at        timestamptz not null default now(),
  report_number     text unique,
  odometer_km       integer,
  roadworthy_status text check (roadworthy_status in ('pass', 'fail')),
  faults            jsonb not null default '[]',
  warnings          jsonb not null default '[]',
  submitted_at      timestamptz
);

create table public.inspection_findings (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  area          text not null,
  status        text not null check (status in ('pass', 'warn', 'fail')),
  note          text
);

create table public.report_purchases (
  id                uuid primary key default gen_random_uuid(),
  inspection_id     uuid not null references public.inspections(id),
  buyer_id          uuid not null references public.profiles(id),
  amount_paid       integer not null,
  payer_earning     integer not null,
  inspector_earning integer not null,
  purchased_at      timestamptz not null default now(),
  unique (inspection_id, buyer_id)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null check (type in ('earn', 'track', 'sys')),
  icon       text not null default '🔔',
  title      text not null,
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.report_items (
  id                  uuid primary key default gen_random_uuid(),
  inspection_id       uuid not null references public.inspections(id) on delete cascade,
  section             text not null,
  component           text not null,
  condition           text not null check (condition in ('good', 'as_expected', 'fair', 'poor', 'na')),
  explanation         text,
  roadworthy_relevant boolean not null default false,
  unique (inspection_id, section, component)
);

create table public.report_measurements (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  test          text not null check (test in ('brake', 'shock', 'slip')),
  position      text not null,
  right_value   numeric,
  left_value    numeric,
  diff_pct      numeric,
  result        text,
  unique (inspection_id, test, position)
);

create table public.report_tyres (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  position      text not null,
  size          text,
  load_speed    text,
  make          text,
  model         text,
  tyre_type     text,
  tread_mm      numeric,
  unique (inspection_id, position)
);

create table public.report_photos (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  section       text not null,
  storage_path  text not null,
  caption       text,
  sort          integer not null default 0
);

create table public.report_orders (
  id                 uuid primary key default gen_random_uuid(),
  inspection_id      uuid not null references public.inspections(id) on delete restrict,
  buyer_id           uuid not null references public.profiles(id) on delete restrict,
  amount             integer not null check (amount >= 0),
  status             text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider           text,
  provider_reference text,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  unique (inspection_id, buyer_id)
);

create index idx_bookings_inspector on public.bookings(inspector_id) where status = 'pending';
create index idx_bookings_buyer on public.bookings(buyer_id);
create index idx_inspections_vin on public.inspections(vin);
create index idx_notifications_user on public.notifications(user_id, read);
create index idx_purchases_earner on public.report_purchases(inspection_id);
create index idx_report_orders_buyer on public.report_orders(buyer_id);
create index idx_report_orders_inspection on public.report_orders(inspection_id);
create index report_items_insp on public.report_items(inspection_id);
create index report_photos_insp on public.report_photos(inspection_id);

-- ---------------------------------------------------------------- functions (verbatim from live)
create or replace function public.can_read_report(p_inspection uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from inspections i
    left join bookings b on b.id = i.booking_id
    where i.id = p_inspection and (
      i.inspector_id = auth.uid()
      or b.buyer_id = auth.uid()
      or exists (select 1 from report_purchases rp where rp.inspection_id = i.id and rp.buyer_id = auth.uid())
    )
  );
$$;

create or replace function public.create_report_order(p_inspection_id uuid) returns public.report_orders
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_insp public.inspections%rowtype;
  v_booking public.bookings%rowtype;
  v_order public.report_orders%rowtype;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into v_insp from public.inspections where id = p_inspection_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select * into v_booking from public.bookings where id = v_insp.booking_id;
  if v_booking.buyer_id = v_user then raise exception 'The commissioning buyer already owns this report' using errcode = '42501'; end if;
  if exists (select 1 from public.report_purchases where inspection_id = p_inspection_id and buyer_id = v_user) then
    raise exception 'Report already purchased' using errcode = '23505';
  end if;
  insert into public.report_orders(inspection_id, buyer_id, amount) values (p_inspection_id, v_user, v_insp.report_price)
  on conflict (inspection_id, buyer_id) do update set amount = excluded.amount returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text; v_first text; v_init text; v_role public.user_role;
begin
 v_name:=coalesce(nullif(new.raw_user_meta_data->>'name',''),split_part(new.email,'@',1));
 v_first:=coalesce(nullif(new.raw_user_meta_data->>'first_name',''),split_part(v_name,' ',1));
 v_init:=coalesce(nullif(new.raw_user_meta_data->>'init',''),upper(left(regexp_replace(v_name,'[^A-Za-z]','','g'),2)));
 if v_init is null or v_init='' then v_init:='U'; end if;
 begin v_role:=(new.raw_user_meta_data->>'role')::public.user_role;
 exception when invalid_text_representation then v_role:='buyer'; end;
 insert into public.profiles(id,role,name,first_name,init,email) values(new.id,v_role,v_name,v_first,v_init,new.email)
 on conflict(id) do update set name=excluded.name,first_name=excluded.first_name,init=excluded.init,email=excluded.email;
 return new;
end $$;

create or replace function public.notify_report_completed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_buyer uuid;
begin
 select buyer_id into v_buyer from public.bookings where id=new.booking_id;
 if v_buyer is not null then insert into public.notifications(user_id,type,icon,title,body) values(v_buyer,'sys','🍋','Your LemonCheck report is ready','Your inspection report '||coalesce(new.report_number,'')||' is now available.'); end if;
 return new;
end $$;

create or replace function public.notify_report_purchased() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inspector uuid; v_tracker uuid; v_vin text;
begin
 select i.inspector_id,i.vin,v.first_tracked_by into v_inspector,v_vin,v_tracker from public.inspections i join public.vehicles v on v.vin=i.vin where i.id=new.inspection_id;
 if v_tracker is not null and v_tracker<>new.buyer_id then insert into public.notifications(user_id,type,icon,title,body) values(v_tracker,'earn','🍋','Report sold again','Your vehicle report for '||v_vin||' generated R'||new.payer_earning||'.'); end if;
 if v_inspector is not null and v_inspector<>new.buyer_id then insert into public.notifications(user_id,type,icon,title,body) values(v_inspector,'earn','💰','Report resale earned','Your LemonCheck report for '||v_vin||' generated R'||new.inspector_earning||'.'); end if;
 return new;
end $$;

create or replace function public.submit_detailed_report(
  p_booking_id uuid, p_score integer, p_verdict text, p_odometer_km integer, p_roadworthy text,
  p_faults jsonb, p_warnings jsonb, p_findings jsonb, p_items jsonb, p_measurements jsonb, p_tyres jsonb
) returns table (inspection_id uuid, report_number text)
language plpgsql security invoker set search_path = public as $$
declare
  b bookings%rowtype; v_report_price integer; v_payer_cut integer; v_insp_cut integer; v_id uuid; v_num text; v_try integer := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into b from bookings where id = p_booking_id for update;
  if not found or b.inspector_id is distinct from auth.uid() then
    raise exception 'Booking not found or not assigned to you' using errcode = '42501';
  end if;
  if b.status = 'done' or exists (select 1 from inspections i where i.booking_id = b.id) then
    raise exception 'A report has already been submitted for this booking' using errcode = '23505';
  end if;
  if p_score is null or p_score < 0 or p_score > 100 then raise exception 'Score must be between 0 and 100' using errcode = '22023'; end if;
  if p_roadworthy not in ('pass', 'fail') then raise exception 'roadworthy must be pass or fail' using errcode = '22023'; end if;
  if p_odometer_km is null or p_odometer_km < 0 then raise exception 'Odometer reading is required' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Checklist items are required' using errcode = '22023'; end if;
  if jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings) = 0 then raise exception 'Area findings are required' using errcode = '22023'; end if;
  if jsonb_typeof(p_faults) is distinct from 'array' or jsonb_typeof(p_warnings) is distinct from 'array'
     or jsonb_typeof(p_measurements) is distinct from 'array' or jsonb_typeof(p_tyres) is distinct from 'array' then
    raise exception 'faults, warnings, measurements and tyres must be arrays' using errcode = '22023';
  end if;
  v_report_price := round(b.inspection_fee * 0.18);
  v_payer_cut    := round(v_report_price * 0.515);
  v_insp_cut     := v_report_price - v_payer_cut;
  loop
    v_num := 'LC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from inspections i where i.report_number = v_num);
    v_try := v_try + 1;
    if v_try > 5 then raise exception 'Could not allocate a report number' using errcode = '55000'; end if;
  end loop;
  insert into inspections (booking_id, vin, inspector_id, score, verdict, full_price, report_price, payer_cut, inspector_cut,
    report_number, odometer_km, roadworthy_status, faults, warnings, submitted_at)
  values (b.id, b.vin, auth.uid(), p_score, p_verdict, b.inspection_fee, v_report_price, v_payer_cut, v_insp_cut,
    v_num, p_odometer_km, p_roadworthy, p_faults, p_warnings, now()) returning id into v_id;
  insert into inspection_findings (inspection_id, area, status, note)
  select v_id, x->>'area', x->>'status', nullif(x->>'note', '') from jsonb_array_elements(p_findings) x;
  insert into report_items (inspection_id, section, component, condition, explanation, roadworthy_relevant)
  select v_id, x->>'section', x->>'component', x->>'condition', nullif(x->>'explanation', ''), coalesce((x->>'roadworthy_relevant')::boolean, false)
  from jsonb_array_elements(p_items) x;
  insert into report_measurements (inspection_id, test, position, right_value, left_value, diff_pct, result)
  select v_id, x->>'test', x->>'position', (x->>'right_value')::numeric, (x->>'left_value')::numeric, (x->>'diff_pct')::numeric, x->>'result'
  from jsonb_array_elements(p_measurements) x;
  insert into report_tyres (inspection_id, position, size, load_speed, make, model, tyre_type, tread_mm)
  select v_id, x->>'position', nullif(x->>'size', ''), nullif(x->>'load_speed', ''), nullif(x->>'make', ''), nullif(x->>'model', ''),
         nullif(x->>'tyre_type', ''), (x->>'tread_mm')::numeric
  from jsonb_array_elements(p_tyres) x;
  update bookings set status = 'done', completed_at = now() where id = b.id;
  update profiles set jobs_completed = jobs_completed + 1 where id = auth.uid();
  return query select v_id, v_num;
end;
$$;

-- ---------------------------------------------------------------- triggers
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create trigger trg_report_completed_notification after insert on public.inspections for each row execute function public.notify_report_completed();
create trigger trg_report_purchase_notification after insert on public.report_purchases for each row execute function public.notify_report_purchased();

-- ---------------------------------------------------------------- RLS (verbatim policy set observed live)
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_history enable row level security;
alter table public.vehicle_accidents enable row level security;
alter table public.vehicle_odometer_readings enable row level security;
alter table public.bookings enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_findings enable row level security;
alter table public.report_purchases enable row level security;
alter table public.notifications enable row level security;
alter table public.report_items enable row level security;
alter table public.report_measurements enable row level security;
alter table public.report_tyres enable row level security;
alter table public.report_photos enable row level security;
alter table public.report_orders enable row level security;

create policy "profiles: read own" on public.profiles for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: buyers can view online inspectors" on public.profiles for select using (role = 'inspector' and online = true);

create policy "vehicles: readable by authenticated users" on public.vehicles for select using (auth.role() = 'authenticated');
create policy "vehicles: insert by authenticated users" on public.vehicles for insert with check (auth.role() = 'authenticated');
create policy "vehicles: update by authenticated users" on public.vehicles for update using (auth.role() = 'authenticated');

create policy "history: readable by authenticated users" on public.vehicle_history for select using (auth.role() = 'authenticated');
create policy "accidents: readable by authenticated users" on public.vehicle_accidents for select using (auth.role() = 'authenticated');
create policy "odo: readable by authenticated users" on public.vehicle_odometer_readings for select using (auth.role() = 'authenticated');

create policy "bookings: buyer inserts own" on public.bookings for insert with check ((select auth.uid()) = buyer_id);
create policy "bookings: buyer reads own" on public.bookings for select using ((select auth.uid()) = buyer_id);
create policy "bookings: buyer updates own" on public.bookings for update using ((select auth.uid()) = buyer_id) with check ((select auth.uid()) = buyer_id);
create policy "bookings: inspector reads assigned/pending" on public.bookings for select
  using (((select auth.uid()) = inspector_id) or ((inspector_id is null) and status = 'pending'));
create policy "bookings: inspector updates assigned" on public.bookings for update
  using ((select auth.uid()) = inspector_id) with check ((select auth.uid()) = inspector_id);

create policy "inspections: inspector inserts own" on public.inspections for insert with check ((select auth.uid()) = inspector_id);
create policy "inspections: readable by authenticated users" on public.inspections for select using (auth.role() = 'authenticated');
create policy "findings: insert via own inspection" on public.inspection_findings for insert
  with check (exists (select 1 from public.inspections i where i.id = inspection_id and i.inspector_id = (select auth.uid())));
create policy "findings: readable by authenticated users" on public.inspection_findings for select using (auth.role() = 'authenticated');

create policy "purchases: buyer reads own" on public.report_purchases for select using (auth.uid() = buyer_id);
create policy "purchases: inspector reads own earnings" on public.report_purchases for select
  using (exists (select 1 from public.inspections i where i.id = report_purchases.inspection_id and i.inspector_id = auth.uid()));
create policy "purchases: original tracker reads own earnings" on public.report_purchases for select
  using (exists (select 1 from public.vehicles v join public.inspections i on i.vin = v.vin
                 where i.id = report_purchases.inspection_id and v.first_tracked_by = auth.uid()));

create policy "notifications: read own" on public.notifications for select using (auth.uid() = user_id);
create policy "notifications: update own" on public.notifications for update using (auth.uid() = user_id);

create policy "report_orders buyer reads own" on public.report_orders for select to authenticated using ((select auth.uid()) = buyer_id);

do $$
declare t text;
begin
  foreach t in array array['report_items', 'report_measurements', 'report_tyres', 'report_photos'] loop
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (can_read_report(inspection_id))', t);
    execute format($p$create policy "%1$s_write" on public.%1$I for all to authenticated
      using (exists (select 1 from public.inspections i where i.id = %1$I.inspection_id and i.inspector_id = auth.uid()))
      with check (exists (select 1 from public.inspections i where i.id = %1$I.inspection_id and i.inspector_id = auth.uid()))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('report-photos', 'report-photos', false);
create policy "report photos read" on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and public.can_read_report(((storage.foldername(name))[1])::uuid));
create policy "report photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and exists (select 1 from public.inspections i
    where i.id::text = (storage.foldername(objects.name))[1] and i.inspector_id = auth.uid()));

-- ---------------------------------------------------------------- grants (Supabase defaults + live revokes)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

revoke all on function public.can_read_report(uuid) from public, anon, authenticated;
revoke all on function public.create_report_order(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.notify_report_completed() from public, anon, authenticated;
revoke all on function public.notify_report_purchased() from public, anon, authenticated;
revoke all on function public.submit_detailed_report(uuid, integer, text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.can_read_report(uuid) to service_role;
grant execute on function public.create_report_order(uuid) to service_role;
grant execute on function public.submit_detailed_report(uuid, integer, text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
