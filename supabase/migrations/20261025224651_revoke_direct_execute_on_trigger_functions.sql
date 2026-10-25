-- Trigger functions are invoked by PostgreSQL triggers, not through the exposed RPC API.
-- Remove direct EXECUTE grants for API roles without affecting existing trigger execution.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end
$$;
