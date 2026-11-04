-- Admin console: list and approve/suspend partner workshops (same pattern as inspectors).
create or replace function public.admin_list_workshops(p_status text default 'all')
returns table (id uuid, name text, email text, phone text, business_name text, area text, address text, services text, brands text,
               approved boolean, created_at timestamptz, quotes_sent bigint, quotes_accepted bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'pending', 'approved') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select p.id, p.name, p.email, p.phone, w.business_name, w.area, w.address, w.services, w.brands, p.approved, p.created_at,
           (select count(*) from public.repair_quotes q where q.workshop_id = p.id),
           (select count(*) from public.repair_quotes q where q.workshop_id = p.id and q.status = 'accepted')
      from public.profiles p left join public.workshop_details w on w.workshop_id = p.id
     where p.role = 'workshop'
       and (p_status = 'all' or (p_status = 'pending' and not p.approved) or (p_status = 'approved' and p.approved))
     order by p.approved, p.created_at desc
     limit 500;
end $$;

create or replace function public.admin_set_workshop_approval(p_workshop_id uuid, p_approved boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_approved is null then raise exception 'approved is required' using errcode = '22023'; end if;
  if not p_approved and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when suspending a workshop' using errcode = '22023';
  end if;
  if p_approved and not exists (select 1 from public.workshop_details where workshop_id = p_workshop_id) then
    raise exception 'The workshop has not completed its business profile yet' using errcode = '55000';
  end if;
  update public.profiles set approved = p_approved where id = p_workshop_id and role = 'workshop';
  if not found then raise exception 'No such workshop' using errcode = 'P0002'; end if;
  insert into public.notifications (user_id, type, icon, title, body)
  values (p_workshop_id, 'sys', case when p_approved then '✅' else '⚠️' end,
          case when p_approved then 'Your workshop is approved' else 'Your workshop was suspended' end,
          case when p_approved then 'You can now see repair requests and send quotes.' else 'You can no longer send quotes. Contact support for details.' end);
  perform public.lc_audit(case when p_approved then 'workshop_approved' else 'workshop_suspended' end,
                          'profile', p_workshop_id::text, jsonb_build_object('reason', p_reason));
end $$;

revoke all on function public.admin_list_workshops(text), public.admin_set_workshop_approval(uuid, boolean, text) from public, anon;
grant execute on function public.admin_list_workshops(text), public.admin_set_workshop_approval(uuid, boolean, text) to authenticated;
