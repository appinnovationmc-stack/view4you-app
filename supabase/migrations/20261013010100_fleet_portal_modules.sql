-- CheckVertical Fleet & Asset Portal — 20261013010100 modules (forward-only).
--
-- 5.1.1 Fleet management: vehicles, drivers, scheduling/allocation, maintenance, fuel, incidents, expenses,
--       vehicle location, statutory compliance.
-- 5.1.2 Property management: land and buildings, valuations, maintenance backlog.
--
-- Every row carries tenant_id and unit_id. Child rows inherit both from their vehicle / property / driver in a
-- BEFORE trigger, so a client can never file a record under another organisation. Access is Row Level Security
-- driven by fleet_can() (role matrix) and fleet_unit_ok() (unit-subtree scope); see the core migration.

-- ---------------------------------------------------------------------------
-- Drivers
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_drivers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id        uuid references public.fleet_units(id) on delete set null,
  member_id      uuid references public.fleet_members(id) on delete set null,   -- links a driver record to a sign-in
  full_name      text not null check (length(btrim(full_name)) between 2 and 120),
  employee_no    text,
  phone          text,
  licence_number text,
  licence_code   text,                       -- e.g. B, C1, EC
  licence_expiry date,
  prdp_expiry    date,                       -- professional driving permit
  status         text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fleet_drivers_tenant on public.fleet_drivers (tenant_id, unit_id);
create index if not exists fleet_drivers_member on public.fleet_drivers (member_id);

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_vehicles (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id             uuid references public.fleet_units(id) on delete set null,
  reg_number          text not null check (length(btrim(reg_number)) between 2 and 20),
  fleet_number        text,
  vin                 text,
  make                text,
  model               text,
  year                integer check (year between 1950 and 2100),
  colour              text,
  category            text not null default 'sedan' check (category in
                        ('sedan', 'hatchback', 'suv', 'bakkie', 'minibus', 'bus', 'truck', 'tractor', 'motorcycle', 'trailer', 'implement', 'other')),
  ownership           text not null default 'owned' check (ownership in ('owned', 'rented', 'leased')),
  rental_supplier     text,
  rental_rate_per_day numeric(12, 2) check (rental_rate_per_day is null or rental_rate_per_day >= 0),
  rental_start        date,
  rental_end          date,
  acquisition_date    date,
  acquisition_cost    numeric(14, 2) check (acquisition_cost is null or acquisition_cost >= 0),
  odometer_km         integer not null default 0 check (odometer_km >= 0),
  engine_hours        numeric(10, 1) check (engine_hours is null or engine_hours >= 0),
  fuel_type           text check (fuel_type is null or fuel_type in ('petrol', 'diesel', 'hybrid', 'electric', 'lpg')),
  tank_capacity_l     numeric(6, 1) check (tank_capacity_l is null or tank_capacity_l > 0),
  seats               integer check (seats is null or seats between 1 and 100),
  status              text not null default 'active' check (status in ('active', 'reserved', 'in_workshop', 'out_of_service', 'disposed')),
  tracker_installed   boolean not null default false,
  tracker_provider    text,
  tracker_device_id   text,
  last_lat            double precision check (last_lat is null or last_lat between -90 and 90),
  last_lng            double precision check (last_lng is null or last_lng between -180 and 180),
  last_seen_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (rental_end is null or rental_start is null or rental_end >= rental_start)
);
create unique index if not exists fleet_vehicles_reg on public.fleet_vehicles (tenant_id, upper(reg_number));
create index if not exists fleet_vehicles_scope on public.fleet_vehicles (tenant_id, unit_id, status);

