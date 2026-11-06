-- PayFast for repair quotes: the checkout helper and the notification handler (service role only).
create or replace function public.prepare_repair_payment(p_user uuid, p_quote_id uuid)
returns table (id uuid, amount integer, label text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
    select q.id, q.total, r.vehicle_label
      from public.repair_quotes q join public.repair_requests r on r.id = q.request_id
     where q.id = p_quote_id and r.buyer_id = p_user and q.status = 'accepted' and q.payment_status = 'unpaid';
  if not found then raise exception 'This quote cannot be paid right now' using errcode = '55000'; end if;
end $$;

create or replace function public.apply_repair_itn(p_order_id uuid, p_pf_payment_id text, p_payment_status text, p_amount_gross numeric, p_raw jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text := upper(coalesce(p_payment_status, '')); v_outcome text;
begin
  if not exists (select 1 from public.repair_quotes where id = p_order_id) then
    v_outcome := 'unknown_order';
  elsif p_pf_payment_id is not null and exists (select 1 from public.payment_events e where e.provider = 'payfast' and e.pf_payment_id = p_pf_payment_id
                                                  and e.payment_status = v_status and e.outcome = 'applied') then
    v_outcome := 'duplicate';
  elsif v_status = 'COMPLETE' then
    v_outcome := public.apply_repair_quote_payment(p_order_id, p_pf_payment_id, p_amount_gross);
    if v_outcome = 'applied' then
      update public.repair_quotes set payment_ref = p_pf_payment_id where id = p_order_id;
    end if;
  elsif v_status in ('FAILED', 'CANCELLED', 'PENDING') then
    v_outcome := 'ignored_' || lower(v_status);
  else
    v_outcome := 'ignored_unknown_status';
  end if;
  insert into public.payment_events (kind, order_id, pf_payment_id, payment_status, amount_gross, outcome, raw)
  values ('repair', p_order_id, p_pf_payment_id, v_status, p_amount_gross, v_outcome, coalesce(p_raw, '{}'));
  return v_outcome;
end $$;

revoke all on function public.prepare_repair_payment(uuid, uuid), public.apply_repair_itn(uuid, text, text, numeric, jsonb) from public, anon, authenticated;
