# System Design & Implementation Guide

This document serves as a comprehensive technical specification for the Inventory application. It details the architecture, data models, security patterns, and logic flows required to reproduce the system from scratch.

## 1. Architecture Overview

 The application follows a **Local-First, Distributed** architecture designed for offline-capable LAN environments.

*   **Host (Desktop)**: An Electron application acts as the central server (Source of Truth) for the local network. It runs an Express.js Node.js server. Supports Windows, macOS, and Linux.
*   **Client (Android — native)**: A native Android application (Kotlin/Compose) that connects to the Host via REST API.
*   **Client (Mobile — Capacitor)**: A cross-platform mobile app (iOS + Android) built with Capacitor 6, vanilla JS, and Vite. Shares the same sync protocol as the native Android app.
*   **Security & Networking**:
    *   **Local PKI**: Desktop generates a unique Root CA and issues ephemeral certificates for local IP addresses.
    *   **Domain Resolution**: Uses `sslip.io` (Wildcard DNS) to provide valid TLS origins (e.g., `https://192-168-1-5.sslip.io`) for WebAuthn compatibility.
    *   **Discovery**: mDNS (Bonjour) is used to locate the server on the LAN.
*   **Sync Strategy**:
    *   **LAN**: Direct HTTPS communication between Device and Host.
    *   **Cloud (Optional)**: Google Drive file-based sync for sharing the SQLite database file between Desktop instances.

### Server Module Architecture

The server code is organized into two modules:

*   **IdP (Identity Provider)** (`server/src/idp/`): Handles authentication, device pairing, WebAuthn/passkey management, and device lifecycle. State is stored in `server-state.sqlite`.
*   **Inventory** (`server/src/inventory/`): Handles item/category/location CRUD, barcode scanning, sync, and export/import. Data is stored in per-inventory `inventory.sqlite` files.

Both modules run in the same Express process. The IdP provides auth middleware consumed by the Inventory module. An optional **split-domain mode** (`IDP_HOSTNAME` / `APP_HOSTNAME` env vars) routes WebAuthn requests to the IdP hostname and API requests to the app hostname.

## 2. Data Persistence Layer

The system uses **SQLite** (`better-sqlite3`) and maintains two distinct database files to separate business data from configuration.

### A. Inventory Database (`inventory.sqlite`)
*   **Purpose**: Stores inventory items, transaction history, and categories.
*   **Path**: `data/inventory.sqlite`

#### Schema Definitions

**1. Items Table**
Implements "Last-Write-Wins" (LWW) conflict resolution and soft deletes.
```sql
CREATE TABLE items (
  item_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  barcode TEXT,             -- Primary SKU/UPC
  barcode_corrupted INTEGER NOT NULL DEFAULT 0, -- 1 if barcode hard to scan
  category_id INTEGER,
  location_id INTEGER,
  
  -- Metadata
  purchase_date TEXT,       -- ISO 8601 Date
  warranty_info TEXT,
  value REAL,               -- Monetary value
  serial_number TEXT,
  photo_path TEXT,

  -- Sync & Conflict Resolution
  deleted INTEGER NOT NULL DEFAULT 0, -- Soft delete (1=deleted)
  last_modified INTEGER NOT NULL,     -- Unix Timestamp (ms)
  
  FOREIGN KEY(category_id) REFERENCES categories(category_id) ON DELETE SET NULL,
  FOREIGN KEY(location_id) REFERENCES locations(location_id) ON DELETE SET NULL
);
```

**2. Categories & Locations**
Hierarchical location support.
```sql
CREATE TABLE categories (
  category_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE locations (
  location_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER,
  UNIQUE(name, parent_id),
  FOREIGN KEY(parent_id) REFERENCES locations(location_id) ON DELETE SET NULL
);
```

**3. Scan Events (Idempotency)**
Prevents network retries from corrupting inventory counts during rapid scanning.
```sql
CREATE TABLE scan_events (
  event_id TEXT PRIMARY KEY,   -- Client-generated UUID
  barcode TEXT NOT NULL,
  item_id INTEGER,             -- Optional: Link to specific item if resolved
  delta INTEGER NOT NULL,      -- Change amount (e.g., +1, -1)
  status TEXT NOT NULL,        -- 'applied', 'duplicate', 'mismatch', 'ambiguous', 'not_found'
  scanned_at INTEGER,          -- Client timestamp
  applied_at INTEGER NOT NULL,  -- Server timestamp
  FOREIGN KEY(item_id) REFERENCES items(item_id) ON DELETE SET NULL
);
```

