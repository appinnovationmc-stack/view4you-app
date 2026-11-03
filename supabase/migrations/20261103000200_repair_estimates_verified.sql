-- Only mechanic-verified prices are shown to buyers. The starter draft is kept as a template but is not displayed.
alter table public.repair_estimates add column if not exists verified boolean not null default false, add column if not exists source text, add column if not exists verified_at date;
update public.repair_estimates set verified = false, source = 'unverified starter draft (not from a mechanic)';
comment on column public.repair_estimates.verified is 'Only rows with verified = true are shown to buyers. Set true after a real mechanic or workshop quote is loaded; record who in source.';
