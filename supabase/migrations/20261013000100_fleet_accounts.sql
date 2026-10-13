-- CheckVertical 20261013000100 — fleet accounts (companies and government), forward-only.
--
-- An organisation registers, an operator approves it (and decides card vs monthly invoice and a credit limit).
-- Members have a role: owner (everything incl. members), manager (vehicles + bookings), viewer (read only).
-- The fleet register holds the organisation's vehicles with an inspection interval, so the dashboard can show what is
-- due. Bulk bookings go to dedicated fleet inspectors only: approved inspectors an operator has flagged
-- `fleet_approved`, who also meet a minimum rating (lc_settings.fleet_min_rating).
--
-- Payment
--   card     the booking is 'unpaid' and is paid through the normal PayFast flow, like any buyer's booking.
--   invoice  the booking is 'invoiced' (paid = true so the inspector can accept it at once). An operator turns finished
--            invoiced bookings into a monthly invoice and marks it paid when the money arrives (then the bookings
--            become 'paid'). A per-organisation credit limit caps unpaid invoiced work.
--   NOTE: the inspector is credited their job fee when the report is submitted (existing ledger behaviour), not when the
--   organisation pays. Invoiced work therefore means CheckVertical carries the receivable. That is what the credit limit
--   is for. Tax (VAT) treatment is not modelled: invoice totals are the sum of the booking amounts.
--
-- Privacy: a report written for an organisation is private. It is not shown in VIN search and cannot be bought by anyone
-- else. Only the inspector and the organisation's members can read it.
--
-- Travel fee: one travel fee per bulk booking (the first vehicle). The inspector makes one trip to one location.
--
-- Nothing here deletes or rewrites existing data.

-- ---------------------------------------------------------------------------
-- Settings and inspector flag
-- ---------------------------------------------------------------------------
alter table public.lc_settings
  add column if not exists fleet_min_rating numeric(3, 2) not null default 4.50
  check (fleet_min_rating between 0 and 5);

alter table public.profiles add column if not exists fleet_approved boolean not null default false;

-- ---------------------------------------------------------------------------
-- Tables (no client access: everything goes through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.organisations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 2 and 120),
  kind             text not null check (kind in ('company', 'government')),
  reg_number       text check (reg_number is null or length(reg_number) <= 40),
  vat_number       text check (vat_number is null or length(vat_number) <= 40),
  contact_name     text not null check (length(contact_name) between 2 and 120),
  contact_phone    text not null check (length(contact_phone) between 5 and 30),
  billing_email    text not null check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(billing_email) <= 200),
  billing_address  text check (billing_address is null or length(billing_address) <= 400),
  wants_invoice    boolean not null default false,
  payment_mode     text not null default 'card' check (payment_mode in ('card', 'invoice')),
  credit_limit     integer not null default 20000 check (credit_limit between 0 and 1000000),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  review_note      text,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  approved_at      timestamptz
);
alter table public.organisations enable row level security;
revoke all on public.organisations from anon, authenticated;
create index if not exists organisations_status on public.organisations (status, created_at desc);

create table if not exists public.org_members (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.org_members enable row level security;
revoke all on public.org_members from anon, authenticated;
create index if not exists org_members_user on public.org_members (user_id);

create table if not exists public.fleet_vehicles (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations(id) on delete cascade,
  vin             text not null references public.vehicles(vin),
  make            text not null,
  model           text not null,
  year            integer not null,
  department      text check (department is null or length(department) <= 60),
  cost_centre     text check (cost_centre is null or length(cost_centre) <= 60),
  interval_months integer not null default 6 check (interval_months between 1 and 36),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (org_id, vin)
);
alter table public.fleet_vehicles enable row level security;
revoke all on public.fleet_vehicles from anon, authenticated;
create index if not exists fleet_vehicles_org on public.fleet_vehicles (org_id) where active;

create sequence if not exists public.invoice_seq;
revoke all on sequence public.invoice_seq from anon, authenticated;

create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id),
  number            text not null unique,
  status            text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  period_from       date not null,
  period_to         date not null,
  total             integer not null check (total >= 0),
  issued_at         timestamptz not null default now(),
  due_at            timestamptz not null,
  paid_at           timestamptz,
  payment_reference text,
  void_reason       text,
  created_by        uuid not null
);
alter table public.invoices enable row level security;
revoke all on public.invoices from anon, authenticated;
create index if not exists invoices_org on public.invoices (org_id, issued_at desc);

