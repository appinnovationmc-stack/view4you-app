-- CheckVertical 20261014000100 — auction / dealership bookings, inspector credentials, testing stations (forward-only).
--
-- 1. Bookings can be at a private address, a dealership or an AUCTION. Auction bookings carry the auction time and
--    lot number, and the deadline by which the buyer needs the report (default: the auction start) so the buyer can
--    decide whether to bid. Inspectors see the same details on their job.
-- 2. Inspector credentials reuse inspector_documents + the existing admin review: Examiner of Vehicles (grade A/B/C),
--    motor-trade certificate. An approved, unexpired credential becomes a BADGE (the document number is never exposed).
-- 3. Testing stations: a directory of registered vehicle testing stations managed by operators. A buyer may add an
--    official roadworthy test at a chosen station. The STATION issues the certificate and is paid at the station;
--    CheckVertical charges only an optional add-on fee (lc_settings.roadworthy_addon_fee, default 0 = free).
--    The certificate is attached to the booking, reviewed by an operator, and shown on the report separately from
--    CheckVertical's own roadworthy result.
--
-- Nothing is deleted. create_booking gains optional trailing parameters, so existing 7-argument calls keep working.

-- ---------------------------------------------------------------------------
-- Settings: optional add-on fee
-- ---------------------------------------------------------------------------
alter table public.lc_settings
  add column if not exists roadworthy_addon_fee integer not null default 0
    check (roadworthy_addon_fee between 0 and 5000);

create or replace function public.lc_roadworthy_fee() returns integer
language sql stable security definer set search_path = '' as $$
  select roadworthy_addon_fee from public.lc_settings where id = 1
$$;
revoke all on function public.lc_roadworthy_fee() from public, anon;
grant execute on function public.lc_roadworthy_fee() to authenticated, service_role;

-- What a buyer needs to know before booking: the fees the server will charge, so the screen never guesses.
create or replace function public.booking_options() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('roadworthy_addon_fee', public.lc_roadworthy_fee(),
                            'travel_fee', public.lc_travel_fee(), 'platform_fee', public.lc_platform_fee());
end $$;

create or replace function public.admin_get_addon_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return jsonb_build_object('roadworthy_addon_fee', public.lc_roadworthy_fee());
end $$;

