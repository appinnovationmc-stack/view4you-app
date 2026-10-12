-- LemonCheck 20261012000300 — inspector document upload and review (forward-only).
--
-- * Private storage bucket 'inspector-docs'. An inspector can upload and read only inside their own folder
--   (<user id>/...). Operators can read every file (to open it through a signed URL). Nobody else can.
-- * inspector_documents  one row per uploaded file with a review status. Written only through functions.
-- * Approval gate: when lc_settings.require_documents is on, an inspector cannot be approved until an ID document
--   and a licence/certificate have both been approved. Suspending is never blocked.
-- * admin_list_inspectors now also returns document counts (return type changed, so it is dropped and recreated).
--
-- Nothing here deletes data.

-- ---------------------------------------------------------------------------
-- Helper for storage policies: is the caller an operator? Boolean only; reveals nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.lc_is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
$$;
revoke all on function public.lc_is_operator() from public, anon;
grant execute on function public.lc_is_operator() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspector-docs', 'inspector-docs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists "inspector docs own read" on storage.objects;
create policy "inspector docs own read" on storage.objects for select to authenticated
  using (bucket_id = 'inspector-docs'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.lc_is_operator()));

drop policy if exists "inspector docs own upload" on storage.objects;
create policy "inspector docs own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspector-docs'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'inspector'));

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.inspector_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('id', 'licence', 'proof_of_address', 'other')),
  storage_path  text not null unique,
  file_name     text not null check (length(file_name) between 1 and 200),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.inspector_documents enable row level security;   -- no policies: invisible to clients
revoke all on public.inspector_documents from anon, authenticated;
create index if not exists inspector_documents_user on public.inspector_documents (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Inspector side
-- ---------------------------------------------------------------------------
-- Call after the file is uploaded to inspector-docs/<user id>/<anything>.
create or replace function public.register_my_document(p_kind text, p_path text, p_file_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'inspector') then
    raise exception 'Only inspectors upload documents' using errcode = '42501';
  end if;
  if p_kind not in ('id', 'licence', 'proof_of_address', 'other') then
    raise exception 'Unknown document type' using errcode = '22023';
  end if;
  if p_path is null or position((v_uid::text || '/') in p_path) <> 1 or p_path ~ '\.\.' or length(p_path) > 300 then
    raise exception 'Bad file path' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_file_name, '')), '') is null then raise exception 'File name is required' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'inspector-docs' and o.name = p_path) then
    raise exception 'The file was not uploaded' using errcode = '22023';
  end if;
  if (select count(*) from public.inspector_documents where user_id = v_uid) >= 12 then
    raise exception 'You have uploaded the maximum number of documents' using errcode = '54000';
  end if;
  insert into public.inspector_documents (user_id, kind, storage_path, file_name)
  values (v_uid, p_kind, p_path, left(btrim(p_file_name), 200)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.my_documents()
returns table (id uuid, kind text, file_name text, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query select d.id, d.kind, d.file_name, d.status, d.reject_reason, d.created_at
                 from public.inspector_documents d where d.user_id = auth.uid() order by d.created_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- Operator side
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_documents(p_user uuid)
returns table (id uuid, kind text, file_name text, storage_path text, status text, reject_reason text,
               reviewed_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query select d.id, d.kind, d.file_name, d.storage_path, d.status, d.reject_reason, d.reviewed_at, d.created_at
                 from public.inspector_documents d where d.user_id = p_user order by d.created_at desc;
end $$;

create or replace function public.admin_review_document(p_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.inspector_documents%rowtype;
begin
  perform public.lc_require_admin(true);
  if p_approve is null then raise exception 'approve is required' using errcode = '22023'; end if;
  if not p_approve and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when rejecting a document' using errcode = '22023';
  end if;
  select * into d from public.inspector_documents where id = p_id for update;
  if not found then raise exception 'No such document' using errcode = 'P0002'; end if;
  update public.inspector_documents
     set status = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else trim(p_reason) end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  insert into public.notifications (user_id, type, icon, title, body)
  values (d.user_id, 'sys', case when p_approve then '✅' else '⚠️' end,
          case when p_approve then 'Document approved' else 'Document needs attention' end,
          case when p_approve then 'Your ' || d.file_name || ' was approved.'
               else 'Your ' || d.file_name || ' was not accepted: ' || trim(p_reason) || '. Please upload a new one.' end);
  perform public.lc_audit(case when p_approve then 'document_approved' else 'document_rejected' end, 'document', p_id::text,
                          jsonb_build_object('user', d.user_id, 'kind', d.kind, 'reason', p_reason));
end $$;

-- Return type gains document counts, so replace rather than alter.
drop function if exists public.admin_list_inspectors(text);
create function public.admin_list_inspectors(p_status text default 'all')
returns table (id uuid, name text, email text, phone text, cert text, licence text, region text, approved boolean,
               online boolean, jobs_completed integer, rating numeric, price integer, created_at timestamptz,
               docs_pending bigint, docs_approved bigint, docs_rejected bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'pending', 'approved') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select p.id, p.name, p.email, p.phone, p.cert, p.licence, p.region, p.approved, p.online,
           p.jobs_completed, p.rating, p.price, p.created_at,
           (select count(*) from public.inspector_documents d where d.user_id = p.id and d.status = 'pending'),
           (select count(*) from public.inspector_documents d where d.user_id = p.id and d.status = 'approved'),
           (select count(*) from public.inspector_documents d where d.user_id = p.id and d.status = 'rejected')
      from public.profiles p
     where p.role = 'inspector'
       and (p_status = 'all' or (p_status = 'pending' and not p.approved) or (p_status = 'approved' and p.approved))
     order by p.approved, p.created_at desc
     limit 500;
end $$;

-- Approval gate (same signature and behaviour as before, plus the document check).
create or replace function public.admin_set_inspector_approval(p_inspector_id uuid, p_approved boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_approved is null then raise exception 'approved is required' using errcode = '22023'; end if;
  if not p_approved and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when suspending an inspector' using errcode = '22023';
  end if;
  if p_approved and (select require_documents from public.lc_settings where id = 1)
     and not (exists (select 1 from public.inspector_documents where user_id = p_inspector_id and kind = 'id' and status = 'approved')
              and exists (select 1 from public.inspector_documents where user_id = p_inspector_id and kind = 'licence' and status = 'approved')) then
    raise exception 'Approve an ID document and a licence first (documents are required in Settings)' using errcode = '55000';
  end if;
  update public.profiles
     set approved = p_approved,
         online   = case when p_approved then online else false end   -- a suspended inspector goes offline at once
   where id = p_inspector_id and role = 'inspector';
  if not found then raise exception 'No such inspector' using errcode = 'P0002'; end if;
  perform public.lc_audit(case when p_approved then 'inspector_approved' else 'inspector_suspended' end,
                          'profile', p_inspector_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'register_my_document(text,text,text)', 'my_documents()', 'admin_list_documents(uuid)',
    'admin_review_document(uuid,boolean,text)', 'admin_list_inspectors(text)', 'admin_set_inspector_approval(uuid,boolean,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
