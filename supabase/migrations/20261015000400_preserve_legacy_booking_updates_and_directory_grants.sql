-- Preserve historical tierless bookings when updating existing rows after tier pricing is enabled.
create or replace function public.lc_guard_booking_integrity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_tiers_enabled boolean := false;
  v_tier public.inspection_tiers%rowtype;
  v_take_rate integer := 2000;
  v_service_ok boolean := false;
begin
  if tg_op = 'UPDATE' and old.tier_id is null and new.tier_id is null then
    return new;
  end if;
  select coalesce(s.tiers_enabled, false), coalesce(s.take_rate_bp, 2000)
    into v_tiers_enabled, v_take_rate from public.lc_settings s where s.id = 1;
  if v_tiers_enabled and new.tier_id is null then
    raise exception 'Choose an active inspection tier before booking.' using errcode = '22023';
  end if;
  if not v_tiers_enabled and new.tier_id is not null then
    raise exception 'Inspection tiers are not currently enabled.' using errcode = '22023';
  end if;
  if new.tier_id is null then return new; end if;

  select * into v_tier from public.inspection_tiers t where t.id = new.tier_id and t.active;
  if not found then raise exception 'Choose an active inspection tier.' using errcode = '22023'; end if;
  select exists (select 1 from public.inspector_tier_services s
    where s.inspector_id = new.inspector_id and s.tier_id = new.tier_id
      and (lower(v_tier.name) <> 'comprehensive' or s.can_measure)) into v_service_ok;
  if not v_service_ok then
    raise exception 'This inspector is not registered to provide the selected tier.' using errcode = '22023';
  end if;
  new.inspection_fee := v_tier.buyer_price;
  new.travel_fee := 0;
  new.platform_fee := 0;
  new.amount_due := v_tier.buyer_price + coalesce(new.addon_fee, 0);
  new.inspector_payout := v_tier.buyer_price - round(v_tier.buyer_price * v_take_rate / 10000.0)::integer;
  new.platform_gross := round(v_tier.buyer_price * v_take_rate / 10000.0)::integer;
  return new;
end;
$$;

-- The client only needs the public directory after authentication; do not expose the
-- SECURITY DEFINER directory RPC to unauthenticated callers.
revoke execute on function public.list_inspectors_with_tiers() from public, anon;
grant execute on function public.list_inspectors_with_tiers() to authenticated;
