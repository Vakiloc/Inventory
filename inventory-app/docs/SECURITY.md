# Security model (current MVP)

## LAN auth

- A random bearer token is stored in SQLite (`meta.api_token`).
- LAN endpoints require `Authorization: Bearer <token>`.
- Exception: `GET /api/ping` is unauthenticated (health check).
- Token disclosure endpoint `/api/admin/token` is restricted to loopback (desktop UI reads locally).

## Transport

- LAN uses HTTP (recommended: trusted Wi‑Fi).
- Server binds `0.0.0.0` by default so other LAN devices can reach it.
- Cloud sync uses Google APIs over HTTPS.

## At-rest

- SQLite is currently unencrypted.
- Optional future enhancement: SQLCipher on all platforms.
