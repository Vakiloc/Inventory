# CLAUDE.md — Inventory

## Project Overview

Household Inventory is a **local-first, offline-capable** inventory management system designed for LAN environments. The Desktop (Electron) app acts as the central host and source of truth, running an embedded Node.js/Express server with SQLite storage. Mobile clients connect over HTTPS on the local network, syncing via REST API with offline queuing and background sync. Two mobile clients are available: a native **Android** (Kotlin/Compose) app and a cross-platform **Capacitor** (iOS + Android) app built with vanilla JS. An optional Google Drive sync allows sharing data between Desktop instances.

The desktop app is fully **cross-platform**, supporting Windows, macOS, and Linux.

Current version: **0.1.4** (desktop `package.json`).

## Repository Layout

```
Inventory/
├── inventory-app/               # npm workspaces root
│   ├── package.json             # Workspaces: server, desktop, mobile
│   ├── server/                  # Node.js Express API + SQLite
│   │   ├── src/
│   │   │   ├── index.js         # Entry point, HTTPS setup, graceful shutdown
│   │   │   ├── app.js           # Express app creation, module wiring, domain splitting
│   │   │   ├── http.js          # Security headers, response helpers
│   │   │   ├── validation.js    # Zod schemas for API payloads
│   │   │   ├── idp/             # Identity Provider module
│   │   │   │   ├── index.js     # Module entry: createIdp()
│   │   │   │   ├── auth.js      # Auth middleware, role enforcement
│   │   │   │   ├── stateDb.js   # Server-state DB (pairing, devices, WebAuthn creds)
│   │   │   │   ├── webauthn.js  # WebAuthn registration/verification logic
│   │   │   │   ├── webauthnDb.js # WebAuthn credential persistence
│   │   │   │   ├── ipCheck.js   # Local network IP validation
│   │   │   │   └── routes/      # IdP routes (core, devices, webauthn)
│   │   │   ├── inventory/       # Inventory App module
│   │   │   │   ├── index.js     # Module entry: createInventoryRouters()
│   │   │   │   ├── db.js        # Inventory DB schema & migrations
│   │   │   │   ├── inventoryDb.js # Multi-inventory DB provider
│   │   │   │   ├── repo.js      # Data access layer (items, categories, locations, scans)
│   │   │   │   ├── middleware.js # X-Inventory-Id header resolution
│   │   │   │   └── routes/      # Inventory routes (items, categories, locations, scans, syncLog)
│   │   │   ├── drive/           # Google Drive sync (optional scaffold)
│   │   │   └── i18n/            # Server-side translations
│   │   └── test/                # Vitest + Supertest tests
│   ├── desktop/                 # Electron desktop client
│   │   ├── src/
│   │   │   ├── main.js          # Electron main process, IPC, server spawning
│   │   │   ├── keystore.js      # Local CA & certificate generation (PKI)
│   │   │   ├── serverConfig.js  # IP detection, sslip.io domain resolution
│   │   │   ├── preload.cjs      # IPC bridge (contextBridge)
│   │   │   └── renderer/        # Frontend UI (vanilla JS, Vite-bundled)
│   │   │       ├── app.js       # Main UI logic & state management
│   │   │       ├── itemsUi.js   # Item CRUD, search, filtering
│   │   │       ├── pairing.js   # QR code pairing flow
│   │   │       ├── scanner.js   # Barcode scanner (webcam/USB)
│   │   │       ├── setup.js     # Keystore & inventory setup wizard
│   │   │       ├── lookups.js   # Category/Location dropdowns
│   │   │       ├── webauthn.js  # WebAuthn registration/auth
│   │   │       ├── index.html   # Main application page
│   │   │       └── styles.css   # Stylesheet
│   │   └── test/                # Vitest tests (jsdom environment)
│   ├── android/                 # Kotlin/Compose Android app (Gradle)
│   │   ├── app/src/main/java/com/inventory/android/
│   │   │   ├── data/            # Room entities, DAOs, repository
│   │   │   ├── net/             # Retrofit client, mDNS discovery, cert manager
│   │   │   ├── ui/              # Compose screens & ViewModels
│   │   │   ├── security/        # WebAuthn, device identity
│   │   │   └── sync/            # WorkManager background sync
│   │   └── app/src/androidTest/ # JUnit + instrumentation tests
│   ├── mobile/                  # Capacitor mobile app (iOS + Android)
│   │   ├── src/                 # Vanilla JS app (Vite-bundled)
│   │   │   ├── app.js           # Main app logic, screen navigation
│   │   │   ├── api.js           # REST API client with Bearer auth
│   │   │   ├── storage.js       # localStorage persistence + offline queues
│   │   │   ├── sync.js          # Offline sync engine (mirrors Android protocol)
│   │   │   ├── network.js       # Network detection + periodic sync
│   │   │   ├── index.html       # Mobile UI (5 screens)
│   │   │   └── styles.css       # Dark mobile-first theme
│   │   ├── scripts/cap-sync.mjs # Capacitor sync wrapper (patches tar v7 compat)
│   │   ├── android/             # Capacitor Android native project
│   │   └── ios/                 # Capacitor iOS native project (Xcode)
│   ├── docs/                    # API.md, SECURITY.md, ANDROID.md, RELEASING.md, etc.
│   └── scripts/                 # Build, release, and utility scripts (Node.js, cross-platform)
├── docs/
│   └── SYSTEM_DESIGN.md         # Comprehensive architecture & schema reference
├── .github/workflows/           # CI (ci.yml) and Release (release.yml)
└── CHANGELOG.md
```

