-- Merge overlapping SELECT policies into one ownership/assignment rule per table.
drop policy if exists "bookings: buyer reads own" on public.bookings;
drop policy if exists "bookings: inspector reads assigned paid" on public.bookings;
create policy "bookings: buyer or assigned inspector reads"
  on public.bookings for select to authenticated
  using (
    (select auth.uid()) = buyer_id
    or ((select auth.uid()) = inspector_id and paid)
  );

drop policy if exists "purchases: buyer reads own" on public.report_purchases;
drop policy if exists "purchases: inspector reads own earnings" on public.report_purchases;
drop policy if exists "purchases: original tracker reads own earnings" on public.report_purchases;
create policy "purchases: owner inspector or tracker reads"
  on public.report_purchases for select to authenticated
  using (
    (select auth.uid()) = buyer_id
    or exists (
      select 1 from public.inspections i
      where i.id = report_purchases.inspection_id
        and i.inspector_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.vehicles v
      join public.inspections i on i.vin = v.vin
      where i.id = report_purchases.inspection_id
        and v.first_tracked_by = (select auth.uid())
    )
  );
