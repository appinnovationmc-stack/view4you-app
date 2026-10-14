-- Keep the report-availability error stable for client handling and tests.
create or replace function public.guard_report_order_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.inspections i
    where i.id = new.inspection_id
      and i.publication_status = 'published'
      and i.taken_down_at is null
  ) then
    raise exception 'This report is not available because it is unpublished or has been taken down'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_report_order_evidence() from public, anon, authenticated;
