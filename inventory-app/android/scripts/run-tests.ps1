param(
  # Optional ADB device serial (from `adb devices`)
  [string]$Device = "",

  # Optional path to adb.exe (if ADB is not on PATH)
  [string]$AdbPath = "",

  # Optional: set JAVA_HOME to Android Studio's embedded JBR (Windows default path)
  [string]$JavaHome = "",

  # Run instrumentation tests (requires emulator/physical device)
  [switch]$Connected,

  # Optional VERSION_CODE override (must fit in Int32). If omitted, uses yyyyMMdd99.
  [int]$VersionCode = 0
)

# Keep cmdlets predictable but don't treat native stderr (e.g. `java -version`) as terminating.
$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$androidRoot = Split-Path -Parent $scriptDir

Write-Host "Android root: $androidRoot"

function Resolve-AdbPath {
  param([string]$Explicit)

  if ($Explicit) {
    if (Test-Path $Explicit) { return (Resolve-Path $Explicit).Path }
    throw "AdbPath not found: $Explicit"
  }

  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path) { return $cmd.Path }

  $candidates = @()
  if ($env:ANDROID_HOME) { $candidates += Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }
  if ($env:ANDROID_SDK_ROOT) { $candidates += Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe' }
  if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
  if ($env:ANDROID_SDK_HOME) { $candidates += Join-Path $env:ANDROID_SDK_HOME 'platform-tools\adb.exe' }

  foreach ($p in $candidates) {
    if (Test-Path $p) { return (Resolve-Path $p).Path }
  }

  return $null
}

function Get-JavaMajorVersion {
  param([string]$JavaExe)

  if (-not (Test-Path $JavaExe)) { return $null }

  $prevEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $out = & $JavaExe -version 2>&1 | Out-String
    # Typical: 'java version "17.0.10"' or 'openjdk version "17.0.10"'
    if ($out -match 'version\s+"(\d+)(?:\.(\d+))?') {
      $major = [int]$Matches[1]
      # Handle legacy format 1.8
      if ($major -eq 1 -and $Matches[2]) { return [int]$Matches[2] }
      return $major
    }
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $prevEap
  }

  return $null
}

function Resolve-JavaHome {
  param([string]$Explicit)

  $candidates = @()

  if ($Explicit) {
    $candidates += $Explicit.TrimEnd('\\')
  }

  if ($env:JAVA_HOME) {
    $candidates += $env:JAVA_HOME.TrimEnd('\\')
  }

  # Android Studio embedded JBR (64-bit). Prefer this on Windows.
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
  }
  $candidates += 'C:\Program Files\Android\Android Studio\jbr'

  foreach ($candidateHome in $candidates) {
    if (-not $candidateHome) { continue }
    $javaExe = Join-Path $candidateHome 'bin\java.exe'
    $major = Get-JavaMajorVersion -JavaExe $javaExe
    if ($major -ge 17) {
      return $candidateHome
    }
  }

  return $null
}

$resolvedJavaHome = Resolve-JavaHome -Explicit $JavaHome
if (-not $resolvedJavaHome) {
  throw "JDK 17+ is required (AGP 8.2.2). Set JAVA_HOME to a JDK 17+ (recommended: Android Studio JBR at 'C:\\Program Files\\Android\\Android Studio\\jbr') or pass -JavaHome." 
}

$env:JAVA_HOME = $resolvedJavaHome
Write-Host "JAVA_HOME: $env:JAVA_HOME"
$javaExe = Join-Path $env:JAVA_HOME 'bin\java.exe'
$prevEap = $ErrorActionPreference
try {
  $ErrorActionPreference = 'SilentlyContinue'
  $javaOut = & $javaExe -version 2>&1 | Out-String
  Write-Host $javaOut.TrimEnd()
} finally {
  $ErrorActionPreference = $prevEap
}

# Avoid INSTALL_FAILED_VERSION_DOWNGRADE when a newer build is already installed on the device.
# This project reads VERSION_CODE from the environment.
if (-not $env:VERSION_CODE) {
  if ($VersionCode -gt 0) {
    $env:VERSION_CODE = "$VersionCode"
  } else {
    $base = [int](Get-Date -Format 'yyyyMMdd')
    $env:VERSION_CODE = "${base}99"
  }
}
Write-Host "VERSION_CODE: $env:VERSION_CODE"

# Ensure Gradle wrapper jars exist (common when the repo is freshly cloned)
$wrapperJar = Join-Path $androidRoot 'gradle\wrapper\gradle-wrapper.jar'
if (-not (Test-Path $wrapperJar)) {
  Write-Host "Gradle wrapper jar missing; bootstrapping..."
  & powershell -ExecutionPolicy Bypass -File (Join-Path $androidRoot 'bootstrap-wrapper.ps1')
}

if ($Device) {
  $env:ANDROID_SERIAL = $Device
  Write-Host "ANDROID_SERIAL set to: $env:ANDROID_SERIAL"
}

Push-Location $androidRoot
try {
  Write-Host "Running unit tests…"
  & .\gradlew.bat testDebugUnitTest
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  if ($Connected) {
    $adbExe = Resolve-AdbPath -Explicit $AdbPath
    if (-not $adbExe) {
      throw "adb not found. Install Android SDK Platform-Tools and ensure adb is on PATH, or pass -AdbPath." 
    }
    Write-Host "adb: $adbExe"
    & $adbExe devices

    Write-Host "Running connected instrumentation tests…"
    & .\gradlew.bat connectedDebugAndroidTest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  Write-Host "Done."
} finally {
  Pop-Location
}
