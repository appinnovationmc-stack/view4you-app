alter table public.inspector_tier_services
  add column if not exists can_measure boolean not null default false;

create or replace function public.sync_inspector_tier_services_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tiers jsonb; v_can_measure boolean := false;
begin
  if new.role is distinct from 'inspector' then return new; end if;
  select u.raw_user_meta_data -> 'inspection_tiers',
         coalesce(u.raw_user_meta_data ->> 'can_measure' = 'true', false)
    into v_tiers, v_can_measure from auth.users u where u.id = new.id;
  if jsonb_typeof(v_tiers) = 'array' then
    insert into public.inspector_tier_services(inspector_id,tier_id,can_measure)
    select new.id,t.id,v_can_measure
    from jsonb_array_elements_text(v_tiers) requested(tier_text)
    join public.inspection_tiers t on t.id::text=requested.tier_text and t.active
    where lower(t.name)<>'comprehensive' or v_can_measure
    on conflict (inspector_id,tier_id) do update set can_measure=excluded.can_measure;
  end if;
  if not exists(select 1 from public.inspector_tier_services s where s.inspector_id=new.id) then
    insert into public.inspector_tier_services(inspector_id,tier_id,can_measure)
    select new.id,t.id,false from public.inspection_tiers t
    where t.active and lower(t.name)='basic'
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_inspector_tier_services_on_signup() from public,anon,authenticated;

drop function if exists public.set_my_inspector_tiers(uuid[]);
create or replace function public.set_my_inspector_tiers(p_tier_ids uuid[], p_can_measure boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_active_count integer;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode='28000'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.role='inspector') then
    raise exception 'Only inspectors can update service tiers' using errcode='42501';
  end if;
  if p_tier_ids is null or cardinality(p_tier_ids)<1 or cardinality(p_tier_ids)>3 then
    raise exception 'Select between one and three inspection tiers' using errcode='22023';
  end if;
  select count(distinct t.id) into v_active_count from public.inspection_tiers t
  where t.id=any(p_tier_ids) and t.active;
  if v_active_count<>cardinality(p_tier_ids) then
    raise exception 'One or more selected inspection tiers are unavailable' using errcode='22023';
  end if;
  if exists(select 1 from public.inspection_tiers t where t.id=any(p_tier_ids) and lower(t.name)='comprehensive')
     and not coalesce(p_can_measure,false) then
    raise exception 'Comprehensive requires suitable equipment for measured brake, suspension and alignment tests' using errcode='22023';
  end if;
  delete from public.inspector_tier_services where inspector_id=v_uid;
  insert into public.inspector_tier_services(inspector_id,tier_id,can_measure)
  select v_uid,t.id,coalesce(p_can_measure,false) from public.inspection_tiers t
  where t.id=any(p_tier_ids) and t.active;
end;
$$;
revoke all on function public.set_my_inspector_tiers(uuid[],boolean) from public,anon;
grant execute on function public.set_my_inspector_tiers(uuid[],boolean) to authenticated;

create or replace function public.get_my_inspector_can_measure()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_or(s.can_measure),false)
  from public.inspector_tier_services s where s.inspector_id=auth.uid();
$$;
revoke all on function public.get_my_inspector_can_measure() from public,anon;
grant execute on function public.get_my_inspector_can_measure() to authenticated;