alter table public.bookings
  add column if not exists org_id           uuid references public.organisations(id),
  add column if not exists fleet_vehicle_id uuid references public.fleet_vehicles(id) on delete set null,
  add column if not exists po_number        text check (po_number is null or length(po_number) <= 60),
  add column if not exists cost_centre      text,
  add column if not exists invoice_id       uuid references public.invoices(id);
create index if not exists bookings_org on public.bookings (org_id, created_at desc) where org_id is not null;
create index if not exists bookings_invoice on public.bookings (invoice_id) where invoice_id is not null;

alter table public.bookings drop constraint if exists bookings_payment_status_check;
alter table public.bookings add constraint bookings_payment_status_check
  check (payment_status in ('unpaid', 'paid', 'legacy_unverified', 'refund_due', 'refunded', 'invoiced'));

alter table public.inspections add column if not exists is_private boolean not null default false;

-- ---------------------------------------------------------------------------
-- Private fleet reports
-- ---------------------------------------------------------------------------
create or replace function public.lc_mark_private_fleet_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.bookings b where b.id = new.booking_id and b.org_id is not null) then
    new.is_private := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_mark_private_fleet_report on public.inspections;
create trigger trg_mark_private_fleet_report before insert on public.inspections
  for each row execute function public.lc_mark_private_fleet_report();

-- Organisation members can read their organisation's reports (in addition to the existing rules).
create or replace function public.can_read_report(p_inspection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.inspections i
    left join public.bookings b on b.id = i.booking_id
    where i.id = p_inspection and i.taken_down_at is null and (
      i.inspector_id = (select auth.uid())
      or b.buyer_id = (select auth.uid())
      or (b.org_id is not null and exists (select 1 from public.org_members m
                                           where m.org_id = b.org_id and m.user_id = (select auth.uid())))
      or exists (select 1 from public.report_purchases rp
                 where rp.inspection_id = i.id and rp.buyer_id = (select auth.uid()))
    )
  );
$$;

-- VIN search never shows a private report to anyone who cannot read it.
create or replace function public.report_preview(p_vin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  i     public.inspections%rowtype;
  v_owned boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into i from public.inspections
   where vin = upper(btrim(p_vin)) and taken_down_at is null
     and (not is_private or public.can_read_report(id))
   order by created_at desc limit 1;
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

-- A taken-down or private report cannot be ordered.
create or replace function public.lc_block_order_for_taken_down() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.inspections
              where id = new.inspection_id and (taken_down_at is not null or is_private)) then
    raise exception 'This report is not available' using errcode = '55000';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: caller's role in an organisation (raises if not a member / not allowed)
-- ---------------------------------------------------------------------------
create or replace function public.lc_org_require(p_org uuid, p_write boolean, p_approved boolean default false)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_status text;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select m.role, o.status into v_role, v_status
    from public.org_members m join public.organisations o on o.id = m.org_id
   where m.org_id = p_org and m.user_id = auth.uid();
  if v_role is null then raise exception 'Organisation not found' using errcode = '42501'; end if;
  if p_write and v_role not in ('owner', 'manager') then
    raise exception 'Your role cannot do that' using errcode = '42501';
  end if;
  if p_approved and v_status <> 'approved' then
    raise exception 'This organisation is not approved yet' using errcode = '55000';
  end if;
  return v_role;
