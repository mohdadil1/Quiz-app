# Quizora for iOS

The iPhone and iPad version of the [Quizora Android app](../android/README.md): the Quizora
website in a locked-down window, for proctored tests.

| | Safari | Quizora iOS app | Quizora Android app |
|---|---|---|---|
| Screenshots and screen recording | possible (watermarked) | the question area comes out **blank**, and the attempt counts as a **warning** | **blocked** |
| Recording or mirroring the screen during a test | possible | the question is **covered** until it's turned off | **blocked** |
| App-switcher preview | shows the question | blank | blank |
| Going Home or switching apps during a test | counts as a warning | counts as a warning; **blocked** with assessment mode (below) | **blocked** (screen pinning) |
| Siri, notifications, Control Centre | possible | counts as a warning; **blocked** with assessment mode | counts as a warning |
| Screen turning off mid-test | can happen | stays on | stays on |

All of the website's own proctoring (warnings, auto-submit, webcam face tracking, the
watermark) still runs inside the app.

## Getting the app to students: TestFlight

iPhones don't install apps from a download link like an APK. Students install the app
through Apple's **TestFlight** app instead. You need a paid **Apple Developer Program**
membership (about US$99 a year), and a Mac is **not** needed: GitHub builds and uploads
the app (`.github/workflows/ios.yml`).

### One-time set-up

1. **Join the Apple Developer Program** at <https://developer.apple.com/programs/enroll/>
   with your Apple ID. Approval can take a day or two. Your **Team ID** is shown on
   <https://developer.apple.com/account> under *Membership details*.
2. **Create the app record** in <https://appstoreconnect.apple.com> → **Apps** → **+** →
   **New App**: platform iOS, name *Quizora* (or any free name), language English,
   bundle ID `com.quizora.app`, SKU `quizora`.
   - If the bundle ID isn't in the list, the first GitHub build registers it; create the
     app record after that build.
   - If `com.quizora.app` is already taken, choose your own (e.g. `in.dsu.quizora`) and
     set it as a repository **variable** `IOS_BUNDLE_ID` (step 4).
3. **Create an API key** so GitHub can sign and upload: App Store Connect → **Users and
   Access** → **Integrations** → **App Store Connect API** → **Team Keys** → **+**. Name it
   *GitHub*, access **Admin**. Download the `.p8` file (you can download it only once) and
   note the **Key ID** and the **Issuer ID** shown above the list.
4. **Add the secrets on GitHub**: repository **Settings → Secrets and variables → Actions**.
   Under **Secrets**, add:
   - `APP_STORE_CONNECT_KEY_ID`: the Key ID
   - `APP_STORE_CONNECT_ISSUER_ID`: the Issuer ID
   - `APP_STORE_CONNECT_PRIVATE_KEY`: the whole text of the `.p8` file, including the
     `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines
   - `APPLE_TEAM_ID`: your Team ID

   Keep the `.p8` file private and never commit it to git.
5. **Run the build**: Actions tab → **iOS app** → **Run workflow** (or push to `main`).
   About 10–30 minutes after it finishes, the build appears in App Store Connect →
   your app → **TestFlight**.

### Inviting students

In App Store Connect → your app → **TestFlight**:

- **External Testing** → **+** to create a group (e.g. *BCA AI & DS*), add the build, and
  fill in the short *Test Information* form. The first build of a group goes through a
  quick Apple review (usually within a day).
- Turn on **Public Link** for the group and share that link. Students open it on their
  iPhone, install **TestFlight** from the App Store, then tap **Install**. Up to 10,000
  people can join.
- New builds from GitHub reach students automatically through TestFlight.
- **TestFlight builds stop working 90 days after upload.** Run the workflow again before
  that (e.g. at the start of each term).

For a permanent install without expiry, submit the app for the App Store instead
(App Store Connect → your app → **Distribution**). Apple's review is stricter there.

## Assessment mode (optional, recommended)

Apple has an official exam mode, **Automatic Assessment Configuration**. While a test runs
it blocks other apps, the Home screen, Siri, notifications, Control Centre, screenshots
and screen recording, and ends when the test is submitted. It's what Apple's own testing
apps use.

It needs an entitlement that Apple grants to your developer account on request:

1. Ask for it at <https://developer.apple.com/contact/request/automatic-assessment-configuration/>
   while signed in as the developer account's **Account Holder** (describe Quizora as your
   college's proctored test app). Apple can take weeks to answer; if it's slow, follow up
   via developer.apple.com → Contact Us → Development and Technical → Entitlements.
2. When Apple confirms, set a repository **variable** `IOS_ASSESSMENT_MODE` to `true`
   (Settings → Secrets and variables → Actions → **Variables**) and run the workflow.

Without it the app still works; leaving the test counts as a warning, as in Safari.

## How it works

- `WebViewController.swift` holds a WKWebView that loads `QUIZORA_URL` (set in
  `project.yml`). Only pages on that site open in the app; other links open in Safari.
- The page sits inside `CaptureShield`: iOS already hides the contents of password
  fields from screenshots and recordings, and the app places the website in the same
  kind of protected view. iOS gives apps no official switch for this, so a future iOS
  may stop honouring it; the screenshot and recording **warnings** keep working either way.
- The app adds `window.QuizoraApp` (`startExam()`, `endExam()`, `version()`), the same
  interface as the Android app (`client/src/nativeApp.js`). On `startExam()` it hides the
  status bar and home indicator, keeps the screen on, turns off back-swipes and enters
  assessment mode if available. `endExam()` undoes all of this.
- The app tells the page when it loses focus or goes to the background, and sends a
  `quizora-screen-capture` event for screenshots and recordings, which the website records
  as *Took a screenshot* / *Recorded or mirrored the screen*.
- Camera access for webcam proctoring, `confirm()` dialogs, and downloads (results
  spreadsheets open the share sheet) work as in Safari.

## Trying it on your own iPhone without a paid account (7 days)

GitHub also builds an **unsigned IPA** on every push to `main` and publishes it on the
**ios-unsigned-latest** release:
`https://github.com/mohdadil1/Quiz-app/releases/tag/ios-unsigned-latest`.
An iPhone only runs apps signed for it, so sign it with your free Apple ID on a Windows
PC or Mac:

1. Install **Sideloadly** (<https://sideloadly.io>) on the computer. On Windows, also
   install iTunes and iCloud from Apple's website (not the Microsoft Store).
2. Connect the iPhone with a cable and tap **Trust** on the phone.
3. Drag the `.ipa` into Sideloadly, type your Apple ID and press **Start**. Sideloadly
   asks for the Apple ID password to get a free signing certificate from Apple; you can
   use a spare Apple ID for this.
4. On the iPhone: **Settings → General → VPN & Device Management** → your Apple ID →
   **Trust**. On iOS 16 or newer, also turn on **Settings → Privacy & Security →
   Developer Mode** and restart when asked.

The app stops opening after 7 days; repeat step 3 to renew it. A free Apple ID can have
3 such apps installed. Assessment mode isn't available in these builds.

## Building on a Mac

```sh
brew install xcodegen
cd ios && xcodegen generate && open Quizora.xcodeproj
```

Pick your team under *Signing & Capabilities* and press Run. To point the app at another
deployment, change `QUIZORA_URL` in `project.yml`.
