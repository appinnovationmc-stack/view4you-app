# Release checklist (do in order; nothing here has been done on the live project)

## 1. Staging first
- [ ] Create a Supabase branch or a separate project. Do NOT start on production.
- [ ] Inventory every file under `supabase/migrations/` and apply all pending migrations in filename order to staging. The list in this document is historical and is not a complete inventory. Include `20261014000100_checkvertical_integrity_guards.sql` and every later migration present in the release commit. Review each migration before applying; do not blindly replay migrations already recorded by Supabase.
- [ ] `supabase functions deploy create-booking-payment create-report-payment` and `supabase functions deploy payfast-itn --no-verify-jwt`. PayFast cannot send a JWT, so `payfast-itn` authenticates by signature, source IP and server confirmation instead. The other two keep JWT verification on.
- [ ] Remove the old `payfast-report-itn` function once `payfast-itn` is live and PayFast notifies the new URL.
- [ ] Set secrets (see `.env.example`): merchant id/key, passphrase, `PAYFAST_SANDBOX=true`, return/cancel/notify URLs. `PAYFAST_PASSPHRASE` is **required** when `PAYFAST_SANDBOX` is not `true`; payment start returns 503 without it.
- [ ] `supabase/config.toml` records `verify_jwt` per function; deploy with the CLI from the repo root so it is honoured (ITN receivers and `release-resale-rewards` are `false`).

## 2. Verify with PayFast sandbox
- [ ] Re-check the PayFast ITN IP list and validate endpoint at https://developers.payfast.co.za/docs.
- [ ] Book as a buyer, pay in the sandbox, confirm `payment_status='paid'` and a `payment_events` row.
- [ ] Replay the same ITN: no second effect. Tamper with the amount: rejected.
- [ ] Buy a resold report, confirm the earnings rows.

## 3. Operations
Use the admin console (`docs/ADMIN_CONSOLE.md`): approve inspectors, work the refund queue (refund in the PayFast dashboard, then record the reference), cancel stuck bookings.
- [ ] Create the first operator login and grant it in `admin_users` (see `docs/ADMIN_CONSOLE.md`), enable MFA, deploy `dist-admin/` on its own address.
- Fallback in SQL (service role): `select public.admin_approve_inspector('<profile uuid>');` and `select public.admin_mark_booking_refunded('<booking uuid>', '<payfast reference>');`
- Existing paid bookings are labelled `legacy_unverified` (no payment record exists for them).

## 4. Before real users
- [ ] Switch `PAYFAST_SANDBOX=false` with live credentials; make one small real payment and refund it.
- [ ] Supabase dashboard: enable leaked-password protection; confirm email confirmation settings.
- [ ] Legal copy (privacy policy, terms), payout process, support contact.
- [ ] Restrict the CARTO map key to your domain/app.
- [ ] Android: `npm ci && npm run build && npx cap sync android`, then build and test on a real phone (see README).