create or replace function public.admin_set_roadworthy_fee(p_fee integer, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old integer;
begin
  perform public.lc_require_admin(true);
  if p_fee is null or p_fee not between 0 and 5000 then raise exception 'Fee must be between R0 and R5000' using errcode = '22023'; end if;
  select roadworthy_addon_fee into v_old from public.lc_settings where id = 1 for update;
  update public.lc_settings set roadworthy_addon_fee = p_fee, updated_at = now() where id = 1;
  perform public.lc_audit('roadworthy_fee_changed', 'settings', '1', jsonb_build_object('before', v_old, 'after', p_fee, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Testing stations (operator managed; buyers read active ones through a function)
-- ---------------------------------------------------------------------------
create table if not exists public.testing_stations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 2 and 120),
  address             text not null check (length(btrim(address)) between 3 and 300),
  city                text check (city is null or length(city) <= 80),
  province            text check (province is null or length(province) <= 60),
  phone               text check (phone is null or length(phone) <= 40),
  grade               text not null check (grade in ('A', 'B', 'C')),
  registration_number text not null check (length(btrim(registration_number)) between 2 and 60),
  hours               text check (hours is null or length(hours) <= 200),
  test_fee            integer not null default 0 check (test_fee between 0 and 5000),
  vehicle_classes     text check (vehicle_classes is null or length(vehicle_classes) <= 200),
  lat                 numeric(9, 6) check (lat is null or lat between -90 and 90),
  lng                 numeric(9, 6) check (lng is null or lng between -180 and 180),
  active              boolean not null default false,
  verified_at         timestamptz,
  verified_by         uuid,
  created_at          timestamptz not null default now()
);
alter table public.testing_stations enable row level security;   -- no policies: reached only through the functions below
revoke all on public.testing_stations from anon, authenticated;

create or replace function public.list_testing_stations()
returns table (id uuid, name text, address text, city text, province text, phone text, grade text,
               registration_number text, hours text, test_fee integer, vehicle_classes text, lat numeric, lng numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query
    select s.id, s.name, s.address, s.city, s.province, s.phone, s.grade, s.registration_number, s.hours,
           s.test_fee, s.vehicle_classes, s.lat, s.lng
      from public.testing_stations s where s.active
     order by s.province nulls last, s.city nulls last, s.name;
end $$;

create or replace function public.admin_list_stations()
returns table (id uuid, name text, address text, city text, province text, phone text, grade text,
               registration_number text, hours text, test_fee integer, vehicle_classes text, lat numeric, lng numeric,
               active boolean, verified_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query
    select s.id, s.name, s.address, s.city, s.province, s.phone, s.grade, s.registration_number, s.hours, s.test_fee,
           s.vehicle_classes, s.lat, s.lng, s.active, s.verified_at, s.created_at
      from public.testing_stations s order by s.active desc, s.name;
end $$;

-- p_id null creates a new (inactive) station; otherwise edits it. A station only becomes visible once an operator
-- has checked its registration and activated it.
create or replace function public.admin_save_station(
  p_id uuid, p_name text, p_address text, p_city text, p_province text, p_phone text, p_grade text,
  p_registration text, p_hours text, p_fee integer, p_classes text, p_lat numeric, p_lng numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.lc_require_admin(true);
  if p_name is null or length(btrim(p_name)) not between 2 and 120 then raise exception 'Enter the station name' using errcode = '22023'; end if;
  if p_address is null or length(btrim(p_address)) not between 3 and 300 then raise exception 'Enter the station address' using errcode = '22023'; end if;
  if p_grade is null or p_grade not in ('A', 'B', 'C') then raise exception 'Grade must be A, B or C' using errcode = '22023'; end if;
  if p_registration is null or length(btrim(p_registration)) not between 2 and 60 then raise exception 'Enter the registration number' using errcode = '22023'; end if;
  if p_fee is null or p_fee not between 0 and 5000 then raise exception 'Test fee must be between R0 and R5000' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.testing_stations (name, address, city, province, phone, grade, registration_number, hours, test_fee, vehicle_classes, lat, lng)
    values (btrim(p_name), btrim(p_address), nullif(btrim(coalesce(p_city, '')), ''), nullif(btrim(coalesce(p_province, '')), ''),
            nullif(btrim(coalesce(p_phone, '')), ''), p_grade, btrim(p_registration), nullif(btrim(coalesce(p_hours, '')), ''),
            p_fee, nullif(btrim(coalesce(p_classes, '')), ''), p_lat, p_lng)
    returning id into v_id;
  else
    update public.testing_stations
       set name = btrim(p_name), address = btrim(p_address), city = nullif(btrim(coalesce(p_city, '')), ''),
           province = nullif(btrim(coalesce(p_province, '')), ''), phone = nullif(btrim(coalesce(p_phone, '')), ''),
           grade = p_grade, registration_number = btrim(p_registration), hours = nullif(btrim(coalesce(p_hours, '')), ''),
           test_fee = p_fee, vehicle_classes = nullif(btrim(coalesce(p_classes, '')), ''), lat = p_lat, lng = p_lng
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'No such station' using errcode = 'P0002'; end if;
  end if;
  perform public.lc_audit('station_saved', 'station', v_id::text, jsonb_build_object('name', p_name, 'grade', p_grade, 'registration', p_registration));
  return v_id;
end $$;

create or replace function public.admin_set_station_active(p_id uuid, p_active boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_active is null then raise exception 'active is required' using errcode = '22023'; end if;
  update public.testing_stations
     set active = p_active,
         verified_at = case when p_active then now() else verified_at end,
         verified_by = case when p_active then auth.uid() else verified_by end
   where id = p_id;
  if not found then raise exception 'No such station' using errcode = 'P0002'; end if;
  perform public.lc_audit(case when p_active then 'station_activated' else 'station_deactivated' end, 'station', p_id::text,
                          jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Bookings: venue, auction details, roadworthy add-on
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists venue_kind          text not null default 'private',
  add column if not exists venue_name          text,
  add column if not exists auction_at          timestamptz,
  add column if not exists lot_number          text,
  add column if not exists needed_by           timestamptz,
  add column if not exists addon_fee           integer not null default 0,
  add column if not exists roadworthy_requested boolean not null default false,
  add column if not exists station_id          uuid references public.testing_stations(id),
  add column if not exists station_fee_quote   integer;

alter table public.bookings drop constraint if exists bookings_venue_check;
alter table public.bookings add constraint bookings_venue_check check (
  venue_kind in ('private', 'dealership', 'auction')
  and (venue_kind = 'private' or (venue_name is not null and length(btrim(venue_name)) between 2 and 120))
  and (venue_kind <> 'auction' or auction_at is not null)
  and (lot_number is null or length(lot_number) <= 40)
  and addon_fee >= 0
  and (not roadworthy_requested or station_id is not null)
);
create index if not exists bookings_station on public.bookings (station_id) where station_id is not null;
create index if not exists bookings_auction_at on public.bookings (auction_at) where venue_kind = 'auction';

-- Replaces the 7-argument version. Trailing parameters are optional, so old callers are unaffected.
drop function if exists public.create_booking(text, text, text, integer, text, text, uuid);
create or replace function public.create_booking(
  p_vin text, p_make text, p_model text, p_year integer,
  p_location text, p_notes text, p_inspector_id uuid,
  p_venue_kind text default 'private', p_venue_name text default null, p_auction_at timestamptz default null,
  p_lot_number text default null, p_needed_by timestamptz default null, p_station_id uuid default null
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
  v_b       public.bookings%rowtype;
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
                               inspection_fee, travel_fee, platform_fee, addon_fee, amount_due, paid, payment_status,
                               venue_kind, venue_name, auction_at, lot_number, needed_by,
                               roadworthy_requested, station_id, station_fee_quote)
  values (v_uid, v_insp.id, v_vin, btrim(p_location), nullif(btrim(coalesce(p_notes, '')), ''), 'pending',
          v_insp.price, public.lc_travel_fee(), public.lc_platform_fee(), v_addon,
          v_insp.price + public.lc_travel_fee() + public.lc_platform_fee() + v_addon, false, 'unpaid',
          v_kind, v_venue, case when v_kind = 'auction' then p_auction_at end, v_lot, v_needed,
          p_station_id is not null, p_station_id, case when p_station_id is not null then v_station.test_fee end)
  returning * into v_b;

  return v_b;
end $$;
revoke all on function public.create_booking(text, text, text, integer, text, text, uuid, text, text, timestamptz, text, timestamptz, uuid) from public, anon;
grant execute on function public.create_booking(text, text, text, integer, text, text, uuid, text, text, timestamptz, text, timestamptz, uuid) to authenticated, service_role;

-- Inspector jobs show the venue, auction time, deadline and station. Columns are appended (view is replaced, not dropped).
create or replace view public.inspector_jobs with (security_invoker = false) as
  select b.id, b.inspector_id, b.vin, b.location, b.notes, b.status, b.inspection_fee, b.travel_fee,
         b.platform_fee, b.paid, b.payment_status, b.created_at, b.accepted_at, b.completed_at,
         v.make, v.model, v.year, v.colour, p.first_name as buyer_first_name,
         b.venue_kind, b.venue_name, b.auction_at, b.lot_number, b.needed_by,
         b.roadworthy_requested, s.name as station_name
    from public.bookings b
    join public.vehicles v on v.vin = b.vin
    left join public.profiles p on p.id = b.buyer_id
    left join public.testing_stations s on s.id = b.station_id
   where b.inspector_id = (select auth.uid()) and b.paid;

-- ---------------------------------------------------------------------------
-- Inspector credentials (extends inspector_documents; same upload, same operator review)
-- ---------------------------------------------------------------------------
alter table public.inspector_documents drop constraint if exists inspector_documents_kind_check;
alter table public.inspector_documents add constraint inspector_documents_kind_check
  check (kind in ('id', 'licence', 'proof_of_address', 'other', 'eov', 'trade_certificate'));
alter table public.inspector_documents
  add column if not exists credential_number text check (credential_number is null or length(credential_number) <= 60),
  add column if not exists credential_grade  text check (credential_grade is null or credential_grade in ('A', 'B', 'C')),
  add column if not exists expires_on        date;

-- Upload first to inspector-docs/<user id>/<anything>, then call this.
create or replace function public.register_my_credential(
  p_kind text, p_path text, p_file_name text, p_number text, p_grade text default null, p_expires_on date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'inspector') then
    raise exception 'Only inspectors add credentials' using errcode = '42501';
  end if;
  if p_kind not in ('eov', 'trade_certificate') then raise exception 'Unknown credential type' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_number, '')), '') is null or length(btrim(p_number)) > 60 then
    raise exception 'Enter the registration or certificate number' using errcode = '22023';
  end if;
  if p_kind = 'eov' and (p_grade is null or p_grade not in ('A', 'B', 'C')) then
    raise exception 'Choose your Examiner of Vehicles grade (A, B or C)' using errcode = '22023';
  end if;
  if p_kind <> 'eov' then p_grade := null; end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'That credential has already expired' using errcode = '22023';
  end if;
  if p_path is null or position((v_uid::text || '/') in p_path) <> 1 or p_path ~ '\.\.' or length(p_path) > 300 then
    raise exception 'Bad file path' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_file_name, '')), '') is null then raise exception 'File name is required' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'inspector-docs' and o.name = p_path) then
    raise exception 'The file was not uploaded' using errcode = '22023';
  end if;
  if (select count(*) from public.inspector_documents where user_id = v_uid) >= 12 then
    raise exception 'You have uploaded the maximum number of documents' using errcode = '54000';
  end if;
  insert into public.inspector_documents (user_id, kind, storage_path, file_name, credential_number, credential_grade, expires_on)
  values (v_uid, p_kind, p_path, left(btrim(p_file_name), 200), btrim(p_number), p_grade, p_expires_on)
  returning id into v_id;
  return v_id;