**4. Item Barcodes (Auxiliary)**
Support for multiple barcodes pointing to a single item.
```sql
CREATE TABLE item_barcodes (
  barcode TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(item_id) REFERENCES items(item_id) ON DELETE CASCADE
);
```

**5. Sync Log**
```sql
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY,
  sync_time INTEGER NOT NULL,
  source TEXT NOT NULL, -- e.g. 'drive_push', 'drive_pull'
  details TEXT
);
```

> **Note**: WebAuthn credentials and challenge transactions are stored in `server-state.sqlite` (see Section 2B), not in the inventory database.

### B. Server State Database (`server-state.sqlite`)
*   **Purpose**: Stores device pairing, authentication secrets, global settings, WebAuthn credentials, and challenge transactions. Managed by the IdP module.
*   **Path**: `data/server-state.sqlite` (Electron: `userData/`)

#### Schema Definitions

**1. Devices & Pairing**
```sql
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  pubkey TEXT,
  name TEXT,
  role TEXT DEFAULT 'editor',
  revoked INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,
  status TEXT DEFAULT 'created', -- 'created', 'scanned', 'authenticated', 'consumed', 'cancelled'
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
```

**2. Security Meta**
```sql
CREATE TABLE server_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: 'server_secret', 'owner_token'
```

**3. WebAuthn Credentials**
```sql
CREATE TABLE webauthn_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  sign_count INTEGER,
  aaguid TEXT,
  transports TEXT,
  friendly_name TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE challenge_transactions (
  tx_id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  challenge TEXT NOT NULL,
  user_id INTEGER,
  issued_at INTEGER DEFAULT (strftime('%s','now')),
  expires_at INTEGER,
  used_at INTEGER,
  session_binding TEXT
);
```

## 3. Frontend & Desktop Architecture

The Desktop Client is an Electron application that serves as both the UI for the Host and the Manager for the background Node.js server.

### A. Tech Stack
*   **Renderer**: Vanilla JavaScript (ES Modules) bundled with **Vite**. No component framework (React/Vue) is used to maintain simplicity and low overhead.
*   **State Management**: Simple module-level global state (vanilla JS objects/classes).
*   **Key Libraries**:
    *   `@zxing/browser`: Camera-based barcode scanning in the browser.
    *   `@simplewebauthn/browser`: WebAuthn/Passkey registration and authentication.

### B. IPC Bridge (`preload.cjs`)
The `contextBridge` exposes safe methods to the renderer via `window.inventory`:

| Category | Method | Description |
| :--- | :--- | :--- |
| **Server** | `getServerUrl()`, `getLanBaseUrl()` | Get local IP/Port for QR code generation. |
| **Tunnel**| `onTunnelStatusChanged(cb)` | Listen for Ngrok tunnel status updates (Remote Access). |
| **Core** | `listInventories()`, `createInventory()` | Manage SQLite database files. |
| **Security** | `createKeystore()`, `unlockKeystore()` | Manage the PKCS#12 certs and encryption. |

### C. Remote Access (Ngrok)
The application integrates **Ngrok** to optionally expose the local Express server to the internet, allowing Android clients to sync even when not on the same LAN.

## 3.5 Mobile (Capacitor) Architecture

The Capacitor mobile app (`mobile/`) provides an alternative cross-platform client for iOS and Android, built with web technologies.

### A. Tech Stack
*   **Framework**: Capacitor 6 — wraps a Vite-bundled vanilla JS web app in a native WebView container.
*   **Build**: Vite for web asset bundling; Capacitor CLI for syncing assets into native Xcode/Android Studio projects.
*   **State Management**: `localStorage`-based persistence via `storage.js` module.
*   **Key Libraries**:
    *   `@capacitor/network`: Native network status detection (connected/disconnected events).
    *   `@capacitor-mlkit/barcode-scanning`: Native MLKit barcode scanning (camera).
    *   `@zxing/browser`: WebView-based barcode scanning fallback.

