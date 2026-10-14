-- These helpers are internal implementation details; callers use vetted public RPCs.
revoke execute on function public.lc_platform_fee() from public, anon, authenticated;
revoke execute on function public.lc_travel_fee() from public, anon, authenticated;
revoke execute on function public.lc_report_split(integer) from public, anon, authenticated;
