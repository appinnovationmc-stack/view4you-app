-- An inspector's stored position must not outlive their availability.
-- Deleted the moment they go offline, lose approval or stop being an inspector.
-- Also removes two unused helper RPCs from an earlier duplicate implementation; the app uses
-- update_my_inspector_location / list_inspectors_with_tiers_and_locations.
create or replace function public.cv_clear_inspector_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(new.online, false) or not coalesce(new.approved, false)
     or new.role <> 'inspector'::public.user_role then
    delete from public.inspector_locations where inspector_id = new.id;
  end if;
  return new;
end $$;

revoke all on function public.cv_clear_inspector_location() from public, anon, authenticated;

drop trigger if exists cv_clear_inspector_location on public.profiles;
create trigger cv_clear_inspector_location
after update of online, approved, role on public.profiles
for each row execute function public.cv_clear_inspector_location();

drop function if exists public.set_my_location(double precision, double precision);
drop function if exists public.list_inspector_locations();
