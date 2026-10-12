-- LemonCheck 20261012000500 — analytics over time and a wider overview (forward-only).
--
-- * admin_analytics(p_days)  daily series, funnel, repeat buyers, inspector utilisation, top inspectors.
--                            Days are Africa/Johannesburg days. Revenue is what buyers paid, not company profit.
-- * admin_overview()         same keys as before plus the new queues (withdrawals, documents, tickets, takedowns).
-- Read-only: both are available to the support role too.

create or replace function public.admin_analytics(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 30), 365));
  v_tz   constant text := 'Africa/Johannesburg';
  v_from date := ((now() at time zone v_tz)::date - (greatest(7, least(coalesce(p_days, 30), 365)) - 1));
  v_buyers_any bigint; v_buyers_repeat bigint;
begin
  perform public.lc_require_admin(false);
  select count(*) filter (where n >= 1), count(*) filter (where n >= 2) into v_buyers_any, v_buyers_repeat
    from (select count(*) n from public.bookings where payment_status in ('paid', 'legacy_unverified', 'refund_due', 'refunded')
           group by buyer_id) s;
  return jsonb_build_object(
    'days', v_days,
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', to_char(d.day, 'YYYY-MM-DD'),
               'bookings', coalesce(b.n, 0), 'paid_bookings', coalesce(b.paid_n, 0), 'booking_revenue', coalesce(b.revenue, 0),
               'report_sales', coalesce(r.n, 0), 'report_revenue', coalesce(r.revenue, 0)) order by d.day)
        from generate_series(v_from, (now() at time zone v_tz)::date, interval '1 day') as g(day_ts)
        cross join lateral (select g.day_ts::date as day) d
        left join (select (created_at at time zone v_tz)::date as day, count(*) n,
                          count(*) filter (where payment_status in ('paid', 'legacy_unverified')) paid_n,
                          coalesce(sum(amount_due) filter (where payment_status in ('paid', 'legacy_unverified')), 0) revenue
                     from public.bookings group by 1) b on b.day = d.day
        left join (select (purchased_at at time zone v_tz)::date as day, count(*) n, coalesce(sum(amount_paid), 0) revenue
                     from public.report_purchases group by 1) r on r.day = d.day), '[]'::jsonb),
    'funnel', (select jsonb_build_object(
                 'created', count(*),
                 'paid', count(*) filter (where payment_status in ('paid', 'legacy_unverified', 'refund_due', 'refunded')),
                 'accepted', count(*) filter (where accepted_at is not null),
                 'completed', count(*) filter (where status = 'done'),
                 'cancelled', count(*) filter (where status = 'cancelled'))
                 from public.bookings where (created_at at time zone v_tz)::date >= v_from),
    'repeat_buyers', jsonb_build_object('buyers', v_buyers_any, 'repeat', v_buyers_repeat),
    'inspectors', jsonb_build_object(
      'approved', (select count(*) from public.profiles where role = 'inspector' and approved),
      'online_now', (select count(*) from public.profiles where role = 'inspector' and approved and online),
      'worked_in_period', (select count(distinct inspector_id) from public.bookings
                            where status = 'done' and (completed_at at time zone v_tz)::date >= v_from)),
    'top_inspectors', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.jobs desc, t.name)
        from (select p.name, count(*) jobs, p.rating
                from public.bookings b join public.profiles p on p.id = b.inspector_id
               where b.status = 'done' and (b.completed_at at time zone v_tz)::date >= v_from
               group by p.id, p.name, p.rating order by count(*) desc, p.name limit 5) t), '[]'::jsonb),
    'totals', jsonb_build_object(
      'booking_revenue', coalesce((select sum(amount_due) from public.bookings
                                    where payment_status in ('paid', 'legacy_unverified') and (created_at at time zone v_tz)::date >= v_from), 0),
      'report_revenue', coalesce((select sum(amount_paid) from public.report_purchases
                                   where (purchased_at at time zone v_tz)::date >= v_from), 0),
      'report_sales', (select count(*) from public.report_purchases where (purchased_at at time zone v_tz)::date >= v_from))
  );
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return jsonb_build_object(
    'inspectors_pending_approval', (select count(*) from public.profiles where role = 'inspector' and not approved),
    'inspectors_approved',         (select count(*) from public.profiles where role = 'inspector' and approved),
    'inspectors_online',           (select count(*) from public.profiles where role = 'inspector' and approved and online),
    'buyers',                      (select count(*) from public.profiles where role = 'buyer'),
    'bookings_by_status',          coalesce((select jsonb_object_agg(status, n) from
                                     (select status::text, count(*) n from public.bookings group by status) s), '{}'::jsonb),
    'bookings_awaiting_payment',   (select count(*) from public.bookings where status = 'pending' and payment_status = 'unpaid'),
    'refunds_due',                 (select count(*) from public.bookings where payment_status = 'refund_due'),
    'refunds_due_amount',          coalesce((select sum(amount_due) from public.bookings where payment_status = 'refund_due'), 0),
    'paid_bookings_amount',        coalesce((select sum(amount_due) from public.bookings where payment_status = 'paid'), 0),
    'reports',                     (select count(*) from public.inspections),
    'payment_problems_7d',         (select count(*) from public.payment_events
                                     where outcome not in ('applied', 'duplicate', 'refunded_by_operator', 'ignored_failed',
                                                           'ignored_cancelled', 'ignored_pending')
                                       and created_at > now() - interval '7 days'),
    'withdrawals_requested',        (select count(*) from public.withdrawal_requests where status = 'requested'),
    'withdrawals_requested_amount', coalesce((select sum(amount) from public.withdrawal_requests where status = 'requested'), 0),
    'documents_pending',            (select count(*) from public.inspector_documents where status = 'pending'),
    'tickets_open',                 (select count(*) from public.support_tickets where status = 'open'),
    'reports_taken_down',           (select count(*) from public.inspections where taken_down_at is not null)
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_analytics(integer)', 'admin_overview()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