### B. Module Architecture

| Module | Purpose |
| :--- | :--- |
| `api.js` | REST client with Bearer auth, reads `baseUrl`/`token` from storage |
| `storage.js` | localStorage persistence: preferences, item/category/location caches, pending queues |
| `sync.js` | Offline sync engine mirroring Android's `syncOnce()` (bootstrap → push creates → push updates → push scans → pull items → refresh lookups) |
| `network.js` | Network monitoring via `@capacitor/network` with browser fallback; periodic 60s sync; auto-sync on reconnect |
| `app.js` | Screen navigation, UI rendering, event wiring, pairing, scanning |

### C. Sync Protocol
The Capacitor mobile app follows the same sync protocol as the native Android app (see Section 4.C). The sync engine (`sync.js`) mirrors `InventoryRepository.syncOnce()`:
1.  Bootstrap via `GET /api/export` (first sync only)
2.  Push pending item creates (`POST /api/items`)
3.  Push pending item updates (`PUT /api/items/:id`, 409 → conflict state)
4.  Push pending scan events (`POST /api/scans/apply`)
5.  Pull incremental items (`GET /api/items?since=X&includeDeleted=1`)
6.  Refresh categories and locations

### D. Offline Storage
Uses `localStorage` instead of Room/SQLite:
*   **Preferences**: `baseUrl`, `token`, `inventoryId`, `locale`, `lastSyncMs`, `itemsSinceMs`, `bootstrapped`
*   **Data caches**: items, categories, locations (JSON arrays)
*   **Pending queues**: `pendingScans`, `pendingCreates`, `pendingUpdates` (flushed during sync)

## 4. Sync & Replication

### A. Google Drive Sync (`inventory-sync.json`)
Allows synchronizing the SQLite database between multiple Desktop instances (e.g., Home PC and Office Laptop).

1.  **Format**: Single JSON file containing the full list of items and categories.
2.  **Logic (Last-Write-Wins)**:
    *   **Pull**: Download JSON -> Upsert local items if `remote.last_modified > local.last_modified`.
    *   **Push**: Export all local items -> Upload JSON to Drive.
    *   **Concurrency**: Uses Drive file `version` to detect write conflicts, prompting a re-pull before push.

### B. Android Offline Sync
The Android client uses `WorkManager` for background synchronization.
*   **Offline Queue**: Scan events are stored locally when offline.
*   **Batch Upload**: usage of `POST /api/scans/apply` to send multiple cached scans at once when connectivity returns.

### C. Android LAN Sync Protocol
The Android client follows a specific cycle to maintain local state:
1.  **Pairing**: Scans QR code with `{ baseUrl, token }`.
2.  **Bootstrap**: Calls `GET /api/export` to download full inventory JSON for initial population.
3.  **Push (Scans)**:
    *   `POST /api/scans/apply` with list of scan events.
    *   Ids are UUIDs generated on the client.
    *   Server ensures idempotency via `scan_events` table.
4.  **Pull (Incremental)**:
    *   `GET /api/items?since=<timestamp>&includeDeleted=1`
    *   `GET /api/item-barcodes?since=<timestamp>`
5.  **Background**: Uses WorkManager to run this cycle periodically (approx. every 15 mins).

When `PUT /items/:id` is called:
1.  **Validation**: Server checks generic types (Zod schema).
2.  **Conflict Check**: compares payload `last_modified` vs DB `last_modified`.
    *   If `payload.time < db.time`: **Reject** (409 Conflict).
    *   If `payload.time >= db.time`: **Apply Update**.
3.  **Result**: The server always converges to the latest timestamp provided by any client.

### B. Scan Idempotency Flow
When `POST /scan` is called by an Android client:
1.  Payload contains `{ event_id, barcode, delta }`.
2.  Server checks `scan_events` for `event_id`.
    *   **Exists**: Return cached success response (No-Op).
    *   **New**: 
        1. Resolve `barcode` to `item_id`.
        2. Update `items` table: `quantity = quantity + delta`.
        3. Insert record into `scan_events`.
