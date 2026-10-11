# Admin console

A separate web app for LemonCheck operators (`admin/`). It is **not** part of the phone app: it builds to `dist-admin/` and is never copied into Android.

## What it does
| Section | Purpose |
|---------|---------|
| Overview | Live counts: inspectors awaiting approval, refunds due and amount owed, payment problems (7 days), bookings by status, paid total |
| Inspectors | See contact/certification details; **Approve**; **Suspend** (reason required; the inspector goes offline immediately) |
| Bookings | Search by VIN, buyer email or inspector; filter by status and payment; **Cancel** a stuck booking (reason required; a paid booking moves to the refund queue and the buyer is notified) |
| Refunds & payments | Refund queue with **Record refund** (needs the PayFast refund reference); PayFast notification log, problems only by default |
| Audit log | Every admin write: who, when, what, why. Cannot be edited |

Two roles: **admin** (read and write) and **support** (read only; write buttons are hidden and the database refuses the calls).

## Not in the console yet
Report takedown, payout ledger / withdrawals, inspector document review, support tickets and messaging, dispatch/reassign, pricing and resale-split editor, analytics over time. See `docs/PRODUCTION_READINESS_AUDIT.md`.

## How access works
* Operators are rows in `public.admin_users`. **No app user can read or write that table**; rows are added only with the SQL editor / service role.
* The console uses the public anon key only. Every action is an `admin_*` database function that checks `admin_users` itself and raises "Admin access required" otherwise. Verified by `tests/db/admin.test.ts` (29 tests): buyers, inspectors and anonymous callers are refused on every function; support cannot write; users cannot make themselves admin; audit rows cannot be edited or deleted.
* Raw PayFast payloads are never returned to the console.

## Setup
1. Apply migration `supabase/migrations/20261011000100_lemoncheck_admin_console.sql` (after the three `20261009*` ones, on staging first).
2. Create the operator's login: Supabase dashboard → Authentication → Users → Add user (use a dedicated email; do not reuse a buyer or inspector account).
3. Grant access in the SQL editor:
   ```sql
   insert into public.admin_users (user_id, role)
   select id, 'admin' from auth.users where email = 'you@yourcompany.co.za';
   -- read-only staff: use 'support'
   ```
4. Run locally: `npm run dev:admin` (http://localhost:5174, uses `.env`). Build: `npm run build:admin` → upload `dist-admin/` to any static host.
5. Host it on its own address (for example `admin.yourdomain.co.za`), separate from the customer site. Recommended: turn on Supabase MFA for operator accounts and restrict the host by IP or SSO if your host supports it.

To remove someone: `delete from public.admin_users where user_id = (select id from auth.users where email = '...');`

## Verification status
* Database layer: automated tests on Postgres (PGlite), all passing. Not yet applied to any Supabase project.
* Screens: driven in a headless browser against a **mocked** backend (login, approve, suspend with required reason, record refund, cancel, audit, read-only role). Not yet run against a real Supabase project.
