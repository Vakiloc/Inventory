# Android app (MVP)

The Android client is implemented under `android/` and pairs to the Desktop app over LAN.

## Current capabilities

- Pair by scanning the Desktop "Pair (LAN)" QR (payload `{ baseUrl, token }`).
- Bootstrap local DB from Desktop via `GET /api/export`.
- Browse inventory locally (search + category/location filters).
- Offline-first scan flow:
  - If barcode is known locally, increment local quantity and queue a delta event.
  - If barcode is unknown, the app records it as "corrupted/illegible" and opens an Add Item form (desktop-like fields).
- Sync:
  - Manual sync via the "Sync" button.
  - Background periodic sync via WorkManager (every 15 minutes when connected).

## Data model + conflict policy

The Android app mirrors the schema and conflict resolution logic defined in the **System Design**.
See [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md) for full schema definitions and the Last-Write-Wins protocol.

## Building and Running

For developer setup instructions, JDK versions, and "Installing to a phone", see the [Android README](../android/README.md).

## Sync protocol (what Android actually does)

1) Pairing
- User scans QR (or pastes JSON) containing `{ baseUrl, token }`.
- App stores these in DataStore.
- Pairing schedules periodic sync and enqueues an immediate one-off sync.

2) First sync (bootstrap)
- `GET /api/export` (requires auth)
- Upserts snapshot into Room.
- Initializes:
  - `items_since_ms` from the newest `items.last_modified`
  - `barcode_since_ms` from the newest `item_barcodes.created_at`

3) Ongoing sync (`syncOnce()`)
- Push queued scan delta events: `POST /api/scans/apply`
- Pull incremental items: `GET /api/items?since=<items_since_ms>&includeDeleted=1`
- Pull incremental barcode mappings: `GET /api/item-barcodes?since=<barcode_since_ms>`

## Installing / running (Android Studio)

- Open the `android/` folder in Android Studio.
- Run the `app` configuration on an emulator or physical device.

## Network & Discovery

The Android app communicates with the Desktop server over the local network (LAN).

### mDNS
The app uses mDNS (multicast DNS) to discover the Desktop server on the local network using `.local` hostnames. This allows for automatic discovery without needing to manually enter IP addresses.

### sslip.io
To comply with WebAuthn (Passkeys) security requirements, the app uses `sslip.io` magic domains.
- Example: `192-168-1-50.sslip.io` resolves to `192.168.1.50`.
- All data traffic remains strictly local (LAN). No data is sent to the internet; `sslip.io` is only used for DNS resolution to satisfy secure context requirements for WebAuthn.

### Root CA
The Desktop app generates a self-signed Root Certificate Authority (CA) to enable secure HTTPS connections required for Passkeys.
- When you first connect, you will see a one-time "Install Certificate" prompt.
- Following this prompt installs the certificate into the Android User Certificate credentials store, allowing the app to trust the local server.

### Troubleshooting
If automatic discovery fails (e.g., due to router blocking mDNS):
- Use the **IP Address** directly via the "Pair (LAN)" QR Code on the desktop.
- The app will automatically convert the IP address into the correct `sslip.io` domain format to ensure WebAuthn still works.

## JDK requirement (Gradle/AGP)

This project uses Gradle 8.5 + Android Gradle Plugin (AGP) 8.2.2, which requires **JDK 17+** for Gradle.

Recommended on Windows: use Android Studio's embedded JBR:
- `C:\Program Files\Android\Android Studio\jbr`

## Updating the app on a physical phone (Windows)

The easiest way to update the app on a phone is to install the Debug build again. As long as the app id/signing key match, Android treats this as an update.

1) Enable developer mode + USB debugging on the phone
- Android Settings → About phone → tap "Build number" 7 times
- Developer options → enable "USB debugging"

2) Install Android Platform Tools (ADB) on Windows and verify the device is visible
- `adb devices`

If `adb` is not on your PATH, Android Studio usually installs it under:
- `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`

Either add the `platform-tools` folder to PATH, or call adb by full path.

3) From the `android/` folder, install/update the debug APK

```powershell
Set-Location .\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
./gradlew.bat :app:installDebug
```

Notes:
- If you hit Gradle wrapper issues on Windows and the wrapper jars are missing, run:
  - `powershell -ExecutionPolicy Bypass -File .\bootstrap-wrapper.ps1`
- If install fails due to a signature mismatch (common if you previously installed a differently-signed build), uninstall first:
  - `adb uninstall com.inventory.android`

## Optional: one-command installer script (Windows)

See [android/scripts/install-debug.ps1](android/scripts/install-debug.ps1) for a helper that runs the same update flow.

Examples:
- `powershell -ExecutionPolicy Bypass -File .\android\scripts\install-debug.ps1`
- With a specific device: `powershell -ExecutionPolicy Bypass -File .\android\scripts\install-debug.ps1 -Device <serial>`
- If adb is not on PATH: `powershell -ExecutionPolicy Bypass -File .\android\scripts\install-debug.ps1 -AdbPath "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`

The helper auto-detects (best-effort):
- `adb.exe` from common Android SDK install locations
- Android Studio's 64-bit JBR (to avoid 32-bit Java heap failures)

Optional flags:
- `-JavaHome "C:\Program Files\Android\Android Studio\jbr"` to force a specific JDK/JBR
- `-Clean` to run `:app:clean` before install

## Running tests (Windows)

Use the helper (recommended):

```powershell
powershell -ExecutionPolicy Bypass -File .\android\scripts\run-tests.ps1
```

To include instrumentation tests (requires emulator/device):

```powershell
powershell -ExecutionPolicy Bypass -File .\android\scripts\run-tests.ps1 -Connected
```

If you prefer manual commands, avoid nesting `powershell -Command "..."` from an already-running PowerShell session, because `$LASTEXITCODE` will get expanded by the outer shell.

Run this instead:

```powershell
Set-Location .\android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
./gradlew.bat testDebugUnitTest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
./gradlew.bat connectedDebugAndroidTest
```

## Windows notes for physical devices

- You need Android Platform Tools (ADB). Verify with `adb devices`.
- If Gradle fails with Java heap / daemon errors, ensure a 64-bit JDK is used.
  - Android Studio ships an embedded JDK (JBR). You can point `JAVA_HOME` to it when running `gradlew.bat` from a terminal.

If you see an error like:
- `Could not reserve enough space for 2097152KB object heap`

It usually means Gradle is using a 32-bit Java (often under `C:\Program Files (x86)\...`). Fix by using Android Studio's 64-bit JBR:
- `powershell -ExecutionPolicy Bypass -File .\android\scripts\install-debug.ps1 -JavaHome "C:\Program Files\Android\Android Studio\jbr"`
