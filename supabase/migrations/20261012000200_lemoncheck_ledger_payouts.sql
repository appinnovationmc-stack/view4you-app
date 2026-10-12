-- LemonCheck 20261012000200 — earnings ledger, bank details and withdrawals (forward-only).
--
-- * ledger_entries     append-only record of what each user has earned and been paid, in whole rand.
--                      Credits are written by triggers (never by clients): the inspector's job fee when a report is
--                      submitted, and the inspector / payer resale shares when a report is bought.
--                      A paid withdrawal is a negative 'payout' row. Operators can add a signed 'adjustment'.
--                      balance = sum(amount). No UPDATE or DELETE is possible for any role but service_role.
-- * payout_accounts    one bank account per user. No client access: written and read only through functions.
-- * withdrawal_requests  a user asks to be paid; an admin pays it in the bank and records the reference.
--
-- OPEN BUSINESS DECISION: the job fee credited to the inspector is the inspection fee only. The travel fee and the
-- platform fee are not credited to anybody. Change lc_credit_job_fee() if travel is passed on to the inspector.
--
-- Existing finished reports and purchases are backfilled once, so earnings that were already announced to users in
-- notifications are withdrawable. Nothing has been paid out before this migration.

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
create table if not exists public.ledger_entries (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id),
  kind       text not null check (kind in ('job_fee', 'resale_inspector', 'resale_payer', 'payout', 'adjustment')),
  amount     integer not null check (amount <> 0),
  note       text,
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz not null default now(),
  constraint ledger_sign check (
    (kind in ('job_fee', 'resale_inspector', 'resale_payer') and amount > 0) or (kind = 'payout' and amount < 0) or kind = 'adjustment')
);
alter table public.ledger_entries enable row level security;   -- no policies: invisible to clients
revoke all on public.ledger_entries from anon, authenticated;
create index if not exists ledger_entries_user on public.ledger_entries (user_id, created_at desc);
-- an earning can be credited only once per source row
create unique index if not exists ledger_entries_once
  on public.ledger_entries (kind, ref_type, ref_id, user_id)
  where kind in ('job_fee', 'resale_inspector', 'resale_payer');

create or replace function public.lc_ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The ledger is append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_ledger_immutable on public.ledger_entries;
create trigger trg_ledger_immutable before update or delete on public.ledger_entries
  for each row execute function public.lc_ledger_immutable();

-- Credits ------------------------------------------------------------------
create or replace function public.lc_credit_job_fee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.full_price > 0 then
    insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id)
    values (new.inspector_id, 'job_fee', new.full_price, 'Inspection ' || coalesce(new.report_number, new.vin), 'inspection', new.id)
    on conflict (kind, ref_type, ref_id, user_id) where kind in ('job_fee', 'resale_inspector', 'resale_payer') do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_credit_job_fee on public.inspections;
create trigger trg_credit_job_fee after insert on public.inspections
  for each row execute function public.lc_credit_job_fee();

create or replace function public.lc_credit_resale() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_inspector uuid; v_tracker uuid; v_num text;
begin
  select i.inspector_id, v.first_tracked_by, coalesce(i.report_number, i.vin)
    into v_inspector, v_tracker, v_num
    from public.inspections i join public.vehicles v on v.vin = i.vin where i.id = new.inspection_id;
  if v_inspector is not null and v_inspector <> new.buyer_id and new.inspector_earning > 0 then
    insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id)
    values (v_inspector, 'resale_inspector', new.inspector_earning, 'Resale of ' || v_num, 'purchase', new.id)
    on conflict (kind, ref_type, ref_id, user_id) where kind in ('job_fee', 'resale_inspector', 'resale_payer') do nothing;
  end if;
  if v_tracker is not null and v_tracker <> new.buyer_id and new.payer_earning > 0 then
    insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id)
    values (v_tracker, 'resale_payer', new.payer_earning, 'Resale of ' || v_num, 'purchase', new.id)
    on conflict (kind, ref_type, ref_id, user_id) where kind in ('job_fee', 'resale_inspector', 'resale_payer') do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_credit_resale on public.report_purchases;
create trigger trg_credit_resale after insert on public.report_purchases
  for each row execute function public.lc_credit_resale();

-- One-time backfill (idempotent: skips anything already credited) -------------
insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id, created_at)
select i.inspector_id, 'job_fee', i.full_price, 'Inspection ' || coalesce(i.report_number, i.vin), 'inspection', i.id,
       coalesce(i.submitted_at, i.created_at)
  from public.inspections i
 where i.full_price > 0
   and not exists (select 1 from public.ledger_entries l
                    where l.kind = 'job_fee' and l.ref_type = 'inspection' and l.ref_id = i.id and l.user_id = i.inspector_id);
insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id, created_at)
select i.inspector_id, 'resale_inspector', rp.inspector_earning, 'Resale of ' || coalesce(i.report_number, i.vin), 'purchase', rp.id, rp.purchased_at
  from public.report_purchases rp join public.inspections i on i.id = rp.inspection_id
 where i.inspector_id <> rp.buyer_id and rp.inspector_earning > 0
   and not exists (select 1 from public.ledger_entries l
                    where l.kind = 'resale_inspector' and l.ref_type = 'purchase' and l.ref_id = rp.id and l.user_id = i.inspector_id);
insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id, created_at)
select v.first_tracked_by, 'resale_payer', rp.payer_earning, 'Resale of ' || coalesce(i.report_number, i.vin), 'purchase', rp.id, rp.purchased_at
  from public.report_purchases rp join public.inspections i on i.id = rp.inspection_id
  join public.vehicles v on v.vin = i.vin
 where v.first_tracked_by is not null and v.first_tracked_by <> rp.buyer_id and rp.payer_earning > 0
   and not exists (select 1 from public.ledger_entries l
                    where l.kind = 'resale_payer' and l.ref_type = 'purchase' and l.ref_id = rp.id and l.user_id = v.first_tracked_by);

-- ---------------------------------------------------------------------------
-- Bank accounts and withdrawals
-- ---------------------------------------------------------------------------
create table if not exists public.payout_accounts (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  account_holder text not null check (length(account_holder) between 2 and 100),
  bank_name      text not null check (length(bank_name) between 2 and 60),
  account_number text not null check (account_number ~ '^[0-9]{6,16}$'),
  branch_code    text not null check (branch_code ~ '^[0-9]{6}$'),
  account_type   text not null check (account_type in ('cheque', 'savings', 'transmission')),
  updated_at     timestamptz not null default now()
);
alter table public.payout_accounts enable row level security;   -- no policies: invisible to clients
revoke all on public.payout_accounts from anon, authenticated;

create table if not exists public.withdrawal_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  amount        integer not null check (amount > 0),
  status        text not null default 'requested' check (status in ('requested', 'paid', 'rejected', 'cancelled')),
  account       jsonb not null,                       -- snapshot of the bank details at request time
  requested_at  timestamptz not null default now(),
  processed_at  timestamptz,
  processed_by  uuid,
  reference     text,
  reject_reason text
);
alter table public.withdrawal_requests enable row level security;   -- no policies: invisible to clients
revoke all on public.withdrawal_requests from anon, authenticated;
create unique index if not exists withdrawal_one_open on public.withdrawal_requests (user_id) where status = 'requested';
create index if not exists withdrawal_status on public.withdrawal_requests (status, requested_at);

create or replace function public.lc_balance(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0)::bigint from public.ledger_entries where user_id = p_user
$$;

-- Caller's own side -----------------------------------------------------------
create or replace function public.set_my_payout_account(p_holder text, p_bank text, p_number text, p_branch text, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if exists (select 1 from public.withdrawal_requests where user_id = v_uid and status = 'requested') then
    raise exception 'You have a withdrawal in progress. Change your bank details after it is paid.' using errcode = '55000';
  end if;
  insert into public.payout_accounts (user_id, account_holder, bank_name, account_number, branch_code, account_type)
  values (v_uid, btrim(p_holder), btrim(p_bank), regexp_replace(coalesce(p_number, ''), '\s', '', 'g'),
          regexp_replace(coalesce(p_branch, ''), '\s', '', 'g'), p_type)
  on conflict (user_id) do update
    set account_holder = excluded.account_holder, bank_name = excluded.bank_name, account_number = excluded.account_number,
        branch_code = excluded.branch_code, account_type = excluded.account_type, updated_at = now();
exception when check_violation then
  raise exception 'Check the bank details: account number 6-16 digits, branch code 6 digits, holder and bank name required'
    using errcode = '22023';
end $$;

-- Never returns the full account number.
create or replace function public.my_payout_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); a public.payout_accounts%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into a from public.payout_accounts where user_id = v_uid;
  if not found then return null; end if;
  return jsonb_build_object('account_holder', a.account_holder, 'bank_name', a.bank_name, 'branch_code', a.branch_code,
                            'account_type', a.account_type, 'account_last4', right(a.account_number, 4));
