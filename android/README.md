# Quizora for Android

A small Android app that opens the Quizora website in a locked-down window. Students can
use it instead of Chrome for proctored tests. It adds what a website can't do:

| | Chrome | Quizora app |
|---|---|---|
| Screenshots and screen recording | possible (watermarked) | **blocked**: the capture is black |
| Circle to Search / Gemini "ask about this screen" | can read the question | **blocked**: they see a black screen |
| Going Home or switching apps during a test | possible, counts as a warning | **blocked**: the app pins itself for the test |
| Recent-apps preview | shows the question | blank |
| Screen turning off mid-test | can happen | stays on during the test |

All of the website's own proctoring (warnings, auto-submit, webcam face tracking, the
watermark) still runs inside the app. Voice questions to an assistant and a second
device still need an invigilator or the webcam to catch.

## Getting the app

GitHub builds it automatically (`.github/workflows/android.yml`):
- **Every push to `main`** publishes the APK on the **android-latest** release:
  `https://github.com/mohdadil1/Quiz-app/releases/tag/android-latest`. Share that link;
  students open it on the phone, download the APK and install it (Android 8.0+). Android
  asks them to allow installs from the browser once.
- **Every other build** (branches, pull requests) uploads the APK under the workflow run's
  **Artifacts** on the Actions tab.

## How it works

- `MainActivity.kt` holds a WebView that loads `quizoraUrl` (set in `gradle.properties`).
  Only pages on that site open in the app; other links open in the browser.
- `FLAG_SECURE` is set on the window for the whole app.
- The website calls `window.QuizoraApp.startExam()` when a proctored test starts (see
  `client/src/nativeApp.js`). The app then pins itself with Android screen pinning, hides
  the status and navigation bars, disables Back and keeps the screen on.
  `endExam()` undoes all of this when the test is submitted.
  - Android may ask the student to confirm pinning the first time. The quiz waits for that
    prompt to close before it starts watching, so it isn't a warning.
  - A student can still unpin by holding Back + Overview. The app pins again as soon as
    it's back in front, and leaving the app counts as a warning on the website.
  - On school-owned phones set up as managed devices, the app can be allow-listed for
    full kiosk mode with no prompt and no way to unpin (`lockTaskMode="if_whitelisted"`).
- The app tells the page when its window loses focus or goes to the background, so the
  website's warnings are accurate inside the app.
- The camera permission is asked the first time a webcam-proctored test starts.

## Updates and signing

The APK is signed with a key. Android only installs an update over an existing app if
both are signed with **the same key**.

- **Debug APK** (`quizora-…-debug.apk`): GitHub creates a new debug key for every build,
  so to install a newer debug build, uninstall the old app first. Fine for trying it out.
- **Release APK** (`quizora-….apk`): signed with your own key, so updates install over the
  old version. Set it up once:
  1. On your computer, with Java installed, run:
     `keytool -genkeypair -v -keystore quizora.jks -alias quizora -keyalg RSA -keysize 2048 -validity 10000`
     Keep `quizora.jks` and its passwords safe and private. If you lose them, you can't
     publish updates to installed apps. Never commit them to git.
  2. On GitHub, open **Settings → Secrets and variables → Actions → New repository secret**
     and add:
     - `QUIZORA_KEYSTORE_BASE64`: the output of `base64 -w0 quizora.jks` (macOS: `base64 -i quizora.jks`)
     - `QUIZORA_KEYSTORE_PASSWORD`, `QUIZORA_KEY_ALIAS` (`quizora`) and `QUIZORA_KEY_PASSWORD`
  3. Re-run the **Android app** workflow. The release APK appears next to the debug one.

The same release APK can later be uploaded to Google Play.

## Building on your computer

Open the `android/` folder in Android Studio and press Run, or run `./gradlew assembleDebug`.
To point the app at another deployment (e.g. a staging site), run
`./gradlew assembleDebug -PquizoraUrl=https://your-staging.vercel.app`.
