-- LemonCheck 20261012000400 — support tickets and messaging (forward-only).
--
-- A buyer or inspector opens a ticket (optionally about one of their own bookings) and talks to support in a
-- thread. Both the 'admin' and 'support' operator roles can read tickets, reply and resolve them: answering
-- customers is the support role's job, so these are the one write that does not need the full admin role.
-- Every operator reply and status change is audited.
--
-- Statuses: open (waiting on support), answered (waiting on the customer), resolved.
-- A customer reply reopens a ticket. A user can have at most 5 unresolved tickets at a time.
--
-- Tables have no client access; everything goes through functions that check ownership.

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete set null,
  subject     text not null check (length(subject) between 3 and 150),
  status      text not null default 'open' check (status in ('open', 'answered', 'resolved')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.support_tickets enable row level security;   -- no policies: invisible to clients
revoke all on public.support_tickets from anon, authenticated;
create index if not exists support_tickets_user on public.support_tickets (user_id, updated_at desc);
create index if not exists support_tickets_status on public.support_tickets (status, updated_at desc);

create table if not exists public.ticket_messages (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  author_id   uuid not null,
  from_staff  boolean not null default false,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
alter table public.ticket_messages enable row level security;   -- no policies: invisible to clients
revoke all on public.ticket_messages from anon, authenticated;
create index if not exists ticket_messages_ticket on public.ticket_messages (ticket_id, id);

-- ---------------------------------------------------------------------------
-- Customer side
-- ---------------------------------------------------------------------------
create or replace function public.open_ticket(p_subject text, p_body text, p_booking_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_subject text := btrim(coalesce(p_subject, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if length(v_subject) < 3 or length(v_subject) > 150 then raise exception 'Give the ticket a short subject' using errcode = '22023'; end if;
  if length(v_body) < 1 or length(v_body) > 4000 then raise exception 'Write a message (up to 4000 characters)' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.support_tickets where user_id = v_uid and status <> 'resolved') >= 5 then
    raise exception 'You have too many open tickets. Wait for support to resolve some first.' using errcode = '54000';
  end if;
  if p_booking_id is not null and not exists (
       select 1 from public.bookings b where b.id = p_booking_id and (b.buyer_id = v_uid or b.inspector_id = v_uid)) then
    raise exception 'That booking is not yours' using errcode = '42501';
  end if;
  insert into public.support_tickets (user_id, booking_id, subject) values (v_uid, p_booking_id, v_subject) returning id into v_id;
  insert into public.ticket_messages (ticket_id, author_id, from_staff, body) values (v_id, v_uid, false, v_body);
  return v_id;
end $$;

create or replace function public.my_tickets()
returns table (id uuid, subject text, status text, booking_id uuid, created_at timestamptz, updated_at timestamptz, messages bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query select t.id, t.subject, t.status, t.booking_id, t.created_at, t.updated_at,
                      (select count(*) from public.ticket_messages m where m.ticket_id = t.id)
                 from public.support_tickets t where t.user_id = auth.uid() order by t.updated_at desc limit 100;
end $$;

create or replace function public.my_ticket_thread(p_ticket uuid)
returns table (id bigint, from_staff boolean, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.support_tickets t where t.id = p_ticket and t.user_id = auth.uid()) then
    raise exception 'No such ticket' using errcode = 'P0002';
  end if;
  return query select m.id, m.from_staff, m.body, m.created_at from public.ticket_messages m where m.ticket_id = p_ticket order by m.id;
end $$;

create or replace function public.reply_my_ticket(p_ticket uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); t public.support_tickets%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if length(v_body) < 1 or length(v_body) > 4000 then raise exception 'Write a message (up to 4000 characters)' using errcode = '22023'; end if;
  select * into t from public.support_tickets where id = p_ticket and user_id = v_uid for update;
  if not found then raise exception 'No such ticket' using errcode = 'P0002'; end if;
  if t.status = 'resolved' and (select count(*) from public.support_tickets where user_id = v_uid and status <> 'resolved') >= 5 then
    raise exception 'You have too many open tickets. Wait for support to resolve some first.' using errcode = '54000';
  end if;
  insert into public.ticket_messages (ticket_id, author_id, from_staff, body) values (p_ticket, v_uid, false, v_body);
  update public.support_tickets set status = 'open', updated_at = now() where id = p_ticket;
end $$;

-- ---------------------------------------------------------------------------
-- Operator side (admin and support roles)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_tickets(p_status text default 'unresolved', p_search text default null)
returns table (id uuid, subject text, status text, user_id uuid, name text, email text, role text, booking_id uuid,
               vin text, created_at timestamptz, updated_at timestamptz, messages bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public.lc_require_admin(false);
  if p_status not in ('all', 'unresolved', 'open', 'answered', 'resolved') then raise exception 'Bad status filter' using errcode = '22023'; end if;
  return query
    select t.id, t.subject, t.status, t.user_id, p.name, p.email, p.role::text, t.booking_id, b.vin, t.created_at, t.updated_at,
           (select count(*) from public.ticket_messages m where m.ticket_id = t.id)
      from public.support_tickets t join public.profiles p on p.id = t.user_id left join public.bookings b on b.id = t.booking_id
     where (p_status = 'all' or (p_status = 'unresolved' and t.status <> 'resolved') or t.status = p_status)
       and (v_search is null or position(v_search in lower(t.subject)) > 0 or position(v_search in lower(p.email)) > 0
            or position(v_search in lower(coalesce(b.vin, ''))) > 0)
     order by (t.status = 'open') desc, t.updated_at desc limit 200;
end $$;

create or replace function public.admin_ticket_thread(p_ticket uuid)
returns table (id bigint, from_staff boolean, author text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  if not exists (select 1 from public.support_tickets t where t.id = p_ticket) then raise exception 'No such ticket' using errcode = 'P0002'; end if;
  return query select m.id, m.from_staff, case when m.from_staff then 'Support' else coalesce(p.name, 'Customer') end, m.body, m.created_at
                 from public.ticket_messages m left join public.profiles p on p.id = m.author_id
                where m.ticket_id = p_ticket order by m.id;
end $$;

create or replace function public.admin_reply_ticket(p_ticket uuid, p_body text, p_resolve boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_body text := btrim(coalesce(p_body, '')); t public.support_tickets%rowtype;
begin
  perform public.lc_require_admin(false);
  if length(v_body) < 1 or length(v_body) > 4000 then raise exception 'Write a message (up to 4000 characters)' using errcode = '22023'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'No such ticket' using errcode = 'P0002'; end if;
  insert into public.ticket_messages (ticket_id, author_id, from_staff, body) values (p_ticket, auth.uid(), true, v_body);
  update public.support_tickets set status = case when coalesce(p_resolve, false) then 'resolved' else 'answered' end, updated_at = now()
   where id = p_ticket;
  insert into public.notifications (user_id, type, icon, title, body)
  values (t.user_id, 'sys', '💬', 'Support replied', 'Support replied to "' || t.subject || '". Open Help to read it.');
  perform public.lc_audit('ticket_replied', 'ticket', p_ticket::text, jsonb_build_object('resolved', coalesce(p_resolve, false)));
end $$;

create or replace function public.admin_set_ticket_status(p_ticket uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets%rowtype;
begin
  perform public.lc_require_admin(false);
  if p_status not in ('open', 'answered', 'resolved') then raise exception 'Bad status' using errcode = '22023'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'No such ticket' using errcode = 'P0002'; end if;
  update public.support_tickets set status = p_status, updated_at = now() where id = p_ticket;
  perform public.lc_audit('ticket_status', 'ticket', p_ticket::text, jsonb_build_object('from', t.status, 'to', p_status));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'open_ticket(text,text,uuid)', 'my_tickets()', 'my_ticket_thread(uuid)', 'reply_my_ticket(uuid,text)',
    'admin_list_tickets(text,text)', 'admin_ticket_thread(uuid)', 'admin_reply_ticket(uuid,text,boolean)', 'admin_set_ticket_status(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
