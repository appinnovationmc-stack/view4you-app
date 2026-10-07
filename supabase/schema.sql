-- ============================================================================
-- LemonCheck — full schema (replaces View4You's schema entirely)
-- Two-sided marketplace: buyers (vehicle history + inspection reports) and
-- inspectors (accept jobs, submit findings, earn per-inspection + resale cut).
-- Apply in Supabase SQL editor, or via `supabase db push` if using the CLI.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users, role determines which app shell loads
-- ---------------------------------------------------------------------------
create type user_role as enum ('buyer', 'inspector');

create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            user_role not null,
  name            text not null,
  first_name      text not null,
  init            text not null,               -- 2-letter avatar initials
  email           text not null,
  phone           text,
  -- inspector-only fields (null for buyers)
  cert            text,                         -- e.g. 'AA Level 2'
  licence         text,
  experience      text,                         -- e.g. '6 years'
  region          text,
  specialty       text,
  bio             text,
  rating          numeric(3,2) default 5.00,
  jobs_completed  integer default 0,
  price           integer,                      -- inspector's per-inspection fee (Rand)
  eta_minutes     integer,                      -- typical response time
  online          boolean default false,
  top_rated       boolean default false,
  created_at      timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "profiles: read own" on profiles for select using (auth.uid() = id);
create policy "profiles: update own" on profiles for update using (auth.uid() = id);
create policy "profiles: insert own" on profiles for insert with check (auth.uid() = id);
-- Inspectors' public fields are visible to buyers browsing the booking flow
create policy "profiles: buyers can view online inspectors" on profiles
  for select using (role = 'inspector' and online = true);

-- ---------------------------------------------------------------------------
-- vehicles — one row per VIN, owner is whoever first searched/booked it
-- ---------------------------------------------------------------------------
create table vehicles (
  vin             text primary key,
  make            text not null,
  model           text not null,
  year            integer not null,
  colour          text,
  mileage         integer,
  engine          text,
  transmission    text,
  first_tracked_by uuid references profiles(id),   -- earns resale cut
  created_at      timestamptz not null default now()
);

alter table vehicles enable row level security;
create policy "vehicles: readable by authenticated users" on vehicles
  for select using (auth.role() = 'authenticated');
create policy "vehicles: insert by authenticated users" on vehicles
  for insert with check (auth.role() = 'authenticated');
create policy "vehicles: update by authenticated users" on vehicles
  for update using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- vehicle_history — eNaTIS / TransUnion-style SA vehicle history snapshot
-- ---------------------------------------------------------------------------
create table vehicle_history (
  vin             text primary key references vehicles(vin) on delete cascade,
  found           boolean not null default true,
  source          text default 'eNaTIS + TransUnion',
  owners          integer,
  first_registered text,
  province        text,
  stolen          boolean default false,
  taxi_history    boolean default false,
  colour_changes  integer default 0,
  outstanding_finance boolean default false,
  finance_house   text,
  fetched_at      timestamptz not null default now()
);

create table vehicle_accidents (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null references vehicles(vin) on delete cascade,
  date            date not null,
  severity        text not null check (severity in ('Minor','Major')),
  description     text
);

create table vehicle_odometer_readings (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null references vehicles(vin) on delete cascade,
  date            date not null,
  km              integer not null
);

alter table vehicle_history enable row level security;
alter table vehicle_accidents enable row level security;
alter table vehicle_odometer_readings enable row level security;
create policy "history: readable by authenticated users" on vehicle_history for select using (auth.role() = 'authenticated');
create policy "accidents: readable by authenticated users" on vehicle_accidents for select using (auth.role() = 'authenticated');
create policy "odo: readable by authenticated users" on vehicle_odometer_readings for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- bookings — a buyer's request for an inspection (becomes a "job" once
-- accepted by an inspector)
-- ---------------------------------------------------------------------------
create type booking_status as enum ('pending','accepted','en_route','in_progress','done','cancelled');

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references profiles(id),
  inspector_id    uuid references profiles(id),
  vin             text not null references vehicles(vin),
  location        text not null,
  notes           text,
  status          booking_status not null default 'pending',
  inspection_fee  integer not null,     -- inspector's price at time of booking
  travel_fee      integer not null default 100,
  platform_fee    integer not null default 75,
  paid            boolean not null default false,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  completed_at    timestamptz
);

