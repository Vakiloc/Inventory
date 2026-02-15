# Security Model

## Transport

- Default port is **443** (HTTPS). The server uses TLS by default.
- **Self-signed certificates**: A local Root CA (`desktop/src/keystore.js`) generates server certificates using `sslip.io` domains for valid HTTPS origins on LAN.
- **Custom certificates**: Users can provide their own certificates (e.g., Let's Encrypt via DuckDNS) in `config.json`.
- Server binds `0.0.0.0` by default so other LAN devices can reach it.
- Cloud sync (Google Drive) uses Google APIs over HTTPS.

## Authentication

- A random owner token is generated on first run and stored in `server-state.sqlite` (`server_meta` table).
- API endpoints require `Authorization: Bearer <token>`.
- **Device tokens**: Format `d1.<device_id>.<HMAC>` where HMAC is computed with the server secret.
- Roles: `owner` (full access), `editor` (CRUD), `viewer` (read-only).
- Exception: `GET /api/ping` is unauthenticated (health check).
- `/api/admin/token` is restricted to loopback (localhost only).

## WebAuthn / Passkeys

- Used for device registration (pairing) and admin authentication.
- Libraries: `@simplewebauthn/server` (backend), `navigator.credentials` (frontend), Android Credentials API.
- Credentials stored in `server-state.sqlite` (managed by the IdP module).
- Registration endpoints restricted to local network IPs.
- `WEBAUTHN_RP_ID` env var controls the Relying Party ID (defaults to `req.hostname`).

## Device Pairing

- Desktop generates a short-lived pairing code (2-min TTL).
- QR code payload contains `{ baseUrl, code, ips }` where `ips` are LAN IPv4 addresses.
- Android scans QR and exchanges the pairing code for a permanent device token.
- Trust-On-First-Use (TOFU) for the self-signed certificate.

## At-rest

- SQLite databases are currently unencrypted.
