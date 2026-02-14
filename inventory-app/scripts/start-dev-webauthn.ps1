
function Refresh-EnvPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Environment Path refreshed." -ForegroundColor Gray
}

Write-Host "Checking for ngrok..."
if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
    $ans = Read-Host "ngrok is not found. Install via winget? (Y/n)"
    if ($ans -match "^[Yy]|^$") {
        Write-Host "Installing ngrok..."
        winget install ngrok
        Refresh-EnvPath
    } else {
        Write-Error "ngrok is required for this script."
        exit 1
    }
}

if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
    # Fallback check for standard winget path
    $wingetPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ngrok.exe"
    if (Test-Path $wingetPath) {
        $env:Path += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
    } else {
        Write-Error "ngrok command still not found. Please restart your terminal or verify installation."
        exit 1
    }
}

$logFile = Join-Path $PSScriptRoot "ngrok.log"

function Start-Ngrok {
    param($RetryWithAuth = $true)

    if (Get-Process ngrok -ErrorAction SilentlyContinue) {
        Write-Warning "Killing existing ngrok process..."
        Stop-Process -Name ngrok -Force
    }

    if (Test-Path $logFile) { Remove-Item $logFile }

    Write-Host "Starting ngrok tunnel on port 5199... (Logging to $logFile)"
    $proc = Start-Process -FilePath "ngrok" -ArgumentList "http 5199 --log=stdout" -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile

    # Wait for ngrok to initialize
    $timeout = 10
    $startTime = Get-Date
    while ($true) {
        Start-Sleep -Seconds 1
        
        # Check if process died
        if ($proc.HasExited) {
            $logContent = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($logContent -match "ERR_NGROK_4018|authentication failed|authtoken is missing") {
                 if ($RetryWithAuth) {
                    Write-Warning "ngrok requires authentication."
                    $token = Read-Host "Please enter your ngrok Authtoken (from dashboard.ngrok.com)"
                    if (-not [string]::IsNullOrWhiteSpace($token)) {
                        ngrok config add-authtoken $token
                        return Start-Ngrok -RetryWithAuth $false
                    }
                 }
                 Write-Error "ngrok failed to start due to authentication error."
            }
            Write-Error "ngrok process exited unexpectedly. Log content:"
            Write-Host $logContent
            exit 1
        }

        # Check API availability
        try {
            $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -ErrorAction Stop
            if ($tunnels.tunnels.Count -gt 0) {
                return $tunnels.tunnels[0].public_url, $proc
            }
        } catch {
            # API not ready yet
        }

        if ((Get-Date) -gt $startTime.AddSeconds($timeout)) {
            Write-Error "Timed out waiting for ngrok to start."
            exit 1
        }
    }
}

$startResult = Start-Ngrok
$publicUrl = $startResult[0]
$ngrokProcess = $startResult[1]

if ([string]::IsNullOrWhiteSpace($publicUrl)) {
    Write-Error "Failed to retrieve public URL."
    Stop-Process -Id $ngrokProcess.Id -Force
    exit 1
}

$hostname = $publicUrl -replace "https://", "" -replace "http://", ""

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host " WEBAUTHN DEV SERVER STARTED" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "Public URL : $publicUrl" -ForegroundColor Cyan
Write-Host "RP ID      : $hostname" -ForegroundColor Cyan
Write-Host "Instructions:" -ForegroundColor Yellow
Write-Host "1. Open the Android App." -ForegroundColor Yellow
Write-Host "2. UNPAIR or CLEAR DATA on the app (since server URL changed)." -ForegroundColor Yellow
Write-Host "3. Pair again using the Public URL above." -ForegroundColor Yellow
Write-Host "==================================================================`n"

$env:WEBAUTHN_RP_ID = $hostname

# Handle cleanup on exit
try {
    Write-Host "Starting Server... (Press Ctrl+C to stop)"
    npm run dev -w server
}
finally {
    Write-Host "`nStopping ngrok..."
    if (-not $ngrokProcess.HasExited) {
        Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
