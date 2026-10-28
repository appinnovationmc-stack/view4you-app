-- Presentation/demo switch: when app_flags.demo_payments is true, bookings and report purchases are confirmed
-- without PayFast. Off = real payments only. Toggle:  update public.app_flags set enabled=false where key='demo_payments';
create table if not exists public.app_flags (key text primary key, enabled boolean not null default false);
alter table public.app_flags enable row level security; -- no policies: only the functions below can read it
insert into public.app_flags (key, enabled) values ('demo_payments', true) on conflict (key) do nothing;

create or replace function public.demo_payments_enabled() returns boolean
language sql security definer set search_path = '' stable
as $$ select coalesce((select enabled from public.app_flags where key = 'demo_payments'), false) $$;

create or replace function public.demo_confirm_booking(p_booking_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare b public.bookings%rowtype;
begin
  if not public.demo_payments_enabled() then raise exception 'Demo payments are off' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_booking_id and buyer_id = auth.uid();
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if b.payment_status <> 'unpaid' then return 'already_paid'; end if;
  return public.apply_payfast_itn('booking', b.id, 'DEMO-' || b.id::text, 'COMPLETE', b.amount_due::numeric, '{"demo":true}'::jsonb);
end $$;

create or replace function public.demo_confirm_report(p_inspection_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare o public.report_orders%rowtype;
begin
  if not public.demo_payments_enabled() then raise exception 'Demo payments are off' using errcode = '42501'; end if;
  o := public.create_report_order_for(auth.uid(), p_inspection_id);
  return public.apply_payfast_itn('report', o.id, 'DEMO-' || o.id::text, 'COMPLETE', o.amount::numeric, '{"demo":true}'::jsonb);
end $$;

revoke all on function public.demo_payments_enabled(), public.demo_confirm_booking(uuid), public.demo_confirm_report(uuid) from public, anon;
grant execute on function public.demo_payments_enabled(), public.demo_confirm_booking(uuid), public.demo_confirm_report(uuid) to authenticated;
