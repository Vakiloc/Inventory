param(
  # Optional ADB device serial (from `adb devices`)
  [string]$Device = "",

  # Optional path to adb.exe (if ADB is not on PATH)
  [string]$AdbPath = "",

  # Optional: set JAVA_HOME to Android Studio's embedded JBR (Windows default path)
  [string]$JavaHome = "",

  # Optional: pass -Clean to run `:app:clean` before installing
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'

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

  # Common env vars
  if ($env:ANDROID_HOME) {
    $candidates += Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
  }
  if ($env:ANDROID_SDK_ROOT) {
    $candidates += Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe'
  }

  # Default Android Studio SDK path on Windows
  if ($env:LOCALAPPDATA) {
    $candidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
  }

  # Some setups use ANDROID_SDK_HOME
  if ($env:ANDROID_SDK_HOME) {
    $candidates += Join-Path $env:ANDROID_SDK_HOME 'platform-tools\adb.exe'
  }

  foreach ($p in $candidates) {
    if (Test-Path $p) { return (Resolve-Path $p).Path }
  }

  return $null
}

$adbExe = Resolve-AdbPath -Explicit $AdbPath
if (-not $adbExe) {
  throw "adb not found. Install Android SDK Platform-Tools (Android Studio: Tools > SDK Manager > SDK Tools > 'Android SDK Platform-Tools'), then either add '<SDK>\\platform-tools' to PATH or re-run with -AdbPath '<SDK>\\platform-tools\\adb.exe'. Common path: $env:LOCALAPPDATA\\Android\\Sdk\\platform-tools\\adb.exe"
}

Write-Host "adb: $adbExe"

function Resolve-JavaHome {
  param([string]$Explicit)

  function Get-JavaMajorVersion {
    param([string]$JavaExe)
    if (-not (Test-Path $JavaExe)) { return $null }
    try {
      $out = & $JavaExe -version 2>&1 | Out-String
      if ($out -match 'version\s+"(\d+)(?:\.(\d+))?') {
        $major = [int]$Matches[1]
        if ($major -eq 1 -and $Matches[2]) { return [int]$Matches[2] }
        return $major
      }
    } catch {
      return $null
    }
    return $null
  }

  if ($Explicit) {
    $candidate = $Explicit.TrimEnd('\\')
    $javaExe = Join-Path $candidate 'bin\\java.exe'
    if (Test-Path $javaExe) { return $candidate }
    throw "JavaHome does not look like a JDK/JRE home (missing bin\\java.exe): $Explicit"
  }

  # Respect existing JAVA_HOME when it's not obviously 32-bit.
  if ($env:JAVA_HOME) {
    $existing = $env:JAVA_HOME.TrimEnd('\\')
    $javaExe = Join-Path $existing 'bin\\java.exe'
    if (Test-Path $javaExe) {
      $major = Get-JavaMajorVersion -JavaExe $javaExe
      if ($javaExe -match '\\Program Files \(x86\)\\') {
        # Prefer JBR if available.
      } elseif ($major -and $major -lt 17) {
        Write-Warning "JAVA_HOME points to Java $major, but AGP 8.2.2 requires JDK 17+. Will try Android Studio JBR instead."
      } else {
        return $existing
      }
    }
  }

  $candidates = @()

  # Android Studio embedded JBR (64-bit). Prefer this on Windows.
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles 'Android\\Android Studio\\jbr'
  }
  $candidates += 'C:\\Program Files\\Android\\Android Studio\\jbr'

  foreach ($javaHomeCandidate in $candidates) {
    $javaExe = Join-Path $javaHomeCandidate 'bin\\java.exe'
    if (Test-Path $javaExe) { return $javaHomeCandidate }
  }

  return $null
}

$resolvedJavaHome = Resolve-JavaHome -Explicit $JavaHome
if ($resolvedJavaHome) {
  $env:JAVA_HOME = $resolvedJavaHome
  Write-Host "JAVA_HOME: $env:JAVA_HOME"
  $javaExe = Join-Path $env:JAVA_HOME 'bin\\java.exe'
  try {
    & $javaExe -version
  } catch {
    # ignore
  }
} else {
  Write-Warning "JAVA_HOME is not set and Android Studio JBR was not found. AGP 8.2.2 requires JDK 17+. Pass -JavaHome 'C:\\Program Files\\Android\\Android Studio\\jbr' or install a 64-bit JDK 17+."
}

# Ensure Gradle wrapper jars exist (common when the repo is freshly cloned)
$wrapperJar = Join-Path $androidRoot 'gradle\wrapper\gradle-wrapper.jar'
if (-not (Test-Path $wrapperJar)) {
  Write-Host "Gradle wrapper jar missing; bootstrapping..."
  & powershell -ExecutionPolicy Bypass -File (Join-Path $androidRoot 'bootstrap-wrapper.ps1')
}

# Help Gradle target a specific device if requested
if ($Device) {
  $env:ANDROID_SERIAL = $Device
  Write-Host "ANDROID_SERIAL set to: $env:ANDROID_SERIAL"
}

Push-Location $androidRoot
try {
  Write-Host "Connected devices:"
  & $adbExe devices

  if ($Clean) {
    & .\gradlew.bat :app:clean
  }

  # `installDebug` builds and installs (updates in-place when possible).
  & .\gradlew.bat :app:installDebug

  Write-Host "Done. If install fails due to signature mismatch, run: adb uninstall com.inventory.android"
} finally {
  Pop-Location
}