create or replace function public.list_inspectors_with_tiers()
returns table (
  id uuid,name text,first_name text,init text,cert text,experience text,
  region text,specialty text,bio text,rating numeric,jobs_completed integer,
  price integer,eta_minutes integer,online boolean,top_rated boolean,tier_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  select d.id,d.name,d.first_name,d.init,d.cert,d.experience,d.region,d.specialty,
         d.bio,d.rating,d.jobs_completed,d.price,d.eta_minutes,d.online,d.top_rated,
         coalesce(array_agg(s.tier_id) filter (
           where s.tier_id is not null and (lower(t.name)<>'comprehensive' or s.can_measure)
         ),'{}'::uuid[])
  from public.inspector_directory d
  left join public.inspector_tier_services s on s.inspector_id=d.id
  left join public.inspection_tiers t on t.id=s.tier_id
  group by d.id,d.name,d.first_name,d.init,d.cert,d.experience,d.region,d.specialty,
           d.bio,d.rating,d.jobs_completed,d.price,d.eta_minutes,d.online,d.top_rated;
$$;
revoke all on function public.list_inspectors_with_tiers() from public;
grant execute on function public.list_inspectors_with_tiers() to anon,authenticated;

create or replace function public.enforce_booking_inspector_tier_service()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tier_name text;
begin
  if new.tier_id is not null and new.inspector_id is null then
    raise exception 'A tiered inspection must be assigned to an inspector who offers that tier' using errcode='23514';
  end if;
  if new.tier_id is not null then
    select t.name into v_tier_name from public.inspection_tiers t where t.id=new.tier_id and t.active;
    if not found then raise exception 'Selected inspection tier is not active' using errcode='23514'; end if;
    if not exists(select 1 from public.inspector_tier_services s where s.inspector_id=new.inspector_id and s.tier_id=new.tier_id) then
      raise exception 'This inspector does not offer the selected inspection tier' using errcode='23514';
    end if;
    if lower(v_tier_name)='comprehensive' and not exists(
      select 1 from public.inspector_tier_services s where s.inspector_id=new.inspector_id and s.tier_id=new.tier_id and s.can_measure
    ) then
      raise exception 'Comprehensive requires an inspector with suitable measurement equipment' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_booking_inspector_tier_service() from public,anon,authenticated;

create or replace function public.validate_inspection_tier_checklist_on_commit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tier uuid; v_tier_name text; v_expected integer; v_submitted integer; v_measurements integer;
begin
  select b.tier_id into v_tier from public.bookings b where b.id=new.booking_id;
  if v_tier is null then return null; end if;
  select t.name into v_tier_name from public.inspection_tiers t where t.id=v_tier;
  select count(*) into v_expected from public.inspection_tier_checklist_items r where r.tier_id=v_tier and r.required;
  select count(*) into v_submitted from public.report_items i where i.inspection_id=new.id;
  if v_expected=0 then raise exception 'No checklist requirements are configured for this tier' using errcode='23514'; end if;
  if v_submitted<>v_expected then
    raise exception 'Checklist incomplete for this tier: expected % items, received %',v_expected,v_submitted using errcode='23514';
  end if;
  if exists(
    select 1 from public.inspection_tier_checklist_items r
    left join public.report_items i on i.inspection_id=new.id and i.section=r.section and i.component=r.component
    where r.tier_id=v_tier and r.required and i.inspection_id is null
  ) then raise exception 'One or more required checklist items are missing for this tier' using errcode='23514'; end if;
  if exists(
    select 1 from public.report_items i
    left join public.inspection_tier_checklist_items r on r.tier_id=v_tier and r.section=i.section and r.component=i.component and r.required
    where i.inspection_id=new.id and r.component is null
  ) then raise exception 'Report contains items outside the booked tier scope' using errcode='23514'; end if;
  if lower(v_tier_name)='comprehensive' then
    select count(*) into v_measurements from public.report_measurements m where m.inspection_id=new.id;
    if v_measurements<>7 then
      raise exception 'Comprehensive requires all seven measured tests; received %',v_measurements using errcode='23514';
    end if;
    if exists(
      select 1 from (values
        ('brake','Front Axle'),('brake','Rear Axle'),('brake','Parking Brake'),
        ('shock','Front Axle'),('shock','Rear Axle'),('slip','Front Axle'),('slip','Rear Axle')
      ) required(test_name,position_name)
      left join public.report_measurements m on m.inspection_id=new.id and m.test=required.test_name and m.position=required.position_name
      where m.inspection_id is null
    ) then raise exception 'Comprehensive is missing one or more required measured tests' using errcode='23514'; end if;
  end if;
  return null;
end;
$$;
revoke all on function public.validate_inspection_tier_checklist_on_commit() from public,anon,authenticated;