end $$;
revoke all on function public.lc_org_require(uuid, boolean, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Organisation + members
-- ---------------------------------------------------------------------------
create or replace function public.register_organisation(
  p_name text, p_kind text, p_reg text, p_vat text, p_contact_name text, p_contact_phone text,
  p_billing_email text, p_billing_address text, p_wants_invoice boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'buyer') then
    raise exception 'Only buyer accounts can register an organisation' using errcode = '42501';
  end if;
  if (select count(*) from public.organisations o where o.created_by = v_uid and o.status <> 'suspended') >= 3 then
    raise exception 'You already have the maximum number of organisations' using errcode = '54000';
  end if;
  if p_kind not in ('company', 'government') then raise exception 'Choose company or government' using errcode = '22023'; end if;
  insert into public.organisations (name, kind, reg_number, vat_number, contact_name, contact_phone, billing_email,
                                    billing_address, wants_invoice, created_by)
  values (btrim(coalesce(p_name, '')), p_kind, nullif(btrim(coalesce(p_reg, '')), ''), nullif(btrim(coalesce(p_vat, '')), ''),
          btrim(coalesce(p_contact_name, '')), btrim(coalesce(p_contact_phone, '')), btrim(coalesce(p_billing_email, '')),
          nullif(btrim(coalesce(p_billing_address, '')), ''), coalesce(p_wants_invoice, false), v_uid)
  returning id into v_id;
  insert into public.org_members (org_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

create or replace function public.my_organisations() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'name', o.name, 'kind', o.kind, 'status', o.status, 'payment_mode', o.payment_mode,
             'wants_invoice', o.wants_invoice, 'credit_limit', o.credit_limit, 'review_note', o.review_note,
             'role', m.role) order by o.created_at)
      from public.org_members m join public.organisations o on o.id = m.org_id
     where m.user_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.org_members_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.name, 'email', u.email, 'role', m.role)
                     order by m.created_at)
      from public.org_members m
      join public.profiles p on p.id = m.user_id
      join auth.users u on u.id = m.user_id
     where m.org_id = p_org), '[]'::jsonb);
end $$;

create or replace function public.org_add_member(p_org uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if public.lc_org_require(p_org, false) <> 'owner' then
    raise exception 'Only an owner can add members' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'manager', 'viewer') then raise exception 'Bad role' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and p.role = 'buyer';
  if v_user is null then
    raise exception 'No CheckVertical buyer account uses that email. Ask them to sign up first.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.org_members where org_id = p_org) >= 50 then
    raise exception 'Member limit reached' using errcode = '54000';
  end if;
  insert into public.org_members (org_id, user_id, role) values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role;
end $$;

create or replace function public.org_remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.lc_org_require(p_org, false) <> 'owner' then
    raise exception 'Only an owner can remove members' using errcode = '42501';
  end if;
  if exists (select 1 from public.org_members where org_id = p_org and user_id = p_user and role = 'owner')
     and (select count(*) from public.org_members where org_id = p_org and role = 'owner') <= 1 then
    raise exception 'An organisation needs at least one owner' using errcode = '55000';
  end if;
  delete from public.org_members where org_id = p_org and user_id = p_user;
  if not found then raise exception 'No such member' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fleet register
