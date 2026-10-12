# CheckVertical

*Discovery awaits.*

Vehicle inspection booking + condition report app. React + Vite + TypeScript + Supabase + Capacitor.

Live: https://view4you-client.vercel.app

## Env vars

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

## Admin console
Operator web app in `admin/` (`npm run dev:admin`, `npm run build:admin`). Setup and access rules: `docs/ADMIN_CONSOLE.md`.

## Brand

- Mark: a tick with a steep long stroke and a green spark above it.
- Colours: ink `#0A0A0B`, paper `#FFFFFF`, discovery green `#3DDC97` (dark) / `#12A66B` (light).
- Type: Poppins Light (Check) + Poppins Bold (Vertical).
- Sources in `src/assets/brand/`. Web icons and manifest in `public/`. Native icon/splash sources in `resources/`.

## Native icons and splash

```
npm i -D @capacitor/assets
npx cap add android && npx cap add ios
npx capacitor-assets generate --iconBackgroundColor '#0A0A0B' --splashBackgroundColor '#0A0A0B'
```
