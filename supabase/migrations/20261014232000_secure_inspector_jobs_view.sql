-- The inspector job view must respect the querying inspector's RLS context.
create or replace view public.inspector_jobs with (security_invoker = true) as
select b.id, b.inspector_id, b.vin, b.location, b.notes, b.status, b.inspection_fee,
       b.travel_fee, b.platform_fee, b.paid, b.payment_status, b.created_at, b.accepted_at,
       b.completed_at, v.make, v.model, v.year, v.colour,
       public.cv_inspector_job_buyer_first_name(b.id) as buyer_first_name,
       b.venue_kind, b.venue_name, b.auction_at, b.lot_number, b.needed_by,
       b.roadworthy_requested, public.cv_inspector_job_station_name(b.id) as station_name,
       b.tier_id
from public.bookings b
join public.vehicles v on v.vin = b.vin
where b.inspector_id = (select auth.uid()) and b.paid;