alter table bookings enable row level security;
create policy "bookings: buyer reads own" on bookings for select using (auth.uid() = buyer_id);
create policy "bookings: inspector reads assigned/pending" on bookings for select using (
  auth.uid() = inspector_id or (inspector_id is null and status = 'pending')
);
create policy "bookings: buyer inserts own" on bookings for insert with check (auth.uid() = buyer_id);
create policy "bookings: buyer updates own" on bookings for update using (auth.uid() = buyer_id);
create policy "bookings: inspector updates assigned" on bookings for update using (auth.uid() = inspector_id);

-- ---------------------------------------------------------------------------
-- inspections — the completed report for a booking (1:1)
-- ---------------------------------------------------------------------------
create table inspections (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null unique references bookings(id) on delete cascade,
  vin             text not null references vehicles(vin),
  inspector_id    uuid not null references profiles(id),
  score           integer not null check (score between 0 and 100),
  verdict         text,
  full_price      integer not null,     -- what the commissioning buyer paid
  report_price    integer not null,     -- resale price for other buyers
  payer_cut       integer not null,     -- resale cut the original buyer earns
  inspector_cut   integer not null,     -- resale cut the inspector earns
  created_at      timestamptz not null default now()
);

create table inspection_findings (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references inspections(id) on delete cascade,
  area            text not null,        -- Engine, Brakes, Tyres, etc.
  status          text not null check (status in ('pass','warn','fail')),
  note            text
);

alter table inspections enable row level security;
alter table inspection_findings enable row level security;
create policy "inspections: readable by authenticated users" on inspections for select using (auth.role() = 'authenticated');
create policy "inspections: inspector inserts own" on inspections for insert with check (auth.uid() = inspector_id);
create policy "findings: readable by authenticated users" on inspection_findings for select using (auth.role() = 'authenticated');
create policy "findings: insert via own inspection" on inspection_findings for insert with check (
  exists (select 1 from inspections i where i.id = inspection_id and i.inspector_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- report_purchases — resale transactions: buyer X buys the report for a VIN
-- already inspected by someone else. Drives the passive-income model.
-- ---------------------------------------------------------------------------
create table report_purchases (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references inspections(id),
  buyer_id        uuid not null references profiles(id),
  amount_paid     integer not null,
  payer_earning   integer not null,     -- credited to vehicles.first_tracked_by
  inspector_earning integer not null,   -- credited to inspections.inspector_id
  purchased_at    timestamptz not null default now(),
  unique (inspection_id, buyer_id)      -- can't buy the same report twice
);

alter table report_purchases enable row level security;
create policy "purchases: buyer reads own" on report_purchases for select using (auth.uid() = buyer_id);
create policy "purchases: original tracker reads own earnings" on report_purchases for select using (
  exists (select 1 from vehicles v join inspections i on i.vin = v.vin
          where i.id = inspection_id and v.first_tracked_by = auth.uid())
);
create policy "purchases: inspector reads own earnings" on report_purchases for select using (
  exists (select 1 from inspections i where i.id = inspection_id and i.inspector_id = auth.uid())
);
create policy "purchases: buyer inserts own" on report_purchases for insert with check (auth.uid() = buyer_id);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  type            text not null check (type in ('earn','track','sys')),
  icon            text not null default '🔔',
  title           text not null,
  body            text not null,
  read            boolean not null default false,
  created_at      timestamptz not null default now()
);

alter table notifications enable row level security;
create policy "notifications: read own" on notifications for select using (auth.uid() = user_id);
create policy "notifications: update own" on notifications for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index idx_bookings_inspector on bookings(inspector_id) where status = 'pending';
create index idx_bookings_buyer on bookings(buyer_id);
create index idx_inspections_vin on inspections(vin);
create index idx_notifications_user on notifications(user_id, read);
create index idx_purchases_earner on report_purchases(inspection_id);
