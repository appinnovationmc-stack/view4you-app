-- LemonCheck: atomic save of a detailed inspection report.
-- Run AFTER schema.sql and report_schema.sql.
--
-- Why an RPC: inspections has UNIQUE(booking_id) and no UPDATE/DELETE policy, so a
-- client-side multi-insert that fails half way would leave an unfixable partial report.
-- This function does everything in ONE transaction. It is SECURITY INVOKER, so every
-- insert still passes through the existing row-level-security policies.
--
-- Prices are computed here from the booking's inspection_fee, never taken from the client.

create or replace function public.submit_detailed_report(
  p_booking_id   uuid,
  p_score        integer,
  p_verdict      text,
  p_odometer_km  integer,
  p_roadworthy   text,
  p_faults       jsonb,
  p_warnings     jsonb,
  p_findings     jsonb,   -- [{area, status, note}]
  p_items        jsonb,   -- [{section, component, condition, explanation, roadworthy_relevant}]
  p_measurements jsonb,   -- [{test, position, right_value, left_value, diff_pct, result}]
  p_tyres        jsonb    -- [{position, size, load_speed, make, model, tyre_type, tread_mm}]
) returns table (inspection_id uuid, report_number text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  b              bookings%rowtype;
  v_report_price integer;
  v_payer_cut    integer;
  v_insp_cut     integer;
  v_id           uuid;
  v_num          text;
  v_try          integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into b from bookings where id = p_booking_id for update;
  if not found or b.inspector_id is distinct from auth.uid() then
    raise exception 'Booking not found or not assigned to you' using errcode = '42501';
  end if;
  if b.status = 'done' or exists (select 1 from inspections i where i.booking_id = b.id) then
    raise exception 'A report has already been submitted for this booking' using errcode = '23505';
  end if;

  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception 'Score must be between 0 and 100' using errcode = '22023';
  end if;
  if p_roadworthy not in ('pass', 'fail') then
    raise exception 'roadworthy must be pass or fail' using errcode = '22023';
  end if;
  if p_odometer_km is null or p_odometer_km < 0 then
    raise exception 'Odometer reading is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Checklist items are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings) = 0 then
    raise exception 'Area findings are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_faults) is distinct from 'array'
     or jsonb_typeof(p_warnings) is distinct from 'array'
     or jsonb_typeof(p_measurements) is distinct from 'array'
     or jsonb_typeof(p_tyres) is distinct from 'array' then
    raise exception 'faults, warnings, measurements and tyres must be arrays' using errcode = '22023';
  end if;

  -- Resale price split: same ratios the app already used (18% of fee, 51.5% to the commissioning buyer).
  v_report_price := round(b.inspection_fee * 0.18);
  v_payer_cut    := round(v_report_price * 0.515);
  v_insp_cut     := v_report_price - v_payer_cut;

  loop
    v_num := 'LC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD')
             || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from inspections i where i.report_number = v_num);
    v_try := v_try + 1;
    if v_try > 5 then
      raise exception 'Could not allocate a report number' using errcode = '55000';
    end if;
  end loop;

  insert into inspections (
    booking_id, vin, inspector_id, score, verdict,
    full_price, report_price, payer_cut, inspector_cut,
    report_number, odometer_km, roadworthy_status, faults, warnings, submitted_at
  ) values (
    b.id, b.vin, auth.uid(), p_score, p_verdict,
    b.inspection_fee, v_report_price, v_payer_cut, v_insp_cut,
    v_num, p_odometer_km, p_roadworthy, p_faults, p_warnings, now()
  ) returning id into v_id;

  insert into inspection_findings (inspection_id, area, status, note)
  select v_id, x->>'area', x->>'status', nullif(x->>'note', '')
  from jsonb_array_elements(p_findings) x;

  insert into report_items (inspection_id, section, component, condition, explanation, roadworthy_relevant)
  select v_id, x->>'section', x->>'component', x->>'condition',
         nullif(x->>'explanation', ''), coalesce((x->>'roadworthy_relevant')::boolean, false)
  from jsonb_array_elements(p_items) x;

  insert into report_measurements (inspection_id, test, position, right_value, left_value, diff_pct, result)
  select v_id, x->>'test', x->>'position',
         (x->>'right_value')::numeric, (x->>'left_value')::numeric, (x->>'diff_pct')::numeric, x->>'result'
  from jsonb_array_elements(p_measurements) x;

  insert into report_tyres (inspection_id, position, size, load_speed, make, model, tyre_type, tread_mm)
  select v_id, x->>'position', nullif(x->>'size', ''), nullif(x->>'load_speed', ''),
         nullif(x->>'make', ''), nullif(x->>'model', ''), nullif(x->>'tyre_type', ''),
         (x->>'tread_mm')::numeric
  from jsonb_array_elements(p_tyres) x;

  update bookings set status = 'done', completed_at = now() where id = b.id;
  update profiles set jobs_completed = jobs_completed + 1 where id = auth.uid();

  return query select v_id, v_num;
end;
$$;

revoke all on function public.submit_detailed_report(uuid, integer, text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.submit_detailed_report(uuid, integer, text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
