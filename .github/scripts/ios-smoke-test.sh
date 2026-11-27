#!/usr/bin/env bash
# Install the simulator build on an iPhone simulator, open it and check it keeps running.
# Saves ios-smoke.png. With the capture shield working, the website area is blank in it:
# the simulator's screenshot is a screen capture like any other.
set -u
APP="$1"
note() { echo "::notice title=iOS smoke test::$1"; }
bad() { echo "::error title=iOS smoke test::$1"; exit 1; }

DEVICE=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
for runtime in sorted(devices, reverse=True):
    if "iOS" not in runtime: continue
    for d in devices[runtime]:
        if d["name"].startswith("iPhone"):
            print(d["udid"]); sys.exit()
')
[ -n "$DEVICE" ] || bad "No iPhone simulator found"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl install "$DEVICE" "$APP" || bad "App did not install"
note "Installed on $(xcrun simctl list devices | grep "$DEVICE" | sed 's/ (.*//;s/^ *//')"
xcrun simctl launch "$DEVICE" com.quizora.app || bad "App did not launch"
sleep 25
xcrun simctl io "$DEVICE" screenshot ios-smoke.png >/dev/null 2>&1 || true
if xcrun simctl spawn "$DEVICE" launchctl list | grep -q "com.quizora.app"; then
  note "App is still running after 25 seconds"
else
  bad "App stopped (crashed?) after launch"
fi
