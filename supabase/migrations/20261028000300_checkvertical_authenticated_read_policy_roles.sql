-- Use Postgres policy role targeting instead of checking auth.role() per row.
alter policy "vehicles: readable by authenticated users" on public.vehicles
  to authenticated using (true);

alter policy "history: readable by authenticated users" on public.vehicle_history
  to authenticated using (true);

alter policy "accidents: readable by authenticated users" on public.vehicle_accidents
  to authenticated using (true);

alter policy "odo: readable by authenticated users" on public.vehicle_odometer_readings
  to authenticated using (true);