-- ---------------------------------------------------------------------------
create or replace function public.org_upsert_vehicles(p_org uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_vin text; v_make text; v_model text; v_year integer; v_int integer; n integer := 0;
begin
  perform public.lc_org_require(p_org, true);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Send between 1 and 200 vehicles' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_items) loop
    v_vin := upper(regexp_replace(coalesce(r->>'vin', ''), '\s', '', 'g'));
    v_make := btrim(coalesce(r->>'make', ''));
    v_model := btrim(coalesce(r->>'model', ''));
    if v_vin !~ '^[A-Z0-9]{6,17}$' then raise exception 'Invalid VIN or registration: %', left(v_vin, 20) using errcode = '22023'; end if;
    if length(v_make) not between 1 and 60 or length(v_model) not between 1 and 60 then
      raise exception 'Make and model are required (%)', v_vin using errcode = '22023';
    end if;
    if coalesce(r->>'year', '') !~ '^\d{4}$' then raise exception 'Invalid year (%)', v_vin using errcode = '22023'; end if;
    v_year := (r->>'year')::integer;
    if v_year not between 1950 and extract(year from now())::integer + 1 then
      raise exception 'Invalid year (%)', v_vin using errcode = '22023';
    end if;
    if coalesce(r->>'interval_months', '') = '' then v_int := 6;
    elsif r->>'interval_months' ~ '^\d{1,2}$' then v_int := (r->>'interval_months')::integer;
    else raise exception 'Invalid inspection interval (%)', v_vin using errcode = '22023';
    end if;
    insert into public.vehicles (vin, make, model, year) values (v_vin, v_make, v_model, v_year)
    on conflict (vin) do nothing;
    insert into public.fleet_vehicles (org_id, vin, make, model, year, department, cost_centre, interval_months)
    values (p_org, v_vin, v_make, v_model, v_year,
            nullif(btrim(coalesce(r->>'department', '')), ''), nullif(btrim(coalesce(r->>'cost_centre', '')), ''), v_int)
    on conflict (org_id, vin) do update
      set make = excluded.make, model = excluded.model, year = excluded.year, department = excluded.department,
          cost_centre = excluded.cost_centre, interval_months = excluded.interval_months, active = true;
    n := n + 1;
  end loop;
  if (select count(*) from public.fleet_vehicles where org_id = p_org and active) > 500 then
    raise exception 'A fleet can hold up to 500 vehicles' using errcode = '54000';
  end if;
  return n;
end $$;

create or replace function public.org_remove_vehicle(p_org uuid, p_vehicle uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, true);
  if exists (select 1 from public.bookings where fleet_vehicle_id = p_vehicle and org_id = p_org
                and status not in ('done', 'cancelled')) then
    raise exception 'This vehicle has an inspection in progress' using errcode = '55000';
  end if;
  update public.fleet_vehicles set active = false where id = p_vehicle and org_id = p_org;
  if not found then raise exception 'No such vehicle' using errcode = 'P0002'; end if;
end $$;

create or replace function public.org_vehicles(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, false);
  return coalesce((
    with last as (
      select distinct on (b.fleet_vehicle_id)
             b.fleet_vehicle_id fv, i.id insp_id, i.score, i.roadworthy_status rw,
             coalesce(i.submitted_at, i.created_at) at_
        from public.bookings b join public.inspections i on i.booking_id = b.id
       where b.org_id = p_org and b.fleet_vehicle_id is not null and i.taken_down_at is null
       order by b.fleet_vehicle_id, coalesce(i.submitted_at, i.created_at) desc),
    openb as (
      select distinct fleet_vehicle_id fv from public.bookings
       where org_id = p_org and fleet_vehicle_id is not null and status not in ('done', 'cancelled'))
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'vin', f.vin, 'make', f.make, 'model', f.model, 'year', f.year,
             'department', f.department, 'cost_centre', f.cost_centre, 'interval_months', f.interval_months,
             'last_inspected_at', l.at_, 'last_score', l.score, 'roadworthy', l.rw, 'inspection_id', l.insp_id,
             'next_due', case when l.at_ is null then null else l.at_ + make_interval(months => f.interval_months) end,
             'status', case
                         when l.at_ is null then 'never'
                         when l.at_ + make_interval(months => f.interval_months) < now() then 'overdue'
                         when l.at_ + make_interval(months => f.interval_months) < now() + interval '30 days' then 'due_soon'
                         else 'ok' end,
             'open_booking', o.fv is not null)
           order by f.make, f.model, f.vin)
      from public.fleet_vehicles f
      left join last l on l.fv = f.id
      left join openb o on o.fv = f.id
     where f.org_id = p_org and f.active), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Dedicated fleet inspectors + bulk booking
-- ---------------------------------------------------------------------------
create or replace function public.org_fleet_inspectors(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'first_name', p.first_name, 'rating', p.rating,
             'jobs_completed', p.jobs_completed, 'price', p.price, 'eta_minutes', p.eta_minutes,
             'online', p.online, 'region', p.region)
           order by p.online desc, p.rating desc, p.jobs_completed desc)
      from public.profiles p
     where p.role = 'inspector' and p.approved and p.fleet_approved and coalesce(p.price, 0) > 0
       and p.rating >= (select fleet_min_rating from public.lc_settings where id = 1)), '[]'::jsonb);
end $$;

