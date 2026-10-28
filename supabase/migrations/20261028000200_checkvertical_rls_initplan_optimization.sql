-- Evaluate auth.uid() once per statement instead of once per row in ownership policies.
alter policy "notifications: read own" on public.notifications
  using ((select auth.uid()) = user_id);

alter policy "profiles: read own" on public.profiles
  using ((select auth.uid()) = id);

alter policy "purchases: buyer reads own" on public.report_purchases
  using ((select auth.uid()) = buyer_id);

alter policy "purchases: inspector reads own earnings" on public.report_purchases
  using (exists (
    select 1 from public.inspections i
    where i.id = report_purchases.inspection_id
      and i.inspector_id = (select auth.uid())
  ));

alter policy "purchases: original tracker reads own earnings" on public.report_purchases
  using (exists (
    select 1
    from public.vehicles v
    join public.inspections i on i.vin = v.vin
    where i.id = report_purchases.inspection_id
      and v.first_tracked_by = (select auth.uid())
  ));
