# check-thai-voices.ps1
# ------------------------------------------------------------------
# ตรวจ "เสียงไทยที่ Windows มีให้ใช้" และบอกว่าแอปจะเลือกเสียงไหน
#
# ทำไมต้องมี: Browser Source ของ OBS (CEF 64-bit) เห็นเฉพาะเสียงที่ลงทะเบียนใน Windows
# ถ้าเครื่องมีแต่เสียงไทยผู้ชาย (Pattara) การ์ดจะขึ้นแต่เสียงอ่านเป็นผู้ชายเสมอ
# (เสียงหญิงธรรมชาติของ Edge เช่น "เปรมวดี Online (Natural)" ไม่ใช่เสียงของ Windows → OBS ใช้ไม่ได้)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\check-thai-voices.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\check-thai-voices.ps1 -Simulate "Microsoft Kanya - Thai (Thailand)"
#   powershell -ExecutionPolicy Bypass -File scripts\check-thai-voices.ps1 -SourceFile "C:\path\to\voice.ts"
#
# -Simulate = จำลองเสียงที่ "ยังไม่ได้ติดตั้ง" เพื่อดูคะแนน/การเลือกก่อนตัดสินใจติดตั้ง
#             (ผลจำลองจะถูกติดป้าย [SIMULATED] และ "ไม่" ถูกนำไปคิด exit code)
#
# Scoring = สูตรเดียวกับ src/lib/tts/voice.ts (scoreVoice):
#   Thai base 1000 · lang th-TH +50 · female +300 · male -400 · natural +120 · local +30
#   (คะแนน +5 ของ "เสียง default ของเบราว์เซอร์" ไม่ถูกนำมาคิด เพราะ registry ไม่รู้จักค่านั้น)
#   hint คำหญิง/ชาย/ธรรมชาติ ถูกอ่านจาก voice.ts ด้วย regex — ถ้าอ่านไม่ได้จะใช้ค่าสำเนา + แจ้งเตือน
#
# Exit code: 0 = พบเสียงไทยผู้หญิง | 2 = พบแต่เสียงไทยผู้ชาย | 1 = ไม่พบเสียงไทย/เกิดข้อผิดพลาด
# ------------------------------------------------------------------

param(
    [string]$Simulate,
    [string]$SourceFile
)

$ErrorActionPreference = 'Stop'

# ---------- ค่าคะแนนของแอป (ต้องตรงกับ scoreVoice ใน src/lib/tts/voice.ts) ----------
$THAI_BASE = 1000
$THAI_TH_BONUS = 50
$FEMALE_BONUS = 300
$MALE_PENALTY = -400
$NATURAL_BONUS = 120
$LOCAL_BONUS = 30
$PREFER_MATCH_SCORE = 10000

# ค่าสำเนา (fallback) — ใช้เฉพาะเมื่ออ่าน hint จาก voice.ts ไม่ได้
$FALLBACK_HINTS = @{
    FEMALE_HINTS = @('premwadee', 'เปรมวดี', 'kanya', 'female', 'หญิง', 'woman', 'chompoo', 'ชมพู', 'ploy', 'พลอย', 'nina', 'หญิงไทย', 'thai female')
    MALE_HINTS   = @('pattara', 'ภัทร', 'niwat', 'นิวัฒน์', 'male', 'david', 'mark')
    NATURAL_HINTS = @('natural', 'neural', 'online', 'premium', 'enhanced', 'google')
}

