-- Real repair quotes per report: a buyer asks approved partner workshops to quote on the faults found in a report;
-- workshops reply with prices; the buyer compares and accepts one. All access goes through the functions below
-- (tables have RLS enabled and no policies). Payment + referral fee settle in a later step; the fee is recorded at acceptance.

alter table public.lc_settings
  add column if not exists repair_referral_bp integer not null default 800 check (repair_referral_bp between 0 and 3000),
  add column if not exists repair_quote_valid_days integer not null default 7 check (repair_quote_valid_days between 1 and 30);

create table if not exists public.workshop_details (
  workshop_id uuid primary key references public.profiles(id) on delete cascade,
  business_name text not null check (length(btrim(business_name)) between 2 and 120),
  address text check (address is null or length(address) <= 300),
  area text check (area is null or length(area) <= 120),
  services text check (services is null or length(services) <= 500),
  brands text check (brands is null or length(brands) <= 300),
  created_at timestamptz not null default now()
);

create table if not exists public.repair_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  vehicle_label text not null,
  issues jsonb not null check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) between 1 and 30),
  area text not null check (length(btrim(area)) between 2 and 120),
  note text check (note is null or length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'accepted', 'closed')),
  accepted_quote_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists repair_requests_buyer_idx on public.repair_requests (buyer_id, created_at desc);
create index if not exists repair_requests_open_idx on public.repair_requests (status, expires_at);
create index if not exists repair_requests_inspection_idx on public.repair_requests (inspection_id);

create table if not exists public.repair_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.repair_requests(id) on delete cascade,
  workshop_id uuid not null references public.profiles(id) on delete cascade,
  total integer not null check (total > 0 and total <= 500000),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 30),
  days integer not null default 1 check (days between 0 and 60),
  note text check (note is null or length(note) <= 500),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected', 'withdrawn')),
  valid_until timestamptz not null,
  referral_fee integer,
  workshop_payout integer,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refund_due')),
  created_at timestamptz not null default now(),
  unique (request_id, workshop_id)
);
create index if not exists repair_quotes_workshop_idx on public.repair_quotes (workshop_id, created_at desc);
alter table public.repair_requests
  add constraint repair_requests_accepted_quote_fk foreign key (accepted_quote_id) references public.repair_quotes(id) on delete set null;

alter table public.workshop_details enable row level security;
alter table public.repair_requests enable row level security;
alter table public.repair_quotes enable row level security;

-- helpers ------------------------------------------------------------------------------------------------
create or replace function public.rq_role() returns public.user_role
language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.rq_workshop_ok() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'workshop' and approved from public.profiles where id = auth.uid()), false) $$;

