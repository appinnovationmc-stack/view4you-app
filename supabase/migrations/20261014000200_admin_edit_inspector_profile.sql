-- Admins can set an inspector's credentials, price and ETA. Inspectors cannot self-declare these.
-- Booking requires a price > 0, so a freshly approved inspector was unbookable until this existed.

drop function if exists public.admin_list_inspectors(text);
create function public.admin_list_inspectors(p_status text default 'all')
returns table(id uuid, name text, email text, phone text, cert text, licence text, region text, approved boolean,
              online boolean, jobs_completed integer, rating numeric, price integer, created_at timestamptz,
              docs_pending bigint, docs_approved bigint, docs_rejected bigint,
              experience text, eta_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'pending', 'approved') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select p.id, p.name, p.email, p.phone, p.cert, p.licence, p.region, p.approved, p.online,
           p.jobs_completed, p.rating, p.price, p.created_at,
           (select count(*) from public.inspector_documents d where d.user_id = p.id and d.status = 'pending'),
           (select count(*) from public.inspector_documents d where d.user_id = p.id and d.status = 'approved'),
           (select count(*) from public.inspector_documents d where d.user_id = p.id and d.status = 'rejected'),
           p.experience, p.eta_minutes
      from public.profiles p
     where p.role = 'inspector'
       and (p_status = 'all' or (p_status = 'pending' and not p.approved) or (p_status = 'approved' and p.approved))
     order by p.approved, p.created_at desc
     limit 500;
end $$;

create or replace function public.admin_update_inspector_profile(
  p_inspector_id uuid, p_cert text, p_licence text, p_region text, p_experience text,
  p_price integer, p_eta_minutes integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_cert text := nullif(btrim(coalesce(p_cert, '')), '');
        v_lic  text := nullif(btrim(coalesce(p_licence, '')), '');
        v_reg  text := nullif(btrim(coalesce(p_region, '')), '');
        v_exp  text := nullif(btrim(coalesce(p_experience, '')), '');
begin
  perform public.lc_require_admin(true);
  if coalesce(length(v_cert), 0) > 120 or coalesce(length(v_lic), 0) > 120
     or coalesce(length(v_reg), 0) > 120 or coalesce(length(v_exp), 0) > 120 then
    raise exception 'Each field must be 120 characters or fewer' using errcode = '22023';
  end if;
  if p_price is not null and p_price not between 1 and 100000 then
    raise exception 'Price must be between R1 and R100000' using errcode = '22023';
  end if;
  if p_eta_minutes is not null and p_eta_minutes not between 1 and 600 then
    raise exception 'ETA must be between 1 and 600 minutes' using errcode = '22023';
  end if;
  update public.profiles
     set cert = v_cert, licence = v_lic, region = v_reg, experience = v_exp,
         price = p_price, eta_minutes = p_eta_minutes
   where id = p_inspector_id and role = 'inspector';
  if not found then raise exception 'No such inspector' using errcode = 'P0002'; end if;
  perform public.lc_audit('inspector_profile_updated', 'profile', p_inspector_id::text,
    jsonb_build_object('cert', v_cert, 'licence', v_lic, 'region', v_reg, 'experience', v_exp,
                       'price', p_price, 'eta_minutes', p_eta_minutes));
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_list_inspectors(text)',
    'admin_update_inspector_profile(uuid,text,text,text,text,integer,integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