-- ---------------------------------------------------------------------------
-- Scheduling / allocation
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_allocations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id        uuid references public.fleet_units(id) on delete set null,
  vehicle_id     uuid not null references public.fleet_vehicles(id) on delete restrict,
  driver_id      uuid references public.fleet_drivers(id) on delete set null,
  requested_by   uuid references public.fleet_members(id) on delete set null,
  purpose        text not null check (length(btrim(purpose)) between 2 and 300),
  destination    text,
  passengers     integer check (passengers is null or passengers >= 0),
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  status         text not null default 'requested' check (status in ('requested', 'approved', 'active', 'completed', 'rejected', 'cancelled')),
  decision_note  text,
  start_odometer integer check (start_odometer is null or start_odometer >= 0),
  end_odometer   integer check (end_odometer is null or end_odometer >= 0),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_at > start_at),
  check (end_odometer is null or start_odometer is null or end_odometer >= start_odometer)
);
create index if not exists fleet_alloc_vehicle on public.fleet_allocations (vehicle_id, start_at);
create index if not exists fleet_alloc_driver on public.fleet_allocations (driver_id, start_at);
create index if not exists fleet_alloc_tenant on public.fleet_allocations (tenant_id, start_at desc);

-- ---------------------------------------------------------------------------
-- Maintenance: recurring plans + work orders
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_maintenance_plans (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id        uuid references public.fleet_units(id) on delete set null,
  vehicle_id     uuid not null references public.fleet_vehicles(id) on delete cascade,
  task           text not null check (length(btrim(task)) between 2 and 120),    -- "Service", "Tyre rotation" ...
  interval_km    integer check (interval_km is null or interval_km > 0),
  interval_days  integer check (interval_days is null or interval_days > 0),
  last_done_date date,
  last_done_km   integer check (last_done_km is null or last_done_km >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (interval_km is not null or interval_days is not null)
);
create index if not exists fleet_mplan_vehicle on public.fleet_maintenance_plans (vehicle_id);

create table if not exists public.fleet_maintenance (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id        uuid references public.fleet_units(id) on delete set null,
  vehicle_id     uuid not null references public.fleet_vehicles(id) on delete restrict,
  plan_id        uuid references public.fleet_maintenance_plans(id) on delete set null,
  kind           text not null default 'service' check (kind in ('service', 'repair', 'tyres', 'inspection', 'accident_repair', 'other')),
  status         text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  description    text not null check (length(btrim(description)) between 2 and 500),
  supplier       text,
  scheduled_date date,
  completed_date date,
  odometer_km    integer check (odometer_km is null or odometer_km >= 0),
  cost           numeric(12, 2) not null default 0 check (cost >= 0),
  invoice_no     text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fleet_maint_vehicle on public.fleet_maintenance (vehicle_id, scheduled_date desc);
create index if not exists fleet_maint_tenant on public.fleet_maintenance (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Fuel
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_fuel_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id     uuid references public.fleet_units(id) on delete set null,
  vehicle_id  uuid not null references public.fleet_vehicles(id) on delete restrict,
  driver_id   uuid references public.fleet_drivers(id) on delete set null,
  filled_at   timestamptz not null default now(),
  litres      numeric(8, 2) not null check (litres > 0),
  cost        numeric(12, 2) not null check (cost >= 0),
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  station     text,
  fuel_card   text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists fleet_fuel_vehicle on public.fleet_fuel_logs (vehicle_id, filled_at desc);
create index if not exists fleet_fuel_tenant on public.fleet_fuel_logs (tenant_id, filled_at desc);

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_incidents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id         uuid references public.fleet_units(id) on delete set null,
  vehicle_id      uuid not null references public.fleet_vehicles(id) on delete restrict,
  driver_id       uuid references public.fleet_drivers(id) on delete set null,
  occurred_at     timestamptz not null default now(),
  kind            text not null default 'accident' check (kind in ('accident', 'damage', 'breakdown', 'theft', 'hijacking', 'traffic_fine', 'misuse', 'other')),
  severity        text not null default 'minor' check (severity in ('minor', 'moderate', 'major', 'critical')),
  location        text,
  description     text not null check (length(btrim(description)) between 2 and 2000),
  injuries        boolean not null default false,
  police_case_no  text,
  third_party     text,
  estimated_cost  numeric(12, 2) check (estimated_cost is null or estimated_cost >= 0),
  insurance_claim text,
  status          text not null default 'reported' check (status in ('reported', 'investigating', 'claim_lodged', 'resolved', 'closed')),
  resolution      text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists fleet_inc_vehicle on public.fleet_incidents (vehicle_id, occurred_at desc);
create index if not exists fleet_inc_tenant on public.fleet_incidents (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Vehicle location history (tracker feed or manual / driver check-in)
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_locations (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id     uuid references public.fleet_units(id) on delete set null,
  vehicle_id  uuid not null references public.fleet_vehicles(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  speed_kmh   numeric(6, 1) check (speed_kmh is null or speed_kmh >= 0),
  source      text not null default 'manual' check (source in ('tracker', 'manual', 'driver')),
  note        text,
  created_by  uuid default auth.uid()
);
create index if not exists fleet_loc_vehicle on public.fleet_locations (vehicle_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Statutory compliance (licence discs, roadworthy, insurance, driver licences, PrDP ...)
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_compliance (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id       uuid references public.fleet_units(id) on delete set null,
  vehicle_id    uuid references public.fleet_vehicles(id) on delete cascade,
  driver_id     uuid references public.fleet_drivers(id) on delete cascade,
  kind          text not null check (kind in ('licence_disc', 'roadworthy', 'insurance', 'operator_card', 'tracker_subscription',
                                              'driver_licence', 'prdp', 'medical', 'other')),
  reference     text,
  issued_on     date,
  expires_on    date not null,
  reminder_days integer not null default 30 check (reminder_days between 0 and 365),
  document_path text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((vehicle_id is not null)::int + (driver_id is not null)::int = 1)
);
create index if not exists fleet_comp_expiry on public.fleet_compliance (tenant_id, expires_on);

-- ---------------------------------------------------------------------------
-- Expenses (fuel and workshop spend live in their own tables; this ledger holds everything else)
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_expenses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id     uuid references public.fleet_units(id) on delete set null,
  vehicle_id  uuid references public.fleet_vehicles(id) on delete restrict,
  property_id uuid,                                                        -- FK added below (properties come later)
  category    text not null check (category in ('insurance', 'licence_fees', 'tolls', 'fines', 'parking', 'cleaning', 'tracking',
                                                'rental', 'utilities', 'rates_taxes', 'security', 'other')),
  amount      numeric(14, 2) not null check (amount >= 0),
  incurred_on date not null default current_date,
  supplier    text,
  invoice_no  text,
  cost_centre text,
  description text,
  status      text not null default 'captured' check (status in ('captured', 'approved', 'paid', 'disputed')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (vehicle_id is null or property_id is null)
);
create index if not exists fleet_exp_tenant on public.fleet_expenses (tenant_id, incurred_on desc);
create index if not exists fleet_exp_vehicle on public.fleet_expenses (vehicle_id, incurred_on desc);

-- ---------------------------------------------------------------------------
-- Property: land and buildings
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_properties (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id           uuid references public.fleet_units(id) on delete set null,
  asset_number      text,
  name              text not null check (length(btrim(name)) between 2 and 160),
  kind              text not null default 'building' check (kind in ('land', 'building', 'land_and_buildings', 'infrastructure')),
  usage             text,                                   -- offices, research station, housing, farm ...
  ownership         text not null default 'owned' check (ownership in ('owned', 'leased', 'state_custody')),
  address           text,
  municipality      text,
  province          text,
  lat               double precision check (lat is null or lat between -90 and 90),
  lng               double precision check (lng is null or lng between -180 and 180),
  extent_value      numeric(14, 2) check (extent_value is null or extent_value >= 0),
  extent_unit       text not null default 'm2' check (extent_unit in ('m2', 'ha')),
  title_deed_number text,
  deed_document_path   text,
  layout_plan_path     text,
  year_built        integer check (year_built is null or year_built between 1700 and 2100),
  condition_rating  text check (condition_rating is null or condition_rating in ('excellent', 'good', 'fair', 'poor', 'critical')),
  status            text not null default 'active' check (status in ('active', 'vacant', 'under_construction', 'for_disposal', 'disposed')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists fleet_prop_scope on public.fleet_properties (tenant_id, unit_id, status);

alter table public.fleet_expenses drop constraint if exists fleet_expenses_property_fk;
alter table public.fleet_expenses add constraint fleet_expenses_property_fk
  foreign key (property_id) references public.fleet_properties(id) on delete restrict;

-- Market value vs current value: market = what the asset would fetch in good order; current = value after the
-- physical-condition discount caused by the maintenance backlog.
create table if not exists public.fleet_property_valuations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id            uuid references public.fleet_units(id) on delete set null,
  property_id        uuid not null references public.fleet_properties(id) on delete cascade,
  valued_on          date not null default current_date,
  market_value       numeric(16, 2) not null check (market_value >= 0),
  current_value      numeric(16, 2) not null check (current_value >= 0),
  maintenance_backlog numeric(16, 2) check (maintenance_backlog is null or maintenance_backlog >= 0),
  method             text,
  valuer             text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists fleet_pval_property on public.fleet_property_valuations (property_id, valued_on desc);

create table if not exists public.fleet_property_maintenance (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.fleet_tenants(id) on delete cascade,
  unit_id        uuid references public.fleet_units(id) on delete set null,
  property_id    uuid not null references public.fleet_properties(id) on delete cascade,
  title          text not null check (length(btrim(title)) between 2 and 200),
  description    text,
  priority       text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status         text not null default 'backlog' check (status in ('backlog', 'planned', 'in_progress', 'completed', 'cancelled')),
  estimated_cost numeric(14, 2) not null default 0 check (estimated_cost >= 0),
  actual_cost    numeric(14, 2) check (actual_cost is null or actual_cost >= 0),
  due_date       date,
  completed_date date,
  contractor     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fleet_pmaint_property on public.fleet_property_maintenance (property_id, status);

-- ---------------------------------------------------------------------------
-- Scope inheritance: child rows take tenant_id / unit_id from their vehicle, property or driver.
-- ---------------------------------------------------------------------------
create or replace function public.fleet_inherit_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(new); t uuid; u uuid; found_parent boolean := false; d_tenant uuid;
begin
  if j ->> 'vehicle_id' is not null then
    select v.tenant_id, v.unit_id into t, u from public.fleet_vehicles v where v.id = (j ->> 'vehicle_id')::uuid;
    if not found then raise exception 'Vehicle not found'; end if;
    found_parent := true;
  elsif j ->> 'property_id' is not null then
    select p.tenant_id, p.unit_id into t, u from public.fleet_properties p where p.id = (j ->> 'property_id')::uuid;
    if not found then raise exception 'Property not found'; end if;
    found_parent := true;
  elsif j ->> 'driver_id' is not null and tg_table_name = 'fleet_compliance' then
    select d.tenant_id, d.unit_id into t, u from public.fleet_drivers d where d.id = (j ->> 'driver_id')::uuid;
    if not found then raise exception 'Driver not found'; end if;
    found_parent := true;
  end if;
  if found_parent then new.tenant_id := t; new.unit_id := u; end if;
  -- a driver on any record must belong to the same organisation
  if j ->> 'driver_id' is not null then
    select d.tenant_id into d_tenant from public.fleet_drivers d where d.id = (j ->> 'driver_id')::uuid;
    if d_tenant is distinct from new.tenant_id then raise exception 'Driver belongs to a different organisation'; end if;
  end if;
  -- a unit chosen on a parent-less row (vehicle, driver, property, expense) must belong to the same organisation
  if not found_parent and new.unit_id is not null
     and not exists (select 1 from public.fleet_units x where x.id = new.unit_id and x.tenant_id = new.tenant_id) then
    raise exception 'That unit does not belong to this organisation';
  end if;
  return new;
end $$;

-- when a vehicle / property / driver moves unit, its history moves with it
create or replace function public.fleet_cascade_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_id is not distinct from old.unit_id then return null; end if;
  if tg_table_name = 'fleet_vehicles' then
    update public.fleet_allocations      set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_maintenance_plans set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_maintenance      set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_fuel_logs        set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_incidents        set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_locations        set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_compliance       set unit_id = new.unit_id where vehicle_id = new.id;
    update public.fleet_expenses         set unit_id = new.unit_id where vehicle_id = new.id;
  elsif tg_table_name = 'fleet_properties' then
    update public.fleet_property_valuations  set unit_id = new.unit_id where property_id = new.id;
    update public.fleet_property_maintenance set unit_id = new.unit_id where property_id = new.id;
    update public.fleet_expenses             set unit_id = new.unit_id where property_id = new.id;
  elsif tg_table_name = 'fleet_drivers' then
    update public.fleet_compliance set unit_id = new.unit_id where driver_id = new.id;
  end if;
  return null;
end $$;

-- Business rules ------------------------------------------------------------
-- No double-booking: an approved / active allocation may not overlap another for the same vehicle or driver,
-- and a vehicle that is in the workshop, out of service or disposed cannot be allocated.
create or replace function public.fleet_allocation_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_clash text;
begin
  if new.status in ('approved', 'active') then
    select v.status into v_status from public.fleet_vehicles v where v.id = new.vehicle_id;
    if v_status in ('in_workshop', 'out_of_service', 'disposed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      raise exception 'Vehicle is % and cannot be allocated', replace(v_status, '_', ' ');
    end if;
    select 'Vehicle is already allocated from ' || to_char(a.start_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
           || ' to ' || to_char(a.end_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
      into v_clash
      from public.fleet_allocations a
     where a.vehicle_id = new.vehicle_id and a.id <> new.id and a.status in ('approved', 'active')
       and tstzrange(a.start_at, a.end_at) && tstzrange(new.start_at, new.end_at)
     limit 1;
    if v_clash is not null then raise exception '%', v_clash; end if;
    if new.driver_id is not null then
      select 'Driver is already allocated from ' || to_char(a.start_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
             || ' to ' || to_char(a.end_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
        into v_clash
        from public.fleet_allocations a
       where a.driver_id = new.driver_id and a.id <> new.id and a.status in ('approved', 'active')
         and tstzrange(a.start_at, a.end_at) && tstzrange(new.start_at, new.end_at)
       limit 1;
      if v_clash is not null then raise exception '%', v_clash; end if;
    end if;
  end if;
  return new;
end $$;

-- Odometer only ever moves forward; completed trips / fuel / workshop visits push it.
create or replace function public.fleet_push_odometer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(new); v_km integer;
begin
  v_km := coalesce((j ->> 'end_odometer')::integer, (j ->> 'odometer_km')::integer);
  if v_km is not null then
    update public.fleet_vehicles set odometer_km = greatest(odometer_km, v_km) where id = (j ->> 'vehicle_id')::uuid;
  end if;
  return null;
end $$;

create or replace function public.fleet_maintenance_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and new.plan_id is not null and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    update public.fleet_maintenance_plans
       set last_done_date = coalesce(new.completed_date, current_date),
           last_done_km = coalesce(new.odometer_km, (select v.odometer_km from public.fleet_vehicles v where v.id = new.vehicle_id))
     where id = new.plan_id and vehicle_id = new.vehicle_id;
  end if;
  return null;
end $$;

create or replace function public.fleet_track_last_position() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.fleet_vehicles
     set last_lat = new.lat, last_lng = new.lng, last_seen_at = new.recorded_at
   where id = new.vehicle_id and (last_seen_at is null or last_seen_at <= new.recorded_at);
  return null;
end $$;

-- Wire triggers ---------------------------------------------------------------
do $$
declare t text;
begin
  -- scope inheritance on every table that hangs off a vehicle, property or driver
  foreach t in array array['fleet_allocations', 'fleet_maintenance_plans', 'fleet_maintenance', 'fleet_fuel_logs', 'fleet_incidents',
                           'fleet_locations', 'fleet_compliance', 'fleet_expenses', 'fleet_property_valuations', 'fleet_property_maintenance',
                           'fleet_vehicles', 'fleet_drivers', 'fleet_properties'] loop
    execute format('drop trigger if exists a_scope on public.%I', t);
    execute format('create trigger a_scope before insert or update on public.%I for each row execute function public.fleet_inherit_scope()', t);
  end loop;
  -- updated_at
  foreach t in array array['fleet_drivers', 'fleet_vehicles', 'fleet_allocations', 'fleet_maintenance_plans', 'fleet_maintenance', 'fleet_incidents',
                           'fleet_compliance', 'fleet_expenses', 'fleet_properties', 'fleet_property_valuations', 'fleet_property_maintenance'] loop
    execute format('drop trigger if exists b_touch on public.%I', t);
    execute format('create trigger b_touch before update on public.%I for each row execute function public.fleet_touch_updated_at()', t);
  end loop;
  -- audit (locations are a high-volume feed and are not audited)
  foreach t in array array['fleet_drivers', 'fleet_vehicles', 'fleet_allocations', 'fleet_maintenance_plans', 'fleet_maintenance', 'fleet_fuel_logs',
                           'fleet_incidents', 'fleet_compliance', 'fleet_expenses', 'fleet_properties', 'fleet_property_valuations',
                           'fleet_property_maintenance'] loop
    execute format('drop trigger if exists z_audit on public.%I', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.fleet_audit_trg()', t);
  end loop;
end $$;

drop trigger if exists c_rules on public.fleet_allocations;
create trigger c_rules before insert or update on public.fleet_allocations for each row execute function public.fleet_allocation_rules();
drop trigger if exists d_odometer on public.fleet_allocations;
create trigger d_odometer after insert or update of end_odometer on public.fleet_allocations for each row execute function public.fleet_push_odometer();
drop trigger if exists d_odometer on public.fleet_fuel_logs;
create trigger d_odometer after insert on public.fleet_fuel_logs for each row execute function public.fleet_push_odometer();
drop trigger if exists d_odometer on public.fleet_maintenance;
create trigger d_odometer after insert or update of odometer_km on public.fleet_maintenance for each row execute function public.fleet_push_odometer();
drop trigger if exists e_plan_done on public.fleet_maintenance;
create trigger e_plan_done after insert or update of status on public.fleet_maintenance for each row execute function public.fleet_maintenance_done();
drop trigger if exists d_lastpos on public.fleet_locations;
create trigger d_lastpos after insert on public.fleet_locations for each row execute function public.fleet_track_last_position();
drop trigger if exists f_cascade on public.fleet_vehicles;
create trigger f_cascade after update of unit_id on public.fleet_vehicles for each row execute function public.fleet_cascade_unit();
drop trigger if exists f_cascade on public.fleet_properties;
create trigger f_cascade after update of unit_id on public.fleet_properties for each row execute function public.fleet_cascade_unit();
drop trigger if exists f_cascade on public.fleet_drivers;
create trigger f_cascade after update of unit_id on public.fleet_drivers for each row execute function public.fleet_cascade_unit();

revoke execute on function public.fleet_inherit_scope(), public.fleet_cascade_unit(), public.fleet_allocation_rules(),
  public.fleet_push_odometer(), public.fleet_maintenance_done(), public.fleet_track_last_position() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: one consistent policy set, generated per table
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('fleet_drivers', 'fleet', true), ('fleet_vehicles', 'fleet', true), ('fleet_allocations', 'fleet', false),
    ('fleet_maintenance_plans', 'fleet', false), ('fleet_maintenance', 'fleet', false), ('fleet_fuel_logs', 'fleet', false),
    ('fleet_incidents', 'fleet', false), ('fleet_locations', 'fleet', false), ('fleet_compliance', 'fleet', false),
    ('fleet_expenses', 'finance', false), ('fleet_properties', 'property', true),
    ('fleet_property_valuations', 'property', false), ('fleet_property_maintenance', 'property', false)
  ) as x(tbl, area, admin_delete_only) loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('revoke all on public.%I from anon, authenticated', r.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_read', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_ins', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_upd', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_del', r.tbl);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.fleet_can(tenant_id, %L, false) and public.fleet_unit_ok(tenant_id, unit_id))$p$, r.tbl || '_read', r.tbl, r.area);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.fleet_can(tenant_id, %L, true) and public.fleet_unit_ok(tenant_id, unit_id))$p$, r.tbl || '_ins', r.tbl, r.area);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.fleet_can(tenant_id, %L, true) and public.fleet_unit_ok(tenant_id, unit_id))
      with check (public.fleet_can(tenant_id, %L, true) and public.fleet_unit_ok(tenant_id, unit_id))$p$, r.tbl || '_upd', r.tbl, r.area, r.area);
    if r.admin_delete_only then   -- vehicles, drivers, properties: retire them (status), only the organisation administrator may delete
      execute format($p$create policy %I on public.%I for delete to authenticated
        using (public.fleet_role_in(tenant_id) = 'tenant_admin')$p$, r.tbl || '_del', r.tbl);
    else
      execute format($p$create policy %I on public.%I for delete to authenticated
        using (public.fleet_can(tenant_id, %L, true) and public.fleet_unit_ok(tenant_id, unit_id))$p$, r.tbl || '_del', r.tbl, r.area);
    end if;
  end loop;
end $$;

-- Drivers: see the vehicles in their scope THROUGH A NARROW VIEW (no rental rates, purchase cost, tracker ids),
-- their own bookings, and log their own trips / fuel / incidents / position.
drop policy if exists fleet_vehicles_driver_read on public.fleet_vehicles;
create or replace view public.fleet_v_driver_vehicles with (security_invoker = false) as
select v.id, v.tenant_id, v.unit_id, v.reg_number, v.fleet_number, v.make, v.model, v.colour, v.category, v.fuel_type, v.seats, v.status, v.odometer_km
  from public.fleet_vehicles v
 where public.fleet_role_in(v.tenant_id) = 'driver' and public.fleet_unit_ok(v.tenant_id, v.unit_id) and v.status <> 'disposed';
revoke all on public.fleet_v_driver_vehicles from anon, authenticated;
grant select on public.fleet_v_driver_vehicles to authenticated;

drop policy if exists fleet_drivers_self_read on public.fleet_drivers;
create policy fleet_drivers_self_read on public.fleet_drivers for select to authenticated
  using (member_id is not null and member_id = public.fleet_member_id(tenant_id));

drop policy if exists fleet_alloc_driver_read on public.fleet_allocations;
create policy fleet_alloc_driver_read on public.fleet_allocations for select to authenticated
  using (public.fleet_role_in(tenant_id) = 'driver'
         and (requested_by = public.fleet_member_id(tenant_id)
              or driver_id in (select d.id from public.fleet_drivers d where d.member_id = public.fleet_member_id(tenant_id))));
drop policy if exists fleet_alloc_driver_request on public.fleet_allocations;
create policy fleet_alloc_driver_request on public.fleet_allocations for insert to authenticated
  with check (public.fleet_role_in(tenant_id) = 'driver' and status = 'requested'
              and requested_by = public.fleet_member_id(tenant_id) and public.fleet_unit_ok(tenant_id, unit_id));

drop policy if exists fleet_fuel_driver_read on public.fleet_fuel_logs;
create policy fleet_fuel_driver_read on public.fleet_fuel_logs for select to authenticated
  using (public.fleet_role_in(tenant_id) = 'driver' and created_by = auth.uid());
drop policy if exists fleet_fuel_driver_add on public.fleet_fuel_logs;
create policy fleet_fuel_driver_add on public.fleet_fuel_logs for insert to authenticated
  with check (public.fleet_role_in(tenant_id) = 'driver' and created_by = auth.uid() and public.fleet_unit_ok(tenant_id, unit_id));

drop policy if exists fleet_inc_driver_read on public.fleet_incidents;
create policy fleet_inc_driver_read on public.fleet_incidents for select to authenticated
  using (public.fleet_role_in(tenant_id) = 'driver' and created_by = auth.uid());
drop policy if exists fleet_inc_driver_add on public.fleet_incidents;
create policy fleet_inc_driver_add on public.fleet_incidents for insert to authenticated
  with check (public.fleet_role_in(tenant_id) = 'driver' and created_by = auth.uid() and status = 'reported' and public.fleet_unit_ok(tenant_id, unit_id));

drop policy if exists fleet_loc_driver_add on public.fleet_locations;
create policy fleet_loc_driver_add on public.fleet_locations for insert to authenticated
  with check (public.fleet_role_in(tenant_id) = 'driver' and created_by = auth.uid() and source = 'driver' and public.fleet_unit_ok(tenant_id, unit_id));

-- counts for the CheckVertical side (numbers only; the platform never reads operational rows)
create or replace function public.fleet_vehicles_count(p_tenant uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.fleet_vehicles v where v.tenant_id = p_tenant and v.status <> 'disposed'
$$;
create or replace function public.fleet_properties_count(p_tenant uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.fleet_properties p where p.tenant_id = p_tenant and p.status <> 'disposed'
$$;
revoke execute on function public.fleet_vehicles_count(uuid), public.fleet_properties_count(uuid) from public, anon, authenticated;
