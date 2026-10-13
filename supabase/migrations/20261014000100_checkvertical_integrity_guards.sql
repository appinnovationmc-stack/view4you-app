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
  v_missing_items integer;
  v_unknown_items integer;
  v_findings integer;
  v_distinct_areas integer;
  v_pass integer;
  v_warn integer;
  v_expected_score integer;
  v_new_score integer;
  v_critical_missing integer;
  v_critical_poor integer;
  v_measurement_faults integer;
  v_tyre_faults integer;
  v_missing_tread integer;
  v_has_roadworthy_fault boolean;
begin
  select * into v_i from public.inspections where id = new.id;
  if not found then return null; end if;
  -- Legacy/admin test fixtures and historical imports may have no submission timestamp.
  -- The report RPC sets submitted_at; integrity enforcement applies to submitted reports.
  if v_i.submitted_at is null then return null; end if;

  select count(*), count(distinct section || '.' || component)
    into v_items, v_distinct_items
    from public.report_items where inspection_id = v_i.id;
  -- Validate the exact server-owned checklist key set, not just the client-provided row count.
  if v_items <> 115 or v_distinct_items <> 115 then
    raise exception 'Report rejected: all 115 unique checklist items must be submitted (received %, unique %)', v_items, v_distinct_items
      using errcode = '22023';
  end if;
  with expected(section, component) as (
    values
      ('drive_system','ball_joint'),
      ('drive_system','bell_housing'),
      ('drive_system','bonnet_cable'),
      ('drive_system','bonnet_stay'),
      ('drive_system','bonnet_hinges'),
      ('drive_system','underbody'),
      ('drive_system','subframe'),
      ('drive_system','control_arm'),
      ('drive_system','exhaust'),
      ('drive_system','smoke_emission'),
      ('drive_system','chassis'),
      ('drive_system','shock_mounting'),
      ('drive_system','stabilizer'),
      ('drive_system','bushings'),
      ('drive_system','links'),
      ('drive_system','tie_rods'),
      ('drive_system','wheel_bearings'),
      ('drive_system','axles'),
      ('drive_system','shocks'),
      ('drive_system','gearbox'),
      ('drive_system','steering_rack'),
      ('drive_system','engine_mountings'),
      ('drive_system','fuel_system'),
      ('drive_system','radiator'),
      ('drive_system','radiator_cradle'),
      ('drive_system','coolant_hoses'),
      ('drive_system','brake_lines'),
      ('drive_system','handbrake'),
      ('drive_system','brake_calipers'),
      ('drive_system','cv_joints'),
      ('drive_system','drive_shaft'),
      ('drive_system','link_rod_covers'),
      ('engine','belts'),
      ('engine','idle'),
      ('engine','alternator'),
      ('engine','battery'),
      ('engine','coolant'),
      ('engine','oil'),
      ('engine','cables'),
      ('engine','pipes_wiring'),
      ('engine','brake_fluid'),
      ('engine','oil_cap'),
      ('engine','expansion_bottle'),
      ('engine','fan'),
      ('engine','firewall'),
      ('engine','induction_pipe'),
      ('engine','engine'),
      ('exterior','body_panels'),
      ('exterior','crumple_zones'),
      ('exterior','bumpers'),
      ('exterior','door_hinges'),
      ('exterior','door_handles'),
      ('exterior','lid_hinges'),
      ('exterior','wipers'),
      ('exterior','side_windows'),
      ('exterior','windscreen'),
      ('exterior','back_window'),
      ('exterior','window_rubbers'),
      ('exterior','headlights'),
      ('exterior','main_beams'),
      ('exterior','dim_lights'),
      ('exterior','park_lights'),
      ('exterior','fog_lights'),
      ('exterior','indicators'),
      ('exterior','side_repeaters'),
      ('exterior','side_mirrors'),
      ('exterior','tail_lights'),
      ('exterior','reflectors'),
      ('exterior','brake_lights'),
      ('exterior','reverse_lights'),
      ('exterior','plate_lights'),
      ('exterior','tailgate'),
      ('interior','main_key'),
      ('interior','spare_key'),
      ('interior','locking'),
      ('interior','steering_lock'),
      ('interior','interior_lights'),
      ('interior','hooter'),
      ('interior','fuel_gauge'),
      ('interior','wiper_stalk'),
      ('interior','washer'),
      ('interior','headlight_controls'),
      ('interior','interior_mirror'),
      ('interior','mirror_adjust'),
      ('interior','instrument_cluster'),
      ('interior','warning_lights'),
      ('interior','audio_nav'),
      ('interior','aircon'),
      ('interior','seats'),
      ('interior','power_windows'),
      ('interior','roof_lining'),
      ('interior','seatbelts'),
      ('interior','sun_visors'),
      ('interior','pedals'),
      ('test_drive','starting'),
      ('test_drive','idle_speed'),
      ('test_drive','braking'),
      ('test_drive','suspension'),
      ('test_drive','steering'),
      ('test_drive','stability'),
      ('test_drive','handling'),
      ('test_drive','performance'),
      ('test_drive','heating'),
      ('test_drive','gear_selection'),
      ('test_drive','instrument_panel'),
      ('test_drive','noises'),
      ('wheels','wheel_nuts'),
      ('wheels','fl_rim'),
      ('wheels','fr_rim'),
      ('wheels','rl_rim'),
      ('wheels','rr_rim'),
      ('wheels','fl_tyre'),
      ('wheels','fr_tyre'),
      ('wheels','rl_tyre'),
      ('wheels','rr_tyre')
  )
  select
    (select count(*) from expected e where not exists (
      select 1 from public.report_items ri
       where ri.inspection_id = v_i.id and ri.section = e.section and ri.component = e.component
    )),
    (select count(*) from public.report_items ri where ri.inspection_id = v_i.id and not exists (
      select 1 from expected e where e.section = ri.section and e.component = ri.component
    ))
  into v_missing_items, v_unknown_items;
  if v_missing_items > 0 or v_unknown_items > 0 then
    raise exception 'Report rejected: checklist keys are incomplete or unrecognised (missing %, unknown %)', v_missing_items, v_unknown_items
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
  select 4 - count(distinct position) into v_missing_tread
    from public.report_tyres
   where inspection_id = v_i.id
     and position in ('Front Left','Front Right','Rear Left','Rear Right')
     and tread_mm is not null and tread_mm >= 0;
  if v_missing_tread > 0 then
    raise exception 'Report rejected: tread depth is required for all four road tyres'
      using errcode = '22023';
  end if;

  v_has_roadworthy_fault := v_critical_poor > 0 or v_measurement_faults > 0 or v_tyre_faults > 0;

  -- Reconcile summary area statuses from safety-critical detail, regardless of client-supplied area summaries.
  with critical_area(section, component, area) as (
    values
      ('drive_system','exhaust','Exhaust'), ('drive_system','smoke_emission','Exhaust'),
      ('drive_system','chassis','Suspension'), ('drive_system','tie_rods','Suspension'),
      ('drive_system','wheel_bearings','Suspension'), ('drive_system','shocks','Suspension'),
      ('drive_system','steering_rack','Suspension'), ('drive_system','fuel_system','Engine'),
      ('drive_system','brake_lines','Brakes'), ('drive_system','handbrake','Brakes'),
      ('drive_system','brake_calipers','Brakes'), ('engine','brake_fluid','Brakes'),
      ('exterior','crumple_zones','Body & Paint'), ('exterior','windscreen','Body & Paint'),
      ('exterior','wipers','Electricals'), ('exterior','headlights','Lights'),
      ('exterior','main_beams','Lights'), ('exterior','dim_lights','Lights'),
      ('exterior','park_lights','Lights'), ('exterior','indicators','Lights'),
      ('exterior','side_mirrors','Lights'), ('exterior','tail_lights','Lights'),
      ('exterior','reflectors','Lights'), ('exterior','brake_lights','Lights'),
      ('exterior','plate_lights','Lights'), ('interior','steering_lock','Electricals'),
      ('interior','hooter','Electricals'), ('interior','warning_lights','Electricals'),
      ('interior','seatbelts','Interior'), ('interior','pedals','Brakes'),
      ('test_drive','braking','Brakes'), ('test_drive','steering','Suspension'),
      ('wheels','wheel_nuts','Tyres'), ('wheels','fl_tyre','Tyres'),
      ('wheels','fr_tyre','Tyres'), ('wheels','rl_tyre','Tyres'), ('wheels','rr_tyre','Tyres')
  )
  update public.inspection_findings f
     set status = 'fail'
    from public.report_items ri, critical_area ca
   where ri.inspection_id = v_i.id and ri.condition::text = 'poor'
     and ca.section = ri.section and ca.component = ri.component
     and f.inspection_id = v_i.id and f.area = ca.area and f.status::text <> 'fail';

  if v_measurement_faults > 0 then
    update public.inspection_findings set status = 'fail'
     where inspection_id = v_i.id and area = 'Brakes' and status::text <> 'fail';
  end if;
  if v_tyre_faults > 0 then
    update public.inspection_findings set status = 'fail'
     where inspection_id = v_i.id and area = 'Tyres' and status::text <> 'fail';
  end if;

  select round((((count(*) filter (where status::text = 'pass') * 10
                       + count(*) filter (where status::text = 'warn') * 5)::numeric) / 12) * 10)::integer
    into v_new_score
    from public.inspection_findings where inspection_id = v_i.id;

  update public.inspections
     set score = v_new_score,
         roadworthy_status = case when v_has_roadworthy_fault then 'fail' else roadworthy_status end,
         verdict = case
           when v_has_roadworthy_fault and coalesce(verdict, '') not ilike '%roadworthy issues found%'
             then concat_ws(' ', nullif(verdict, ''), 'Roadworthy issues found by server-side validation.')
           else verdict
         end
   where id = v_i.id
     and (score is distinct from v_new_score
       or (v_has_roadworthy_fault and roadworthy_status::text <> 'fail')
       or (v_has_roadworthy_fault and coalesce(verdict, '') not ilike '%roadworthy issues found%'));
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
