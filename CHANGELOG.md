# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

**Server**
- **Unified batch scan endpoint**: `POST /api/scans` accepts 1–500 scan events per request, replacing the old single-scan and apply endpoints.
- **Barcode detach endpoint**: `DELETE /api/items/:id/barcodes/:barcode` removes a barcode from an item.
- **Cascade delete safety**: Deleting a category or location now nullifies the foreign key on associated items instead of orphaning them.
- **Referential integrity on import**: `importSnapshotLww` validates that imported `category_id`/`location_id` values reference existing records; invalid references are nullified before upsert.
- **Input validation hardening**: Added `max()` length constraints to all Zod schemas (item name 500, description 5000, barcode 128, etc.) and range constraints (quantity ≤ 999999, value ≥ 0, deleted 0|1).
- **Duplicate name prevention**: Creating a category or location with an existing name now returns 409 Conflict.
- **Split-domain mode**: New `IDP_HOSTNAME` / `APP_HOSTNAME` env vars enable deploying IdP and Inventory on separate hostnames.
- **Multi-inventory support**: Registry-based system (`inventories.json`) allowing multiple inventory databases per server instance.
- **`X-Inventory-Id` header**: API requests can target a specific inventory by ID.
- **`GET /api/inventories` endpoint**: Lists available inventories.
- **Environment variables**: `INVENTORY_SERVER_STATE_DIR`, `INVENTORY_REGISTRY_PATH`, `WEBAUTHN_RP_ID`, `IDP_HOSTNAME`, `APP_HOSTNAME`.

**Desktop**
- **Offline-first sync queue**: New `syncQueue.js` module queues item creates/updates/deletes and scan events while offline, with exponential-backoff retry and localStorage persistence.
- **DuckDNS auto-update**: Server startup automatically updates DuckDNS A records with the current LAN IP when a `.duckdns.org` hostname is configured.
- **Existing certificate detection**: Setup wizard and certbot script now search app-local and legacy certbot directories for valid Let's Encrypt certs before invoking Certbot, allowing reuse.
- **Connectivity checking**: Periodic 15-second ping to `/api/ping` detects when the server comes back online and flushes queued operations.
- **Conflict resolution dialog**: Side-by-side comparison when an item update returns 409 Conflict; user can keep local version or accept the server version.
- **Sidebar collapse/expand**: Collapsible sidebar with `Mod+B` keyboard shortcut and localStorage persistence.
- **Dual filter bars**: Category/location filter dropdowns in the main content area, synchronized with the sidebar filters.
- **Barcode delete UI**: Each alternative barcode now has a remove button (editor role) calling the new detach endpoint.
- **Accessibility overhaul**: Skip-to-content link, semantic HTML5 landmarks (`<header>`, `<main>`, `<aside>`), ARIA labels on search, filters, table columns, and action buttons.
- **Design system refresh**: CSS custom properties for surfaces, text, semantic colors, interactive states, and transitions; primary color shifted from blue to teal (#3D9B8F).
- **i18n**: New translation keys for barcode operations, conflict resolution, validation messages, empty states, and accessibility labels (en + es).

**Android**
- **Bottom tab navigation**: Items / Scan / Settings tabs replace the single-screen layout.
- **Dedicated Scan screen**: `ScanScreen.kt` composable (previously inlined in HomeScreen).
- **Settings screen**: `SettingsScreen.kt` with language selector, connection status, pairing toggle, and inventory switching.
- **Item create/edit form**: Modal dialog with all item fields (name, description, quantity, value, category, location, barcode, serial, purchase date, warranty).
- **Item delete with sync**: Soft-delete locally and queue server delete; falls back to offline queue if unreachable.
- **Sync conflict resolution**: Banner showing conflict count, dialog to compare versions, keep-mine or keep-server choices.
- **Accessibility**: TalkBack semantic descriptions for item cards, quantity buttons (48dp min touch target), scanner state, and sync status; `liveRegion` announcements for status changes.
- **Theme overhaul**: Warmer palette — primary shifted from blue (#2563EB) to teal (#3D9B8F), softer danger/success colors, cream-tinted text.
- **LAN IP fallback**: `ApiClient` uses LAN IPs from QR payload when custom hostnames resolve to unreachable public IPs.
- **i18n**: New keys for delete confirmation, empty states, accessibility descriptions, and conflict resolution (en + es).

**Infrastructure**
- **CI**: Added `npm audit --audit-level=high` step to fail builds on high-severity vulnerabilities.

### Changed

**Server**
- **Server architecture**: Split monolithic server into IdP (Identity Provider) and Inventory modules with backward-compatible re-export shims.
- **Default port**: Changed from 5199 to 443 (HTTPS standard).
- **Database ownership**: WebAuthn credentials and challenge transactions moved from `inventory.sqlite` to `server-state.sqlite` (managed by IdP module).
- **Pairing QR payload**: Now includes LAN IP addresses (`ips` field) for custom hostname resolution on Android.
- **409 Conflict response**: Now includes `clientTimestamp` alongside `serverItem` for better client-side debugging.

**Desktop**
- **Certbot script**: Rewritten with app-local certbot directories, DuckDNS A-record registration, existing-cert reuse, and Let's Encrypt rate-limit detection with contextual error messages.
- **mDNS service**: Bonjour now advertises `_https._tcp` (was `_http._tcp`) and uses the DuckDNS FQDN when configured.
- **Scan API calls**: All scan operations migrated to the new unified `/api/scans` batch endpoint.

**Android**
- **mDNS discovery**: Service type changed from `_http._tcp.` to `_https._tcp.` to match the HTTPS-only server.
- **DAO retry backoff**: `listPending()` skips entries that errored within the last 30 seconds to avoid hammering the server.

**Dependencies**
- Upgraded `supertest` 6 → 7, `tar` 6 → 7, `qs` 6.14 → 6.15.
- Removed `@simplewebauthn/types` (types consolidated into `@simplewebauthn/server`).

### Fixed
- **Desktop**: Server restart when creating a new inventory no longer fails with `start_failed`. The restart path now uses `configureServerEnv()` (consistent with the initial start), preventing accidental Split Domain Mode activation from stale `IDP_HOSTNAME`/`APP_HOSTNAME` env vars.
- **Desktop**: Health check (`isServerReachable`) now uses `https.request` with `rejectUnauthorized: false` so it can reach the local server through self-signed TLS certificates.

### Removed
- **Server**: `POST /api/scan` single-scan endpoint (replaced by `POST /api/scans` batch endpoint).
- **Server**: `POST /api/scans/apply` separate events endpoint (consolidated into `POST /api/scans`).
- **Server**: `POST /api/items/sync` bulk item upsert endpoint.
- **Server**: `override` parameter on scan events (force barcode reassignment removed).
- **Server**: `forceAttachBarcodeToItem()` function and associated logic.

## [0.1.3] - 2026-02-06
### Added
- Initial prototype release.
- Desktop application (Electron).
- Local server (Node.js + Express).
- Android application (Kotlin).
