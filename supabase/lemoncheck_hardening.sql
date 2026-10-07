-- LemonCheck production hardening
-- Apply after schema.sql, report_schema.sql and submit_report_rpc.sql.
-- This file is safe to re-run.

-- 1. Create profiles server-side at signup so email confirmation does not
-- leave a new user without a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_first text;
  v_init text;
  v_role public.user_role;
begin
  v_name := coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1));
  v_first := coalesce(nullif(new.raw_user_meta_data->>'first_name',''), split_part(v_name,' ',1));
  v_init := coalesce(nullif(new.raw_user_meta_data->>'init',''), upper(left(regexp_replace(v_name,'[^A-Za-z]','','g'),2)));
  if v_init is null or v_init = '' then v_init := 'U'; end if;

  begin
    v_role := (new.raw_user_meta_data->>'role')::public.user_role;
  exception when invalid_text_representation then
    v_role := 'buyer';
  end;

  insert into public.profiles(id, role, name, first_name, init, email)
  values(new.id, v_role, v_name, v_first, v_init, new.email)
  on conflict (id) do update set
    name = excluded.name,
    first_name = excluded.first_name,
    init = excluded.init,
    email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 2. The browser must never insert arbitrary report prices/payouts.
create or replace function public.purchase_report(p_inspection_id uuid)
returns public.report_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inspection public.inspections%rowtype;
  v_booking public.bookings%rowtype;
  v_row public.report_purchases%rowtype;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_inspection
  from public.inspections
  where id = p_inspection_id
  for update;

  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  select * into v_booking from public.bookings where id = v_inspection.booking_id;

  if v_booking.buyer_id = v_user then
    raise exception 'The commissioning buyer already owns this report' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.report_purchases
    where inspection_id = p_inspection_id and buyer_id = v_user
  ) then
    select * into v_row from public.report_purchases
    where inspection_id = p_inspection_id and buyer_id = v_user;
    return v_row;
  end if;

  insert into public.report_purchases(
    inspection_id, buyer_id, amount_paid, payer_earning, inspector_earning
  )
  values(
    p_inspection_id, v_user,
    v_inspection.report_price,
    v_inspection.payer_cut,
    v_inspection.inspector_cut
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.purchase_report(uuid) from public, anon;
grant execute on function public.purchase_report(uuid) to authenticated;

-- 3. Report notifications are generated server-side.
create or replace function public.notify_report_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid;
begin
  select buyer_id into v_buyer from public.bookings where id = new.booking_id;
  if v_buyer is not null then
    insert into public.notifications(user_id,type,icon,title,body)
    values(
      v_buyer,'sys','🍋','Your LemonCheck report is ready',
      'Your inspection report ' || coalesce(new.report_number,'') || ' is now available.'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_completed_notification on public.inspections;
create trigger trg_report_completed_notification
after insert on public.inspections
for each row execute function public.notify_report_completed();

create or replace function public.notify_report_purchased()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inspector uuid;
  v_tracker uuid;
  v_vin text;
begin
  select i.inspector_id, i.vin, v.first_tracked_by
    into v_inspector, v_vin, v_tracker
  from public.inspections i
  join public.vehicles v on v.vin = i.vin
  where i.id = new.inspection_id;

  if v_tracker is not null and v_tracker <> new.buyer_id then
    insert into public.notifications(user_id,type,icon,title,body)
    values(v_tracker,'earn','🍋','Report sold again',
      'Your vehicle report for ' || v_vin || ' generated R' || new.payer_earning || '.');
  end if;

  if v_inspector is not null and v_inspector <> new.buyer_id then
    insert into public.notifications(user_id,type,icon,title,body)
    values(v_inspector,'earn','💰','Report resale earned',
      'Your LemonCheck report for ' || v_vin || ' generated R' || new.inspector_earning || '.');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_report_purchase_notification on public.report_purchases;
create trigger trg_report_purchase_notification
after insert on public.report_purchases
for each row execute function public.notify_report_purchased();

revoke all on function public.notify_report_completed() from public, anon, authenticated;
revoke all on function public.notify_report_purchased() from public, anon, authenticated;

-- 4. Notifications are system-generated; clients can only read/update their own.
-- 5. Keep the detailed report tables behind can_read_report().
