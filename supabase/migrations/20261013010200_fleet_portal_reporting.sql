-- CheckVertical Fleet & Asset Portal — 20261013010200 reporting views, cost recovery, dashboard, document storage.
-- Every view and function here is SECURITY INVOKER: the caller's Row Level Security (role + unit scope) still applies,
-- so a site manager's report only ever contains their own sites.

-- ---------------------------------------------------------------------------
-- Statutory compliance: one list for vehicles and drivers, with a state
-- ---------------------------------------------------------------------------
create or replace view public.fleet_v_compliance with (security_invoker = true) as
select c.id, c.tenant_id, c.unit_id, c.vehicle_id, c.driver_id, c.kind, c.reference, c.issued_on, c.expires_on,
       c.reminder_days, c.document_path, c.notes,
       case when c.vehicle_id is not null then v.reg_number else d.full_name end as subject,
       case when c.vehicle_id is not null then 'vehicle' else 'driver' end as subject_type,
       (c.expires_on - current_date) as days_left,
       case when c.expires_on < current_date then 'expired'
            when c.expires_on <= current_date + c.reminder_days then 'due_soon'
            else 'valid' end as state
  from public.fleet_compliance c
  left join public.fleet_vehicles v on v.id = c.vehicle_id
  left join public.fleet_drivers d on d.id = c.driver_id;

-- ---------------------------------------------------------------------------
-- Maintenance due (by date and / or kilometres since last done)
-- ---------------------------------------------------------------------------
create or replace view public.fleet_v_maintenance_due with (security_invoker = true) as
select x.*,
       case when x.days_left is null and x.km_left is null then 'no_history'
            when coalesce(x.days_left, 1) < 0 or coalesce(x.km_left, 1) < 0 then 'overdue'
            when coalesce(x.days_left, 999) <= 14 or coalesce(x.km_left, 99999) <= 1000 then 'due_soon'
            else 'ok' end as state
  from (
    select p.id as plan_id, p.tenant_id, p.unit_id, p.vehicle_id, v.reg_number, v.make, v.model, p.task,
           p.interval_km, p.interval_days, p.last_done_date, p.last_done_km, v.odometer_km,
           case when p.interval_days is not null and p.last_done_date is not null then p.last_done_date + p.interval_days end as next_due_date,
           case when p.interval_km is not null and p.last_done_km is not null then p.last_done_km + p.interval_km end as next_due_km,
           case when p.interval_days is not null and p.last_done_date is not null then (p.last_done_date + p.interval_days - current_date) end as days_left,
           case when p.interval_km is not null and p.last_done_km is not null then (p.last_done_km + p.interval_km - v.odometer_km) end as km_left
      from public.fleet_maintenance_plans p
      join public.fleet_vehicles v on v.id = p.vehicle_id
     where p.active and v.status <> 'disposed'
  ) x;

-- ---------------------------------------------------------------------------
-- Fuel: consumption per fill (km since the previous fill / litres)
-- ---------------------------------------------------------------------------
create or replace view public.fleet_v_fuel with (security_invoker = true) as
select y.*,
       case when y.km_since_prev > 0 then round(y.km_since_prev / y.litres, 2) end as km_per_litre,
       round(y.cost / y.litres, 2) as price_per_litre
  from (
    select f.id, f.tenant_id, f.unit_id, f.vehicle_id, v.reg_number, f.driver_id, f.filled_at, f.litres, f.cost, f.odometer_km,
           f.station, f.fuel_card,
           (f.odometer_km - lag(f.odometer_km) over (partition by f.vehicle_id order by f.filled_at, f.created_at))::numeric as km_since_prev
      from public.fleet_fuel_logs f
      join public.fleet_vehicles v on v.id = f.vehicle_id
  ) y;

-- ---------------------------------------------------------------------------
-- Property: latest valuation, the condition discount, and the open maintenance backlog
-- ---------------------------------------------------------------------------
create or replace view public.fleet_v_property_value with (security_invoker = true) as
select p.id as property_id, p.tenant_id, p.unit_id, p.asset_number, p.name, p.kind, p.ownership, p.status, p.condition_rating,
       p.province, p.municipality, p.lat, p.lng, p.title_deed_number,
       case when p.extent_unit = 'ha' then p.extent_value * 10000 else p.extent_value end as extent_m2,
       p.extent_value, p.extent_unit,
       lv.valued_on, lv.market_value, lv.current_value,
       (lv.market_value - lv.current_value) as condition_discount,
       coalesce(b.open_cost, 0) as open_backlog_cost, coalesce(b.open_items, 0) as open_backlog_items
  from public.fleet_properties p
  left join lateral (
    select v.valued_on, v.market_value, v.current_value
      from public.fleet_property_valuations v
     where v.property_id = p.id
     order by v.valued_on desc, v.created_at desc limit 1
  ) lv on true
  left join lateral (
    select sum(m.estimated_cost) as open_cost, count(*) as open_items
      from public.fleet_property_maintenance m
     where m.property_id = p.id and m.status in ('backlog', 'planned', 'in_progress')
  ) b on true
 where p.status <> 'disposed';

