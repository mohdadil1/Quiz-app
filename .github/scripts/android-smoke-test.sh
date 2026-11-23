#!/usr/bin/env bash
# Install the debug APK on the emulator, open it and check it works and is locked down.
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

adb exec-out screencap -p > shot.png
python3 - <<'PY'
import struct, zlib
data = open('shot.png', 'rb').read()
# Minimal PNG decode (RGBA/RGB, 8-bit) to measure how bright the screenshot is
pos, w, h, ct, idat = 8, 0, 0, 0, b''
while pos < len(data):
    n, typ = struct.unpack('>I4s', data[pos:pos + 8]); body = data[pos + 8:pos + 8 + n]; pos += 12 + n
    if typ == b'IHDR': w, h, _, ct = struct.unpack('>IIBB', body[:10])
    elif typ == b'IDAT': idat += body
raw = zlib.decompress(idat); bpp = 4 if ct == 6 else 3; stride = w * bpp
total = count = 0
prev = bytearray(stride); i = 0
for y in range(h):
    f = raw[i]; line = bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
    for x in range(stride):
        a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
        if f == 1: line[x] = (line[x] + a) & 255
        elif f == 2: line[x] = (line[x] + b) & 255
        elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
        elif f == 4:
            p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
    prev = line
    if y % 8 == 0:
        for x in range(0, stride, bpp * 8): total += line[x] + line[x + 1] + line[x + 2]; count += 3
mean = total / max(count, 1)
print(f"::notice title=Android smoke test::Screenshot of the app is {w}x{h}, mean brightness {mean:.1f}/255 ({'black: capture blocked' if mean < 8 else 'NOT black'})")
open('brightness.txt', 'w').write(str(mean))
PY
mean=$(cat brightness.txt 2>/dev/null || echo 255)
python3 -c "import sys; sys.exit(0 if float('$mean') < 8 else 1)" || bad "Screenshot was not black, FLAG_SECURE isn't blocking capture"

exit $fail