-- workshop profile ---------------------------------------------------------------------------------------
create or replace function public.save_my_workshop_details(p_business_name text, p_address text, p_area text, p_services text, p_brands text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.rq_role() is distinct from 'workshop' then raise exception 'Only workshops can do this' using errcode = '42501'; end if;
  insert into public.workshop_details (workshop_id, business_name, address, area, services, brands)
  values (auth.uid(), btrim(p_business_name), nullif(btrim(p_address), ''), nullif(btrim(p_area), ''), nullif(btrim(p_services), ''), nullif(btrim(p_brands), ''))
  on conflict (workshop_id) do update set business_name = excluded.business_name, address = excluded.address,
    area = excluded.area, services = excluded.services, brands = excluded.brands;
end $$;

create or replace function public.get_my_workshop_details() returns jsonb
language sql stable security definer set search_path = '' as
$$ select to_jsonb(w) from public.workshop_details w where w.workshop_id = auth.uid() $$;

-- buyer: ask for quotes ----------------------------------------------------------------------------------
create or replace function public.create_repair_request(p_inspection_id uuid, p_issues jsonb, p_area text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_insp public.inspections%rowtype; v_label text; v_clean jsonb; v_req public.repair_requests; v_days integer;
begin
  if public.rq_role() is distinct from 'buyer' then raise exception 'Only buyers can request quotes' using errcode = '42501'; end if;
  select * into v_insp from public.inspections where id = p_inspection_id;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if not (exists (select 1 from public.bookings b where b.id = v_insp.booking_id and b.buyer_id = v_uid)
       or exists (select 1 from public.report_purchases rp where rp.inspection_id = p_inspection_id and rp.buyer_id = v_uid)) then
    raise exception 'You can only request quotes for reports you own' using errcode = '42501';
  end if;
  if p_issues is null or jsonb_typeof(p_issues) <> 'array' or jsonb_array_length(p_issues) not between 1 and 30 then
    raise exception 'Choose at least one issue to get quotes for' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object(
           'key', left(coalesce(e->>'key', ''), 80), 'title', left(btrim(e->>'title'), 120),
           'state', left(coalesce(e->>'state', ''), 120), 'note', left(coalesce(e->>'note', ''), 300)))
    into v_clean from jsonb_array_elements(p_issues) e where length(btrim(coalesce(e->>'title', ''))) > 0;
  if v_clean is null then raise exception 'Choose at least one issue to get quotes for' using errcode = '22023'; end if;
  if p_area is null or length(btrim(p_area)) not between 2 and 120 then raise exception 'Enter your suburb or area' using errcode = '22023'; end if;
  if (select count(*) from public.repair_requests where buyer_id = v_uid and status = 'open' and expires_at > now()) >= 5 then
    raise exception 'You already have 5 open quote requests' using errcode = '54000';
  end if;
  select trim(coalesce(v.year::text, '') || ' ' || coalesce(v.make, '') || ' ' || coalesce(v.model, '')) into v_label from public.vehicles v where v.vin = v_insp.vin;
  select repair_quote_valid_days into v_days from public.lc_settings where id = 1;
  insert into public.repair_requests (buyer_id, inspection_id, vehicle_label, issues, area, note, expires_at)
  values (v_uid, p_inspection_id, coalesce(nullif(v_label, ''), 'Vehicle'), v_clean, btrim(p_area), nullif(left(btrim(coalesce(p_note, '')), 500), ''),
          now() + make_interval(days => coalesce(v_days, 7)))
  returning * into v_req;
  insert into public.notifications (user_id, type, icon, title, body)
  select p.id, 'sys', '🔧', 'New repair quote request', 'A buyer in ' || btrim(p_area) || ' needs a quote for ' || coalesce(nullif(v_label, ''), 'a vehicle') || '.'
    from public.profiles p where p.role = 'workshop' and p.approved;
  return to_jsonb(v_req);
end $$;

create or replace function public.list_my_repair_requests() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'inspection_id', r.inspection_id, 'vehicle_label', r.vehicle_label, 'issues', r.issues, 'area', r.area, 'note', r.note,
    'status', case when r.status = 'open' and r.expires_at <= now() then 'closed' else r.status end,
    'created_at', r.created_at, 'expires_at', r.expires_at, 'accepted_quote_id', r.accepted_quote_id,
    'quote_count', (select count(*) from public.repair_quotes q where q.request_id = r.id and q.status in ('submitted', 'accepted'))
  ) order by r.created_at desc), '[]'::jsonb)
  from public.repair_requests r where r.buyer_id = auth.uid() $$;

create or replace function public.list_repair_quotes(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.repair_requests where id = p_request_id and buyer_id = auth.uid()) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'total', q.total, 'lines', q.lines, 'days', q.days, 'note', q.note, 'status', q.status, 'valid_until', q.valid_until,
    'workshop', jsonb_build_object('name', coalesce(w.business_name, p.name), 'area', w.area, 'brands', w.brands, 'rating', p.rating, 'jobs', p.jobs_completed)
  ) order by q.total), '[]'::jsonb) into v_out
  from public.repair_quotes q join public.profiles p on p.id = q.workshop_id left join public.workshop_details w on w.workshop_id = q.workshop_id
  where q.request_id = p_request_id and q.status in ('submitted', 'accepted') and (q.status = 'accepted' or q.valid_until > now());
  return v_out;
end $$;

create or replace function public.accept_repair_quote(p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_q public.repair_quotes%rowtype; v_r public.repair_requests%rowtype; v_bp integer; v_fee integer;
begin
  select * into v_q from public.repair_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  select * into v_r from public.repair_requests where id = v_q.request_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if v_r.status <> 'open' then raise exception 'This request is no longer open' using errcode = '55000'; end if;
  if v_q.status <> 'submitted' or v_q.valid_until <= now() then raise exception 'This quote is no longer available' using errcode = '55000'; end if;
  select repair_referral_bp into v_bp from public.lc_settings where id = 1;
  v_fee := round(v_q.total * coalesce(v_bp, 800) / 10000.0)::integer;
  update public.repair_quotes set status = 'accepted', referral_fee = v_fee, workshop_payout = v_q.total - v_fee where id = v_q.id;
  update public.repair_quotes set status = 'rejected' where request_id = v_r.id and id <> v_q.id and status = 'submitted';
  update public.repair_requests set status = 'accepted', accepted_quote_id = v_q.id where id = v_r.id;
  insert into public.notifications (user_id, type, icon, title, body)
  select q.workshop_id, 'sys', case when q.id = v_q.id then '✅' else '🔔' end,
         case when q.id = v_q.id then 'Your quote was accepted' else 'Quote not selected' end,
         case when q.id = v_q.id then 'The buyer accepted your quote for ' || v_r.vehicle_label || '.' else 'The buyer chose another workshop for ' || v_r.vehicle_label || '.' end
    from public.repair_quotes q where q.request_id = v_r.id and q.status in ('accepted', 'rejected');
  return (select to_jsonb(q) from public.repair_quotes q where q.id = v_q.id);
end $$;

-- workshop: inbox + quoting -------------------------------------------------------------------------------
create or replace function public.list_open_repair_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not public.rq_workshop_ok() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'vehicle_label', r.vehicle_label, 'issues', r.issues, 'area', r.area, 'note', r.note,
    'created_at', r.created_at, 'expires_at', r.expires_at,
    'buyer_first_name', (select first_name from public.profiles where id = r.buyer_id),
    'my_quote', (select to_jsonb(q) from public.repair_quotes q where q.request_id = r.id and q.workshop_id = auth.uid())
  ) order by r.created_at desc), '[]'::jsonb) into v_out
  from public.repair_requests r where r.status = 'open' and r.expires_at > now();
  return v_out;
