-- Guard booking tier integrity at the database boundary, including the obsolete RPC overload.
create or replace function public.lc_guard_booking_integrity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_tiers_enabled boolean := false;
  v_tier public.inspection_tiers%rowtype;
  v_take_rate integer := 2000;
  v_service_ok boolean := false;
  v_profile public.profiles%rowtype;
begin
  select coalesce(s.tiers_enabled, false), coalesce(s.take_rate_bp, 2000)
    into v_tiers_enabled, v_take_rate from public.lc_settings s where s.id = 1;
  if v_tiers_enabled and new.tier_id is null then
    raise exception 'Choose an active inspection tier before booking.' using errcode = '22023';
  end if;
  if not v_tiers_enabled and new.tier_id is not null then
    raise exception 'Inspection tiers are not currently enabled.' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles p
    where p.id = new.inspector_id and p.role = 'inspector' and p.approved and p.online;
  if not found then raise exception 'That inspector is not available right now.' using errcode = 'P0002'; end if;
  if new.tier_id is not null then
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
  else
    if v_profile.price is null or v_profile.price <= 0 then
      raise exception 'That inspector does not have a valid inspection price.' using errcode = '22023';
    end if;
    new.inspection_fee := v_profile.price;
    new.inspector_payout := null;
    new.platform_gross := null;
  end if;
  return new;
end;
$$;
drop trigger if exists lc_guard_booking_integrity on public.bookings;
create trigger lc_guard_booking_integrity
before insert or update of inspector_id, tier_id, inspection_fee, travel_fee, platform_fee, addon_fee, amount_due
on public.bookings for each row execute function public.lc_guard_booking_integrity();

create or replace function public.lc_prevent_self_price_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.price is distinct from old.price and auth.uid() is not null
     and auth.uid() = old.id and old.role <> 'admin' then
    raise exception 'Inspection prices are managed by CheckVertical and cannot be changed from your profile.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists lc_prevent_self_price_change on public.profiles;
create trigger lc_prevent_self_price_change before update of price on public.profiles
for each row execute function public.lc_prevent_self_price_change();
revoke all on function public.lc_guard_booking_integrity() from public, anon, authenticated;
revoke all on function public.lc_prevent_self_price_change() from public, anon, authenticated;
