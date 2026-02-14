This folder is a scaffold for Google Drive backup/sync.

The server currently implements LAN sync via `/api/sync`.

To implement Drive sync safely you will typically:
- OAuth2 installed-app flow (PKCE) to get user tokens
- Upload/download a sync artifact (recommended: JSON export rather than raw SQLite)
- Use Drive file revision/ETag to detect concurrent updates

A minimal Node implementation will be added in a later step (requires Google OAuth client id).
