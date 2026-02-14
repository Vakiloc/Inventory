# CLAUDE.md — Inventory

## Project Overview

Household Inventory is a **local-first, offline-capable** inventory management system designed for LAN environments. The Desktop (Electron) app acts as the central host and source of truth, running an embedded Node.js/Express server with SQLite storage. The Android (Kotlin/Compose) app connects as a client over HTTPS on the local network, syncing via REST API with offline queuing and background sync. An optional Google Drive sync allows sharing data between Desktop instances.

Current version: **0.1.4** (desktop `package.json`).

## Repository Layout

```
Inventory/
├── inventory-app/               # npm workspaces root
│   ├── package.json             # Workspaces: server, desktop
│   ├── server/                  # Node.js Express API + SQLite
│   │   ├── src/
│   │   │   ├── index.js         # Entry point, HTTPS setup, graceful shutdown
│   │   │   ├── app.js           # Express app creation, routes, middleware
│   │   │   ├── db.js            # Database schema & migrations
│   │   │   ├── stateDb.js       # Server-state DB (pairing, auth)
│   │   │   ├── repo.js          # Data access layer (items, categories, locations, scans)
│   │   │   ├── http.js          # Auth middleware, security headers
│   │   │   ├── validation.js    # Zod schemas for API payloads
│   │   │   ├── routes/          # API endpoint handlers
│   │   │   ├── middleware/      # IP-check middleware
│   │   │   ├── drive/           # Google Drive sync (optional scaffold)
│   │   │   ├── webauthn/        # WebAuthn registration/verification
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
│   ├── docs/                    # API.md, SECURITY.md, ANDROID.md, RELEASING.md, etc.
│   └── scripts/                 # Build, release, and utility scripts
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

## Common Commands

All commands run from `inventory-app/` unless noted otherwise.

### Install

```sh
npm install
```

### Development

```sh
npm run dev              # Server only (port 5199)
npm run dev:desktop      # Desktop app + embedded server
npm run dev:all          # Concurrent server + desktop (uses concurrently)
```

Override the default port with `PORT=5200` (server-only) or `INVENTORY_PORT=5200` (desktop).

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

### Build & Release

```sh
npm run build                      # Build all workspaces
npm run dist:win -w desktop        # Windows NSIS installer (electron-builder)
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
| `inventory.sqlite` | `server/data/` | Items, categories, locations, barcodes, scan events, sync log, WebAuthn credentials |
| `server-state.sqlite` | `server/data/` | Paired devices, pairing codes, server secret & owner token |

Migrations run automatically via `CREATE TABLE IF NOT EXISTS` in `db.js` and `stateDb.js` on server startup.

### Sync & Conflict Resolution

- **Last-Write-Wins (LWW)**: Items use a `last_modified` Unix timestamp (ms). On update, if `payload.last_modified < db.last_modified`, the server rejects with 409 Conflict.
- **Idempotent scan events**: Clients generate UUIDs for each scan event. The server deduplicates via the `scan_events` table, preventing double-counting on retry.
- **Android sync cycle**: Pair via QR -> bootstrap via `GET /api/export` -> push scans via `POST /api/scans/apply` -> pull incremental changes via `GET /api/items?since=<ts>`. Background sync via WorkManager (~15 min intervals).

### Security

- **TLS**: Self-signed certificates generated by a local Root CA (`keystore.js`) using `sslip.io` domains for valid HTTPS origins on LAN.
- **Authentication**: Bearer token (`Authorization: Bearer <token>`). Owner token stored in `server-state.sqlite`; device tokens issued during pairing.
- **WebAuthn/Passkeys**: Used for admin operations. Libraries: `@simplewebauthn/server` (backend), `navigator.credentials` (frontend).
- **Pairing**: Desktop generates a short-lived pairing code (2-min TTL) displayed as a QR code. Android scans it and exchanges for a permanent device token (Trust-On-First-Use for the self-signed certificate).
- **mDNS discovery**: `bonjour-service` advertises the server on the LAN for automatic Android discovery.

### Frontend

The desktop renderer uses **vanilla JavaScript** with ES modules bundled by Vite. There is no component framework (React, Vue, etc.). State management is done with module-level variables and direct DOM manipulation.

## CI/CD

### `ci.yml` — Runs on PR and push to `main`

1. **Node tests** (Windows, Node 20): `npm ci` -> `npm test` -> `npm run build -w desktop`
2. **Android unit tests** (Linux, Java 17): `./gradlew :app:testDebugUnitTest` -> `./gradlew :app:assembleDebug`

### `release.yml` — Triggered by version tags (`v*.*.*`) or manual dispatch

1. Validates Node and Android tests
2. Builds Windows NSIS installer via electron-builder
3. Builds signed Android release APK
4. Publishes both artifacts to a GitHub Release

## Code Conventions

- **ES modules** throughout: `"type": "module"` in all workspace `package.json` files. Use `import`/`export`, not `require`. Exception: `preload.cjs` (Electron requires CommonJS for preload scripts).
- **No linter/formatter enforced**: There is no ESLint or Prettier configuration. Follow existing code style when making changes.
- **Validation**: API payloads are validated with Zod schemas in `server/src/validation.js`.
- **i18n**: Translation strings live in `i18n/` directories within both server and desktop. Run `npm run lint:i18n` to check key consistency.
- **Database changes**: Add new tables or columns via `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` in `db.js` or `stateDb.js`. Migrations are embedded in code, not separate files.
- **Vanilla JS frontend**: No JSX, no templating engine. UI updates are done via direct DOM manipulation (`document.getElementById`, `innerHTML`, event listeners).
- **Android**: Kotlin with Jetpack Compose for UI, Room for local persistence, Retrofit for HTTP.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5199` | Server listen port (server-only mode) |
| `INVENTORY_PORT` | `5199` | Server port override (desktop mode) |
| `INVENTORY_DATA_DIR` | `server/data/` | SQLite database directory |
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
| `inventory-app/docs/ANDROID.md` | Android client guide |
| `inventory-app/docs/RELEASING.md` | Release procedures |
| `inventory-app/docs/MAINTENANCE.md` | Cleanup & re-initialization |
| `inventory-app/docs/DRIVE_SYNC.md` | Google Drive sync setup |
| `inventory-app/android/README.md` | Android development setup & testing |
