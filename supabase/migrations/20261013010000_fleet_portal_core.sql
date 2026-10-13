-- CheckVertical Fleet & Asset Portal — 20261013010000 core: tenancy, roles, access, audit (forward-only).
--
-- The portal is a SEPARATE product from the consumer app and the operator admin console. It has its own
-- sign-in, its own web app (fleet/) and its own tables (all prefixed fleet_). Nothing here changes an
-- existing table, and no consumer / inspector / admin_users account gets any access by being one.
--
-- Two sides, each with its own role levels:
--   CheckVertical side   fleet_platform_staff   platform_admin (provision + suspend client organisations)
--                                               platform_support (read-only, organisation level)
--   Client side (e.g. ARC, a municipality, a company)   fleet_members.role, optionally scoped to an org unit:
--                        tenant_admin, fleet_manager, property_manager, finance_officer,
--                        site_manager, driver, auditor
--
-- Privacy decision (government data): CheckVertical staff manage organisations, access and usage counts but
-- have NO access to a client's vehicles, drivers, properties, expenses or documents unless the client's
-- tenant_admin adds them as a member. Change that deliberately, not by accident.

-- ---------------------------------------------------------------------------
-- Organisations, hierarchy, people
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 120),
  kind          text not null check (kind in ('government', 'company')),
  contact_email text,
  status        text not null default 'active' check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now()
);

create table if not exists public.fleet_platform_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'platform_support' check (role in ('platform_admin', 'platform_support')),
  note       text,
  created_at timestamptz not null default now()
);

-- Government / company hierarchy: head office -> region -> district -> depot / site.
create table if not exists public.fleet_units (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.fleet_tenants(id) on delete cascade,
  parent_id  uuid references public.fleet_units(id) on delete restrict,
  name       text not null check (length(btrim(name)) between 1 and 120),
  kind       text not null default 'site' check (kind in ('head_office', 'region', 'province', 'district', 'depot', 'site', 'department')),
  created_at timestamptz not null default now()
);
create index if not exists fleet_units_tenant on public.fleet_units (tenant_id, parent_id);

create table if not exists public.fleet_members (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.fleet_tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('tenant_admin', 'fleet_manager', 'property_manager', 'finance_officer', 'site_manager', 'driver', 'auditor')),
  unit_id    uuid references public.fleet_units(id) on delete set null,   -- null = whole organisation
  full_name  text,
  email      text,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists fleet_members_user on public.fleet_members (user_id);

create table if not exists public.fleet_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.fleet_tenants(id) on delete cascade,
  email       text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role        text not null check (role in ('tenant_admin', 'fleet_manager', 'property_manager', 'finance_officer', 'site_manager', 'driver', 'auditor')),
  unit_id     uuid references public.fleet_units(id) on delete set null,
  full_name   text,
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists fleet_invites_open on public.fleet_invites (tenant_id, email) where accepted_at is null;
create index if not exists fleet_invites_email on public.fleet_invites (email) where accepted_at is null;

create table if not exists public.fleet_audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid,
  actor      uuid,
  table_name text not null,
  row_id     text,
  action     text not null,
  changes    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fleet_audit_tenant on public.fleet_audit_log (tenant_id, created_at desc);

alter table public.fleet_tenants        enable row level security;
alter table public.fleet_platform_staff enable row level security;
alter table public.fleet_units          enable row level security;
alter table public.fleet_members        enable row level security;
alter table public.fleet_invites        enable row level security;
alter table public.fleet_audit_log      enable row level security;

revoke all on public.fleet_tenants, public.fleet_platform_staff, public.fleet_units, public.fleet_members,
              public.fleet_invites, public.fleet_audit_log from anon, authenticated;
grant select on public.fleet_tenants, public.fleet_units, public.fleet_members, public.fleet_invites, public.fleet_audit_log to authenticated;
grant insert, update, delete on public.fleet_units to authenticated;       -- gated by policy: tenant_admin only
-- fleet_platform_staff: no client access at all. fleet_members / fleet_invites / fleet_tenants: changed only by the RPCs below.

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER so policies can use them without recursing into RLS)
-- ---------------------------------------------------------------------------
create or replace function public.fleet_platform_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.fleet_platform_staff s where s.user_id = auth.uid()
$$;

