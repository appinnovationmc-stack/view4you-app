-- LemonCheck payment order boundary.
-- The browser creates no purchase record. A server-side payment function creates
-- a pending order; PayFast ITN verifies the payment before report_purchases is inserted.

create table if not exists public.report_orders (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  amount integer not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled','refunded')),
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (inspection_id, buyer_id)
);

alter table public.report_orders enable row level security;
drop policy if exists "report_orders buyer reads own" on public.report_orders;
create policy "report_orders buyer reads own" on public.report_orders
for select to authenticated using ((select auth.uid()) = buyer_id);

create index if not exists idx_report_orders_buyer on public.report_orders(buyer_id);
create index if not exists idx_report_orders_inspection on public.report_orders(inspection_id);

drop policy if exists "purchases: buyer inserts own" on public.report_purchases;
revoke all on function public.create_report_order(uuid) from public, anon, authenticated;