## Tech Stack

| Platform | Languages / Frameworks | Key Libraries |
|----------|----------------------|---------------|
| **Server** | Node.js, Express, ES modules | better-sqlite3, Zod, @simplewebauthn/server, cors |
| **Desktop** | Electron 30, Vite, vanilla JS | @zxing/browser, @simplewebauthn/browser, bonjour-service, ngrok, node-forge, selfsigned, qrcode |
| **Android** | Kotlin, Jetpack Compose | Room, Retrofit, WorkManager, OkHttp, ZXing, Credentials API |
| **Mobile** | Capacitor 6, Vite, vanilla JS | @capacitor/network, @capacitor-mlkit/barcode-scanning, @zxing/browser |

## Common Commands

All commands run from `inventory-app/` unless noted otherwise.

### Install

```sh
npm install
```

### Development

```sh
npm run dev              # Server only (port 443)
npm run dev:desktop      # Desktop app + embedded server
npm run dev:all          # Concurrent server + desktop (uses concurrently)
```

Override the default port with `PORT=8443` (server-only) or `INVENTORY_PORT=8443` (desktop).

### Testing

```sh
npm test                 # i18n lint + server tests + desktop tests
npm test -w server       # Server tests only (Vitest)
npm test -w desktop      # Desktop tests only (Vitest)
npm run lint:i18n        # Check i18n key consistency
```

Android (from `inventory-app/android/`):

```sh
./gradlew :app:testDebugUnitTest   # Unit tests
./gradlew :app:assembleDebug       # Build debug APK
```

### Mobile (Capacitor)

```sh
npm run dev -w mobile              # Vite dev server (port 5175)
npm run build -w mobile            # Build web assets
npm run cap:sync -w mobile         # Sync web assets to native projects
npm run cap:open:ios -w mobile     # Open Xcode project
npm run cap:open:android -w mobile # Open Android Studio project
```

### Build & Release

```sh
npm run build                      # Build all workspaces
npm run dist:win -w desktop        # Windows NSIS installer (electron-builder)
npm run dist:mac -w desktop        # macOS DMG + zip
npm run dist:linux -w desktop      # Linux AppImage + deb
npm run dist -w desktop            # Build for current platform
```

## Testing Details

- **Framework**: Vitest for server and desktop workspaces
- **Server tests** (`server/test/`): Node environment, Supertest for HTTP assertions, ephemeral test DB via `testDb.js`, 20-second timeout
- **Desktop tests** (`desktop/test/`): jsdom environment, extensive mocking of Electron IPC and renderer APIs
- **Android tests** (`android/app/src/androidTest/`): JUnit 4, Mockito, AndroidX instrumentation, WorkManager testing helpers
- **i18n lint**: `scripts/check-i18n-keys.mjs` validates translation key consistency; runs automatically as part of `npm test`

Always run `npm test` from the `inventory-app/` root before committing to ensure all tests pass.

