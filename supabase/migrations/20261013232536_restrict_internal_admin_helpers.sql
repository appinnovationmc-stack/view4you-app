-- Internal authorization helpers must not be callable directly through the Data API.
revoke execute on function public.lc_require_admin(boolean) from public, anon, authenticated;
revoke execute on function public.lc_admin_role() from public, anon, authenticated;
