param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [int]$VersionCode = [int](Get-Date -Format 'yyyyMMdd'),

  [switch]$SkipTests,
  [switch]$SkipDesktop,
  [switch]$SkipAndroid,

  [string]$AndroidJdkPath = "C:\Program Files\Android\Android Studio\jbr",

  [switch]$CreateGitTag,
  [switch]$PushGitTag
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) {
  Write-Host "\n=== $Text ===" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Assert-SemVer([string]$v) {
  $value = $v
  if ($null -eq $value) { $value = '' }
  $trimmed = $value.Trim()
  if ($trimmed.StartsWith('v')) {
    throw "Version must not include the 'v' prefix. Use -Version 0.1.1 (not v0.1.1)."
  }
  # Accept: 1.2.3 or 1.2.3-rc.1 (no build metadata needed here)
  if ($trimmed -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    throw "Invalid version format: '$v'. Expected SemVer like 0.1.1 or 0.1.1-rc.1"
  }
}

function Ensure-RepoClean([string]$Path) {
  Push-Location $Path
  try {
    $dirty = git status --porcelain
    if ($dirty) {
      throw "Working tree is not clean. Commit/stash changes before creating/pushing a release tag.\n\n$dirty"
    }
  } finally {
    Pop-Location
  }
}

function Test-SymlinkPrivilege() {
  $tmp = Join-Path $env:TEMP ("inv-symlink-test-" + [Guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $target = Join-Path $tmp 'target.txt'
    $link = Join-Path $tmp 'link.txt'
    Set-Content -Path $target -Value 'ok' -Encoding ascii
    try {
      New-Item -ItemType SymbolicLink -Path $link -Target $target | Out-Null
      return $true
    } catch {
      # New-Item often fails without Admin even in Developer Mode.
      # Fallback to mklink, which works in Developer Mode.
      cmd /c mklink "$link" "$target" | Out-Null
      if (Test-Path $link) {
        return $true
      }
      return $false
    }
  } finally {
    Remove-Item -Force -Recurse -ErrorAction SilentlyContinue $tmp
  }
}

function Ensure-7ZipBinary([string]$InventoryAppRoot) {
  $p = Join-Path $InventoryAppRoot 'node_modules\7zip-bin\win\x64\7za.exe'
  if (Test-Path $p) {
    return
  }

  Write-Host "7za.exe missing at $p." -ForegroundColor Yellow
  Write-Host "This is usually caused by Windows Defender quarantining 7zip-bin during install." -ForegroundColor Yellow
  Write-Host "Attempting to reinstall 7zip-bin..." -ForegroundColor Yellow

  Push-Location $InventoryAppRoot
  try {
    npm i --no-save 7zip-bin@5.2.0
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $p)) {
    throw "7za.exe still missing at $p. Try reinstalling dependencies (npm ci) and/or add a Defender exclusion for the repo folder."
  }
}

$inventoryAppRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$repoRoot = Resolve-Path (Join-Path $inventoryAppRoot '..')

Write-Step "Preflight"
Require-Command npm
Assert-SemVer $Version

if ($PushGitTag -and -not $CreateGitTag) {
  throw "-PushGitTag requires -CreateGitTag (or push the existing tag manually)."
}

if (-not $SkipAndroid) {
  if (-not (Test-Path $AndroidJdkPath)) {
    throw "Android JDK path not found: $AndroidJdkPath`nInstall Android Studio (includes a JDK), or pass -AndroidJdkPath."
  }
}

if (-not $SkipDesktop) {
  Ensure-7ZipBinary $inventoryAppRoot
}

if ($CreateGitTag -or $PushGitTag) {
  Require-Command git
  Ensure-RepoClean $repoRoot
}

if (-not $SkipTests) {
  Write-Step "Validate: npm test"
  Push-Location $inventoryAppRoot
  try {
    npm test
  } finally {
    Pop-Location
  }
}

if (-not $SkipDesktop) {
  Write-Step "Build: Windows desktop installer"

  # electron-builder extraction of winCodeSign uses symlinks; require Developer Mode or admin.
  if (-not (Test-SymlinkPrivilege)) {
    throw "Windows symlink privilege is not available.\n\nFix: enable Developer Mode (Windows Settings -> For developers) or run this shell elevated (Run as Administrator).\nOr re-run with -SkipDesktop to only produce the Android APK."
  }

  Push-Location $inventoryAppRoot
  try {
    $env:RELEASE_VERSION = $Version
    npm -w desktop run dist:win
  } finally {
    Pop-Location
  }
}

if (-not $SkipAndroid) {
  Write-Step "Build: Android release APK"
  Push-Location (Join-Path $inventoryAppRoot 'android')
  try {
    $env:JAVA_HOME = $AndroidJdkPath
    $env:Path = "$AndroidJdkPath\bin;$env:Path"

    $env:VERSION_NAME = $Version
    $env:VERSION_CODE = "$VersionCode"

    if (-not $SkipTests) {
      Write-Step "Validate: Android unit tests"
      .\gradlew.bat :app:testDebugUnitTest
    }

    .\gradlew.bat :app:copyReleaseApk
  } finally {
    Pop-Location
  }
}

Write-Step "Artifacts"
$apk = Join-Path $inventoryAppRoot 'android\app\artifacts\app-release.apk'
if (Test-Path $apk) {
  Write-Host "Android APK: $apk"
}

$desktopOut = Join-Path $inventoryAppRoot 'desktop\dist-electron'
if (Test-Path $desktopOut) {
  # Prefer actual installer outputs, not the unpacked app contents.
  $installers = @()
  $installers += Get-ChildItem -Path $desktopOut -File -Include *.exe,*.msi -ErrorAction SilentlyContinue
  if (-not $installers) {
    $installers += Get-ChildItem -Path $desktopOut -Recurse -File -Include *.exe,*.msi -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\win-unpacked\\' }
  }

  if ($installers) {
    $installers | ForEach-Object { Write-Host "Desktop installer: $($_.FullName)" }
  } else {
    Write-Host "Desktop output folder: $desktopOut"
  }
}

if ($CreateGitTag -or $PushGitTag) {
  Write-Step "Git tag"
  Push-Location $repoRoot
  try {
    $tag = "v$Version"
    if ($CreateGitTag) {
      $existing = git tag --list $tag
      if ($existing) {
        throw "Tag already exists: $tag"
      }
      git tag $tag
    }
    if ($PushGitTag) {
      git push origin $tag
    }
  } finally {
    Pop-Location
  }
}

Write-Step "Done"