## Architecture & Key Patterns

### Databases

Two separate SQLite files (created automatically on first run):

| Database | Path | Purpose |
|----------|------|---------|
| `inventory.sqlite` | Per-inventory data directory | Items, categories, locations, barcodes, scan events, sync log |
| `server-state.sqlite` | Server state directory (Electron: `userData/`) | Paired devices, pairing codes, server secret, owner token, WebAuthn credentials |

Migrations run automatically via `CREATE TABLE IF NOT EXISTS` in `inventory/db.js` and `idp/stateDb.js` on server startup.

### Server Module Architecture

The server is split into two logical modules, both running in the same Express process:

- **IdP (Identity Provider)** (`server/src/idp/`): Authentication, device pairing (QR code flow), device management (list/revoke), WebAuthn/passkey registration and verification. All state stored in `server-state.sqlite`.
- **Inventory** (`server/src/inventory/`): Item/category/location CRUD, barcode scanning, sync/export/import, multi-inventory selection. Data stored in per-inventory `inventory.sqlite` files.

The IdP creates auth middleware (`requireAuth`, `requireOwner`) consumed by the Inventory module. Both modules expose Express routers mounted on a shared `/api` router in `app.js`.

**Split-domain mode** (optional): When `IDP_HOSTNAME` and/or `APP_HOSTNAME` env vars are set, the server routes WebAuthn requests (`/auth/webauthn/*`) to the IdP hostname and API requests (`/api/*`) to the app hostname. In monolith mode (default), both coexist on a single origin.

**Multi-inventory**: The `X-Inventory-Id` request header selects which inventory database to use. A registry file (`inventories.json` in Electron `userData/`) maps inventory IDs to data directories. Each inventory has its own `inventory.sqlite`. If no registry is configured, a single default inventory is used.

### Sync & Conflict Resolution

- **Last-Write-Wins (LWW)**: Items use a `last_modified` Unix timestamp (ms). On update, if `payload.last_modified < db.last_modified`, the server rejects with 409 Conflict.
- **Idempotent scan events**: Clients generate UUIDs for each scan event. The server deduplicates via the `scan_events` table, preventing double-counting on retry.
- **Mobile sync cycle**: Pair via QR -> bootstrap via `GET /api/export` -> push scans via `POST /api/scans/apply` -> pull incremental changes via `GET /api/items?since=<ts>`. Android: background sync via WorkManager (~15 min intervals). Capacitor mobile: periodic sync every 60s + auto-sync on network reconnect.

### Security

