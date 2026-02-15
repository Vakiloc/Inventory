# Household Inventory (offline-first)

This workspace contains a working **desktop + local server** MVP:
- **Server**: Node.js + Express + SQLite (LAN sync + export/import + sync log)
- **Desktop**: Electron app that talks to the local server
- **Android**: Kotlin/Compose client that pairs to the Desktop over LAN (offline-first scans + background sync)

Path: `inventory-app/`

## Prereqs (Windows)

### 1) Install Node.js (LTS)

```powershell
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
```

If your current terminal still can’t find `node`/`npm`, reopen PowerShell or run:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
```

### 2) Install C++ build tools (needed for `better-sqlite3`)

```powershell
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### 3) Networking (Zero-Config)

The app handles secure local networking automatically using a custom **Local PKI** and **sslip.io**:
- **No Manual IP**: The app advertises itself via mDNS (Bonjour).
- **Secure WebAuthn**: The internal CA issues certificates for `[managed-ip].sslip.io` to ensure a valid HTTPS origin for Passkeys without needing external tunnels or internet access.
- **Bootstrapping**: The Android app will prompt you to install a certificate on first pair ("Trust On First Use").

## Install

From `inventory-app/`:

```powershell
cd inventory-app
npm install
```

## Run

### Option A (recommended): Run the desktop app (it auto-starts the server)

```powershell
cd inventory-app
npm run dev:desktop
```

If port `5199` is already in use, override it:

```powershell
$env:INVENTORY_PORT = "5200"
npm run dev:desktop
```

### Option B: Run the server only

```powershell
cd inventory-app
npm run dev -w server
```

If port `5199` is already in use when running the server directly:

```powershell
$env:PORT = "5200"
npm run dev -w server
```

Health check:

```powershell
Invoke-RestMethod "http://127.0.0.1:5199/api/ping" | ConvertTo-Json -Depth 5
```

### Option C: Run WebAuthn Dev Mode (Android Testing)

To test WebAuthn/Biometric pairing on Android (which requires HTTPS via ngrok):

1. Stop other running servers.
2. Run the helper script:

```powershell
.\scripts\start-dev-webauthn.ps1
```

3. Pair the Android app using the **HTTPS URL** printed in the terminal.

## What works (current MVP)

- CRUD inventory items (name, description, qty, category, location, barcode, serial, purchase date, warranty, value, photo path)
- Search/filter in desktop UI
- Barcode workflows:
  - USB scanners: focus **Quick scan** and scan (acts like typing + Enter)
  - Webcam scanners (Windows): click **Webcam scan** (or **Scan** next to the Barcode field)
  - If a scanned barcode already exists, the server increments the item quantity automatically
  - You can attach multiple barcodes to a single item ("combine barcode sets")
- **LAN sync API**:
  - REST CRUD endpoints
  - Composite `POST /api/sync` (push changes + pull changes since timestamp)
  - LWW conflict handling via `last_modified`
- **Export/Import**:
  - `GET /api/export` returns a JSON snapshot
  - `POST /api/import` merges snapshot (LWW)
- **Sync log**:
  - `GET /api/sync-log`
- Basic **role gating** in desktop UI (Viewer disables editing)

## LAN pairing token

The server uses a simple bearer token.
- Desktop reads it locally from `GET /api/admin/token` (localhost-only endpoint).
- LAN clients must include `Authorization: Bearer <token>`.

Desktop UI shows a QR payload containing `{ baseUrl, token }`.
Replace `YOUR-DESKTOP-IP` with your actual LAN IP in the pairing dialog.

## Android client

The Android app lives under `android/`.

- Pair by scanning the Desktop pairing QR (payload `{ baseUrl, token }`).
- Initial sync (bootstrap) pulls a full snapshot via `GET /api/export`.
- Offline scans increment local quantities and queue idempotent delta events.
- Sync runs:
  - in the foreground (connection check + fast flush on reconnect)
  - periodically in the background (WorkManager, every 15 minutes when connected)

See `docs/ANDROID.md` and `android/README.md` for setup and device install notes.

## Google Drive sync (optional, CLI scaffold)

Implemented as an **optional** JSON snapshot upload/download (does not run automatically).

1) Create OAuth credentials in Google Cloud Console and download `credentials.json`
2) Place it at:

- `inventory-app/server/src/drive/credentials.json`

or set:

- `GOOGLE_OAUTH_CREDENTIALS_PATH=/absolute/path/to/credentials.json`

Then:

```powershell
cd inventory-app
# Upload local snapshot to Drive
npm run drive:push -w server
# Download snapshot from Drive and merge into local DB
npm run drive:pull -w server
```

## Data location

Server stores SQLite at:
- `inventory-app/server/data/inventory.sqlite`

(override with `INVENTORY_DATA_DIR`)

## Sample inventory

A small sample dataset is included at:
- `docs/sample-inventory.json`

To import it into a running local server:

```powershell
# Get bearer token (localhost-only)
$token = (Invoke-RestMethod "http://127.0.0.1:5199/api/admin/token").token

# Read JSON body from disk
$body = Get-Content -Raw ".\docs\sample-inventory.json"

# Import snapshot
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:5199/api/import" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json -Depth 5
```

Note: the sample items use a very small `last_modified` value, so importing into an existing DB is less likely to overwrite newer real data.

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/SECURITY.md`
- `docs/DRIVE_SYNC.md`
- `docs/ANDROID.md`

## Releasing

See `docs/RELEASING.md`.

## Notes

- Images are stored as file paths right now (no binary storage).
- For Android behavior and setup notes, see `docs/ANDROID.md`.
