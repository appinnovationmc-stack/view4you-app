-- A comprehensive report needs the seven distinct measured positions shown by the app.
-- Prevent duplicate rows from being used to satisfy the evidence threshold.
create unique index if not exists report_measurements_inspection_test_position_uidx
  on public.report_measurements (inspection_id, test, position);

create or replace function public.publish_inspection_report(p_inspection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ins public.inspections%rowtype;
  v_tier_name text;
  v_min_photos integer;
  v_photo_count integer;
  v_measurement_count integer;
  v_missing_positions integer;
  v_invalid_measurements integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_ins
  from public.inspections i
  where i.id = p_inspection_id and i.inspector_id = auth.uid();

  if not found then
    raise exception 'Inspection not found for this inspector' using errcode = '42501';
  end if;

  if v_ins.tier_id is null then
    update public.inspections
    set publication_status = 'published'
    where id = p_inspection_id;
    return;
  end if;

  select t.name into v_tier_name
  from public.inspection_tiers t
  where t.id = v_ins.tier_id;

  if v_tier_name is null then
    raise exception 'Inspection tier is unavailable' using errcode = '23514';
  end if;

  v_min_photos := case lower(v_tier_name)
    when 'comprehensive' then 12
    when 'standard' then 8
    else 4
  end;

  select count(*) into v_photo_count
  from public.report_photos p
  where p.inspection_id = p_inspection_id;

  if v_photo_count < v_min_photos then
    raise exception 'This tier requires at least % uploaded evidence photos; % are recorded',
      v_min_photos, v_photo_count using errcode = '23514';
  end if;

  if lower(v_tier_name) = 'comprehensive' then
    select count(*) into v_measurement_count
    from public.report_measurements m
    where m.inspection_id = p_inspection_id;

    if v_measurement_count <> 7 then
      raise exception 'Comprehensive requires all seven distinct recorded measurements before publication'
        using errcode = '23514';
    end if;

    with expected(test, position) as (
      values
        ('brake','Front Axle'),
        ('brake','Rear Axle'),
        ('brake','Parking Brake'),
        ('shock','Front Axle'),
        ('shock','Rear Axle'),
        ('slip','Front Axle'),
        ('slip','Rear Axle')
    )
    select count(*) into v_missing_positions
    from expected e
    where not exists (
      select 1 from public.report_measurements m
      where m.inspection_id = p_inspection_id
        and m.test = e.test and m.position = e.position
    );

    if v_missing_positions > 0 then
      raise exception 'Comprehensive report is missing one or more required measurement positions'
        using errcode = '23514';
    end if;

    select count(*) into v_invalid_measurements
    from public.report_measurements m
    where m.inspection_id = p_inspection_id
      and (
        (m.test in ('brake','shock') and (m.left_value is null or m.right_value is null))
        or (m.test = 'slip' and (m.right_value is null or m.left_value is not null))
      );

    if v_invalid_measurements > 0 then
      raise exception 'Comprehensive report has incomplete measured test values'
        using errcode = '23514';
    end if;
  end if;

  update public.inspections
  set publication_status = 'published',
      submitted_at = coalesce(submitted_at, now())
  where id = p_inspection_id;
end;
$$;

revoke all on function public.publish_inspection_report(uuid) from public, anon;
grant execute on function public.publish_inspection_report(uuid) to authenticated;
