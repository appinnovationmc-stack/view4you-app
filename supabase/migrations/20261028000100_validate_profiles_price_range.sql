-- The live audit confirmed there are no profiles outside the existing price bounds.
-- Validate the previously NOT VALID check so existing rows are covered as well as future writes.
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_price_range;
