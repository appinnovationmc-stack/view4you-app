-- Prevent authenticated clients from using the legacy create_booking overload that has no tier_id argument.
-- Tier-aware booking is enforced by the 14-argument RPC; keep the legacy overload available only to trusted server code.
REVOKE EXECUTE ON FUNCTION public.create_booking(text, text, text, integer, text, text, uuid, text, text, timestamp with time zone, text, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(text, text, text, integer, text, text, uuid, text, text, timestamp with time zone, text, timestamp with time zone, uuid) TO service_role;