grant select on public.fleet_v_compliance, public.fleet_v_maintenance_due, public.fleet_v_fuel, public.fleet_v_property_value to authenticated;
revoke all on public.fleet_v_compliance, public.fleet_v_maintenance_due, public.fleet_v_fuel, public.fleet_v_property_value from anon;

-- ---------------------------------------------------------------------------
-- Cost recovery: what each vehicle costs per hour and per km over a period
-- ---------------------------------------------------------------------------
create or replace function public.fleet_vehicle_costs(p_tenant uuid, p_from date, p_to date)
returns table (
  vehicle_id uuid, reg_number text, fleet_number text, make text, model text, category text, ownership text, unit_id uuid,
  litres numeric, fuel_cost numeric, maintenance_cost numeric, other_cost numeric, rental_cost numeric, total_cost numeric,
  hours_used numeric, km_driven numeric, cost_per_hour numeric, cost_per_km numeric
) language sql stable set search_path = '' as $$
  select v.id, v.reg_number, v.fleet_number, v.make, v.model, v.category, v.ownership, v.unit_id,
         coalesce(f.litres, 0), coalesce(f.cost, 0), coalesce(m.cost, 0), coalesce(e.cost, 0),
         coalesce(r.cost, 0),
         coalesce(f.cost, 0) + coalesce(m.cost, 0) + coalesce(e.cost, 0) + coalesce(r.cost, 0) as total_cost,
         round(coalesce(a.hours, 0), 1), coalesce(a.km, 0),
         case when coalesce(a.hours, 0) > 0
              then round((coalesce(f.cost, 0) + coalesce(m.cost, 0) + coalesce(e.cost, 0) + coalesce(r.cost, 0)) / a.hours, 2) end,
         case when coalesce(a.km, 0) > 0
              then round((coalesce(f.cost, 0) + coalesce(m.cost, 0) + coalesce(e.cost, 0) + coalesce(r.cost, 0)) / a.km, 2) end
    from public.fleet_vehicles v
    left join lateral (select sum(x.litres) as litres, sum(x.cost) as cost from public.fleet_fuel_logs x
                        where x.vehicle_id = v.id and x.filled_at >= p_from::timestamptz and x.filled_at < (p_to + 1)::timestamptz) f on true
    left join lateral (select sum(x.cost) as cost from public.fleet_maintenance x
                        where x.vehicle_id = v.id and x.status = 'completed'
                          and coalesce(x.completed_date, x.scheduled_date) between p_from and p_to) m on true
    left join lateral (select sum(x.amount) as cost from public.fleet_expenses x
                        where x.vehicle_id = v.id and x.incurred_on between p_from and p_to and x.status <> 'disputed') e on true
    left join lateral (select case when v.rental_rate_per_day is null then 0
                                   else v.rental_rate_per_day * greatest(0, (least(p_to, coalesce(v.rental_end, p_to)) - greatest(p_from, coalesce(v.rental_start, p_from))) + 1) end as cost
                         where v.ownership in ('rented', 'leased')) r on true
    left join lateral (select sum(extract(epoch from (least(x.end_at, now(), (p_to + 1)::timestamptz) - greatest(x.start_at, p_from::timestamptz))) / 3600.0) as hours,
                              sum(case when x.status = 'completed' and x.end_odometer is not null and x.start_odometer is not null
                                       then x.end_odometer - x.start_odometer end) as km
                         from public.fleet_allocations x
                        where x.vehicle_id = v.id and x.status in ('active', 'completed')
                          and x.start_at < (p_to + 1)::timestamptz and x.end_at > p_from::timestamptz
                          and least(x.end_at, now()) > greatest(x.start_at, p_from::timestamptz)) a on true
   where v.tenant_id = p_tenant and v.status <> 'disposed'
   order by total_cost desc, v.reg_number
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: fleet counts, tracking coverage, classification, age, compliance, money
-- ---------------------------------------------------------------------------
create or replace function public.fleet_dashboard(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  with v as (select * from public.fleet_vehicles where tenant_id = p_tenant and status <> 'disposed'),
       fuel as (select coalesce(sum(cost), 0) as cost, coalesce(sum(litres), 0) as litres from public.fleet_fuel_logs
                 where tenant_id = p_tenant and filled_at >= date_trunc('month', now())),
       pv as (select * from public.fleet_v_property_value where tenant_id = p_tenant)
  select jsonb_build_object(
    'vehicles_total',        (select count(*) from v),
    'vehicles_tracked',      (select count(*) from v where tracker_installed),
    'vehicles_untracked',    (select count(*) from v where not tracker_installed),
    'by_status',             (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (select status, count(*) c from v group by 1) s),
    'by_category',           (select coalesce(jsonb_object_agg(category, c), '{}'::jsonb) from (select category, count(*) c from v group by 1) s),
    'by_ownership',          (select coalesce(jsonb_object_agg(ownership, c), '{}'::jsonb) from (select ownership, count(*) c from v group by 1) s),
    'avg_age_years',         (select round(avg(extract(epoch from age(current_date, acquisition_date)) / 31557600.0)::numeric, 1) from v where acquisition_date is not null),
    'avg_odometer_km',       (select round(avg(odometer_km)) from v),
    'compliance_expired',    (select count(*) from public.fleet_v_compliance where tenant_id = p_tenant and state = 'expired'),
    'compliance_due_soon',   (select count(*) from public.fleet_v_compliance where tenant_id = p_tenant and state = 'due_soon'),
    'maintenance_overdue',   (select count(*) from public.fleet_v_maintenance_due where tenant_id = p_tenant and state = 'overdue'),
    'maintenance_due_soon',  (select count(*) from public.fleet_v_maintenance_due where tenant_id = p_tenant and state = 'due_soon'),
    'in_workshop',           (select count(*) from v where status = 'in_workshop'),
    'open_incidents',        (select count(*) from public.fleet_incidents where tenant_id = p_tenant and status not in ('resolved', 'closed')),
    'requests_pending',      (select count(*) from public.fleet_allocations where tenant_id = p_tenant and status = 'requested'),
    'trips_active',          (select count(*) from public.fleet_allocations where tenant_id = p_tenant and status in ('approved', 'active') and start_at <= now() and end_at >= now()),
    'trips_next_7_days',     (select count(*) from public.fleet_allocations where tenant_id = p_tenant and status in ('approved', 'requested') and start_at >= now() and start_at < now() + interval '7 days'),
    'fuel_cost_month',       (select cost from fuel),
    'fuel_litres_month',     (select litres from fuel),
    'maintenance_cost_month',(select coalesce(sum(cost), 0) from public.fleet_maintenance where tenant_id = p_tenant and status = 'completed'
                               and coalesce(completed_date, scheduled_date) >= date_trunc('month', current_date)::date),
    'properties_total',      (select count(*) from pv),
    'properties_extent_m2',  (select coalesce(sum(extent_m2), 0) from pv),
    'property_market_value', (select coalesce(sum(market_value), 0) from pv),
    'property_current_value',(select coalesce(sum(current_value), 0) from pv),
    'property_open_backlog', (select coalesce(sum(open_backlog_cost), 0) from pv),
    'property_poor_or_critical', (select count(*) from pv where condition_rating in ('poor', 'critical'))
  )
$$;

revoke execute on function public.fleet_vehicle_costs(uuid, date, date), public.fleet_dashboard(uuid) from public, anon;
grant execute on function public.fleet_vehicle_costs(uuid, date, date), public.fleet_dashboard(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Documents: title deeds, building layout plans, licence discs, insurance schedules ...
-- Path convention:  <tenant_id>/<scope>/<record_id>/<file>      (the first folder is the organisation)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-documents', 'fleet-documents', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 26214400,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

create or replace function public.fleet_doc_tenant(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return (string_to_array(p_name, '/'))[1]::uuid; exception when others then return null; end $$;
revoke execute on function public.fleet_doc_tenant(text) from public, anon;
grant execute on function public.fleet_doc_tenant(text) to authenticated;

drop policy if exists "fleet docs read" on storage.objects;
create policy "fleet docs read" on storage.objects for select to authenticated
  using (bucket_id = 'fleet-documents'
         and public.fleet_doc_tenant(name) is not null
         and (public.fleet_can(public.fleet_doc_tenant(name), 'fleet', false) or public.fleet_can(public.fleet_doc_tenant(name), 'property', false)));

drop policy if exists "fleet docs write" on storage.objects;
create policy "fleet docs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'fleet-documents'
              and public.fleet_doc_tenant(name) is not null
              and (public.fleet_can(public.fleet_doc_tenant(name), 'fleet', true) or public.fleet_can(public.fleet_doc_tenant(name), 'property', true)));

drop policy if exists "fleet docs update" on storage.objects;
create policy "fleet docs update" on storage.objects for update to authenticated
  using (bucket_id = 'fleet-documents' and public.fleet_doc_tenant(name) is not null
         and (public.fleet_can(public.fleet_doc_tenant(name), 'fleet', true) or public.fleet_can(public.fleet_doc_tenant(name), 'property', true)));

drop policy if exists "fleet docs delete" on storage.objects;
create policy "fleet docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'fleet-documents' and public.fleet_doc_tenant(name) is not null
         and (public.fleet_can(public.fleet_doc_tenant(name), 'fleet', true) or public.fleet_can(public.fleet_doc_tenant(name), 'property', true)));
