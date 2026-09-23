# sync-stripe-secret.ps1
# ------------------------------------------------------------------
# Keep .env -> STRIPE_WEBHOOK_SECRET in sync with the running Stripe CLI.
# The CLI signs every forwarded event with its own whsec_... ; if .env has a
# different value the app answers 400 Invalid signature and NOTHING shows on OBS.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\sync-stripe-secret.ps1          # fix .env if needed
#   powershell -ExecutionPolicy Bypass -File scripts\sync-stripe-secret.ps1 -NoWrite # check only
#
# Exit code: 0 = matches (or fixed) | 1 = error | 2 = mismatch, not written (-NoWrite)
# ------------------------------------------------------------------

param(
    [switch]$NoWrite
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

if (-not (Get-Command stripe -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: stripe CLI not found in PATH (winget install Stripe.StripeCLI)' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env not found at $envFile" -ForegroundColor Red
    exit 1
}

$lines = @(Get-Content $envFile -Encoding UTF8)

# IMPORTANT: the CLI must run on the SAME Stripe account as STRIPE_SECRET_KEY in .env.
# Otherwise `stripe trigger` (CLI account) succeeds but real donations (created with the
# app key -> another account) NEVER reach this CLI, so no alert shows on OBS.
$apiKey = $null
foreach ($l in $lines) {
    if ($l -match '^\s*STRIPE_SECRET_KEY\s*=') { $apiKey = ($l -split '=', 2)[1].Trim(); break }
}
if (-not $apiKey) {
    Write-Host 'ERROR: STRIPE_SECRET_KEY is missing in .env' -ForegroundColor Red
    exit 1
}

$secret = ((& stripe listen --print-secret --api-key $apiKey) | Select-Object -First 1)
if ($secret) { $secret = $secret.Trim() }
if (-not $secret -or -not $secret.StartsWith('whsec_')) {
    Write-Host 'ERROR: cannot read secret from "stripe listen --print-secret"' -ForegroundColor Red
    exit 1
}

$current = $null
$index = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*STRIPE_WEBHOOK_SECRET\s*=') {
        $current = ($lines[$i] -split '=', 2)[1].Trim()
        $index = $i
        break
    }
}

if ($current -eq $secret) {
    Write-Host 'OK: .env STRIPE_WEBHOOK_SECRET matches the Stripe CLI secret' -ForegroundColor Green
    exit 0
}

Write-Host 'MISMATCH - .env would reject every forwarded webhook with 400:' -ForegroundColor Yellow

# แสดงค่าแบบปิดบางส่วนเสมอ (ห้ามพิมพ์ secret เต็มลง terminal/log)
function Show-Masked([string]$value) {
    if (-not $value) { return '(empty)' }
    if ($value.Length -le 14) { return $value.Substring(0, 4) + '...' }
    return $value.Substring(0, 10) + '...' + $value.Substring($value.Length - 4)
}

Write-Host "  .env : $(Show-Masked $current)"
Write-Host "  CLI  : $(Show-Masked $secret)"

if ($NoWrite) { exit 2 }

if ($index -ge 0) { $lines[$index] = "STRIPE_WEBHOOK_SECRET=$secret" } else { $lines += "STRIPE_WEBHOOK_SECRET=$secret" }

# write UTF-8 without BOM so the first line of .env stays clean
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($envFile, $lines, $utf8NoBom)

Write-Host "UPDATED .env -> STRIPE_WEBHOOK_SECRET=$(Show-Masked $secret)" -ForegroundColor Green
Write-Host "!! Now RESTART 'npm run dev' (env vars are read only at startup)" -ForegroundColor Red
exit 0