-- The caller's role inside a tenant, or null (not a member, suspended, or the organisation is suspended).
create or replace function public.fleet_role_in(p_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
    from public.fleet_members m
    join public.fleet_tenants t on t.id = m.tenant_id and t.status = 'active'
   where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.fleet_member_id(p_tenant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.fleet_members m
   where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
$$;

-- Permission matrix. areas: fleet (vehicles, drivers, scheduling, maintenance, fuel, incidents, tracking,
-- compliance) | finance (expenses, cost recovery) | property (land and buildings) | people (units, access).
create or replace function public.fleet_can(p_tenant uuid, p_area text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case public.fleet_role_in(p_tenant)
    when 'tenant_admin'      then true
    when 'fleet_manager'     then p_area = 'fleet'    or (not p_write and p_area in ('finance', 'property'))
    when 'property_manager'  then p_area = 'property' or (not p_write and p_area in ('fleet', 'finance'))
    when 'finance_officer'   then p_area = 'finance'  or (not p_write and p_area in ('fleet', 'property'))
    when 'site_manager'      then p_area = 'fleet'    or (not p_write and p_area in ('finance', 'property'))
    when 'auditor'           then not p_write and p_area in ('fleet', 'finance', 'property', 'people')
    else false end, false)
$$;

-- Units at or below p_unit.
create or replace function public.fleet_unit_descendants(p_unit uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive d(id) as (
    select u.id from public.fleet_units u where u.id = p_unit
    union
    select c.id from public.fleet_units c join d on c.parent_id = d.id
  ) select id from d
$$;

-- Row scope: organisation-wide members see every row; unit-scoped members only rows in their unit subtree.
create or replace function public.fleet_unit_ok(p_tenant uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when m.unit_id is null then true
                when p_unit is null then false
                else exists (select 1 from public.fleet_unit_descendants(m.unit_id) d(id) where d.id = p_unit) end
      from public.fleet_members m
      join public.fleet_tenants t on t.id = m.tenant_id and t.status = 'active'
     where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
  ), false)
$$;

revoke execute on function public.fleet_platform_role(), public.fleet_role_in(uuid), public.fleet_member_id(uuid),
  public.fleet_can(uuid, text, boolean), public.fleet_unit_descendants(uuid), public.fleet_unit_ok(uuid, uuid) from public, anon;
grant execute on function public.fleet_platform_role(), public.fleet_role_in(uuid), public.fleet_member_id(uuid),
  public.fleet_can(uuid, text, boolean), public.fleet_unit_descendants(uuid), public.fleet_unit_ok(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies on the core tables
-- ---------------------------------------------------------------------------
drop policy if exists fleet_tenants_read on public.fleet_tenants;
create policy fleet_tenants_read on public.fleet_tenants for select to authenticated
  using (public.fleet_platform_role() is not null
         or exists (select 1 from public.fleet_members m where m.tenant_id = id and m.user_id = auth.uid() and m.status = 'active'));

drop policy if exists fleet_units_read on public.fleet_units;
create policy fleet_units_read on public.fleet_units for select to authenticated
  using (public.fleet_role_in(tenant_id) is not null);
drop policy if exists fleet_units_write on public.fleet_units;
create policy fleet_units_write on public.fleet_units for all to authenticated
  using (public.fleet_role_in(tenant_id) = 'tenant_admin')
  with check (public.fleet_role_in(tenant_id) = 'tenant_admin'
              and (parent_id is null or exists (select 1 from public.fleet_units p where p.id = parent_id and p.tenant_id = fleet_units.tenant_id)));

-- Members see themselves; tenant_admin / auditor see the whole organisation; platform staff see members only to provision.
drop policy if exists fleet_members_read on public.fleet_members;
create policy fleet_members_read on public.fleet_members for select to authenticated
  using (user_id = auth.uid()
         or public.fleet_role_in(tenant_id) in ('tenant_admin', 'auditor')
         or public.fleet_platform_role() is not null);

drop policy if exists fleet_invites_read on public.fleet_invites;
create policy fleet_invites_read on public.fleet_invites for select to authenticated
  using (public.fleet_role_in(tenant_id) = 'tenant_admin' or public.fleet_platform_role() is not null);

drop policy if exists fleet_audit_read on public.fleet_audit_log;
create policy fleet_audit_read on public.fleet_audit_log for select to authenticated
  using (public.fleet_role_in(tenant_id) in ('tenant_admin', 'auditor')
         or (public.fleet_platform_role() is not null and table_name in ('fleet_tenants', 'fleet_members', 'fleet_invites')));

-- ---------------------------------------------------------------------------
-- Audit trigger (attached to every fleet table; rows cannot be edited by clients)
-- ---------------------------------------------------------------------------
create or replace function public.fleet_audit_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_changes jsonb; v_row jsonb; v_tenant uuid;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new); v_row := v_new; v_changes := v_new;
  elsif tg_op = 'DELETE' then v_old := to_jsonb(old); v_row := v_old; v_changes := v_old;
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value)), '{}'::jsonb)
      into v_changes
      from jsonb_each(v_new) n
     where n.value is distinct from (v_old -> n.key) and n.key <> 'updated_at';
    if v_changes = '{}'::jsonb then return null; end if;
  end if;
  v_tenant := coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'fleet_tenants' then (v_row ->> 'id')::uuid end);
  insert into public.fleet_audit_log (tenant_id, actor, table_name, row_id, action, changes)
  values (v_tenant, auth.uid(), tg_table_name, v_row ->> 'id', lower(tg_op), v_changes);
  return null;