end $$;

-- Operators also see number, grade and expiry (return type changed, so drop and recreate).
drop function if exists public.admin_list_documents(uuid);
create function public.admin_list_documents(p_user uuid)
returns table (id uuid, kind text, file_name text, storage_path text, status text, reject_reason text,
               reviewed_at timestamptz, created_at timestamptz, credential_number text, credential_grade text, expires_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query select d.id, d.kind, d.file_name, d.storage_path, d.status, d.reject_reason, d.reviewed_at, d.created_at,
                      d.credential_number, d.credential_grade, d.expires_on
                 from public.inspector_documents d where d.user_id = p_user order by d.created_at desc;
end $$;
revoke all on function public.admin_list_documents(uuid) from public, anon;
grant execute on function public.admin_list_documents(uuid) to authenticated, service_role;

-- The inspector's own list, with credential details (own data only).
create or replace function public.my_credentials()
returns table (id uuid, kind text, file_name text, status text, reject_reason text, credential_number text,
               credential_grade text, expires_on date, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query select d.id, d.kind, d.file_name, d.status, d.reject_reason, d.credential_number, d.credential_grade, d.expires_on, d.created_at
                 from public.inspector_documents d
                where d.user_id = auth.uid() and d.kind in ('eov', 'trade_certificate') order by d.created_at desc;
end $$;

-- Public badges: only approved, unexpired credentials, never the number. Best EOV grade wins.
create or replace function public.lc_inspector_badges(p_inspector uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(b order by o), '[]'::jsonb) from (
    select 1 as o, jsonb_build_object('kind', 'identity_verified') as b
     where exists (select 1 from public.inspector_documents d where d.user_id = p_inspector and d.kind = 'id' and d.status = 'approved')
    union all
    select 2, jsonb_build_object('kind', 'eov', 'grade', (
             select min(d.credential_grade) from public.inspector_documents d
              where d.user_id = p_inspector and d.kind = 'eov' and d.status = 'approved'
                and (d.expires_on is null or d.expires_on >= current_date)))
     where exists (select 1 from public.inspector_documents d where d.user_id = p_inspector and d.kind = 'eov' and d.status = 'approved'
                      and (d.expires_on is null or d.expires_on >= current_date))
    union all
    select 3, jsonb_build_object('kind', 'trade_qualified')
     where exists (select 1 from public.inspector_documents d where d.user_id = p_inspector and d.kind = 'trade_certificate'
                      and d.status = 'approved' and (d.expires_on is null or d.expires_on >= current_date))
  ) t(o, b)
$$;
revoke all on function public.lc_inspector_badges(uuid) from public, anon;
grant execute on function public.lc_inspector_badges(uuid) to authenticated, service_role;

-- Directory gains a trailing badges column.
create or replace view public.inspector_directory with (security_invoker = false) as
  select id, name, first_name, init, cert, experience, region, specialty, bio,
         rating, jobs_completed, price, eta_minutes, online, top_rated,
         public.lc_inspector_badges(id) as badges
    from public.profiles
   where role = 'inspector' and approved;

-- ---------------------------------------------------------------------------
-- Official roadworthy certificates (issued by the testing station, attached to the booking)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('roadworthy-certs', 'roadworthy-certs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Folder = booking id. The booking's buyer and inspector may upload and read; operators read.
create or replace function public.lc_booking_party(p_booking text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b
                  where b.id::text = p_booking and (b.buyer_id = (select auth.uid()) or b.inspector_id = (select auth.uid())))
$$;
revoke all on function public.lc_booking_party(text) from public, anon;
grant execute on function public.lc_booking_party(text) to authenticated;

drop policy if exists "roadworthy certs read" on storage.objects;
create policy "roadworthy certs read" on storage.objects for select to authenticated
  using (bucket_id = 'roadworthy-certs' and (public.lc_booking_party((storage.foldername(name))[1]) or public.lc_is_operator()));
drop policy if exists "roadworthy certs upload" on storage.objects;
create policy "roadworthy certs upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'roadworthy-certs' and public.lc_booking_party((storage.foldername(name))[1]));

create table if not exists public.roadworthy_certificates (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null unique references public.bookings(id) on delete cascade,
  station_id         uuid references public.testing_stations(id),
  certificate_number text not null check (length(btrim(certificate_number)) between 2 and 60),
  result             text not null check (result in ('pass', 'fail')),
  issued_on          date not null,
  expires_on         date,
  storage_path       text not null unique,
  status             text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected')),
  reject_reason      text,
  submitted_by       uuid not null,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint roadworthy_dates check (expires_on is null or expires_on >= issued_on)
);
alter table public.roadworthy_certificates enable row level security;   -- no policies: functions only
revoke all on public.roadworthy_certificates from anon, authenticated;

-- Buyer or inspector of a paid booking that asked for the add-on attaches the station's certificate.
create or replace function public.submit_roadworthy_certificate(
  p_booking uuid, p_path text, p_number text, p_result text, p_issued_on date, p_expires_on date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); b public.bookings%rowtype; v_old public.roadworthy_certificates%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found or (b.buyer_id <> v_uid and b.inspector_id is distinct from v_uid) then
    raise exception 'No such booking' using errcode = 'P0002';
  end if;
  if not b.roadworthy_requested or not b.paid then
    raise exception 'This booking has no paid roadworthy add-on' using errcode = '55000';
  end if;
  if p_result not in ('pass', 'fail') then raise exception 'Result must be pass or fail' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_number, '')), '') is null or length(btrim(p_number)) > 60 then
    raise exception 'Enter the certificate number' using errcode = '22023';
  end if;
  if p_issued_on is null or p_issued_on > current_date then raise exception 'Enter the date the certificate was issued' using errcode = '22023'; end if;
  if p_expires_on is not null and p_expires_on < p_issued_on then raise exception 'Expiry is before the issue date' using errcode = '22023'; end if;
  if p_path is null or position((p_booking::text || '/') in p_path) <> 1 or p_path ~ '\.\.' or length(p_path) > 300 then
    raise exception 'Bad file path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'roadworthy-certs' and o.name = p_path) then
    raise exception 'The file was not uploaded' using errcode = '22023';
  end if;
  select * into v_old from public.roadworthy_certificates where booking_id = p_booking for update;
  if found and v_old.status = 'verified' then
    raise exception 'A verified certificate cannot be replaced' using errcode = '55000';
  end if;
  insert into public.roadworthy_certificates (booking_id, station_id, certificate_number, result, issued_on, expires_on, storage_path, submitted_by)
  values (p_booking, b.station_id, btrim(p_number), p_result, p_issued_on, p_expires_on, p_path, v_uid)
  on conflict (booking_id) do update
    set certificate_number = excluded.certificate_number, result = excluded.result, issued_on = excluded.issued_on,
        expires_on = excluded.expires_on, storage_path = excluded.storage_path, submitted_by = excluded.submitted_by,
        status = 'submitted', reject_reason = null, reviewed_by = null, reviewed_at = null, created_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.booking_certificate(p_booking uuid)
