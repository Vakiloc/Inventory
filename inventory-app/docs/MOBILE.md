# Mobile app (Capacitor)

The Capacitor mobile client (`mobile/`) provides a cross-platform iOS + Android app that pairs to the Desktop server over LAN.

## Architecture

The mobile app is built with **Capacitor 6** wrapping a **vanilla JS** web app bundled with **Vite**. It shares the same sync protocol as the native Android (Kotlin) client but uses web technologies throughout.

### Source modules

| File | Purpose |
|------|---------|
| `src/app.js` | Main entry — screen navigation, item CRUD, pairing, scanning, UI wiring |
| `src/api.js` | REST client with Bearer auth (`Authorization: Bearer <token>`) |
| `src/storage.js` | localStorage-based persistence: preferences, data caches, offline queues |
| `src/sync.js` | Offline sync engine mirroring Android's `syncOnce()` protocol |
| `src/network.js` | Network status detection + periodic sync scheduling |
| `src/index.html` | Mobile UI — 5 screens (pair, items, scan, item-detail, settings) |
| `src/styles.css` | Dark mobile-first theme with safe-area-inset support |

### Native projects

| Directory | Description |
|-----------|-------------|
| `android/` | Capacitor Android project (Gradle) — **not** the native Kotlin app at `inventory-app/android/` |
| `ios/` | Capacitor iOS project (Xcode workspace) |
| `scripts/cap-sync.mjs` | Wrapper for `npx cap sync` that patches tar v7 CJS compatibility |

## Current capabilities

- **Pair** by scanning a QR code from the Desktop app or pasting pairing JSON
- **Browse** inventory locally with search, category, and location filters
- **Create/edit/delete** items with full form fields
- **Scan barcodes** via camera (ZXing WebView or MLKit native)
- **Offline-first sync**: pending creates, updates, and scan events are queued and flushed on next sync
- **Network detection**: auto-syncs when coming back online, shows online/offline indicator
- **Periodic sync**: every 60 seconds when paired and online

## Sync protocol

The sync engine (`sync.js`) follows the same cycle as the native Android client:

1. **Bootstrap** (first sync): `GET /api/export` — downloads full inventory snapshot
2. **Push creates**: `POST /api/items` — one per pending create
3. **Push updates**: `PUT /api/items/:id` — one per pending update (409 → conflict state)
4. **Push scans**: `POST /api/scans/apply` — batch of queued scan events
5. **Pull items**: `GET /api/items?since=<timestamp>&includeDeleted=1`
6. **Refresh lookups**: `GET /api/categories` + `GET /api/locations`

## Development

### Prerequisites

- Node.js 20+
- For iOS: macOS with Xcode 15+ and CocoaPods
- For Android: Android Studio with SDK 34+

### Setup

From `inventory-app/`:

```sh
npm install                          # Install all workspace dependencies
npm run build -w mobile              # Build web assets
npm run cap:sync -w mobile           # Sync assets to native projects
```

### Dev server

```sh
npm run dev -w mobile                # Vite dev server on port 5175
```

### Open native IDE

```sh
npm run cap:open:ios -w mobile       # Open Xcode
npm run cap:open:android -w mobile   # Open Android Studio
```

### Run on device

```sh
npm run cap:run:ios -w mobile        # Build & run on iOS device/simulator
npm run cap:run:android -w mobile    # Build & run on Android device/emulator
```

### Sync after code changes

After modifying web source files:

```sh
npm run build -w mobile && npm run cap:sync -w mobile
```

Or use the platform-specific sync:

```sh
npm run cap:sync:ios -w mobile
npm run cap:sync:android -w mobile
```

## iOS-specific notes

### CocoaPods

The iOS project uses CocoaPods for native plugin dependencies. After `cap sync ios`, run:

```sh
cd mobile/ios/App && pod install
```

This is handled automatically by `cap sync` when CocoaPods is installed.

### Code signing

For development, Xcode will auto-sign with your personal team. For distribution:

1. Set a valid Bundle Identifier in Xcode (replace `com.inventory.mobile`)
2. Select your Apple Developer team
3. Configure provisioning profiles

## Differences from native Android app

| Feature | Native Android | Capacitor Mobile |
|---------|---------------|-----------------|
| Language | Kotlin/Compose | Vanilla JS |
| Storage | Room (SQLite) | localStorage |
| Background sync | WorkManager (~15 min) | setInterval (60s, foreground only) |
| Barcode scanning | ZXing native | ZXing WebView + MLKit plugin |
| Network detection | ConnectivityManager | @capacitor/network plugin |
| Platforms | Android only | iOS + Android |

Both clients implement the same REST API sync protocol and are fully compatible with the Desktop server.

## Troubleshooting

### tar v7 compatibility

The workspace root overrides `tar` to v7 for security. Capacitor CLI expects tar v6's CJS default export. The `scripts/cap-sync.mjs` wrapper handles this by injecting a Node.js preload that patches `tar.default`. Always use `npm run cap:sync` instead of `npx cap sync` directly.

### Self-signed certificates on iOS

iOS requires certificate trust to be configured for self-signed certs:

1. Download the Root CA from the Desktop app (Settings → Security → Download CA)
2. On iOS: Settings → General → VPN & Device Management → Install the certificate
3. Settings → General → About → Certificate Trust Settings → Enable full trust

### Camera permissions

Both iOS and Android require camera permission for barcode scanning. The app requests permission on first scan attempt. If denied, go to device Settings → App → Permissions to re-enable.
