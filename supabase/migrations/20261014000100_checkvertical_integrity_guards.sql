-- CheckVertical integrity guardrails. Forward-only; deploy to staging and verify before production.
-- The report is written in one transaction. A deferred trigger sees all report rows before commit.

create or replace function public.cv_validate_inspection_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.inspections%rowtype;
  v_items integer;
  v_distinct_items integer;
  v_findings integer;
  v_distinct_areas integer;
  v_pass integer;
  v_warn integer;
  v_expected_score integer;
  v_critical_missing integer;
  v_critical_poor integer;
  v_measurement_faults integer;
  v_tyre_faults integer;
  v_has_roadworthy_fault boolean;
begin
  select * into v_i from public.inspections where id = new.id;
  if not found then return null; end if;

  select count(*), count(distinct section || '.' || component)
    into v_items, v_distinct_items
    from public.report_items where inspection_id = v_i.id;
  -- Current inspection template has 115 distinct checklist components.
  if v_items <> 115 or v_distinct_items <> 115 then
    raise exception 'Report rejected: all 115 unique checklist items must be submitted (received %, unique %)', v_items, v_distinct_items
      using errcode = '22023';
  end if;

  select count(*), count(distinct area),
         count(*) filter (where status::text = 'pass'),
         count(*) filter (where status::text = 'warn')
    into v_findings, v_distinct_areas, v_pass, v_warn
    from public.inspection_findings where inspection_id = v_i.id;
  if v_findings <> 12 or v_distinct_areas <> 12 then
    raise exception 'Report rejected: exactly 12 unique area findings are required'
      using errcode = '22023';
  end if;
  v_expected_score := round((((v_pass * 10 + v_warn * 5)::numeric) / 12) * 10)::integer;
  if v_i.score is distinct from v_expected_score then
    raise exception 'Report rejected: submitted score does not match the area findings (expected %)', v_expected_score
      using errcode = '22023';
  end if;

  -- Critical list is maintained server-side; do not trust roadworthy_relevant supplied by the app.
  with critical(section, component) as (
    values
      ('drive_system','exhaust'), ('drive_system','smoke_emission'), ('drive_system','chassis'),
      ('drive_system','tie_rods'), ('drive_system','wheel_bearings'), ('drive_system','shocks'),
      ('drive_system','steering_rack'), ('drive_system','fuel_system'), ('drive_system','brake_lines'),
      ('drive_system','handbrake'), ('drive_system','brake_calipers'),
      ('engine','brake_fluid'),
      ('exterior','crumple_zones'), ('exterior','wipers'), ('exterior','windscreen'),
      ('exterior','headlights'), ('exterior','main_beams'), ('exterior','dim_lights'),
      ('exterior','park_lights'), ('exterior','indicators'), ('exterior','side_mirrors'),
      ('exterior','tail_lights'), ('exterior','reflectors'), ('exterior','brake_lights'),
      ('exterior','plate_lights'),
      ('interior','steering_lock'), ('interior','hooter'), ('interior','warning_lights'),
      ('interior','seatbelts'), ('interior','pedals'),
      ('test_drive','braking'), ('test_drive','steering'),
      ('wheels','wheel_nuts'), ('wheels','fl_tyre'), ('wheels','fr_tyre'),
      ('wheels','rl_tyre'), ('wheels','rr_tyre')
  )
  select count(*) filter (where ri.component is null or ri.condition::text = 'na'),
         count(*) filter (where ri.condition::text = 'poor')
    into v_critical_missing, v_critical_poor
    from critical c
    left join public.report_items ri
      on ri.inspection_id = v_i.id and ri.section = c.section and ri.component = c.component;

  if v_critical_missing > 0 then
    raise exception 'Report rejected: safety-critical checklist items cannot be missing or marked N/A'
      using errcode = '22023';
  end if;

  select count(*) into v_measurement_faults
    from public.report_measurements
   where inspection_id = v_i.id and test::text = 'brake'
     and position <> 'Parking Brake' and coalesce(diff_pct, 0) > 30;
  select count(*) into v_tyre_faults
    from public.report_tyres
   where inspection_id = v_i.id and position <> 'Spare' and tread_mm is not null and tread_mm < 1.0;

  v_has_roadworthy_fault := v_critical_poor > 0 or v_measurement_faults > 0 or v_tyre_faults > 0;
  if v_has_roadworthy_fault and v_i.roadworthy_status::text <> 'fail' then
    update public.inspections
       set roadworthy_status = 'fail',
           verdict = case
             when coalesce(verdict, '') ilike '%roadworthy issues found%' then verdict
             else concat_ws(' ', nullif(verdict, ''), 'Roadworthy issues found by server-side validation.')
           end
     where id = v_i.id;
  end if;
  return null;
end;
$$;

revoke all on function public.cv_validate_inspection_integrity() from public, anon, authenticated;

drop trigger if exists cv_validate_inspection_integrity on public.inspections;
create constraint trigger cv_validate_inspection_integrity
after insert or update on public.inspections
deferrable initially deferred
for each row execute function public.cv_validate_inspection_integrity();

-- Keep the preview's original report fee honest; older clients incorrectly displayed R0.
create or replace function public.report_preview(p_vin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  i     public.inspections%rowtype;
  v_owned boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into i from public.inspections
   where vin = upper(btrim(p_vin)) order by created_at desc limit 1;
  if not found then return null; end if;
  v_owned := public.can_read_report(i.id);
  return jsonb_build_object(
    'inspection_id', i.id,
    'report_number', i.report_number,
    'score', i.score,
    'full_price', i.full_price,
    'report_price', i.report_price,
    'payer_cut', i.payer_cut,
    'inspected_at', coalesce(i.submitted_at, i.created_at),
    'roadworthy_status', i.roadworthy_status,
    'inspector_name', (select p.name from public.profiles p where p.id = i.inspector_id),
    'owned', v_owned,
    'verdict', case when v_owned then i.verdict else null end,
    'areas', coalesce((select jsonb_agg(jsonb_build_object('area', f.area, 'status', f.status,
                                                          'note', case when v_owned then f.note else null end)
                                        order by f.area)
                         from public.inspection_findings f where f.inspection_id = i.id), '[]'::jsonb)
  );
end $$;

revoke all on function public.report_preview(text) from public, anon;
grant execute on function public.report_preview(text) to authenticated, service_role;
