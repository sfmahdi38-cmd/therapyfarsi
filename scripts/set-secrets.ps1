# Puts the call-test keys on the "therapyfarsi" Cloudflare Worker.
# Run it yourself:  powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1
# Keys go straight from this window to Cloudflare. Nothing is saved in the project.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# npm writes notices to stderr; under 'Stop' PowerShell 5.1 would treat them as errors here.
$ErrorActionPreference = 'Continue'
$who = (npx wrangler whoami 2>&1 | Out-String)
$ErrorActionPreference = 'Stop'
if ($who -match 'not authenticated') {
  Write-Host 'Cloudflare login: a browser window opens - approve it.' -ForegroundColor Cyan
  npx wrangler login
}

function Read-Secret([string]$label) {
  $secure = Read-Host "Paste $label (hidden), then Enter" -AsSecureString
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
  if (-not $plain) { throw "$label is empty" }
  return $plain
}

# Random access code for the /call-test page (24 URL-safe characters).
$bytes = New-Object byte[] 18
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$code = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')

$secrets = [ordered]@{
  CALL_TEST_CODE     = $code
  DAILY_DOMAIN       = 'thropy.daily.co'
  DAILY_API_KEY      = Read-Secret 'DAILY_API_KEY  (dashboard.daily.co > Developers)'
  LIVEKIT_URL        = Read-Secret 'LIVEKIT_URL  (cloud.livekit.io > Settings, starts with wss://)'
  LIVEKIT_API_KEY    = Read-Secret 'LIVEKIT_API_KEY  (cloud.livekit.io > Settings > API keys)'
  LIVEKIT_API_SECRET = Read-Secret 'LIVEKIT_API_SECRET  (same place)'
}
if (-not $secrets.LIVEKIT_URL.StartsWith('wss://')) { throw 'LIVEKIT_URL must start with wss://' }

# One upload for all six; the temp file is deleted right after.
$tmp = Join-Path $env:TEMP ("tf-secrets-" + [guid]::NewGuid() + '.json')
try {
  [System.IO.File]::WriteAllText($tmp, ($secrets | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
  npx wrangler secret bulk $tmp
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Done. Your /call-test access code (save it; give it only to the testers):' -ForegroundColor Green
Write-Host $code -ForegroundColor Yellow
