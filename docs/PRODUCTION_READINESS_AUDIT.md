# LemonCheck — production readiness audit

Branch `fix/lemoncheck-production-readiness`. Live state observed read-only on 2026-10-07; snapshot in
`supabase/baseline/lemoncheck_live_baseline_2026-10-07.sql`. Nothing in this document has been applied to the live project.

## Findings (all reproduced against the live-schema snapshot before fixing)

| # | Severity | Finding | Fixed in |
|---|----------|---------|----------|
| 1 | Critical | A user could `UPDATE profiles SET role='inspector'` (and rating, jobs_completed, price, top_rated). | `20261009000100` column-level grants |
| 2 | Critical | A buyer could INSERT/UPDATE their own booking with `paid=true`, any fee, any status, any inspector. | `20261009000100/200` RPC-only writes |
| 3 | Critical | An inspector could INSERT an `inspections` row with self-chosen prices and earnings. | `20261009000300` `submit_detailed_report` is the only writer |
| 4 | Critical | A buyer could INSERT their own `report_purchases` row (free report, fake earnings). | `20261009000100/300` |
| 5 | Critical | Any signed-in user could read every inspection and finding. | `20261009000100` entitlement-gated RLS |
| 6 | High | Any user could change `vehicles.first_tracked_by` (steals resale earnings). | `20261009000100/200` |
| 7 | High | `can_read_report()` was revoked from `authenticated`, so detailed reports were unreadable for everyone ("permission denied for function"). | `20261009000100` |
| 8 | High | Repo and live edge functions for PayFast were broken / unverified (no signature, amount or idempotency checks). | `supabase/functions/*`, `20261009000300` |
| 9 | Medium | Client marked bookings paid (`markBookingPaid`) and showed a simulated "inspector en route" countdown, a fake saved card and fake weekly earnings. | `src/LemonCheckApp.tsx` |
| 10 | Medium | Hardcoded "R180" earnings promise in six places. | removed; amounts now come from the server |
| 11 | Low | `npm audit`: 1 high (`source-map-js`), Leaflet loaded from a CDN without SRI, placeholder brand "Your Real Name". | brand fixed; others open |

## What was built
* `20261009000100_lemoncheck_access_lockdown.sql` — removes client write access to privileged tables, adds `profiles.approved`, `bookings.payment_status/amount_due`, directory + job views.
* `20261009000200_lemoncheck_booking_state_machine.sql` — `create_booking` (price computed on the server), race-safe `accept_booking`, `decline_booking`, `advance_booking`, `cancel_booking`, `set_online`.
* `20261009000300_lemoncheck_payments_and_reports.sql` — `payment_events` audit table, idempotent `apply_payfast_itn` (service role only), `submit_detailed_report` (idempotent, server-priced), `report_preview`, `admin_approve_inspector`, `admin_mark_booking_refunded`.
* Edge functions: `create-booking-payment`, `create-report-payment`, `payfast-itn` (shared code in `_shared/`): server-side signed checkout, ITN signature, source IP, merchant, amount, currency, order reference, server confirmation, idempotency.
* App: PayFast redirect, live booking status screen (polls the booking row), inspector accept/decline/progress, real earnings only.

## Test evidence
Run `npm test` (vitest, PGlite = real Postgres in WASM, with stubbed Supabase roles).
* `LC_MIGRATIONS=0 npx vitest run tests/db/security.test.ts` against the unmigrated live snapshot: 10 of 13 exploit tests FAIL (exploits reproduce).
* `npm test` with the migrations: 62 of 62 pass (security, booking state machine, forged / wrong-amount / repeated ITN, report access, PayFast signature and IP logic).
* `npm run build` and `npx tsc -b` clean.

## NOT verified (do not claim otherwise)
* **No live PayFast payment, sandbox or live, has been made.** Merchant credentials were not available. The signature code is tested against fixtures only. Re-check the ITN source IP list and the validate endpoint against https://developers.payfast.co.za/docs (the page could not be fetched during the audit).
* **The migrations have not been applied to any Supabase project.** They are tested only on PGlite with stand-ins for `auth` and `storage`.
* The edge functions have not been deployed or run on Deno.
* The Android app has not been built or installed (the Android SDK is unreachable from the cloud environment). The web build was only smoke-tested for the splash screen.
* The sign-in, booking, inspection and report screens were not clicked through against a real backend.
* Vehicle history (owners, accidents, finance) is demo data; there is no eNaTIS/TransUnion integration.
* Inspector GPS is not tracked live; the buyer sees status changes only.

## Open decisions for the owner
* Resale split. Currently 18% of the inspection fee, ~51.5% to the commissioning buyer, remainder to the inspector, platform keeps 0%. Lives in `lc_report_split()` only.
* Travel fee (R100) and platform fee (R75) are constants in `lc_travel_fee()` / `lc_platform_fee()`.
* Payout process (withdrawals are not in the app), refund process (`admin_mark_booking_refunded`), privacy policy and terms.
* Enable leaked-password protection in the Supabase dashboard.
