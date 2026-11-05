create or replace function public.admin_approve_inspector(p_inspector_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.lc_require_admin(true);
  update public.profiles set approved = true where id = p_inspector_id and role = 'inspector';
  if not found then raise exception 'No such inspector' using errcode = 'P0002'; end if;
end
$function$;
