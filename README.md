# CheckVertical

*Discovery awaits.*

Vehicle inspection booking + condition report app. React + Vite + TypeScript + Supabase + Capacitor.

Live: https://view4you-client.vercel.app

## Env vars

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

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
