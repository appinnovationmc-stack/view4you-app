create or replace function public.report_preview(p_vin text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  i public.inspections%rowtype;
  v_owned boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode='28000'; end if;
  select * into i from public.inspections
   where vin=upper(btrim(p_vin)) and taken_down_at is null and publication_status='published'
   order by created_at desc limit 1;
  if not found then return null; end if;
  v_owned := public.can_read_report(i.id);
  return jsonb_build_object(
    'inspection_id',i.id,
    'report_number',i.report_number,
    'score',i.score,
    'full_price',i.full_price,
    'report_price',i.report_price,
    'payer_cut',i.payer_cut,
    'inspected_at',coalesce(i.submitted_at,i.created_at),
    'roadworthy_status',i.roadworthy_status,
    'inspector_name',(select p.name from public.profiles p where p.id=i.inspector_id),
    'owned',v_owned,
    'verdict',case when v_owned then i.verdict else null end,
    'areas',coalesce((
      select jsonb_agg(jsonb_build_object('area',f.area,'status',f.status,
                                          'note',case when v_owned then f.note else null end)
                       order by f.area)
      from public.inspection_findings f where f.inspection_id=i.id
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.report_preview(text) from public,anon;
grant execute on function public.report_preview(text) to authenticated;
