# CheckVertical Fleet & Asset Portal

Standalone web app for organisations (government and company). Separate from the consumer app and the operator admin console: own sign-in, own build, own `fleet_*` tables.

- Dev: `npm run dev:fleet` (port 5175). Build: `npm run build:fleet` → `dist-fleet/` (deploy as its own Vercel project, root = repo, build command above, output `dist-fleet`).
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (repo-root `.env`).
- Database: migrations `20261013010000` … `010200` (apply in order; not yet applied to the live project).

## Two sides, separate role levels
- CheckVertical side (`fleet_platform_staff`): `platform_admin` creates/suspends organisations and invites their first administrator; `platform_support` is read-only. Sees counts only, never client records.
- Client side (`fleet_members`): `tenant_admin`, `fleet_manager`, `property_manager`, `finance_officer`, `site_manager`, `driver`, `auditor`, optionally limited to an org unit (head office → province → district → depot).

## First platform administrator (run once in the Supabase SQL editor)
```sql
insert into public.fleet_platform_staff (user_id, role)
select id, 'platform_admin' from auth.users where email = 'YOU@EXAMPLE.COM';
```
Then sign in, open "CheckVertical console", add an organisation; its administrator signs up with the invited email and is granted access automatically.
