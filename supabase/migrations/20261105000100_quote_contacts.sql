-- Once a quote is accepted, both sides can see how to reach each other (and only then).
create or replace function public.list_repair_quotes(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.repair_requests where id = p_request_id and buyer_id = auth.uid()) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'total', q.total, 'lines', q.lines, 'days', q.days, 'note', q.note, 'status', q.status, 'valid_until', q.valid_until,
    'workshop', jsonb_build_object('name', coalesce(w.business_name, p.name), 'area', w.area, 'brands', w.brands, 'rating', p.rating, 'jobs', p.jobs_completed,
      'phone', case when q.status = 'accepted' then p.phone end, 'address', case when q.status = 'accepted' then w.address end)
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
    'buyer_phone', case when q.status = 'accepted' then (select phone from public.profiles where id = r.buyer_id) end
  ) order by q.created_at desc), '[]'::jsonb)
  from public.repair_quotes q join public.repair_requests r on r.id = q.request_id where q.workshop_id = auth.uid() $$;
