# Google Drive sync (scaffold)

Implemented as a file-based JSON snapshot sync in `server/src/drive/`.

## Why JSON snapshot

- Avoids raw SQLite file locking/corruption issues on Drive.
- Enables LWW record-level merges.

## Setup

- Provide OAuth `credentials.json` (Installed App)
  - Place at `server/src/drive/credentials.json`
  - or set `GOOGLE_OAUTH_CREDENTIALS_PATH`

## Commands

- Push: `npm run drive:push -w server`
- Pull: `npm run drive:pull -w server`

Token caching:
- Stored at `server/data/google-drive-token.json`
- File id cached at `server/data/google-drive-file.json`