create or replace function public.create_fleet_bookings(
  p_org uuid, p_vehicle_ids uuid[], p_inspector_id uuid, p_location text, p_notes text, p_po_number text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_org     public.organisations%rowtype;
  v_insp    public.profiles%rowtype;
  v_ids     uuid[];
  v_vid     uuid;
  v_fv      public.fleet_vehicles%rowtype;
  v_n       integer;
  v_travel  integer;
  v_platform integer := public.lc_platform_fee();
  v_total   integer := 0;
  v_amount  integer;
  v_first   boolean := true;
  v_out     uuid[] := '{}';
  v_b       public.bookings%rowtype;
  v_invoice boolean;
  v_outstanding integer;
  v_po      text := nullif(btrim(coalesce(p_po_number, '')), '');
begin
  perform public.lc_org_require(p_org, true, true);
  select * into v_org from public.organisations where id = p_org for update;   -- serialises the credit check
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_vehicle_ids, '{}'::uuid[])) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n not between 1 and 50 then raise exception 'Choose between 1 and 50 vehicles' using errcode = '22023'; end if;
  if p_location is null or length(btrim(p_location)) not between 3 and 300 then
    raise exception 'Enter the inspection location' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then raise exception 'Notes are too long' using errcode = '22023'; end if;
  if v_po is not null and length(v_po) > 60 then raise exception 'PO number is too long' using errcode = '22023'; end if;

  select * into v_insp from public.profiles
   where id = p_inspector_id and role = 'inspector' and approved and fleet_approved and online
     and coalesce(price, 0) > 0
     and rating >= (select fleet_min_rating from public.lc_settings where id = 1);
  if not found then raise exception 'That inspector is not available for fleet work right now' using errcode = 'P0002'; end if;

  v_invoice := v_org.payment_mode = 'invoice';
  v_travel := public.lc_travel_fee();
  v_total := v_n * (v_insp.price + v_platform) + v_travel;
  if v_invoice then
    select coalesce(sum(amount_due), 0) into v_outstanding from public.bookings
     where org_id = p_org and payment_status = 'invoiced' and status <> 'cancelled';
    if v_outstanding + v_total > v_org.credit_limit then
      raise exception 'This would exceed your credit limit of R%. Outstanding: R%.', v_org.credit_limit, v_outstanding
        using errcode = '54000';
    end if;
  end if;

  foreach v_vid in array v_ids loop
    select * into v_fv from public.fleet_vehicles where id = v_vid and org_id = p_org and active;
    if not found then raise exception 'A selected vehicle is not in this fleet' using errcode = 'P0002'; end if;
    if exists (select 1 from public.bookings where fleet_vehicle_id = v_fv.id and status not in ('done', 'cancelled')) then
      raise exception '% already has an inspection in progress', v_fv.vin using errcode = '55000';
    end if;
    v_amount := v_insp.price + v_platform + case when v_first then v_travel else 0 end;
    insert into public.bookings (buyer_id, inspector_id, vin, location, notes, status, inspection_fee, travel_fee,
                                 platform_fee, amount_due, paid, payment_status, paid_at,
                                 org_id, fleet_vehicle_id, po_number, cost_centre)
    values (v_uid, v_insp.id, v_fv.vin, btrim(p_location), nullif(btrim(coalesce(p_notes, '')), ''), 'pending',
            v_insp.price, case when v_first then v_travel else 0 end, v_platform, v_amount,
            v_invoice, case when v_invoice then 'invoiced' else 'unpaid' end,
            case when v_invoice then now() else null end,
            p_org, v_fv.id, v_po, v_fv.cost_centre)
    returning * into v_b;
    v_out := v_out || v_b.id;
    v_first := false;
  end loop;

  if v_invoice then
    insert into public.notifications (user_id, type, icon, title, body)
    values (v_insp.id, 'sys', '🚗', 'New fleet inspection request',
            v_n || ' vehicle' || case when v_n = 1 then '' else 's' end || ' for ' || v_org.name || ' at ' || btrim(p_location) || '.');
  end if;
  return jsonb_build_object('booking_ids', to_jsonb(v_out), 'count', v_n, 'total', v_total,
                            'payment_mode', v_org.payment_mode);
