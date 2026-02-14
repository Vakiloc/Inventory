# Project Maintenance

## Cleaning the Project

To reduce the project size (e.g. for sharing, backup, or a fresh install), you can run the cleanup script. This removes:
- `node_modules/` folders (Server, Desktop, Root)
- Build artifacts (`dist/`, `build/`, `dist-electron/`)
- Android build cache (`.gradle/`, `app/build/`)
- Temporary database files (`.sqlite-shm`, `.sqlite-wal`)
- Log files

**Warning:** After running this, you must run `npm install` again to restore dependencies before developing.

### Usage (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\clean.ps1
```

## Re-initializing

After cleaning, to get back to a working state:

1. **Install dependencies:**
   ```bash
   npm install
   cd server; npm install
   cd ../desktop; npm install
   ```
   *(Or just `npm install` in root if workspaces are configured, but explicit is safer)*

2. **Run dev servers:**
   ```bash
   npm run dev -w server
   npm run dev -w desktop
   ```
