create or replace function public.enforce_booking_inspector_tier_service()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tier_id is not null and new.inspector_id is null then
    raise exception 'A tiered inspection must be assigned to an inspector who offers that tier' using errcode = '23514';
  end if;
  if new.tier_id is not null and not exists (
    select 1 from public.inspector_tier_services s
    where s.inspector_id = new.inspector_id and s.tier_id = new.tier_id
  ) then
    raise exception 'This inspector does not offer the selected inspection tier' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_booking_inspector_tier_service() from public, anon, authenticated;