end $$;

create or replace function public.org_cancel_booking(p_org uuid, p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, true);
  update public.bookings
     set status = 'cancelled', cancel_reason = 'cancelled_by_buyer',
         payment_status = case when payment_status in ('paid', 'legacy_unverified') then 'refund_due' else payment_status end
   where id = p_booking and org_id = p_org and status = 'pending';
  if not found then
    raise exception 'Only a booking that has not been accepted yet can be cancelled' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.org_bookings(p_org uuid, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, false);
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc) from (
      select b.created_at,
             jsonb_build_object(
               'id', b.id, 'created_at', b.created_at, 'status', b.status, 'payment_status', b.payment_status,
               'amount_due', b.amount_due, 'po_number', b.po_number, 'cost_centre', b.cost_centre, 'vin', b.vin,
               'make', f.make, 'model', f.model, 'location', b.location,
               'inspector_name', (select p.name from public.profiles p where p.id = b.inspector_id),
               'inspection_id', (select i.id from public.inspections i where i.booking_id = b.id and i.taken_down_at is null limit 1),
               'score', (select i.score from public.inspections i where i.booking_id = b.id and i.taken_down_at is null limit 1),
               'invoice_number', (select v.number from public.invoices v where v.id = b.invoice_id)) j
        from public.bookings b left join public.fleet_vehicles f on f.id = b.fleet_vehicle_id
       where b.org_id = p_org
       order by b.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))) x), '[]'::jsonb);
end $$;

create or replace function public.org_invoices(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'number', v.number, 'status', v.status, 'period_from', v.period_from, 'period_to', v.period_to,
             'total', v.total, 'issued_at', v.issued_at, 'due_at', v.due_at, 'paid_at', v.paid_at,
             'jobs', (select count(*) from public.bookings b where b.invoice_id = v.id)) order by v.issued_at desc)
      from public.invoices v where v.org_id = p_org), '[]'::jsonb);
end $$;

