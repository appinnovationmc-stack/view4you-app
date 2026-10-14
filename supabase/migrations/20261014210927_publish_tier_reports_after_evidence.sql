alter table public.inspections
  add column if not exists publication_status text not null default 'published'
  check (publication_status in ('pending_evidence','published','rejected'));

create or replace function public.set_inspection_evidence_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tier_id is not null then new.publication_status := 'pending_evidence'; end if;
  return new;
end;
$$;
revoke all on function public.set_inspection_evidence_state() from public,anon,authenticated;
drop trigger if exists inspections_set_evidence_state on public.inspections;
create trigger inspections_set_evidence_state before insert on public.inspections
for each row execute function public.set_inspection_evidence_state();

create or replace function public.publish_inspection_report(p_inspection_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ins public.inspections%rowtype; v_tier_name text; v_min_photos integer; v_photo_count integer; v_measurement_count integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode='28000'; end if;
  select * into v_ins from public.inspections i where i.id=p_inspection_id and i.inspector_id=auth.uid();
  if not found then raise exception 'Inspection not found for this inspector' using errcode='42501'; end if;
  if v_ins.tier_id is null then
    update public.inspections set publication_status='published' where id=p_inspection_id;
    return;
  end if;
  select t.name into v_tier_name from public.inspection_tiers t where t.id=v_ins.tier_id;
  v_min_photos := case lower(v_tier_name) when 'comprehensive' then 12 when 'standard' then 8 else 4 end;
  select count(*) into v_photo_count from public.report_photos p where p.inspection_id=p_inspection_id;
  if v_photo_count < v_min_photos then
    raise exception 'This tier requires at least % uploaded evidence photos; % are recorded',v_min_photos,v_photo_count using errcode='23514';
  end if;
  if lower(v_tier_name)='comprehensive' then
    select count(*) into v_measurement_count from public.report_measurements m where m.inspection_id=p_inspection_id;
    if v_measurement_count<>7 then
      raise exception 'Comprehensive requires all seven recorded measurements before publication' using errcode='23514';
    end if;
  end if;
  update public.inspections set publication_status='published',submitted_at=coalesce(submitted_at,now())
  where id=p_inspection_id;
end;
$$;
revoke all on function public.publish_inspection_report(uuid) from public,anon;
grant execute on function public.publish_inspection_report(uuid) to authenticated;

create or replace function public.guard_report_order_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.inspections i where i.id=new.inspection_id and i.publication_status='published' and i.taken_down_at is null) then
    raise exception 'This report is not published yet or has been taken down' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_report_order_evidence() from public,anon,authenticated;
drop trigger if exists report_orders_published_report_guard on public.report_orders;
create trigger report_orders_published_report_guard before insert or update of inspection_id
on public.report_orders for each row execute function public.guard_report_order_evidence();
drop trigger if exists report_purchases_published_report_guard on public.report_purchases;
create trigger report_purchases_published_report_guard before insert or update of inspection_id
on public.report_purchases for each row execute function public.guard_report_order_evidence();

create or replace function public.can_read_report(p_inspection uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.inspections i
    left join public.bookings b on b.id=i.booking_id
    where i.id=p_inspection and i.taken_down_at is null and (
      i.inspector_id=(select auth.uid())
      or (
        i.publication_status='published' and (
          b.buyer_id=(select auth.uid())
          or exists(select 1 from public.report_purchases rp where rp.inspection_id=i.id and rp.buyer_id=(select auth.uid()))
        )
      )
    )
  );
$$;
