# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.5-claude] - 2026-02-15
### Fixed
- **Certificate setup validation**: Fixed "Cert file not found" error during DuckDNS automatic certificate generation.
  - Enhanced PowerShell script to detect alternate domain naming (handles both `example.duckdns.org` and `example` directory formats)
  - Added Windows symlink resolution for certificate file validation (Certbot creates symlinks in `live/` pointing to `archive/`)
  - Improved error messages with diagnostic details and troubleshooting hints
  - Added file size validation to detect empty or corrupted certificates
  - Enhanced user feedback in setup wizard with clear success/failure indicators

### Changed
- **Server architecture**: Split monolithic server into IdP (Identity Provider) and Inventory modules with backward-compatible re-export shims.
- **Default port**: Changed from 5199 to 443 (HTTPS standard).
- **Database ownership**: WebAuthn credentials and challenge transactions moved from `inventory.sqlite` to `server-state.sqlite` (managed by IdP module).
- **Pairing QR payload**: Now includes LAN IP addresses (`ips` field) for custom hostname resolution on Android.
- **Certbot script**: Added `--expand` flag and improved subdomain array parsing for DuckDNS multi-domain certificates.

### Added
- **Split-domain mode**: New `IDP_HOSTNAME` / `APP_HOSTNAME` env vars enable deploying IdP and Inventory on separate hostnames.
- **Multi-inventory support**: Registry-based system (`inventories.json`) allowing multiple inventory databases per server instance.
- **`X-Inventory-Id` header**: API requests can target a specific inventory by ID.
- **`GET /api/inventories` endpoint**: Lists available inventories.
- **Environment variables**: `INVENTORY_SERVER_STATE_DIR`, `INVENTORY_REGISTRY_PATH`, `WEBAUTHN_RP_ID`, `IDP_HOSTNAME`, `APP_HOSTNAME`.
- **Android LAN IP fallback**: `ApiClient` uses LAN IPs from QR payload when custom hostnames resolve to unreachable public IPs.

## [0.1.3] - 2026-02-06
### Added
- Initial prototype release.
- Desktop application (Electron).
- Local server (Node.js + Express).
- Android application (Kotlin).