3.  This ensures that if the network drops and the client retries, the item is not counted twice.

### C. Device Pairing Flow (Secure Bootstrap)
1.  **Start**: Desktop User requests pairing. Server generates `pairing_code` (TTL: 2 min).
2.  **Display**: Desktop shows QR Code with `{ baseUrl, code, ips }` where `ips` contains LAN IPv4 addresses for custom hostname resolution.
3.  **Scan**: Android Device scans QR.
    *   Android accepts the Self-Signed Certificate because it was physically scanned (Trust On First Use).
4.  **Verify**: Android calls `POST /registration/verify` with `code`.
5.  **Finalize**: Server consumes code, registers `device_id`, and returns a permanent API Token.

## 6. Security Implementation

### A. SSL/TLS (Self-Signed)
Since WebAuthn and Secure Contexts (camera access) require HTTPS:
*   **Module**: `desktop/src/keystore.js`
*   **Generation**: Uses `selfsigned` (NPM) and `node-forge` to generate a generic Root CA and Server Certificate.
*   **Storage**: Saved as a PKCS#12 (`.pfx`) file in `userData/keystore/`.
*   **Usage**: Express server is wrapped in `https.createServer({ pfx }, app)`.

### B. Authentication Strategy
*   **API Access**: Bearer Token authentication.
    *   Header: `Authorization: Bearer <api_token>`
*   **Passkeys (WebAuthn)**:
    *   Used for administrative actions or initial pairing validation.
    *   Libraries: `@simplewebauthn/server` (Backend), standard `navigator.credentials` (Frontend).

## 7. API Surface Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/api/ping` | Health check (unauthenticated). |
| **GET** | `/api/meta` | Server metadata (auth required). |
| **GET** | `/api/admin/token` | Get owner token (localhost only). |
| **GET** | `/api/admin/pair-code` | Generate pairing code (localhost only). |
| **GET** | `/api/admin/pair-code/:code/status` | Poll pairing code status (localhost only). |
| **POST** | `/api/pair/exchange` | Exchange pairing code for device token. |
| **GET** | `/api/items` | List items (supports `since` cursor for sync). |
| **GET** | `/api/items/:id` | Get single item. |
| **POST** | `/api/items` | Create item. |
| **PUT** | `/api/items/:id` | Update item (LWW protected). |
| **DELETE** | `/api/items/:id` | Soft-delete item. |
| **GET** | `/api/categories` | List all categories. |
| **POST/PUT** | `/api/categories` | Create or Update category. |
| **DELETE** | `/api/categories/:id` | Delete category. |
| **GET** | `/api/locations` | List all locations. |
| **POST/PUT** | `/api/locations` | Create or Update location. |
| **DELETE** | `/api/locations/:id` | Delete location. |
| **POST** | `/api/scan` | Apply scan event (idempotent). |
| **POST** | `/api/scans/apply` | **(Batch)** Apply multiple offline scan events. |
| **GET** | `/api/items/:id/barcodes` | List alternate barcodes for item. |
| **POST** | `/api/items/:id/barcodes` | Add alternate barcode to item. |
| **POST** | `/api/sync` | Composite sync (push items + pull changes). |
| **GET** | `/api/export` | Dump full inventory as JSON. |
| **POST** | `/api/import` | Import inventory from JSON. |
| **GET** | `/api/sync-log` | View sync history. |
| **GET** | `/api/item-barcodes` | Incremental barcode sync (supports `since`). |
| **GET** | `/api/inventories` | List available inventories (multi-inventory). |
| **GET** | `/api/devices` | Admin: List paired devices. |
| **POST** | `/api/devices/:id/revoke` | Admin: Revoke device access. |
| **POST** | `/auth/webauthn/registration/options` | Begin WebAuthn registration. |
| **POST** | `/auth/webauthn/registration/verify` | Complete WebAuthn registration. |
| **POST** | `/auth/webauthn/registration/cancel` | Cancel WebAuthn registration. |
| **POST** | `/auth/webauthn/authentication/options` | Begin WebAuthn authentication. |
| **POST** | `/auth/webauthn/authentication/verify` | Complete WebAuthn authentication. |
