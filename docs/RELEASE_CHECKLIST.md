# Release checklist (do in order; nothing here has been done on the live project)

## 1. Staging first
- [ ] Create a Supabase branch or a separate project. Do NOT start on production.
- [ ] Apply migrations in order: `20261009000100`, `20261009000200`, `20261009000300` (forward-only; no data is deleted).
- [ ] `supabase functions deploy create-booking-payment create-report-payment` and `supabase functions deploy payfast-itn --no-verify-jwt`. PayFast cannot send a JWT, so `payfast-itn` authenticates by signature, source IP and server confirmation instead. The other two keep JWT verification on.
- [ ] Remove the old `payfast-report-itn` function once `payfast-itn` is live and PayFast notifies the new URL.
- [ ] Set secrets (see `.env.example`): merchant id/key, passphrase, `PAYFAST_SANDBOX=true`, return/cancel/notify URLs.

## 2. Verify with PayFast sandbox
- [ ] Re-check the PayFast ITN IP list and validate endpoint at https://developers.payfast.co.za/docs.
- [ ] Book as a buyer, pay in the sandbox, confirm `payment_status='paid'` and a `payment_events` row.
- [ ] Replay the same ITN: no second effect. Tamper with the amount: rejected.
- [ ] Buy a resold report, confirm the earnings rows.

## 3. Operations (SQL editor, service role)
- Approve an inspector: `select public.admin_approve_inspector('<profile uuid>');`
- Refund queue: `select id, vin, amount_due from public.bookings where payment_status='refund_due';` Refund in the PayFast dashboard, then `select public.admin_mark_booking_refunded('<booking uuid>', '<payfast reference>');`
- Existing paid bookings are labelled `legacy_unverified` (no payment record exists for them).

## 4. Before real users
- [ ] Switch `PAYFAST_SANDBOX=false` with live credentials; make one small real payment and refund it.
- [ ] Supabase dashboard: enable leaked-password protection; confirm email confirmation settings.
- [ ] Legal copy (privacy policy, terms), payout process, support contact.
- [ ] Restrict the CARTO map key to your domain/app.
- [ ] Android: `npm ci && npm run build && npx cap sync android`, then build and test on a real phone (see README).
