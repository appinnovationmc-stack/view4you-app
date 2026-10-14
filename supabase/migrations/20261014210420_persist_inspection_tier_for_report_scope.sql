alter table public.inspections
  add column if not exists tier_id uuid references public.inspection_tiers(id);

create or replace function public.attach_inspection_tier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tier_id is null then
    select b.tier_id into new.tier_id from public.bookings b where b.id=new.booking_id;
  end if;
  return new;
end;
$$;
revoke all on function public.attach_inspection_tier() from public,anon,authenticated;
drop trigger if exists inspections_attach_tier on public.inspections;
create trigger inspections_attach_tier before insert on public.inspections
for each row execute function public.attach_inspection_tier();

update public.inspections i set tier_id=b.tier_id
from public.bookings b where b.id=i.booking_id and i.tier_id is null and b.tier_id is not null;
