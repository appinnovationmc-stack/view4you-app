create or replace function public.get_my_inspector_tiers()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.tier_id order by t.sort), '{}'::uuid[])
  from public.inspector_tier_services s
  join public.inspection_tiers t on t.id=s.tier_id and t.active
  where s.inspector_id=auth.uid();
$$;
revoke all on function public.get_my_inspector_tiers() from public, anon;
grant execute on function public.get_my_inspector_tiers() to authenticated;