$HIVES = @(
    @{ Path = 'HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens'; Label = 'OneCore (64-bit)'; Is32BitOnly = $false }
    @{ Path = 'HKLM:\SOFTWARE\Microsoft\Speech\Voices\Tokens';         Label = 'SAPI5 (64-bit)';   Is32BitOnly = $false }
    @{ Path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens'; Label = 'SAPI5 (32-bit)'; Is32BitOnly = $true }
)

# ---------- ตัวช่วย ----------

function Convert-LcidToLang([string]$lcid) {
    if (-not $lcid) { return $null }

    $map = @{
        '409' = 'en-US'; '809' = 'en-GB'; '41E' = 'th-TH'; '411' = 'ja-JP'; '412' = 'ko-KR'
        '804' = 'zh-CN'; '404' = 'zh-TW'; '40C' = 'fr-FR'; '407' = 'de-DE'; '40A' = 'es-ES'
        '410' = 'it-IT'; '416' = 'pt-BR'; '419' = 'ru-RU'; '42A' = 'vi-VN'; '421' = 'id-ID'; '44E' = 'ms-MY'
    }

    $key = $lcid.Trim().ToUpperInvariant()
    if ($map.ContainsKey($key)) { return $map[$key] }

    return $null
}

function Read-HintArray([string]$source, [string]$name) {
    # อ่าน array ของ string จากไฟล์ .ts ด้วย regex — ไม่ต้อง build/รันโค้ด
    $match = [regex]::Match($source, "const\s+$name\s*=\s*\[(.*?)\];", [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $match.Success) { return $null }

    $items = @()
    foreach ($m in [regex]::Matches($match.Groups[1].Value, '"([^"]+)"')) {
        $items += $m.Groups[1].Value
    }

    if ($items.Count -eq 0) { return $null }

    return $items
}

function Test-Hint([string]$name, $hints) {
    if (-not $name -or -not $hints) { return $false }

    $lower = $name.ToLowerInvariant()
    foreach ($hint in $hints) {
        if ($lower.Contains($hint.ToLowerInvariant())) { return $true }
    }

    return $false
}

function Get-VoiceScore([string]$name, [string]$lang, [bool]$isLocal, [string]$preferName, $femaleHints, $maleHints, $naturalHints) {
    if (-not $lang) { return $null }
    if (-not $lang.ToLowerInvariant().StartsWith('th')) { return $null }

    $score = $THAI_BASE
    if ($preferName) {
        $target = $preferName.Trim().ToLowerInvariant()
        if ($target.Length -gt 0 -and $name.ToLowerInvariant().Contains($target)) { return $PREFER_MATCH_SCORE }
    }

    if ($lang.ToLowerInvariant() -eq 'th-th') { $score += $THAI_TH_BONUS }
    if (Test-Hint $name $femaleHints) { $score += $FEMALE_BONUS }
    if (Test-Hint $name $maleHints) { $score += $MALE_PENALTY }
    if (Test-Hint $name $naturalHints) { $score += $NATURAL_BONUS }
    if ($isLocal) { $score += $LOCAL_BONUS }

    return $score
}

function Get-VoiceGender([string]$genderAttribute, [string]$name, $femaleHints, $maleHints) {
    # ใช้ค่าจาก registry ก่อน (ถ้ามี) แล้วค่อยเดาจากชื่อ — เพื่อรายงานตามจริง
    if ($genderAttribute) {
        $g = $genderAttribute.Trim().ToLowerInvariant()
        if ($g -like 'female*') { return 'female' }
        if ($g -like 'male*') { return 'male' }
    }

    $femaleHint = Test-Hint $name $femaleHints
    $maleHint = Test-Hint $name $maleHints

    if ($femaleHint -and -not $maleHint) { return 'female' }
    if ($maleHint -and -not $femaleHint) { return 'male' }

    return 'unknown'
}

function Read-RegistryVoices($hive, $femaleHints, $maleHints) {
    $rows = @()

    $keys = Get-ChildItem -Path $hive.Path -ErrorAction SilentlyContinue
    foreach ($key in $keys) {
        $attributes = Get-ItemProperty -Path (Join-Path $key.PSPath 'Attributes') -ErrorAction SilentlyContinue
        $name = if ($attributes) { [string]$attributes.Name } else { '' }
        if (-not $name) { $name = $key.PSChildName }

        $langHex = if ($attributes) { [string]$attributes.Language } else { '' }
        $gender = if ($attributes) { [string]$attributes.Gender } else { '' }

        $rows += [pscustomobject]@{
            TokenId     = $key.PSChildName
            Name        = $name
            LangHex     = $langHex
            Lang        = Convert-LcidToLang $langHex
            Gender      = Get-VoiceGender $gender $name $femaleHints $maleHints
            GenderRaw   = $gender
            Hive        = $hive.Label
            Is32BitOnly = $hive.Is32BitOnly
            IsLocal     = $true   # เสียงจาก registry = local voice ของเบราว์เซอร์ (ได้ +30)
        }
    }

    return $rows
}

# ---------- เริ่มทำงาน ----------

Write-Host '== check-thai-voices ==' -ForegroundColor Cyan

if (-not $SourceFile) {
    $SourceFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\lib\tts\voice.ts'
}

$usingFallback = $false
$femaleHints = $null
$maleHints = $null
$naturalHints = $null

if (Test-Path $SourceFile) {
    $source = Get-Content $SourceFile -Raw -Encoding UTF8
    $femaleHints = Read-HintArray $source 'FEMALE_HINTS'
    $maleHints = Read-HintArray $source 'MALE_HINTS'
    $naturalHints = Read-HintArray $source 'NATURAL_HINTS'
    Write-Host "   hints from: $SourceFile" -ForegroundColor DarkGray
} else {
    Write-Host "   WARN: source file not found: $SourceFile" -ForegroundColor Yellow
}

if (-not $femaleHints -or -not $maleHints -or -not $naturalHints) {
    $usingFallback = $true
    if (-not $femaleHints) { $femaleHints = $FALLBACK_HINTS.FEMALE_HINTS }
    if (-not $maleHints) { $maleHints = $FALLBACK_HINTS.MALE_HINTS }
    if (-not $naturalHints) { $naturalHints = $FALLBACK_HINTS.NATURAL_HINTS }
    Write-Host '   WARN: could not read hint arrays from voice.ts -> using EMBEDDED FALLBACK hints' -ForegroundColor Yellow
}

$voices = @()
foreach ($hive in $HIVES) {
    $voices += Read-RegistryVoices $hive $femaleHints $maleHints
}

$thaiVoices = @($voices | Where-Object { $_.Lang -and $_.Lang.ToLowerInvariant().StartsWith('th') })

$scored = @()
foreach ($voice in $thaiVoices) {
    $score = Get-VoiceScore $voice.Name $voice.Lang $voice.IsLocal $null $femaleHints $maleHints $naturalHints
    if ($null -ne $score) {
        $scored += [pscustomobject]@{
            Name        = $voice.Name
            Lang        = $voice.Lang
            Gender      = $voice.Gender
            Score       = $score
            Hive        = $voice.Hive
            Is32BitOnly = $voice.Is32BitOnly
            Simulated   = $false
        }
    }
}

$simulated = $null
if ($Simulate) {
    $simScore = Get-VoiceScore $Simulate 'th-TH' $true $null $femaleHints $maleHints $naturalHints
    $simGender = Get-VoiceGender '' $Simulate $femaleHints $maleHints

    if ($null -eq $simScore) { $simScore = '(' + 'not a Thai voice by scoring rules' + ')' }

    $simulated = [pscustomobject]@{
        Name        = $Simulate
        Lang        = 'th-TH'
        Gender      = $simGender
        Score       = $simScore
        Hive        = '(not installed)'
        Is32BitOnly = $false
        Simulated   = $true
    }
}

Write-Host ''
Write-Host '--- Thai voices installed in Windows registry ---' -ForegroundColor Cyan

if ($scored.Count -eq 0) {
    Write-Host '   (none)' -ForegroundColor Yellow
} else {
    Write-Host ('   {0,-6} {1,-8} {2,-8} {3}' -f 'Score', 'Gender', 'Lang', 'Name')
    foreach ($row in ($scored | Sort-Object -Property Score -Descending)) {
        $flag = if ($row.Is32BitOnly) { '  [32-bit hive - OBS 64-bit may not see it]' } else { '' }
        Write-Host ('   {0,-6} {1,-8} {2,-8} {3}{4}' -f $row.Score, $row.Gender, $row.Lang, $row.Name, $flag)
        Write-Host ('          hive: {0}' -f $row.Hive) -ForegroundColor DarkGray
    }
}

if ($simulated) {
    Write-Host ''
    Write-Host '--- [SIMULATED] NOT installed - planning only ---' -ForegroundColor Magenta
    Write-Host ('   {0,-6} {1,-8} {2,-8} {3}' -f 'Score', 'Gender', 'Lang', $simulated.Name)
    Write-Host '   (assumption: lang=th-TH, local Windows voice, gender inferred from registry/name hints)' -ForegroundColor DarkGray
}

# ---- ระบบจะเลือกเสียงไหน ----
Write-Host ''

$installedBest = $null
if ($scored.Count -gt 0) {
    $installedBest = ($scored | Sort-Object -Property Score -Descending | Select-Object -First 1)
}

if ($installedBest) {
    Write-Host ("-> System will select: {0} (score {1})" -f $installedBest.Name, $installedBest.Score) -ForegroundColor Green
} else {
    Write-Host '-> System will select: (no Thai voice) - app falls back to the browser default voice' -ForegroundColor Red
}

if ($simulated) {
    $combinedBest = (@($scored) + @($simulated) | Sort-Object -Property Score -Descending | Select-Object -First 1)
    Write-Host ("-> WITH THE SIMULATED VOICE installed, system would select: {0} (score {1})" -f $combinedBest.Name, $combinedBest.Score) -ForegroundColor Magenta
}

# ---- คำเตือน ----
$warnings = @()

if ($usingFallback) {
    $warnings += 'hint arrays were NOT read from voice.ts (embedded fallback used) -> scores may drift from the app'
}

if (@($scored | Where-Object { $_.Is32BitOnly }).Count -gt 0) {
    $warnings += 'Thai voice(s) found only in the 32-bit hive (WOW6432Node) -> OBS/CEF is 64-bit and may NOT see them'
}

if ($scored.Count -eq 0) {
    $warnings += 'no Thai voice installed -> TTS uses the browser default voice (Thai pronunciation will be wrong)'
} elseif (@($scored | Where-Object { $_.Gender -eq 'female' }).Count -eq 0) {
    $warnings += 'only Thai MALE voice(s) found -> OBS/CEF will speak Thai with a male voice; use Edge /overlay/voice or install a Thai female voice'
}

if (@($scored | Where-Object { $_.Gender -eq 'unknown' }).Count -gt 0) {
    $warnings += 'some voice(s) have unknown gender (registry Gender missing + name hints did not match) -> verify by ear or force with ?ttsvoice='
}

if ($Simulate) {
    $warnings += 'the [SIMULATED] voice is NOT installed -> it does not affect the exit code'
}

if ($warnings.Count -gt 0) {
    Write-Host ''
    Write-Host '--- WARNINGS ---' -ForegroundColor Yellow
    foreach ($w in $warnings) {
        Write-Host ('   ! ' + $w) -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor DarkGray
Write-Host '   - After installing a voice: RESTART OBS completely (CEF reads voices at startup), then add &ttsdiag=1 to the Browser Source URL' -ForegroundColor DarkGray
Write-Host '   - Expect the panel to show "เสียงไทย: 2" with the female voice having the highest score' -ForegroundColor DarkGray
Write-Host '   - Force a voice via URL: &ttsvoice=<part of the voice name>' -ForegroundColor DarkGray
Write-Host '   - No Thai female voice? Use Edge /overlay/voice (see docs/STREAM_DAY_CHECKLIST.md)' -ForegroundColor DarkGray

# ---- exit code (อิงจากเสียงที่ติดตั้งจริงเท่านั้น — ผลจำลองไม่นับ) ----
$hasThai = $scored.Count -gt 0
$hasThaiFemale = @($scored | Where-Object { $_.Gender -eq 'female' }).Count -gt 0

if (-not $hasThai) {
    Write-Host ''
    Write-Host 'RESULT: no Thai voice installed (exit 1)' -ForegroundColor Red
    exit 1
}

if (-not $hasThaiFemale) {
    Write-Host ''
    Write-Host 'RESULT: Thai male voice only (exit 2)' -ForegroundColor Yellow
    exit 2
}

Write-Host ''
Write-Host 'RESULT: Thai female voice available (exit 0)' -ForegroundColor Green
exit 0
