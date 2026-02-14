param(
  [string]$ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = 'Stop'

$wrapperJar = Join-Path $ProjectRoot 'gradle\\wrapper\\gradle-wrapper.jar'
$wrapperSharedJar = Join-Path $ProjectRoot 'gradle\\wrapper\\gradle-wrapper-shared.jar'
$wrapperCliJar = Join-Path $ProjectRoot 'gradle\\wrapper\\gradle-cli.jar'
$wrapperProps = Join-Path $ProjectRoot 'gradle\wrapper\gradle-wrapper.properties'

# Always overwrite the wrapper jar to match the configured distributionUrl.
# This avoids Android Studio sync issues when the Gradle version changes.

if (!(Test-Path $wrapperProps)) {
  throw "Missing $wrapperProps"
}

$props = Get-Content $wrapperProps -Raw
$match = [regex]::Match($props, 'distributionUrl=(.+)')
if (!$match.Success) {
  throw "distributionUrl not found in gradle-wrapper.properties"
}

$url = $match.Groups[1].Value.Trim()
$url = $url -replace '\\:', ':'
$url = $url -replace '\\/', '/'

Write-Host "Downloading Gradle distribution: $url"

$tmpZip = Join-Path ([System.IO.Path]::GetTempPath()) ('gradle-dist-' + [guid]::NewGuid().ToString() + '.zip')
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ('gradle-dist-' + [guid]::NewGuid().ToString())

Invoke-WebRequest -Uri $url -OutFile $tmpZip
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir

# Gradle 8+ splits wrapper runtime across multiple jars.
# In practice, GradleWrapperMain is shipped in the wrapper plugin jar (lib/plugins),
# while shared classes + CLI live under lib/.
$mainJar = Get-ChildItem -Path $tmpDir -Recurse -Filter 'gradle-wrapper-*.jar' |
  Where-Object { $_.FullName -match 'lib\\plugins\\gradle-wrapper-' } |
  Select-Object -First 1

$sharedJar = Get-ChildItem -Path $tmpDir -Recurse -Filter 'gradle-wrapper-shared-*.jar' |
  Where-Object { $_.FullName -match 'lib\\gradle-wrapper-shared-' } |
  Select-Object -First 1

$cliJar = Get-ChildItem -Path $tmpDir -Recurse -Filter 'gradle-cli-*.jar' |
  Where-Object { $_.FullName -match 'lib\\gradle-cli-' } |
  Select-Object -First 1

if (!$mainJar) { throw "Could not locate lib/plugins/gradle-wrapper-*.jar inside distribution" }
if (!$sharedJar) { throw "Could not locate lib/gradle-wrapper-shared-*.jar inside distribution" }
if (!$cliJar) { throw "Could not locate lib/gradle-cli-*.jar inside distribution" }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $wrapperJar) | Out-Null
Copy-Item -Force -Path $mainJar.FullName -Destination $wrapperJar
Copy-Item -Force -Path $sharedJar.FullName -Destination $wrapperSharedJar
Copy-Item -Force -Path $cliJar.FullName -Destination $wrapperCliJar

Write-Host "Installed Gradle wrapper jar: $wrapperJar"
Write-Host "Installed Gradle wrapper shared jar: $wrapperSharedJar"
Write-Host "Installed Gradle cli jar: $wrapperCliJar"

Remove-Item -Force $tmpZip
Remove-Item -Recurse -Force $tmpDir
