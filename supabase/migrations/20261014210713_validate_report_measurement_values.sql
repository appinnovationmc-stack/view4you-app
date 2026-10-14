create or replace function public.validate_report_measurement_values()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.right_value is null then
    raise exception 'Measured test is missing its primary value' using errcode='23514';
  end if;
  if new.test in ('brake','shock') and (new.left_value is null or new.right_value < 0 or new.left_value < 0) then
    raise exception 'Brake and suspension measurements require non-negative left and right values' using errcode='23514';
  end if;
  if new.test='slip' and new.left_value is not null then
    raise exception 'Alignment/slip tests store one signed measurement per axle' using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function public.validate_report_measurement_values() from public,anon,authenticated;
drop trigger if exists report_measurement_values_guard on public.report_measurements;
create constraint trigger report_measurement_values_guard
after insert on public.report_measurements
deferrable initially deferred
for each row execute function public.validate_report_measurement_values();
