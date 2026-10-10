# View4You Mobile App — Phase 1

Customer booking + report app (React + Vite + Supabase + Capacitor).

## Live on Vercel
Import this repo in Vercel. Framework: Vite.

Env vars:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Latest commit includes all screens (Booking, BookingDetail, DealerIndex, etc.) and `src/vite-env.d.ts`.

## Run it on a phone (Android)
```
npm ci
cp .env.example .env        # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run build && npx cap sync android
npx cap open android        # Android Studio → Run on a connected phone
```
Debug APK from the command line: `cd android && ./gradlew assembleDebug` (needs the Android SDK).
See `docs/RELEASE_CHECKLIST.md` before connecting it to the live Supabase project, and
`docs/PRODUCTION_READINESS_AUDIT.md` for what has and has not been verified.
