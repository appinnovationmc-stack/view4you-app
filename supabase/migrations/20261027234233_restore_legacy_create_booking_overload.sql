-- Restore the documented legacy compatibility grant while keeping the tierless insert guarded by cv_guard_tiered_booking
-- and lc_guard_booking_integrity. The guard is the enforcement boundary; the legacy overload remains available only
-- when tier mode is disabled.
REVOKE EXECUTE ON FUNCTION public.create_booking(text, text, text, integer, text, text, uuid, text, text, timestamp with time zone, text, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(text, text, text, integer, text, text, uuid, text, text, timestamp with time zone, text, timestamp with time zone, uuid) TO authenticated, service_role;