returns table (id uuid, certificate_number text, result text, issued_on date, expires_on date, storage_path text,
               status text, reject_reason text, station_name text, station_grade text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (public.lc_booking_party(p_booking::text) or public.lc_is_operator()) then
    raise exception 'No such booking' using errcode = 'P0002';
  end if;
  return query
    select c.id, c.certificate_number, c.result, c.issued_on, c.expires_on, c.storage_path, c.status, c.reject_reason, s.name, s.grade
      from public.roadworthy_certificates c left join public.testing_stations s on s.id = c.station_id
     where c.booking_id = p_booking;
end $$;

create or replace function public.admin_list_certificates(p_status text default 'submitted')
returns table (id uuid, booking_id uuid, vin text, station_name text, certificate_number text, result text,
               issued_on date, expires_on date, storage_path text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'submitted', 'verified', 'rejected') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select c.id, c.booking_id, b.vin, s.name, c.certificate_number, c.result, c.issued_on, c.expires_on, c.storage_path, c.status, c.created_at
      from public.roadworthy_certificates c
      join public.bookings b on b.id = c.booking_id
      left join public.testing_stations s on s.id = c.station_id
     where p_status = 'all' or c.status = p_status
     order by c.created_at desc;
end $$;

create or replace function public.admin_review_certificate(p_id uuid, p_verify boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.roadworthy_certificates%rowtype; v_buyer uuid; v_vin text;
begin
  perform public.lc_require_admin(true);
  if p_verify is null then raise exception 'verify is required' using errcode = '22023'; end if;
  if not p_verify and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when rejecting a certificate' using errcode = '22023';
  end if;
  select * into c from public.roadworthy_certificates where id = p_id for update;
  if not found then raise exception 'No such certificate' using errcode = 'P0002'; end if;
  update public.roadworthy_certificates
     set status = case when p_verify then 'verified' else 'rejected' end,
         reject_reason = case when p_verify then null else trim(p_reason) end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  select b.buyer_id, b.vin into v_buyer, v_vin from public.bookings b where b.id = c.booking_id;
  insert into public.notifications (user_id, type, icon, title, body)
  values (v_buyer, 'sys', case when p_verify then '✅' else '⚠️' end,
          case when p_verify then 'Roadworthy certificate verified' else 'Roadworthy certificate needs attention' end,
          case when p_verify then 'The roadworthy certificate for ' || v_vin || ' was verified and now shows on your report.'
               else 'The roadworthy certificate for ' || v_vin || ' was not accepted: ' || trim(p_reason) || '. Please upload it again.' end);
  perform public.lc_audit(case when p_verify then 'certificate_verified' else 'certificate_rejected' end, 'certificate', p_id::text,
                          jsonb_build_object('booking', c.booking_id, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- What a report reader may see: venue, inspector badges, and the station certificate (never the document or its path).
-- ---------------------------------------------------------------------------
create or replace function public.report_extras(p_inspection uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.inspections%rowtype; b public.bookings%rowtype; c record; v_rw jsonb := null;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not public.can_read_report(p_inspection) then raise exception 'No such report' using errcode = 'P0002'; end if;
  select * into i from public.inspections where id = p_inspection;
  if i.taken_down_at is not null then raise exception 'No such report' using errcode = 'P0002'; end if;
  select * into b from public.bookings where id = i.booking_id;
  select cc.certificate_number, cc.result, cc.issued_on, cc.expires_on, cc.status, s.name as station_name, s.grade as station_grade
    into c from public.roadworthy_certificates cc left join public.testing_stations s on s.id = cc.station_id
   where cc.booking_id = i.booking_id and cc.status in ('submitted', 'verified');
  if found then
    v_rw := jsonb_build_object('certificate_number', c.certificate_number, 'result', c.result, 'issued_on', c.issued_on,
                               'expires_on', c.expires_on, 'verified', c.status = 'verified',
                               'station_name', c.station_name, 'station_grade', c.station_grade);
  end if;
  return jsonb_build_object(
    'venue', jsonb_build_object('kind', b.venue_kind, 'name', b.venue_name, 'auction_at', b.auction_at, 'lot_number', b.lot_number),
    'inspector_badges', public.lc_inspector_badges(i.inspector_id),
    'roadworthy_certificate', v_rw);
end $$;

-- ---------------------------------------------------------------------------
-- Grants for everything new (functions are not callable by anon)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'booking_options()', 'list_testing_stations()', 'register_my_credential(text, text, text, text, text, date)',
    'my_credentials()', 'submit_roadworthy_certificate(uuid, text, text, text, date, date)', 'booking_certificate(uuid)',
    'report_extras(uuid)',
    'admin_get_addon_settings()', 'admin_set_roadworthy_fee(integer, text)', 'admin_list_stations()',
    'admin_save_station(uuid, text, text, text, text, text, text, text, text, integer, text, numeric, numeric)',
    'admin_set_station_active(uuid, boolean, text)', 'admin_list_certificates(text)', 'admin_review_certificate(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