end $$;

create or replace function public.my_earnings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_bal bigint; v_pending bigint;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_bal := public.lc_balance(v_uid);
  select coalesce(sum(amount), 0) into v_pending from public.withdrawal_requests where user_id = v_uid and status = 'requested';
  return jsonb_build_object(
    'balance', v_bal, 'pending_withdrawal', v_pending, 'available', greatest(v_bal - v_pending, 0),
    'min_payout', (select min_payout from public.lc_settings where id = 1),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id desc) from
                          (select id, kind, amount, note, created_at from public.ledger_entries
                            where user_id = v_uid order by created_at desc, id desc limit 50) e), '[]'::jsonb));
end $$;

create or replace function public.my_withdrawals() returns table (
  id uuid, amount integer, status text, requested_at timestamptz, processed_at timestamptz, reference text, reject_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query select w.id, w.amount, w.status, w.requested_at, w.processed_at, w.reference, w.reject_reason
                 from public.withdrawal_requests w where w.user_id = auth.uid() order by w.requested_at desc limit 50;
end $$;

create or replace function public.request_withdrawal(p_amount integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_min integer; v_acc public.payout_accounts%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = v_uid for update;     -- serialise a user's own requests
  select min_payout into v_min from public.lc_settings where id = 1;
  if p_amount < v_min then raise exception 'The minimum withdrawal is R%', v_min using errcode = '22023'; end if;
  select * into v_acc from public.payout_accounts where user_id = v_uid;
  if not found then raise exception 'Add your bank details first' using errcode = '22023'; end if;
  if exists (select 1 from public.withdrawal_requests where user_id = v_uid and status = 'requested') then
    raise exception 'You already have a withdrawal in progress' using errcode = '55000';
  end if;
  if p_amount > public.lc_balance(v_uid) then raise exception 'That is more than your available balance' using errcode = '22023'; end if;
  insert into public.withdrawal_requests (user_id, amount, account)
  values (v_uid, p_amount, jsonb_build_object('account_holder', v_acc.account_holder, 'bank_name', v_acc.bank_name,
          'account_number', v_acc.account_number, 'branch_code', v_acc.branch_code, 'account_type', v_acc.account_type))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_my_withdrawal(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.withdrawal_requests set status = 'cancelled', processed_at = now()
   where id = p_id and user_id = auth.uid() and status = 'requested';
  if not found then raise exception 'No open withdrawal to cancel' using errcode = 'P0002'; end if;
end $$;

-- Operator side -----------------------------------------------------------------
create or replace function public.admin_list_balances(p_search text default null)
returns table (user_id uuid, name text, email text, role text, earned bigint, paid_out bigint, adjustments bigint, balance bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public.lc_require_admin(false);
  return query
    select p.id, p.name, p.email, p.role::text,
           coalesce(sum(l.amount) filter (where l.kind in ('job_fee', 'resale_inspector', 'resale_payer')), 0)::bigint,
           coalesce(-sum(l.amount) filter (where l.kind = 'payout'), 0)::bigint,
           coalesce(sum(l.amount) filter (where l.kind = 'adjustment'), 0)::bigint,
           coalesce(sum(l.amount), 0)::bigint
      from public.profiles p join public.ledger_entries l on l.user_id = p.id
     where v_search is null or position(v_search in lower(p.name)) > 0 or position(v_search in lower(p.email)) > 0
     group by p.id, p.name, p.email, p.role
     order by 8 desc, p.name
     limit 500;
end $$;

create or replace function public.admin_list_ledger(p_user uuid, p_limit integer default 100)
returns table (id bigint, kind text, amount integer, note text, ref_type text, ref_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(false);
  return query select l.id, l.kind, l.amount, l.note, l.ref_type, l.ref_id, l.created_at
                 from public.ledger_entries l where l.user_id = p_user
                order by l.created_at desc, l.id desc limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- Includes full bank details, so it needs the admin role (support staff cannot see account numbers).
create or replace function public.admin_list_withdrawals(p_status text default 'requested')
returns table (id uuid, user_id uuid, name text, email text, amount integer, status text, account jsonb,
               balance bigint, requested_at timestamptz, processed_at timestamptz, reference text, reject_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if p_status not in ('all', 'requested', 'paid', 'rejected', 'cancelled') then
    raise exception 'Bad status filter' using errcode = '22023';
  end if;
  return query
    select w.id, w.user_id, p.name, p.email, w.amount, w.status, w.account, public.lc_balance(w.user_id),
           w.requested_at, w.processed_at, w.reference, w.reject_reason
      from public.withdrawal_requests w join public.profiles p on p.id = w.user_id
     where p_status = 'all' or w.status = p_status
     order by (w.status = 'requested') desc, w.requested_at desc limit 200;
end $$;

create or replace function public.admin_pay_withdrawal(p_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.withdrawal_requests%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reference, '')), '') is null then
    raise exception 'The bank payment reference is required' using errcode = '22023';
  end if;
  select * into w from public.withdrawal_requests where id = p_id for update;
  if not found then raise exception 'No such withdrawal' using errcode = 'P0002'; end if;
  if w.status <> 'requested' then raise exception 'This withdrawal is already %', w.status using errcode = '55000'; end if;
  perform 1 from public.profiles where id = w.user_id for update;
  if public.lc_balance(w.user_id) < w.amount then
    raise exception 'The balance is now lower than this withdrawal. Reject it or fix the balance first.' using errcode = '55000';
  end if;
  update public.withdrawal_requests set status = 'paid', processed_at = now(), processed_by = auth.uid(), reference = trim(p_reference)
   where id = p_id;
  insert into public.ledger_entries (user_id, kind, amount, note, ref_type, ref_id)
  values (w.user_id, 'payout', -w.amount, 'Withdrawal paid. Ref ' || trim(p_reference), 'withdrawal', w.id);
  insert into public.notifications (user_id, type, icon, title, body)
  values (w.user_id, 'earn', '💰', 'Withdrawal paid', 'R' || w.amount || ' was paid to your bank account ending ' || right(w.account->>'account_number', 4) || '.');
  perform public.lc_audit('withdrawal_paid', 'withdrawal', p_id::text,
                          jsonb_build_object('user', w.user_id, 'amount', w.amount, 'reference', trim(p_reference)));
end $$;

create or replace function public.admin_reject_withdrawal(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.withdrawal_requests%rowtype;
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into w from public.withdrawal_requests where id = p_id for update;
  if not found then raise exception 'No such withdrawal' using errcode = 'P0002'; end if;
  if w.status <> 'requested' then raise exception 'This withdrawal is already %', w.status using errcode = '55000'; end if;
  update public.withdrawal_requests set status = 'rejected', processed_at = now(), processed_by = auth.uid(), reject_reason = trim(p_reason)
   where id = p_id;
  insert into public.notifications (user_id, type, icon, title, body)
  values (w.user_id, 'earn', '💰', 'Withdrawal not processed', 'Your withdrawal of R' || w.amount || ' was not processed: ' || trim(p_reason));
  perform public.lc_audit('withdrawal_rejected', 'withdrawal', p_id::text,
                          jsonb_build_object('user', w.user_id, 'amount', w.amount, 'reason', trim(p_reason)));
end $$;

-- A signed correction. A negative adjustment cannot take the balance below zero.
create or replace function public.admin_add_adjustment(p_user uuid, p_amount integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lc_require_admin(true);
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required' using errcode = '22023'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'The amount must be between R1 and R100000, positive or negative' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'No such user' using errcode = 'P0002'; end if;
  if p_amount < 0 and public.lc_balance(p_user) + p_amount < 0 then
    raise exception 'That would take the balance below zero' using errcode = '22023';
  end if;
  insert into public.ledger_entries (user_id, kind, amount, note, ref_type)
  values (p_user, 'adjustment', p_amount, trim(p_reason), 'admin');
  insert into public.notifications (user_id, type, icon, title, body)
  values (p_user, 'earn', '💰', 'Balance adjusted', 'Support adjusted your balance by R' || p_amount || ': ' || trim(p_reason));
  perform public.lc_audit('balance_adjusted', 'user', p_user::text, jsonb_build_object('amount', p_amount, 'reason', trim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'set_my_payout_account(text,text,text,text,text)', 'my_payout_account()', 'my_earnings()', 'my_withdrawals()',
    'request_withdrawal(integer)', 'cancel_my_withdrawal(uuid)',
    'admin_list_balances(text)', 'admin_list_ledger(uuid,integer)', 'admin_list_withdrawals(text)',
    'admin_pay_withdrawal(uuid,text)', 'admin_reject_withdrawal(uuid,text)', 'admin_add_adjustment(uuid,integer,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['lc_balance(uuid)', 'lc_credit_job_fee()', 'lc_credit_resale()', 'lc_ledger_immutable()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
