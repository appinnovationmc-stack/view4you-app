-- Buyers rate the workshop once they have paid; the workshop's profile rating is the average of its ratings.
alter table public.repair_quotes
  add column if not exists buyer_rating smallint check (buyer_rating between 1 and 5),
  add column if not exists buyer_review text;

create or replace function public.rate_repair_quote(p_quote_id uuid, p_stars integer, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_q public.repair_quotes%rowtype;
begin
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars' using errcode = '22023'; end if;
  select q.* into v_q from public.repair_quotes q join public.repair_requests r on r.id = q.request_id
   where q.id = p_quote_id and r.buyer_id = auth.uid() for update of q;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if v_q.payment_status <> 'paid' then raise exception 'You can rate a workshop after paying' using errcode = '55000'; end if;
  if v_q.buyer_rating is not null then raise exception 'You have already rated this job' using errcode = '55000'; end if;
  update public.repair_quotes set buyer_rating = p_stars, buyer_review = nullif(left(btrim(coalesce(p_comment, '')), 500), '') where id = v_q.id;
  update public.profiles p set
    rating = (select round(avg(buyer_rating)::numeric, 1) from public.repair_quotes where workshop_id = v_q.workshop_id and buyer_rating is not null),
    jobs_completed = (select count(*) from public.repair_quotes where workshop_id = v_q.workshop_id and buyer_rating is not null)
   where p.id = v_q.workshop_id;
  insert into public.notifications (user_id, type, icon, title, body)
  values (v_q.workshop_id, 'sys', '⭐', 'New rating', 'A buyer rated your work ' || p_stars || ' out of 5.');
end $$;
revoke all on function public.rate_repair_quote(uuid, integer, text) from public, anon;
grant execute on function public.rate_repair_quote(uuid, integer, text) to authenticated;

create or replace function public.list_repair_quotes(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not exists (select 1 from public.repair_requests where id = p_request_id and buyer_id = auth.uid()) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'total', q.total, 'lines', q.lines, 'days', q.days, 'note', q.note, 'status', q.status, 'valid_until', q.valid_until,
    'payment_status', q.payment_status, 'my_rating', q.buyer_rating,
    'workshop', jsonb_build_object('name', coalesce(w.business_name, p.name), 'area', w.area, 'brands', w.brands, 'rating', p.rating, 'jobs', p.jobs_completed,
      'phone', case when q.payment_status = 'paid' then p.phone end, 'address', case when q.payment_status = 'paid' then w.address end)
  ) order by q.total), '[]'::jsonb) into v_out
  from public.repair_quotes q join public.profiles p on p.id = q.workshop_id left join public.workshop_details w on w.workshop_id = q.workshop_id
  where q.request_id = p_request_id and q.status in ('submitted', 'accepted') and (q.status = 'accepted' or q.valid_until > now());
  return v_out;
end $$;
