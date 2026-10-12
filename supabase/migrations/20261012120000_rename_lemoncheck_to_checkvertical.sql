-- Rebrand: LemonCheck -> CheckVertical in function bodies and existing notifications.
do $$
declare r record;
begin
  for r in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%LemonCheck%'
  loop
    execute replace(pg_get_functiondef(r.oid), 'LemonCheck', 'CheckVertical');
  end loop;
end $$;

update public.notifications
set title = replace(title, 'LemonCheck', 'CheckVertical'),
    body  = replace(body,  'LemonCheck', 'CheckVertical')
where title like '%LemonCheck%' or body like '%LemonCheck%';
