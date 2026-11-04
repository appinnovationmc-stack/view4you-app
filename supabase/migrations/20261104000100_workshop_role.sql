-- Third account type: invite-only partner workshops that quote on repairs found in reports.
alter type public.user_role add value if not exists 'workshop';
