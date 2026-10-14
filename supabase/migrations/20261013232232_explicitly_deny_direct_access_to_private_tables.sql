-- Explicitly deny direct API access to sensitive tables; app access is through vetted RPCs.
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_audit_log',
    'admin_users',
    'inspector_documents',
    'lc_settings',
    'ledger_entries',
    'payment_events',
    'payout_accounts',
    'support_tickets',
    'ticket_messages',
    'withdrawal_requests'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists deny_direct_api_access on public.%I', t);
    execute format(
      'create policy deny_direct_api_access on public.%I for all to anon, authenticated using (false) with check (false)',
      t
    );
  end loop;
end $$;
