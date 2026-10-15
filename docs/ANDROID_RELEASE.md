# Android release (Google Play)

Play accepts only a **signed release bundle (.aab)**. The existing "Build CheckVertical Android APK"
workflow makes a debug APK for testing; this one makes the store build.

## One-time setup (you do this; the key must stay yours)
1. Create the upload key on your computer and **back it up somewhere safe**. If you lose it you cannot update the app.

       keytool -genkeypair -v -keystore checkvertical-upload.jks -alias checkvertical \
         -keyalg RSA -keysize 2048 -validity 10000

2. Turn it into text: `base64 -w0 checkvertical-upload.jks` (macOS: `base64 -i checkvertical-upload.jks`).
3. GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret:
   - `ANDROID_KEYSTORE_BASE64`: the text from step 2
   - `ANDROID_KEYSTORE_PASSWORD`: the keystore password
   - `ANDROID_KEY_ALIAS`: `checkvertical`
   - `ANDROID_KEY_PASSWORD`: the key password

## Each release
Actions -> "Build CheckVertical Android release" -> Run workflow. Download the artifact named
`checkvertical-release-SIGNED` and upload the `.aab` in Play Console. `versionCode` is the run number,
so it increases automatically.