end $$;

create or replace function public.submit_repair_quote(p_request_id uuid, p_total integer, p_lines jsonb, p_days integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_r public.repair_requests%rowtype; v_q public.repair_quotes; v_days integer; v_lines jsonb;
begin
  if not public.rq_workshop_ok() then raise exception 'Your workshop account is not approved yet' using errcode = '42501'; end if;
  select * into v_r from public.repair_requests where id = p_request_id for share;
  if not found or v_r.status <> 'open' or v_r.expires_at <= now() then raise exception 'This request is no longer open' using errcode = '55000'; end if;
  if p_total is null or p_total <= 0 or p_total > 500000 then raise exception 'Enter a total between R1 and R500,000' using errcode = '22023'; end if;
  if p_days is null or p_days not between 0 and 60 then raise exception 'Enter the days needed (0 to 60)' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', left(coalesce(e->>'key', ''), 80), 'title', left(coalesce(e->>'title', ''), 120),
           'price', greatest(0, least(500000, coalesce((e->>'price')::integer, 0))))), '[]'::jsonb)
    into v_lines from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) e;
  select repair_quote_valid_days into v_days from public.lc_settings where id = 1;
  insert into public.repair_quotes (request_id, workshop_id, total, lines, days, note, valid_until)
  values (p_request_id, auth.uid(), p_total, v_lines, p_days, nullif(left(btrim(coalesce(p_note, '')), 500), ''),
          least(v_r.expires_at, now() + make_interval(days => coalesce(v_days, 7))))
  on conflict (request_id, workshop_id) do update set total = excluded.total, lines = excluded.lines, days = excluded.days,
    note = excluded.note, valid_until = excluded.valid_until, status = 'submitted'
    where public.repair_quotes.status in ('submitted', 'withdrawn')
  returning * into v_q;
  if v_q.id is null then raise exception 'This quote can no longer be changed' using errcode = '55000'; end if;
  insert into public.notifications (user_id, type, icon, title, body)
  values (v_r.buyer_id, 'sys', '💬', 'New repair quote', 'A workshop quoted R' || p_total || ' for your ' || v_r.vehicle_label || '.');
  return to_jsonb(v_q);
end $$;

create or replace function public.withdraw_repair_quote(p_quote_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.repair_quotes set status = 'withdrawn' where id = p_quote_id and workshop_id = auth.uid() and status = 'submitted';
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.list_my_repair_quotes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'request_id', q.request_id, 'vehicle_label', r.vehicle_label, 'area', r.area, 'issues', r.issues,
    'total', q.total, 'days', q.days, 'note', q.note, 'status', q.status, 'valid_until', q.valid_until,
    'workshop_payout', q.workshop_payout, 'payment_status', q.payment_status,
    'buyer_first_name', case when q.status = 'accepted' then (select first_name from public.profiles where id = r.buyer_id) end
  ) order by q.created_at desc), '[]'::jsonb)
  from public.repair_quotes q join public.repair_requests r on r.id = q.request_id where q.workshop_id = auth.uid() $$;

-- grants: signed-in users only, and each function checks the caller's role -----------------------------------
revoke all on function public.rq_role(), public.rq_workshop_ok(),
  public.save_my_workshop_details(text, text, text, text, text), public.get_my_workshop_details(),
  public.create_repair_request(uuid, jsonb, text, text), public.list_my_repair_requests(), public.list_repair_quotes(uuid),
  public.accept_repair_quote(uuid), public.list_open_repair_requests(), public.submit_repair_quote(uuid, integer, jsonb, integer, text),
  public.withdraw_repair_quote(uuid), public.list_my_repair_quotes() from public, anon;
grant execute on function public.rq_role(), public.rq_workshop_ok(),
  public.save_my_workshop_details(text, text, text, text, text), public.get_my_workshop_details(),
  public.create_repair_request(uuid, jsonb, text, text), public.list_my_repair_requests(), public.list_repair_quotes(uuid),
  public.accept_repair_quote(uuid), public.list_open_repair_requests(), public.submit_repair_quote(uuid, integer, jsonb, integer, text),
  public.withdraw_repair_quote(uuid), public.list_my_repair_quotes() to authenticated;
