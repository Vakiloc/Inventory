# PowerShell script to clean project dependencies and build artifacts

$ErrorActionPreference = "Stop"

function Remove-PathSafe {
    param($Path)
    if (Test-Path $Path) {
        Write-Host "Removing $Path..." -ForegroundColor Yellow
        try {
            Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
            Write-Host "  Removed." -ForegroundColor Green
        } catch {
            Write-Host "  Failed to remove $Path using PowerShell. Trying cmd..." -ForegroundColor Red
            # Fallback for deep paths or locked files
            if (Test-Path -PathType Container $Path) {
                cmd /c "rmdir /s /q `"$Path`""
            } else {
                cmd /c "del /f /q `"$Path`""
            }
        }
    } else {
        Write-Host "Skipping $Path (Not found)" -ForegroundColor Gray
    }
}

<# Get the root path of the project finding the inventory-app sibling folder #>

$root = $PSScriptRoot
while ($root -ne [System.IO.Path]::GetPathRoot($root)) {
    if (Test-Path "$root\inventory-app") {
        break
    }
    $root = [System.IO.Path]::GetDirectoryName($root)
}

Write-Host "Cleaning project at $root" -ForegroundColor Cyan

# 0. Python Virtual Environments

# Find all the Python virtual environments in the project and remove them by checking for the presence of pyvenv.cfg
# We collect the results into an array first to avoid modifying the collection while iterating
$venvConfigs = Get-ChildItem -Path $root -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "pyvenv.cfg" }

if ($venvConfigs) {
    $venvConfigs | ForEach-Object {
        $venvPath = $_.Directory.FullName
        Remove-PathSafe $venvPath
    }
}

# 1. Node Modules

#Find all node_modules folders in the project and remove them
Get-ChildItem -Path $root -Recurse -Directory -Filter "node_modules" | ForEach-Object {
    Remove-PathSafe $_.FullName
}

# 2. Desktop Build Artifacts
Remove-PathSafe "$root\desktop\dist"
Remove-PathSafe "$root\desktop\dist-electron"
Remove-PathSafe "$root\desktop\.vite"

# 3. Android Build Artifacts
Remove-PathSafe "$root\android\.gradle"
Remove-PathSafe "$root\android\app\build"
Remove-PathSafe "$root\android\build"

# 4. Server Data (Temporary files only)
# Do not delete inventory.sqlite!
Remove-PathSafe "$root\server\data\inventory.sqlite-shm"
Remove-PathSafe "$root\server\data\inventory.sqlite-wal"

# 5. Logs
Remove-PathSafe "$root\*.log"
Remove-PathSafe "$root\server\*.log"
Remove-PathSafe "$root\desktop\*.log"

# 6. Claude temporary files. These tmpclaude-*-cwd files are a bug in the current version of Claude.
Get-ChildItem -Path $root -Recurse -File -Filter "tmpclaude-*-cwd" | ForEach-Object {
    Remove-PathSafe $_.FullName
}

Write-Host "Clean complete! You will need to run 'npm install' to rebuild dependencies." -ForegroundColor Magenta