create or replace function public.org_invoice_lines(p_org uuid, p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_org_require(p_org, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'booking_id', b.id, 'date', b.completed_at, 'vin', b.vin, 'make', f.make, 'model', f.model,
             'po_number', b.po_number, 'cost_centre', b.cost_centre, 'amount', b.amount_due) order by b.completed_at)
      from public.bookings b left join public.fleet_vehicles f on f.id = b.fleet_vehicle_id
     where b.org_id = p_org and b.invoice_id = p_invoice), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Operator side
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_orgs(p_status text default 'all') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'pending', 'approved', 'suspended') then
    raise exception 'Bad status filter' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'name', o.name, 'kind', o.kind, 'status', o.status, 'payment_mode', o.payment_mode,
             'wants_invoice', o.wants_invoice, 'credit_limit', o.credit_limit, 'reg_number', o.reg_number,
             'vat_number', o.vat_number, 'contact_name', o.contact_name, 'contact_phone', o.contact_phone,
             'billing_email', o.billing_email, 'billing_address', o.billing_address, 'review_note', o.review_note,
             'created_at', o.created_at,
             'owner_email', (select u.email from auth.users u where u.id = o.created_by),
             'vehicles', (select count(*) from public.fleet_vehicles f where f.org_id = o.id and f.active),
             'outstanding', (select coalesce(sum(b.amount_due), 0) from public.bookings b
                              where b.org_id = o.id and b.payment_status = 'invoiced' and b.status <> 'cancelled'))
           order by (o.status = 'pending') desc, o.created_at desc)
      from public.organisations o where p_status = 'all' or o.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_review_org(
  p_org uuid, p_approve boolean, p_payment_mode text default 'card', p_credit_limit integer default 20000,
  p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_o public.organisations%rowtype;
begin
  perform public.lc_require_admin(true);
  if p_approve is null then raise exception 'approve is required' using errcode = '22023'; end if;
  select * into v_o from public.organisations where id = p_org for update;
  if not found then raise exception 'No such organisation' using errcode = 'P0002'; end if;
  if p_approve then
    if p_payment_mode not in ('card', 'invoice') then raise exception 'Choose card or invoice' using errcode = '22023'; end if;
    if p_credit_limit is null or p_credit_limit not between 0 and 1000000 then
      raise exception 'Credit limit must be between R0 and R1,000,000' using errcode = '22023';
    end if;
    update public.organisations
       set status = 'approved', payment_mode = p_payment_mode, credit_limit = p_credit_limit,
           review_note = nullif(trim(coalesce(p_reason, '')), ''), approved_at = coalesce(approved_at, now())
     where id = p_org;
  else
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception 'A reason is required when suspending or declining' using errcode = '22023';
    end if;
    update public.organisations set status = 'suspended', review_note = trim(p_reason) where id = p_org;
  end if;
  insert into public.notifications (user_id, type, icon, title, body)
  select m.user_id, 'sys', case when p_approve then '✅' else '⚠️' end,
         case when p_approve then 'Fleet account approved' else 'Fleet account not active' end,
         case when p_approve then v_o.name || ' can now book fleet inspections.'
              else v_o.name || ' is not active: ' || trim(p_reason) end
    from public.org_members m where m.org_id = p_org and m.role = 'owner';
  perform public.lc_audit(case when p_approve then 'org_approved' else 'org_suspended' end, 'organisation', p_org::text,
                          jsonb_build_object('payment_mode', p_payment_mode, 'credit_limit', p_credit_limit, 'reason', p_reason));
end $$;

create or replace function public.admin_set_fleet_inspector(p_inspector uuid, p_value boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_value is null then raise exception 'value is required' using errcode = '22023'; end if;
  update public.profiles set fleet_approved = p_value
   where id = p_inspector and role = 'inspector' and (not p_value or approved);
  if not found then raise exception 'No such approved inspector' using errcode = 'P0002'; end if;
  perform public.lc_audit(case when p_value then 'fleet_inspector_on' else 'fleet_inspector_off' end, 'profile',
                          p_inspector::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_set_fleet_min_rating(p_value numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_value is null or p_value not between 0 and 5 then raise exception 'Rating must be between 0 and 5' using errcode = '22023'; end if;
  update public.lc_settings set fleet_min_rating = p_value, updated_at = now() where id = 1;
  perform public.lc_audit('fleet_min_rating', 'settings', '1', jsonb_build_object('value', p_value, 'reason', p_reason));
end $$;

create or replace function public.admin_list_fleet_inspectors() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return jsonb_build_object(
    'min_rating', (select fleet_min_rating from public.lc_settings where id = 1),
    'inspectors', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'rating', p.rating,
                                          'jobs_completed', p.jobs_completed, 'price', p.price,
                                          'fleet_approved', p.fleet_approved) order by p.fleet_approved desc, p.rating desc)
        from public.profiles p where p.role = 'inspector' and p.approved), '[]'::jsonb));
end $$;

create or replace function public.admin_generate_invoice(p_org uuid, p_from date, p_to date, p_due_days integer default 30)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_total integer; v_n integer;
begin
  perform public.lc_require_admin(true);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid period' using errcode = '22023'; end if;
  if p_due_days is null or p_due_days not between 0 and 120 then raise exception 'Due days must be 0 to 120' using errcode = '22023'; end if;
  perform 1 from public.organisations where id = p_org for update;
  if not found then raise exception 'No such organisation' using errcode = 'P0002'; end if;
  select count(*), coalesce(sum(amount_due), 0) into v_n, v_total from public.bookings
   where org_id = p_org and payment_status = 'invoiced' and status = 'done' and invoice_id is null
     and (completed_at at time zone 'Africa/Johannesburg')::date between p_from and p_to;
  if v_n = 0 then raise exception 'No finished, uninvoiced jobs in that period' using errcode = 'P0002'; end if;
  insert into public.invoices (org_id, number, period_from, period_to, total, due_at, created_by)
  values (p_org,
          'CV-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYYMM') || '-' || lpad(nextval('public.invoice_seq')::text, 4, '0'),
          p_from, p_to, v_total, now() + make_interval(days => p_due_days), auth.uid())
  returning id into v_id;
  update public.bookings set invoice_id = v_id
   where org_id = p_org and payment_status = 'invoiced' and status = 'done' and invoice_id is null
     and (completed_at at time zone 'Africa/Johannesburg')::date between p_from and p_to;
  perform public.lc_audit('invoice_issued', 'invoice', v_id::text, jsonb_build_object('org', p_org, 'jobs', v_n, 'total', v_total));
  return v_id;
