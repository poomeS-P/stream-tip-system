# set-min-tts.ps1
# ------------------------------------------------------------------
# ตั้งค่า "ขั้นต่ำสำหรับ TTS" (SystemSetting.minAmountForTTS) ของระบบที่ deploy อยู่
# ผ่าน Admin API (PUT /api/admin/settings) — ไม่ต้องเปิดเบราว์เซอร์
#
# ทำไมต้องมี:
# เกณฑ์นี้คือตัวตัดสินว่าโดเนท "จะมีเสียงอ่านหรือไม่" (บันทึกตอน webhook: amount >= minAmountForTTS)
# ถ้าตั้งสูงกว่ายอดที่ผู้ชมจ่ายได้จริง โดเนทจะขึ้นการ์ดแต่ "เงียบ" (ดู docs/STREAM_DAY_CHECKLIST.md)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\set-min-tts.ps1                # ถาม token แล้วตั้งเป็น 10
#   powershell -ExecutionPolicy Bypass -File scripts\set-min-tts.ps1 -Amount 20
#   powershell -ExecutionPolicy Bypass -File scripts\set-min-tts.ps1 -CheckOnly     # อ่านค่าปัจจุบันเท่านั้น
#   powershell -ExecutionPolicy Bypass -File scripts\set-min-tts.ps1 -Local         # ยิงไป http://localhost:<PORT ใน .env>
#   $env:ADMIN_TOKEN='...' ; scripts\set-min-tts.ps1 -Local                          # ส่ง token ผ่าน env ได้
#
# Security: ไม่พิมพ์ token ออกจอ/ไฟล์ · รับผ่าน Read-Host -AsSecureString เมื่อไม่ได้ส่งมา
# Exit code: 0 = สำเร็จ | 1 = error | 2 = โหมด -CheckOnly (ไม่ได้เขียนอะไร)
# ------------------------------------------------------------------

param(
    [double]$Amount = 10,
    [string]$BaseUrl = 'https://stream-tip-system-production.up.railway.app',
    [string]$Token,
    [switch]$Local,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

function Get-EnvFileValue([string]$key) {
    if (-not (Test-Path $envFile)) { return $null }

    $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
    if (-not $line) { return $null }

    return ($line -split '=', 2)[1].Trim()
}

if ($Local) {
    $port = Get-EnvFileValue 'PORT'
    if (-not $port) { $port = 3300 }
    $BaseUrl = "http://localhost:$port"
}
$BaseUrl = $BaseUrl.TrimEnd('/')

if ($Amount -le 0) {
    Write-Host 'ERROR: -Amount must be greater than 0' -ForegroundColor Red
    exit 1
}

# --- ADMIN_TOKEN: parameter > environment > interactive prompt (never echoed) ---
if (-not $Token) { $Token = $env:ADMIN_TOKEN }
if (-not $Token) {
    $secure = Read-Host -Prompt 'ADMIN_TOKEN (input hidden)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $Token) {
    Write-Host 'ERROR: ADMIN_TOKEN is required' -ForegroundColor Red
    exit 1
}

$api = "$BaseUrl/api/admin/settings"
$headers = @{ Authorization = "Bearer $Token" }

function Invoke-AdminApi([string]$method, $body) {
    try {
        if ($null -eq $body) {
            return Invoke-RestMethod -Uri $api -Method $method -Headers $headers -TimeoutSec 30
        }

        return Invoke-RestMethod -Uri $api -Method $method -Headers $headers -ContentType 'application/json' `
            -Body ($body | ConvertTo-Json) -TimeoutSec 30
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $status = [int]$resp.StatusCode
            $detail = ''
            if ($resp.GetResponseStream()) {
                $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
                $detail = $reader.ReadToEnd()
            }
            if ($status -eq 401) {
                throw "401 Unauthorized - ADMIN_TOKEN does not match the target system ($BaseUrl)"
            }
            throw "HTTP $status : $detail"
        }

        throw $_.Exception.Message
    }
}

function Show-Settings($s) {
    Write-Host "  minTipAmount     : $($s.minTipAmount)"
    Write-Host "  minAmountForTTS  : $($s.minAmountForTTS)"
    Write-Host "  alertDurationSec : $($s.alertDurationSec)"
    Write-Host "  Emergency Alert  : $(if ($s.emergencyAlertMuted) { 'MUTED' } else { 'on' })"
    Write-Host "  Emergency TTS    : $(if ($s.emergencyTTSMuted) { 'MUTED' } else { 'on' })"
}

Write-Host '== set-min-tts ==' -ForegroundColor Cyan
Write-Host "   target : $BaseUrl"

try {
    $current = Invoke-AdminApi 'GET' $null
} catch {
    Write-Host "ERROR: cannot read settings - $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host '   current settings:' -ForegroundColor DarkGray
Show-Settings $current

if ($CheckOnly) {
    Write-Host 'CheckOnly: no changes were made.' -ForegroundColor Yellow
    exit 2
}

if ([double]$current.minAmountForTTS -eq $Amount) {
    Write-Host "OK: minAmountForTTS is already $Amount - nothing to do." -ForegroundColor Green
    exit 0
}

try {
    $updated = Invoke-AdminApi 'PUT' @{ minAmountForTTS = $Amount }
} catch {
    Write-Host "ERROR: cannot update settings - $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "UPDATED: minAmountForTTS -> $($updated.minAmountForTTS)" -ForegroundColor Green
Write-Host ''
Write-Host "Next: Admin -> Test Alert with amount >= $Amount -> you should HEAR the TTS" -ForegroundColor DarkGray
Write-Host '      (card shows but still silent? see the TTS section in docs/STREAM_DAY_CHECKLIST.md)' -ForegroundColor DarkGray
exit 0
