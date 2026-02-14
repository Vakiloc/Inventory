<#
.SYNOPSIS
    Automates Let's Encrypt Certificate Setup (Split Domain Support).
    Uses a local Python Virtual Environment and User Profile storage.
#>

param(
    [string]$ResultFile,
    [string[]]$Subdomains,
    [string]$Token,
    [string]$Email
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$VenvDir = Join-Path $ScriptDir ".certbot-env"

# User-profile directories for Certbot to avoid permission issues
$CertbotBaseDir = Join-Path $env:USERPROFILE ".inventory-certbot"
$ConfigDir = Join-Path $CertbotBaseDir "config"
$WorkDir = Join-Path $CertbotBaseDir "work"
$LogsDir = Join-Path $CertbotBaseDir "logs"
$CredDir = Join-Path $CertbotBaseDir "credentials"
$CredFile = Join-Path $CredDir "duckdns.ini"

function Write-Result {
    param(
        [bool]$Success,
        [object]$Data = $null,
        [string]$Message = "",
        [string]$Output = ""
    )
    
    if (-not $ResultFile) {
        Write-Host "No ResultFile specified. Output only to console."
        return
    }

    $outputData = @{ success = $Success }
    if ($Success) {
        $outputData["result"] = $Data
    } else {
        $outputData["message"] = $Message
        if (-not [string]::IsNullOrEmpty($Output)) {
            $outputData["output"] = $Output
        }
    }
    
    # Ensure directory exists
    $resDir = Split-Path $ResultFile -Parent
    if ($resDir -and -not (Test-Path $resDir)) {
        New-Item -ItemType Directory -Path $resDir -Force | Out-Null
    }
    
    # Write Result JSON with UTF-8 No BOM
    $json = $outputData | ConvertTo-Json -Depth 5
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($ResultFile, $json, $utf8NoBom)
}

try {
    Write-Host "=== Inventory App: Certificate Setup ===" -ForegroundColor Cyan
    
    # --- Validation ---
    if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
        throw "Python 3 is not installed or not in PATH."
    }
    if (-not $Subdomains -or $Subdomains.Count -eq 0) {
        throw "At least one Subdomain is required."
    }
    if (-not $Token) {
        throw "DuckDNS Token is required."
    }
    if (-not $Email) {
        throw "Email is required."
    }

    # Clean domain inputs
    $targets = @()
    foreach ($sub in $Subdomains) {
        if (-not [string]::IsNullOrWhiteSpace($sub)) {
            $clean = $sub.Trim()
            if (-not $clean.EndsWith(".duckdns.org")) {
                $clean = "$clean.duckdns.org"
            }
            $targets += $clean
        }
    }
    
    if ($targets.Count -eq 0) {
        throw "No valid subdomains provided."
    }

    Write-Host "Targets: $($targets -join ', ')"

    # --- Python Venv Setup ---
    if (-not (Test-Path $VenvDir)) {
        Write-Host "Creating Python Venv..." -ForegroundColor Yellow
        python -m venv $VenvDir
    }

    $PipExe = Join-Path $VenvDir "Scripts\pip.exe"
    
    if (-not (Test-Path $PipExe)) {
        throw "Virtual Environment corrupted. Delete '$VenvDir' and retry."
    }

    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    & $PipExe install certbot certbot-dns-duckdns --quiet --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Python dependencies."
    }

    # --- Directories & Credentials ---
    foreach ($path in @($ConfigDir, $WorkDir, $LogsDir, $CredDir)) {
        if (-not (Test-Path $path)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }

    # Write duckdns.ini
    Set-Content -Path $CredFile -Value "dns_duckdns_token = $Token"
    
    # --- Run Certbot ---
    Write-Host "Requesting certificate via DuckDNS..." -ForegroundColor Yellow
    
    $CertbotExe = Join-Path $VenvDir "Scripts\certbot.exe"
    if (-not (Test-Path $CertbotExe)) {
        throw "Certbot executable not found in venv: $CertbotExe"
    }

    $certbotArgs = @(
        "certonly",
        "--non-interactive",
        "--agree-tos",
        "--email", $Email,
        "--authenticator", "dns-duckdns",
        "--dns-duckdns-credentials", $CredFile,
        "--dns-duckdns-propagation-seconds", "60",
        "--config-dir", $ConfigDir,
        "--work-dir", $WorkDir,
        "--logs-dir", $LogsDir
    )
    
    foreach ($t in $targets) {
        $certbotArgs += "-d"
        $certbotArgs += $t
    }

    # Temporarily relax ErrorActionPreference to prevent NativeCommandError on stderr output
    $origEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    # Execute and capture output
    # Using Try/Catch for execution to be safe
    try {
        $cmdOutput = & $CertbotExe $certbotArgs 2>&1 | Out-String
    } catch {
        $cmdOutput = $_.Exception.Message
    }
    
    $ErrorActionPreference = $origEAP
    
    # Log valid output or error
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Certbot Failed!" -ForegroundColor Red
        if ($cmdOutput -match "Request response text: KO") {
             Write-Host "DuckDNS Error Detected!" -ForegroundColor Red
        }
        
        Write-Result -Success $false -Message "Certbot failed with exit code $LASTEXITCODE" -Output $cmdOutput
        exit 1
    } else {
        Write-Host $cmdOutput -ForegroundColor Gray
    }

    # --- Verification ---
    $MainDomain = $targets[0]
    $LiveCertDir = Join-Path $ConfigDir "live\$MainDomain"
    $KeyPath = Join-Path $LiveCertDir "privkey.pem"
    $CertPath = Join-Path $LiveCertDir "fullchain.pem"

    if ((-not (Test-Path $KeyPath)) -or (-not (Test-Path $CertPath))) {
        throw "Files not found at expected path: $LiveCertDir"
    }

    Write-Host "Success! Certificate Generated." -ForegroundColor Green
    
    $resultData = @{
        hostname = $MainDomain
        key = $KeyPath
        cert = $CertPath
    }
    
    if ($targets.Count -gt 1) {
        $resultData["idpHostname"] = $targets[1]
    }

    Write-Result -Success $true -Data $resultData

} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Result -Success $false -Message $_.Exception.Message
    Start-Sleep -Seconds 5
    exit 1
}
