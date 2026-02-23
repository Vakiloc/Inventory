<#
.SYNOPSIS
    Automates Let's Encrypt Certificate Setup (Split Domain Support).
    Stores Python venv and Certbot data under AppDataDir (Electron userData).
    Falls back to %USERPROFILE% for backward compatibility.
#>

param(
    [string]$ResultFile,
    [string[]]$Subdomains,
    [string]$Token,
    [string]$Email,
    [string]$AppDataDir,
    [string]$WebAppPort
)

$ErrorActionPreference = "Stop"

# Use AppDataDir if provided, fall back to USERPROFILE for backward compat
$BaseDir = if ($AppDataDir -and $AppDataDir.Trim()) { $AppDataDir.Trim() } else { $env:USERPROFILE }
$VenvDir = Join-Path $BaseDir ".certbot-env"
$CertbotBaseDir = Join-Path $BaseDir ".inventory-certbot"
$ConfigDir = Join-Path $CertbotBaseDir "config"
$WorkDir = Join-Path $CertbotBaseDir "work"
$LogsDir = Join-Path $CertbotBaseDir "logs"
$CredDir = Join-Path $CertbotBaseDir "credentials"
$CredFile = Join-Path $CredDir "duckdns.ini"

# Legacy location for backward compatibility checks
$LegacyCertbotBaseDir = Join-Path $env:USERPROFILE ".inventory-certbot"
$LegacyConfigDir = Join-Path $LegacyCertbotBaseDir "config"

function Test-ExistingCerts {
    param([string[]]$Domains, [string]$CfgDir)

    $mainDomain = $Domains[0]
    $baseName = $mainDomain -replace '\.duckdns\.org$', ''
    $liveRoot = Join-Path $CfgDir "live"

    if (-not (Test-Path $liveRoot)) { return $null }

    # Scan all dirs under live/: exact match, alt name, or -0001 suffixed variants
    $candidates = Get-ChildItem -Path $liveRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq $mainDomain -or $_.Name -eq $baseName -or $_.Name.StartsWith($mainDomain) -or $_.Name.StartsWith($baseName) } |
        Sort-Object { if ($_.Name -eq $mainDomain -or $_.Name -eq $baseName) { 0 } else { 1 } }

    $liveDir = $null
    foreach ($candidate in $candidates) {
        $kp = Join-Path $candidate.FullName "privkey.pem"
        $cp = Join-Path $candidate.FullName "fullchain.pem"
        if ((Test-Path $kp) -and (Test-Path $cp)) {
            $mainDomain = $candidate.Name
            $liveDir = $candidate.FullName
            break
        }
    }

    if (-not $liveDir) { return $null }

    $keyPath = Join-Path $liveDir "privkey.pem"
    $certPath = Join-Path $liveDir "fullchain.pem"

    # Read expiry from the certificate using .NET X509Certificate2
    try {
        # Resolve symlinks for actual file content
        $certItem = Get-Item $certPath
        $actualCertPath = $certPath
        if ($certItem.LinkType -eq 'SymbolicLink' -and $certItem.Target) {
            $actualCertPath = Join-Path (Split-Path $certPath) $certItem.Target[0]
        }

        $certPem = Get-Content -Raw $actualCertPath
        # Extract the first PEM block (the leaf certificate)
        if ($certPem -match '(?s)(-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----)') {
            $pemBlock = $Matches[1]
            $base64 = ($pemBlock -replace '-----BEGIN CERTIFICATE-----', '' -replace '-----END CERTIFICATE-----', '').Trim()
            $bytes = [Convert]::FromBase64String($base64)
            $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$bytes)
            $expiry = $x509.NotAfter
            $daysLeft = ($expiry - (Get-Date)).Days

            return @{
                Domain       = $mainDomain
                KeyPath      = $keyPath
                CertPath     = $certPath
                ExpiresAt    = $expiry.ToString("o")
                DaysLeft     = $daysLeft
                NeedsRenewal = ($daysLeft -lt 30)
            }
        }
    } catch {
        Write-Host "Warning: Could not parse existing certificate: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    return $null
}

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