end $$;

drop trigger if exists fleet_audit on public.fleet_tenants;
create trigger fleet_audit after insert or update or delete on public.fleet_tenants for each row execute function public.fleet_audit_trg();
drop trigger if exists fleet_audit on public.fleet_units;
create trigger fleet_audit after insert or update or delete on public.fleet_units for each row execute function public.fleet_audit_trg();
drop trigger if exists fleet_audit on public.fleet_members;
create trigger fleet_audit after insert or update or delete on public.fleet_members for each row execute function public.fleet_audit_trg();
drop trigger if exists fleet_audit on public.fleet_invites;
create trigger fleet_audit after insert or update or delete on public.fleet_invites for each row execute function public.fleet_audit_trg();

create or replace function public.fleet_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Identity: who am I, and claiming an invitation
-- ---------------------------------------------------------------------------
create or replace function public.fleet_whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'platform_role', public.fleet_platform_role(),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', m.id, 'tenant_id', t.id, 'tenant_name', t.name, 'tenant_kind', t.kind,
               'role', m.role, 'unit_id', m.unit_id, 'unit_name', u.name) order by t.name)
        from public.fleet_members m
        join public.fleet_tenants t on t.id = m.tenant_id and t.status = 'active'
        left join public.fleet_units u on u.id = m.unit_id
       where m.user_id = auth.uid() and m.status = 'active'
    ), '[]'::jsonb))
$$;

-- Turns invitations addressed to the caller's CONFIRMED email into memberships. Safe to call on every sign-in.
create or replace function public.fleet_claim_invites() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_n integer := 0; r record;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for r in select * from public.fleet_invites i
            where i.email = v_email and i.accepted_at is null
              and exists (select 1 from public.fleet_tenants t where t.id = i.tenant_id and t.status = 'active')
            for update loop
    insert into public.fleet_members (tenant_id, user_id, role, unit_id, full_name, email)
    values (r.tenant_id, v_uid, r.role, r.unit_id, r.full_name, v_email)
    on conflict (tenant_id, user_id) do nothing;
    update public.fleet_invites set accepted_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Client-side people management (tenant_admin) and CheckVertical-side provisioning (platform_admin)