- **TLS**: Self-signed certificates generated by a local Root CA (`keystore.js`) using `sslip.io` domains, or user-provided certificates (e.g., Let's Encrypt via DuckDNS). Default port is 443 (HTTPS standard).
- **Authentication**: Bearer token (`Authorization: Bearer <token>`). Owner token stored in `server-state.sqlite`; device tokens (`d1.<device_id>.<hmac>`) issued during pairing. Roles: owner, editor, viewer.
- **WebAuthn/Passkeys**: Used for device registration and admin authentication. Libraries: `@simplewebauthn/server` (backend), `navigator.credentials` (frontend), Android Credentials API.
- **Pairing**: Desktop generates a short-lived pairing code (2-min TTL) displayed as a QR code. QR payload includes LAN IPs for offline hostname resolution. Android scans it and exchanges for a permanent device token (Trust-On-First-Use for the self-signed certificate).
- **mDNS discovery**: `bonjour-service` advertises the server on the LAN for automatic Android discovery.

### Frontend

The desktop renderer uses **vanilla JavaScript** with ES modules bundled by Vite. There is no component framework (React, Vue, etc.). State management is done with module-level variables and direct DOM manipulation.

The Capacitor mobile app also uses **vanilla JavaScript** with Vite, sharing the same architectural patterns as the desktop renderer (REST API client, localStorage-based offline queues, DOM manipulation). The mobile UI is optimized for touch with bottom navigation, FAB, and safe-area-inset support.

## CI/CD

### `ci.yml` — Runs on PR and push to `main`

1. **Node tests** (Windows, macOS, Linux — matrix): `npm ci` -> `npm test` -> `npm run build -w desktop` -> `npm run build -w mobile`
2. **Android unit tests** (Linux, Java 17): `./gradlew :app:testDebugUnitTest` -> `./gradlew :app:assembleDebug`

### `release.yml` — Triggered by version tags (`v*.*.*`) or manual dispatch

1. Validates Node tests (3-OS matrix) and Android tests
2. Builds desktop installers: Windows (NSIS .exe), macOS (DMG + zip), Linux (AppImage + deb)
3. Builds signed Android release APK (native Kotlin app)
4. Builds unsigned iOS IPA (Capacitor mobile app)
5. Publishes all artifacts to a GitHub Release

## Code Conventions

- **ES modules** throughout: `"type": "module"` in all workspace `package.json` files. Use `import`/`export`, not `require`. Exception: `preload.cjs` (Electron requires CommonJS for preload scripts).
- **No linter/formatter enforced**: There is no ESLint or Prettier configuration. Follow existing code style when making changes.
- **Validation**: API payloads are validated with Zod schemas in `server/src/validation.js`.
- **i18n**: Translation strings live in `i18n/` directories within both server and desktop. Run `npm run lint:i18n` to check key consistency.
- **Database changes**: Add new tables or columns via `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` in `inventory/db.js` (inventory schema) or `idp/stateDb.js` (identity/state schema). Migrations are embedded in code, not separate files.
- **Vanilla JS frontend**: No JSX, no templating engine. UI updates are done via direct DOM manipulation (`document.getElementById`, `innerHTML`, event listeners). Both desktop and mobile use this approach.
- **Android (native)**: Kotlin with Jetpack Compose for UI, Room for local persistence, Retrofit for HTTP.
- **Mobile (Capacitor)**: Vanilla JS wrapped in Capacitor 6 for iOS/Android native containers. Uses `@capacitor/network` for connectivity, `@zxing/browser` for barcode scanning.
- **Scripts**: All build/release/utility scripts are written in Node.js (`.mjs` files) for cross-platform compatibility. No PowerShell dependency.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `443` | Server listen port (server-only mode) |
| `INVENTORY_PORT` | `443` | Server port override (desktop mode) |
| `INVENTORY_DATA_DIR` | `server/data/` | SQLite database directory (default inventory) |
| `INVENTORY_SERVER_STATE_DIR` | `INVENTORY_DATA_DIR` | Directory for `server-state.sqlite` (Electron: `userData/`) |
| `INVENTORY_REGISTRY_PATH` | — | Path to `inventories.json` for multi-inventory mode |
| `IDP_HOSTNAME` | — | Hostname for IdP routes (split-domain mode) |
| `APP_HOSTNAME` | — | Hostname for Inventory API routes (split-domain mode) |
| `WEBAUTHN_RP_ID` | `req.hostname` | WebAuthn Relying Party ID (domain for passkey binding) |
| `HTTPS_PFX_PATH` | — | Path to PKCS#12 certificate file |
| `HTTPS_CERT_PATH` / `HTTPS_KEY_PATH` | — | Separate cert/key paths |
| `HTTPS_PASSPHRASE` | — | TLS certificate passphrase |
| `INVENTORY_ROOT_CA_PATH` | — | Root CA for Android certificate download |
| `VITE_DEV_SERVER_URL` | — | Desktop dev server URL (set automatically) |
| `GOOGLE_OAUTH_CREDENTIALS_PATH` | — | Google Drive sync OAuth credentials |

## Key Documentation

| Document | Description |
|----------|-------------|
| `docs/SYSTEM_DESIGN.md` | Comprehensive architecture, schemas, sync protocol, security |
| `inventory-app/docs/API.md` | REST endpoint reference |
| `inventory-app/docs/SECURITY.md` | Security model (LAN auth, transport, at-rest) |
| `inventory-app/docs/ANDROID.md` | Android (native) client guide |
| `inventory-app/docs/MOBILE.md` | Capacitor mobile (iOS + Android) guide |
| `inventory-app/docs/RELEASING.md` | Release procedures (all platforms) |
| `inventory-app/docs/MAINTENANCE.md` | Cleanup & re-initialization |
| `inventory-app/docs/DRIVE_SYNC.md` | Google Drive sync setup |
| `inventory-app/android/README.md` | Android development setup & testing |
