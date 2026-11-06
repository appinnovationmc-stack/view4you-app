-- Buyer pays CheckVertical for an accepted repair quote; contact details unlock only once it is paid.
-- CheckVertical keeps referral_fee and owes the workshop workshop_payout. Real PayFast checkout plugs into
-- apply_repair_quote_payment; until then the demo switch (app_flags.demo_payments) confirms it.
alter table public.repair_quotes add column if not exists paid_at timestamptz, add column if not exists payment_ref text;

create or replace function public.apply_repair_quote_payment(p_quote_id uuid, p_ref text, p_amount numeric) returns text
language plpgsql security definer set search_path = '' as $$
declare v_q public.repair_quotes%rowtype; v_r public.repair_requests%rowtype;
begin
  select * into v_q from public.repair_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if v_q.status <> 'accepted' then return 'ignored_not_accepted'; end if;
  if v_q.payment_status = 'paid' then return 'duplicate'; end if;
  if p_amount is distinct from v_q.total::numeric then return 'amount_mismatch'; end if;
  update public.repair_quotes set payment_status = 'paid', paid_at = now(), payment_ref = p_ref where id = v_q.id;
  select * into v_r from public.repair_requests where id = v_q.request_id;
  insert into public.notifications (user_id, type, icon, title, body)
  values (v_q.workshop_id, 'sys', '💰', 'Customer has paid', 'Payment received for ' || v_r.vehicle_label || '. You can now contact the buyer and book the work.');
  return 'applied';
end $$;

create or replace function public.pay_repair_quote_demo(p_quote_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.demo_payments_enabled() then raise exception 'Demo payments are off' using errcode = '42501'; end if;
  if not exists (select 1 from public.repair_quotes q join public.repair_requests r on r.id = q.request_id
                  where q.id = p_quote_id and r.buyer_id = auth.uid()) then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  return public.apply_repair_quote_payment(p_quote_id, 'DEMO-' || p_quote_id::text, (select total::numeric from public.repair_quotes where id = p_quote_id));
end $$;

revoke all on function public.apply_repair_quote_payment(uuid, text, numeric), public.pay_repair_quote_demo(uuid) from public, anon, authenticated;
grant execute on function public.pay_repair_quote_demo(uuid) to authenticated;

create or replace function public.list_repair_quotes(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.repair_requests where id = p_request_id and buyer_id = auth.uid()) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'total', q.total, 'lines', q.lines, 'days', q.days, 'note', q.note, 'status', q.status, 'valid_until', q.valid_until,
    'payment_status', q.payment_status,
    'workshop', jsonb_build_object('name', coalesce(w.business_name, p.name), 'area', w.area, 'brands', w.brands, 'rating', p.rating, 'jobs', p.jobs_completed,
      'phone', case when q.payment_status = 'paid' then p.phone end, 'address', case when q.payment_status = 'paid' then w.address end)
  ) order by q.total), '[]'::jsonb) into v_out
  from public.repair_quotes q join public.profiles p on p.id = q.workshop_id left join public.workshop_details w on w.workshop_id = q.workshop_id
  where q.request_id = p_request_id and q.status in ('submitted', 'accepted') and (q.status = 'accepted' or q.valid_until > now());
  return v_out;
end $$;

create or replace function public.list_my_repair_quotes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'request_id', q.request_id, 'vehicle_label', r.vehicle_label, 'area', r.area, 'issues', r.issues,
    'total', q.total, 'days', q.days, 'note', q.note, 'status', q.status, 'valid_until', q.valid_until,
    'workshop_payout', q.workshop_payout, 'payment_status', q.payment_status,
    'buyer_first_name', case when q.status = 'accepted' then (select first_name from public.profiles where id = r.buyer_id) end,
    'buyer_phone', case when q.payment_status = 'paid' then (select phone from public.profiles where id = r.buyer_id) end
  ) order by q.created_at desc), '[]'::jsonb)
  from public.repair_quotes q join public.repair_requests r on r.id = q.request_id where q.workshop_id = auth.uid() $$;
