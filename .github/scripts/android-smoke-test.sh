#!/usr/bin/env bash
# Install the debug APK on the emulator, open it and check it works and is locked down.
# FLAG_SECURE on the window is what makes Android black out screenshots, recordings and
# screen-reading assistants, so that's what is checked.
# Results are printed as GitHub annotations; any failed check fails the job.
set -u
APK=$(ls dist/*-debug.apk | head -1)
fail=0
note() { echo "::notice title=Android smoke test::$1"; }
bad() { echo "::error title=Android smoke test::$1"; fail=1; }

adb install -r "$APK" || { bad "APK did not install"; exit 1; }
note "Installed $(basename "$APK")"
adb shell am start -W -n com.quizora.app/.MainActivity
# Give the site time to load over the network
for i in $(seq 1 12); do
  sleep 5
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1
  grep -q "Student Login" ui.xml 2>/dev/null && break
done

focus=$(adb shell dumpsys window | grep -m1 mCurrentFocus | tr -d '\r')
case "$focus" in *com.quizora.app*) note "App is in front: ${focus## }";; *) bad "App is not in front: $focus";; esac

if grep -q "Student Login" ui.xml 2>/dev/null; then
  note "Quizora site loaded (Student Login page visible)"
else
  bad "Quizora site did not load: $(grep -o 'text="[^"]\{1,60\}"' ui.xml 2>/dev/null | head -5 | tr '\n' ' ')"
fi

flags=$(adb shell dumpsys window windows | tr -d '\r' | grep -A12 "com.quizora.app/com.quizora.app.MainActivity" | grep -m1 -o "fl=[^ ]*.*" | head -c 300)
if echo "$flags" | grep -q "SECURE"; then note "Window is FLAG_SECURE: $flags"; else bad "FLAG_SECURE missing: $flags"; fi

exit $fail
