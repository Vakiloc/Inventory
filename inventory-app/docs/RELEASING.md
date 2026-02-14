# Releasing (Windows + Android APK)

This repo ships downloadable builds via GitHub Releases.

## What gets published

- **Windows desktop**: installer from Electron (`inventory-app/desktop`)
- **Android**: **release APK** (`app-release.apk`) from `inventory-app/android`

## Local procedure (manual)

### 1) Validate

From `inventory-app/`:

- `npm test`

### 1.5) Repo hygiene (important)

Before tagging a release, verify build outputs and local databases are **not tracked by git**:

- `git status` should be clean
- Artifacts like `desktop/dist-electron/**`, `android/app/artifacts/**`, and `server/data/*.sqlite*` must not be committed

If something is accidentally tracked already, removing it from `.gitignore` is **not enough** — untrack it with:

- `git rm -r --cached <path>`

### 2) Build Windows desktop installer

Prereqs:
- Windows needs **symlink privilege** for `electron-builder` to unpack its tooling.
  - Enable **Developer Mode** (Windows Settings → For developers), or
  - run PowerShell **as Administrator**.

From `inventory-app/`:

- Set env `RELEASE_VERSION` (example `0.1.1`)
- Run `npm -w desktop run dist:win`

Outputs go under:
- `inventory-app/desktop/dist-electron/`

### 3) Build Android release APK

Prereqs:
- Gradle/AGP requires a modern JDK. If your system `java` is 1.8, point `JAVA_HOME` to Android Studio’s JDK.

From `inventory-app/android/`:

- Set `JAVA_HOME` to `C:\Program Files\Android\Android Studio\jbr`
- Set `VERSION_NAME` (example `0.1.1`)
- Set `VERSION_CODE` (example `20260105`)
- Run `./gradlew.bat :app:copyReleaseApk`

Output is copied to:
- `inventory-app/android/app/artifacts/app-release.apk`

## Local procedure (automated)

Use the PowerShell helper:

- `inventory-app/scripts/release.ps1 -Version 0.1.1`

Or via npm from `inventory-app/`:

- `npm run release -- -Version 0.1.1`

By default this runs:

- `npm test` (server + desktop)
- Android unit tests (`:app:testDebugUnitTest`) if Android is enabled
- Desktop Windows installer build (unless `-SkipDesktop`)
- Android release APK build (unless `-SkipAndroid`)

Optional flags:
- `-SkipDesktop` / `-SkipAndroid` / `-SkipTests`
- `-AndroidJdkPath "C:\\Program Files\\Android\\Android Studio\\jbr"`
- `-VersionCode 20260105`
- `-CreateGitTag` and `-PushGitTag` to create/push `vX.Y.Z`

Notes:

- `-Version` must be plain SemVer like `0.1.1` (no leading `v`).
- Tagging requires a clean git working tree.

## CI/CD procedure (recommended)

### Validation

- PRs and pushes to `main` run validations in [.github/workflows/ci.yml](../.github/workflows/ci.yml)

### Release

- Create and push a tag like `v0.1.1`
- GitHub Actions will:
  1) re-run validations
  2) build Windows desktop installer
  3) build Android release APK
  4) publish a GitHub Release with both attached

Release workflow: [.github/workflows/release.yml](../.github/workflows/release.yml)

## Android signing (optional but recommended)

If you set these GitHub secrets, the release APK will be signed:
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

If not set, the workflow still builds an **unsigned** release APK.
