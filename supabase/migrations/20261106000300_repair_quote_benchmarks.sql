-- Price ranges built from real workshop quotes. A fault only gets a range once at least 3 different workshops have
-- priced it; the range is the 20th to 80th percentile of their prices. No workshop is identifiable from the output.
create or replace function public.repair_quote_benchmarks() returns jsonb
language sql stable security definer set search_path = '' as $$
  with l as (
    select (e->>'key') as key, (e->>'title') as title, (e->>'price')::numeric as price, q.workshop_id
      from public.repair_quotes q, jsonb_array_elements(q.lines) e
     where q.status in ('submitted', 'accepted', 'rejected')
       and coalesce(e->>'key', '') <> '' and (e->>'price') ~ '^[0-9]+(\.[0-9]+)?$' and (e->>'price')::numeric > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', key, 'label', t, 'n', n,
    'low', round(p20 / 50) * 50, 'high', greatest(round(p80 / 50) * 50, round(p20 / 50) * 50), 'premium_factor', 1)), '[]'::jsonb)
  from (
    select key, max(title) as t, count(distinct workshop_id) as n,
           percentile_cont(0.2) within group (order by price) as p20, percentile_cont(0.8) within group (order by price) as p80
      from l group by key having count(distinct workshop_id) >= 3
  ) s $$;
revoke all on function public.repair_quote_benchmarks() from public, anon;
grant execute on function public.repair_quote_benchmarks() to authenticated;
