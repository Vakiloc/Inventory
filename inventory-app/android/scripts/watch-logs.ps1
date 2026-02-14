$ErrorActionPreference = 'Stop'

function Get-AdbPath {
    $onPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($onPath) { return "adb" }
    
    $localAppData = [System.Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    $candidate = "$localAppData\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $candidate) { return $candidate }
    
    return $null
}

$adb = Get-AdbPath

if (-not $adb) {
    Write-Host "ADB not found on PATH or default location." -ForegroundColor Red
    Write-Host "Please add platform-tools to PATH or run from an Android Studio initialized shell."
    exit 1
}

Write-Host "Using ADB: $adb"

$package = "com.inventory.android"
Write-Host "Clearing old logs..."
& $adb logcat -c
Write-Host "Listening for logs from $package..."
& $adb logcat -v color *:S System.err:V AndroidRuntime:V MessageQueue-JNI:V Inventory:V InvApp:V OkHttp:V io.ktor:V
