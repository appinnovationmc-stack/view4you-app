revoke execute on function public.can_read_report(uuid) from authenticated, anon, public;
create index if not exists idx_bookings_vin on public.bookings(vin);
create index if not exists idx_inspection_findings_inspection on public.inspection_findings(inspection_id);
create index if not exists idx_inspections_inspector on public.inspections(inspector_id);
create index if not exists idx_report_purchases_buyer on public.report_purchases(buyer_id);
create index if not exists idx_vehicle_accidents_vin on public.vehicle_accidents(vin);
create index if not exists idx_vehicle_odometer_vin on public.vehicle_odometer_readings(vin);
create index if not exists idx_vehicles_first_tracked_by on public.vehicles(first_tracked_by);