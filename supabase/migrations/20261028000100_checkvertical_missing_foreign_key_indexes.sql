-- Add indexes for foreign-key columns identified by Supabase database advisors.
-- These indexes improve joins and parent-row update/delete checks as the tables grow.
create index if not exists inspections_tier_id_idx
  on public.inspections (tier_id);

create index if not exists inspector_tier_services_tier_id_idx
  on public.inspector_tier_services (tier_id);

create index if not exists resale_rewards_first_buyer_id_idx
  on public.resale_rewards (first_buyer_id);

create index if not exists roadworthy_certificates_station_id_idx
  on public.roadworthy_certificates (station_id);

create index if not exists support_tickets_booking_id_idx
  on public.support_tickets (booking_id);
