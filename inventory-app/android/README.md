# Android client (MVP)

For high-level architecture, features, and security details, see [ANDROID.md](../docs/ANDROID.md). 

This folder contains an Android client that pairs with the Desktop app over LAN.

## Current capabilities

- Pair by scanning the Desktop "Pair (LAN)" QR (contains `{ baseUrl, token }`).
- Initial sync (required before offline scans): calls `GET /api/export`.
- Browse inventory locally (simple list + item detail).
- Offline scan (after initial sync): resolves barcode locally and queues delta events.
- Sync queued scan deltas later: `POST /api/scans/apply` (idempotent via `event_id`).
- Incremental barcode mappings: `GET /api/item-barcodes?since=<ms>`.
- Incremental item refresh: `GET /api/items?since=<ms>&includeDeleted=1`.
- Unknown barcode handling: keeps it in a local "corrupted/illegible" list and opens an Add Item form (desktop-like fields).
- Background sync: WorkManager periodic sync (15 min, requires network) plus one-off sync on pairing.

## Open in Android Studio

Open the `android/` folder in Android Studio.

## Gradle wrapper bootstrap (Windows)

If `gradle/wrapper/gradle-wrapper.jar` is missing, run:
- `powershell -ExecutionPolicy Bypass -File .\bootstrap-wrapper.ps1`

## JDK note

Running `gradlew.bat` from a terminal requires `java` on `PATH` or `JAVA_HOME` to be set.
Android Studio uses its own embedded JDK for Gradle sync.

This project uses AGP 8.2.2, so **JDK 17+ is required** for Gradle.

If you hit Gradle daemon heap errors on Windows, ensure you're using a 64-bit JDK.
Android Studio's embedded JDK is typically at:
- `C:\Program Files\Android\Android Studio\jbr\bin\java.exe`

If you see:
- `Could not reserve enough space for 2097152KB object heap`

It usually means Gradle is using a 32-bit Java (often under `C:\Program Files (x86)\...`). Fix by using Android Studio's 64-bit JBR, for example:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-debug.ps1 -JavaHome "C:\Program Files\Android\Android Studio\jbr"
```

## Windows/OneDrive note

If the repo lives under OneDrive, Gradle can fail with errors like:
"Unable to delete directory ... app\\build\\intermediates ...".

This project config redirects Gradle `buildDir` to your temp directory to avoid OneDrive file locks.
If you still hit this, stop Gradle daemons and re-run:
- `File > Invalidate Caches / Restart` (Android Studio)
- delete `app/build` (if it exists)

## Installing to a phone (Windows)

1) Enable developer mode + USB debugging on the phone
- Android Settings → About phone → tap "Build number" 7 times
- Developer options → enable "USB debugging"

2) Install Android Platform Tools (ADB) and verify the device is visible:
- `adb devices`

If `adb` is not on your PATH, Android Studio usually installs it under:
- `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`

3) From `android/`, install/update the Debug build using a 64-bit JDK (example using Android Studio JBR):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
./gradlew.bat :app:installDebug
```

## Running tests (Windows)

Recommended helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1
```

With instrumentation tests (requires emulator/device):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1 -Connected
```

Notes:
- Re-running `:app:installDebug` updates the app on the phone (same app id/signing key).
- If install fails due to signature mismatch (you installed a different build previously), uninstall first:
	- `adb uninstall com.inventory.android`

## One-command installer helper (Windows)

Optional script:
- `powershell -ExecutionPolicy Bypass -File .\scripts\install-debug.ps1`

If you have multiple devices/emulators connected:
- `adb devices`
- `powershell -ExecutionPolicy Bypass -File .\scripts\install-debug.ps1 -Device <serial>`

Optional flags:
- Force Java/JBR (recommended if Gradle picks a 32-bit Java):
	- `powershell -ExecutionPolicy Bypass -File .\scripts\install-debug.ps1 -JavaHome "C:\Program Files\Android\Android Studio\jbr"`
- Clean before install:
	- `powershell -ExecutionPolicy Bypass -File .\scripts\install-debug.ps1 -Clean`

If adb is not on PATH (rare on Windows):
- `powershell -ExecutionPolicy Bypass -File .\scripts\install-debug.ps1 -AdbPath "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`
