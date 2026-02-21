# Releasing (All Platforms)

This repo ships downloadable builds via GitHub Releases.

## What gets published

- **Windows desktop**: NSIS installer (`.exe`) from Electron (`inventory-app/desktop`)
- **macOS desktop**: DMG + zip from Electron (`inventory-app/desktop`)
- **Linux desktop**: AppImage + deb from Electron (`inventory-app/desktop`)
- **Android (native)**: release APK (`app-release.apk`) from `inventory-app/android`
- **iOS (Capacitor)**: unsigned IPA from `inventory-app/mobile`

## Local procedure (manual)

### 1) Validate

From `inventory-app/`:

- `npm test`

### 1.5) Repo hygiene (important)

Before tagging a release, verify build outputs and local databases are **not tracked by git**:

- `git status` should be clean
- Artifacts like `desktop/dist-electron/**`, `android/app/artifacts/**`, `mobile/dist/**`, and `server/data/*.sqlite*` must not be committed

If something is accidentally tracked already, removing it from `.gitignore` is **not enough** — untrack it with:

- `git rm -r --cached <path>`

### 2) Build desktop installer

From `inventory-app/`:

- Set env `RELEASE_VERSION` (example `0.1.1`)
- Run `npm -w desktop run dist` (auto-detects current platform)
- Or target a specific platform:
  - `npm -w desktop run dist:win` (Windows NSIS)
  - `npm -w desktop run dist:mac` (macOS DMG + zip)
  - `npm -w desktop run dist:linux` (Linux AppImage + deb)

Prereqs (Windows only):
- **Symlink privilege** for `electron-builder`: enable **Developer Mode** (Windows Settings → For developers), or run as Administrator.

Outputs go under:
- `inventory-app/desktop/dist-electron/`

### 3) Build Android release APK

Prereqs:
- Gradle/AGP requires a modern JDK. If your system `java` is 1.8, point `JAVA_HOME` to Android Studio's JDK.

From `inventory-app/android/`:

- Set `JAVA_HOME` to Android Studio's JBR (e.g., `C:\Program Files\Android\Android Studio\jbr` on Windows)
- Set `VERSION_NAME` (example `0.1.1`)
- Set `VERSION_CODE` (example `20260105`)
- Run `./gradlew :app:copyReleaseApk` (Linux/macOS) or `./gradlew.bat :app:copyReleaseApk` (Windows)

Output is copied to:
- `inventory-app/android/app/artifacts/app-release.apk`

### 4) Build Capacitor mobile (iOS)

From `inventory-app/`:

- `npm run build -w mobile`
- `cd mobile && npm run cap:sync:ios`

Then open Xcode:
- `cd mobile && npx cap open ios`
- Archive and export via Xcode (Product → Archive)

## Local procedure (automated)

Use the Node.js release script from `inventory-app/`:

```sh
node scripts/release.mjs 0.1.5
```

By default this runs:

- `npm test` (server + desktop)
- Android unit tests (`:app:testDebugUnitTest`) if Android is enabled
- Desktop installer build for the current platform
- Android release APK build

Optional flags:
- `--skip-desktop` / `--skip-android` / `--skip-tests`
- `--jdk-path "C:\Program Files\Android\Android Studio\jbr"`
- `--version-code 20260105`
- `--create-tag` and `--push-tag` to create/push `vX.Y.Z`

Notes:

- Version must be plain SemVer like `0.1.1` (no leading `v`).
- Tagging requires a clean git working tree.

## CI/CD procedure (recommended)

### Validation

- PRs and pushes to `main` run validations in [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- Node tests run on Windows, macOS, and Linux (matrix)
- Android unit tests run on Linux

### Release

- Create and push a tag like `v0.1.1`
- GitHub Actions will:
  1) re-run validations (3-OS matrix + Android)
  2) build desktop installers for Windows, macOS, and Linux
  3) build native Android release APK
  4) build Capacitor iOS unsigned IPA
  5) publish a GitHub Release with all artifacts attached

Release workflow: [.github/workflows/release.yml](../.github/workflows/release.yml)

## Android signing (optional but recommended)

If you set these GitHub secrets, the release APK will be signed:
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

If not set, the workflow still builds an **unsigned** release APK.

## iOS signing

The CI workflow currently produces an **unsigned** IPA. For App Store or TestFlight distribution:

1. Set up an Apple Developer account
2. Configure code signing certificates and provisioning profiles
3. Update the `build_mobile_ios` job in `release.yml` with your signing identity

For ad-hoc distribution (sideloading), the unsigned IPA can be re-signed with tools like `ios-deploy` or Apple Configurator.
