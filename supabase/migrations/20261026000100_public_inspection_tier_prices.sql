-- Let signed-out visitors see the published inspection tiers and prices
-- (name, price, sort) so the app can show them before sign-in.
-- Read-only, exposes only what the booking screen already shows to buyers.
-- Returns nothing when tiers are disabled.
create or replace function public.list_public_inspection_tiers()
returns table(id uuid, name text, buyer_price integer, sort integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.lc_settings s where s.id=1 and s.tiers_enabled) then return; end if;
  return query select t.id, t.name, t.buyer_price, t.sort
    from public.inspection_tiers t where t.active order by t.sort, t.buyer_price;
end $$;
revoke all on function public.list_public_inspection_tiers() from public;
grant execute on function public.list_public_inspection_tiers() to anon, authenticated, service_role;