-- ---------------------------------------------------------------------------
create or replace function public.fleet_invite_member(p_tenant uuid, p_email text, p_role text, p_unit uuid default null, p_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if public.fleet_role_in(p_tenant) is distinct from 'tenant_admin' and public.fleet_platform_role() is distinct from 'platform_admin' then
    raise exception 'Only an organisation administrator can invite people' using errcode = '42501';
  end if;
  if public.fleet_platform_role() is not null and public.fleet_role_in(p_tenant) is null and p_role <> 'tenant_admin' then
    raise exception 'CheckVertical staff can only invite the first organisation administrator' using errcode = '42501';
  end if;
  if position('@' in v_email) < 2 then raise exception 'A valid email address is required'; end if;
  if p_role not in ('tenant_admin', 'fleet_manager', 'property_manager', 'finance_officer', 'site_manager', 'driver', 'auditor') then
    raise exception 'Unknown role %', p_role;
  end if;
  if p_unit is not null and not exists (select 1 from public.fleet_units u where u.id = p_unit and u.tenant_id = p_tenant) then
    raise exception 'That unit does not belong to this organisation';
  end if;
  if exists (select 1 from public.fleet_members m join auth.users u on u.id = m.user_id
              where m.tenant_id = p_tenant and lower(u.email) = v_email) then
    raise exception 'That person is already a member';
  end if;
  insert into public.fleet_invites (tenant_id, email, role, unit_id, full_name, invited_by)
  values (p_tenant, v_email, p_role, p_unit, nullif(btrim(p_name), ''), auth.uid())
  on conflict (tenant_id, email) where accepted_at is null
  do update set role = excluded.role, unit_id = excluded.unit_id, full_name = excluded.full_name, invited_by = excluded.invited_by
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fleet_revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.fleet_invites where id = p_invite and accepted_at is null;
  if v_tenant is null then raise exception 'Invitation not found'; end if;
  if public.fleet_role_in(v_tenant) is distinct from 'tenant_admin' and public.fleet_platform_role() is distinct from 'platform_admin' then
    raise exception 'Only an organisation administrator can revoke invitations' using errcode = '42501';
  end if;
  delete from public.fleet_invites where id = p_invite;
end $$;

-- Change a member's role / unit / status. The last active tenant_admin can never be removed or demoted.
create or replace function public.fleet_set_member(p_member uuid, p_role text, p_unit uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.fleet_members%rowtype; v_admins integer;
begin
  select * into m from public.fleet_members where id = p_member for update;
  if not found then raise exception 'Member not found'; end if;
  if public.fleet_role_in(m.tenant_id) is distinct from 'tenant_admin' and public.fleet_platform_role() is distinct from 'platform_admin' then
    raise exception 'Only an organisation administrator can change access' using errcode = '42501';
  end if;
  if p_role not in ('tenant_admin', 'fleet_manager', 'property_manager', 'finance_officer', 'site_manager', 'driver', 'auditor') then
    raise exception 'Unknown role %', p_role;
  end if;
  if p_status not in ('active', 'suspended') then raise exception 'Unknown status %', p_status; end if;
  if p_unit is not null and not exists (select 1 from public.fleet_units u where u.id = p_unit and u.tenant_id = m.tenant_id) then
    raise exception 'That unit does not belong to this organisation';
  end if;
  if m.role = 'tenant_admin' and m.status = 'active' and (p_role <> 'tenant_admin' or p_status <> 'active') then
    select count(*) into v_admins from public.fleet_members x where x.tenant_id = m.tenant_id and x.role = 'tenant_admin' and x.status = 'active';
    if v_admins <= 1 then raise exception 'An organisation must keep at least one active administrator'; end if;
  end if;
  update public.fleet_members set role = p_role, unit_id = p_unit, status = p_status where id = p_member;
end $$;

-- CheckVertical side ---------------------------------------------------------
create or replace function public.fleet_platform_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.fleet_platform_role() is null then raise exception 'CheckVertical staff access required' using errcode = '42501'; end if;
  -- Counts only. No operational record is ever returned to the platform side.
  return jsonb_build_object('tenants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'kind', t.kind, 'status', t.status, 'created_at', t.created_at, 'contact_email', t.contact_email,
      'members', (select count(*) from public.fleet_members m where m.tenant_id = t.id and m.status = 'active'),
      'pending_invites', (select count(*) from public.fleet_invites i where i.tenant_id = t.id and i.accepted_at is null),
      'units', (select count(*) from public.fleet_units u where u.tenant_id = t.id),
      'vehicles', public.fleet_vehicles_count(t.id),
      'properties', public.fleet_properties_count(t.id)
    ) order by t.name) from public.fleet_tenants t), '[]'::jsonb));
end $$;

create or replace function public.fleet_platform_create_tenant(p_name text, p_kind text, p_admin_email text, p_admin_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.fleet_platform_role() is distinct from 'platform_admin' then
    raise exception 'This action needs the CheckVertical platform administrator role' using errcode = '42501';
  end if;
  if p_kind not in ('government', 'company') then raise exception 'Kind must be government or company'; end if;
  insert into public.fleet_tenants (name, kind, contact_email) values (btrim(p_name), p_kind, lower(btrim(p_admin_email))) returning id into v_id;
  perform public.fleet_invite_member(v_id, p_admin_email, 'tenant_admin', null, p_admin_name);
  return v_id;
end $$;

create or replace function public.fleet_platform_set_tenant_status(p_tenant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.fleet_platform_role() is distinct from 'platform_admin' then
    raise exception 'This action needs the CheckVertical platform administrator role' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then raise exception 'Unknown status %', p_status; end if;
  update public.fleet_tenants set status = p_status where id = p_tenant;
  if not found then raise exception 'Organisation not found'; end if;
end $$;

revoke execute on function public.fleet_audit_trg(), public.fleet_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.fleet_whoami(), public.fleet_claim_invites(),
  public.fleet_invite_member(uuid, text, text, uuid, text), public.fleet_revoke_invite(uuid),
  public.fleet_set_member(uuid, text, uuid, text), public.fleet_platform_overview(),
  public.fleet_platform_create_tenant(text, text, text, text), public.fleet_platform_set_tenant_status(uuid, text) from public, anon;
grant execute on function public.fleet_whoami(), public.fleet_claim_invites(),
  public.fleet_invite_member(uuid, text, text, uuid, text), public.fleet_revoke_invite(uuid),
  public.fleet_set_member(uuid, text, uuid, text), public.fleet_platform_overview(),
  public.fleet_platform_create_tenant(text, text, text, text), public.fleet_platform_set_tenant_status(uuid, text) to authenticated;