end $$;

create or replace function public.admin_list_invoices(p_status text default 'all') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'issued', 'paid', 'void') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'number', v.number, 'org_id', v.org_id, 'org_name', o.name, 'billing_email', o.billing_email,
             'status', v.status, 'period_from', v.period_from, 'period_to', v.period_to, 'total', v.total,
             'issued_at', v.issued_at, 'due_at', v.due_at, 'paid_at', v.paid_at, 'payment_reference', v.payment_reference,
             'overdue', v.status = 'issued' and v.due_at < now(),
             'jobs', (select count(*) from public.bookings b where b.invoice_id = v.id)) order by v.issued_at desc)
      from public.invoices v join public.organisations o on o.id = v.org_id
     where p_status = 'all' or v.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_mark_invoice_paid(p_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.invoices%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reference, '')), '') is null then raise exception 'The payment reference is required' using errcode = '22023'; end if;
  select * into v from public.invoices where id = p_id for update;
  if not found then raise exception 'No such invoice' using errcode = 'P0002'; end if;
  if v.status <> 'issued' then raise exception 'Only an issued invoice can be marked paid' using errcode = '55000'; end if;
  update public.invoices set status = 'paid', paid_at = now(), payment_reference = trim(p_reference) where id = p_id;
  update public.bookings set payment_status = 'paid' where invoice_id = p_id and payment_status = 'invoiced';
  insert into public.notifications (user_id, type, icon, title, body)
  select m.user_id, 'sys', '🧾', 'Invoice paid', 'Invoice ' || v.number || ' was marked paid. Thank you.'
    from public.org_members m where m.org_id = v.org_id and m.role = 'owner';
  perform public.lc_audit('invoice_paid', 'invoice', p_id::text, jsonb_build_object('reference', trim(p_reference)));
end $$;

create or replace function public.admin_void_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.invoices%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into v from public.invoices where id = p_id for update;
  if not found then raise exception 'No such invoice' using errcode = 'P0002'; end if;
  if v.status <> 'issued' then raise exception 'Only an issued invoice can be voided' using errcode = '55000'; end if;
  update public.invoices set status = 'void', void_reason = trim(p_reason) where id = p_id;
  update public.bookings set invoice_id = null where invoice_id = p_id;   -- the jobs can be invoiced again
  perform public.lc_audit('invoice_void', 'invoice', p_id::text, jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only. Each function checks membership or operator role itself.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'register_organisation(text,text,text,text,text,text,text,text,boolean)',
    'my_organisations()', 'org_members_list(uuid)', 'org_add_member(uuid,text,text)', 'org_remove_member(uuid,uuid)',
    'org_upsert_vehicles(uuid,jsonb)', 'org_remove_vehicle(uuid,uuid)', 'org_vehicles(uuid)',
    'org_fleet_inspectors(uuid)', 'create_fleet_bookings(uuid,uuid[],uuid,text,text,text)',
    'org_cancel_booking(uuid,uuid)', 'org_bookings(uuid,integer)', 'org_invoices(uuid)', 'org_invoice_lines(uuid,uuid)',
    'admin_list_orgs(text)', 'admin_review_org(uuid,boolean,text,integer,text)',
    'admin_set_fleet_inspector(uuid,boolean,text)', 'admin_set_fleet_min_rating(numeric,text)',
    'admin_list_fleet_inspectors()', 'admin_generate_invoice(uuid,date,date,integer)', 'admin_list_invoices(text)',
    'admin_mark_invoice_paid(uuid,text)', 'admin_void_invoice(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.lc_mark_private_fleet_report() from public, anon, authenticated;
