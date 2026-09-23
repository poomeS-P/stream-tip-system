# start-stripe-listen.ps1
# ------------------------------------------------------------------
# Start the Stripe CLI webhook forwarder, pointing at the SAME port as .env
# (previously the port was typed by hand, so it broke silently when the app
#  moved from 3000 to 3300).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-stripe-listen.ps1
# Close the window to stop forwarding.
# ------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

# --- port from .env (fallback 3300) ---
$port = 3300
if (Test-Path $envFile) {
    $portLine = (Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1)
    if ($portLine) { $port = ($portLine -split '=', 2)[1].Trim() }
}
$target = "http://localhost:$port/api/webhooks/payment"

# --- API key from .env: keeps the CLI on the SAME Stripe account as the app ---
$apiKey = $null
if (Test-Path $envFile) {
    $keyLine = (Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*STRIPE_SECRET_KEY\s*=' } | Select-Object -First 1)
    if ($keyLine) { $apiKey = ($keyLine -split '=', 2)[1].Trim() }
}
if (-not $apiKey) {
    Write-Host 'ERROR: STRIPE_SECRET_KEY not found in .env' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

Write-Host '== Stripe CLI listen ==' -ForegroundColor Cyan
Write-Host "   forward-to : $target"
Write-Host ''

# --- make sure the signing secret in .env matches this CLI ---
try {
    & (Join-Path $PSScriptRoot 'sync-stripe-secret.ps1')
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'WARNING: STRIPE_WEBHOOK_SECRET may be stale - webhooks can be rejected with 400' -ForegroundColor Red
    }
} catch {
    Write-Host "WARNING: sync-stripe-secret.ps1 failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ''
Write-Host 'Press Ctrl+C (or close this window) to stop.' -ForegroundColor DarkGray
Write-Host ''

& stripe listen `
    --api-key $apiKey `
    --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired `
    --forward-to $target