function Update-DuckDnsDomains {
    param(
        [string[]]$Domains,
        [string]$DuckToken
    )

    # Detect local IPv4 where the webapp and idp are running.
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet","Wi-Fi" -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" }).IPAddress[0]
    if (-not $localIp) {
        throw "Could not detect local IPv4 address. Ensure you are connected to a network and have the necessary permissions."
    } elseif (Test-NetConnection -ComputerName $localIp -Port $WebAppPort -InformationLevel Quiet) {
        Write-Host "Local IP detected: $localIp and port $WebAppPort is open." -ForegroundColor Green
    } else {
        Write-Host "Warning: Local IP detected as $localIp but port $WebAppPort is not open. DuckDNS registration may succeed but certificate validation will fail." -ForegroundColor Yellow
    }

    # Strip .duckdns.org suffix to get bare subdomain names, join with comma
    $subNames = ($Domains | ForEach-Object { $_ -replace '\.duckdns\.org$', '' }) -join ','

    Write-Host "Registering/updating DuckDNS: $subNames -> $localIp" -ForegroundColor Yellow

    # Single API call creates or updates all subdomains
    $uri = "https://www.duckdns.org/update?domains=$subNames&token=$DuckToken&ip=$localIp"
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 30
    } catch {
        throw "DuckDNS API request failed: $($_.Exception.Message)"
    }

    if ("$response".Trim() -ne 'OK') {
        throw "DuckDNS registration failed (response: '$response'). Verify your token and that subdomains are available."
    }
    Write-Host "DuckDNS domains registered/updated successfully." -ForegroundColor Green
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

    # Clean domain inputs - handle both array and comma-separated string
    # Start-Process -ArgumentList can mangle "val1","val2" into a single "val1,val2"
    $targets = @()
    foreach ($sub in $Subdomains) {
        if ([string]::IsNullOrWhiteSpace($sub)) { continue }
        $parts = $sub.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        foreach ($part in $parts) {
            if (-not $part.EndsWith(".duckdns.org")) {
                $part = "$part.duckdns.org"
            }
            $targets += $part
        }
    }
    
    if ($targets.Count -eq 0) {
        throw "No valid subdomains provided."
    }

    Write-Host "Targets: $($targets -join ', ')"

    # --- Register/update DuckDNS domains with local IP ---
    # Ensures domains exist before Certbot attempts DNS-01 challenge.
    # Idempotent: if domains already exist, harmlessly updates their A record.
    Update-DuckDnsDomains -Domains $targets -DuckToken $Token

    # --- Check for existing valid certificates ---
    # Check new location first, then legacy location
    $existing = Test-ExistingCerts -Domains $targets -CfgDir $ConfigDir
    if (-not $existing -and $LegacyConfigDir -ne $ConfigDir) {
        $existing = Test-ExistingCerts -Domains $targets -CfgDir $LegacyConfigDir
    }

    if ($existing -and -not $existing.NeedsRenewal) {
        Write-Host "Valid certificate found (expires in $($existing.DaysLeft) days)." -ForegroundColor Green
        Write-Host "  Key:  $($existing.KeyPath)" -ForegroundColor Gray
        Write-Host "  Cert: $($existing.CertPath)" -ForegroundColor Gray
        Write-Host "Reusing existing certificate. Skipping Certbot." -ForegroundColor Green

        $resultData = @{
            hostname = $existing.Domain
            key      = $existing.KeyPath
            cert     = $existing.CertPath
            reused   = $true
        }
        if ($targets.Count -gt 1) {
            $resultData["idpHostname"] = $targets[1]
        }
        Write-Result -Success $true -Data $resultData
        exit 0
    }

    if ($existing -and $existing.NeedsRenewal) {
        Write-Host "Certificate expires in $($existing.DaysLeft) days. Will attempt renewal." -ForegroundColor Yellow
    }

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
        "--expand",
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

        # Parse rate limit message for a friendlier error
        $errMsg = "Certbot failed with exit code $LASTEXITCODE"
        if ($cmdOutput -match "too many certificates.*?retry after\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+UTC)") {
            $retryAfter = $Matches[1]
            $errMsg = "Rate limited by Let's Encrypt. Retry after $retryAfter. Use different subdomains or wait."
        }

        Write-Result -Success $false -Message $errMsg -Output $cmdOutput
        exit 1
    } else {
        Write-Host $cmdOutput -ForegroundColor Gray
    }

    # --- Verification ---
    Write-Host "Verifying certificate files..." -ForegroundColor Yellow

    # Log directory structure for debugging
    if (Test-Path $ConfigDir) {
        $liveDir = Join-Path $ConfigDir "live"
        if (Test-Path $liveDir) {
            Write-Host "Available certificate directories:" -ForegroundColor Gray
            Get-ChildItem $liveDir | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
        }
    }

    $MainDomain = $targets[0]
    $LiveCertDir = Join-Path $ConfigDir "live\$MainDomain"

    # Check for alternate domain naming (Certbot may strip .duckdns.org)
    if (-not (Test-Path $LiveCertDir)) {
        $altDomain = $MainDomain -replace '\.duckdns\.org$', ''
        $altLiveCertDir = Join-Path $ConfigDir "live\$altDomain"

        if (Test-Path $altLiveCertDir) {
            Write-Host "Using normalized domain: $altDomain" -ForegroundColor Yellow
            $MainDomain = $altDomain
            $LiveCertDir = $altLiveCertDir
        } else {
            throw "Certificate directory not found at: $LiveCertDir or $altLiveCertDir"
        }
    }

    $KeyPath = Join-Path $LiveCertDir "privkey.pem"
    $CertPath = Join-Path $LiveCertDir "fullchain.pem"

    # Verify files exist and are non-empty
    if (-not (Test-Path $KeyPath)) {
        throw "Private key not found: $KeyPath"
    }
    if (-not (Test-Path $CertPath)) {
        throw "Certificate not found: $CertPath"
    }

    # Get file sizes (resolve symlinks on Windows)
    $keyItem = Get-Item $KeyPath
    $certItem = Get-Item $CertPath

    # If the file is a symlink, resolve it to get the actual file size
    if ($keyItem.LinkType -eq 'SymbolicLink' -and $keyItem.Target) {
        $keyTargetPath = Join-Path (Split-Path $KeyPath) $keyItem.Target[0]
        $keySize = (Get-Item $keyTargetPath).Length
    } else {
        $keySize = $keyItem.Length
    }

    if ($certItem.LinkType -eq 'SymbolicLink' -and $certItem.Target) {
        $certTargetPath = Join-Path (Split-Path $CertPath) $certItem.Target[0]
        $certSize = (Get-Item $certTargetPath).Length
    } else {
        $certSize = $certItem.Length
    }

    if ($keySize -eq 0) {
        throw "Private key file is empty: $KeyPath"
    }
    if ($certSize -eq 0) {
        throw "Certificate file is empty: $CertPath"
    }

    # Ensure files are fully flushed to disk
    Start-Sleep -Milliseconds 500

    Write-Host "Certificate verified:" -ForegroundColor Green
    Write-Host "  Key:  $KeyPath ($keySize bytes)" -ForegroundColor Gray
    Write-Host "  Cert: $CertPath ($certSize bytes)" -ForegroundColor Gray

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
