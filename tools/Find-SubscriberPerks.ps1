<#
  Lists the subscriber perk settings (cig_subscriber.*) baked into a Star Citizen build,
  with their default values and descriptions, plus the log lines the perks can write.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\Find-SubscriberPerks.ps1            # PTU
    powershell -ExecutionPolicy Bypass -File .\Find-SubscriberPerks.ps1 -Channel LIVE
    powershell -ExecutionPolicy Bypass -File .\Find-SubscriberPerks.ps1 -Root 'D:\Games\StarCitizen'
#>
param(
    [string]$Root = 'C:\Program Files\Roberts Space Industries\StarCitizen',
    [string]$Channel = 'PTU'
)

$dir = Join-Path $Root $Channel
$exe = Join-Path $dir 'Bin64\StarCitizen.exe'
if (-not (Test-Path $exe)) { Write-Error "Not found: $exe"; exit 1 }

$manifest = Join-Path $dir 'build_manifest.id'
if (Test-Path $manifest) {
    $d = (Get-Content $manifest -Raw | ConvertFrom-Json).Data
    "$Channel build $($d.Version), changelist $($d.RequestedP4ChangeNum), built $($d.BuildDateStamp)"
} else {
    "$Channel ($exe)"
}
''

# Read the exe as one byte-per-char string so string offsets equal file offsets.
$text = [Text.Encoding]::GetEncoding(28591).GetString([IO.File]::ReadAllBytes($exe))

# Find where the subscriber strings sit; they are stored together.
$hits = foreach ($needle in 'cig_subscriber', '[Subscriber]') {
    $i = $text.IndexOf($needle, [StringComparison]::Ordinal)
    while ($i -ge 0) { $i; $i = $text.IndexOf($needle, $i + 1, [StringComparison]::Ordinal) }
}
if (-not $hits) { 'No subscriber perks in this build.'; exit 0 }
$from = [Math]::Max(0, ($hits | Measure-Object -Minimum).Minimum - 4096)
$to = [Math]::Min($text.Length, ($hits | Measure-Object -Maximum).Maximum + 4096)

# The readable strings in that region, in file order.
$strings = @([regex]::Matches($text.Substring($from, $to - $from), '[\x20-\x7E\t]{6,}') |
    ForEach-Object { $_.Value.Trim() })

$isName = { param($s) $s -match '^cig_subscriber\.[\w.]+$' }
$isDefault = { param($s) $s -match '^[\d.]+(\s*,\s*[\d.]+)+$' }

'Settings:'
$seen = @{}
$rows = for ($i = 0; $i -lt $strings.Count; $i++) {
    $name = $strings[$i]
    if (-not (& $isName $name) -or $seen[$name]) { continue }
    $seen[$name] = $true
    $default = ''
    $j = $i + 1
    if ($j -lt $strings.Count -and (& $isDefault $strings[$j])) { $default = $strings[$j]; $j++ }
    # The description follows the name, except for a few where it comes just before.
    $desc = if ($j -lt $strings.Count -and $strings[$j] -notmatch '^\[|^cig_' ) { $strings[$j] }
            elseif ($i -gt 0 -and $strings[$i - 1] -notmatch '^\[|^cig_|::') { $strings[$i - 1] }
            else { '' }
    [pscustomobject]@{ Setting = $name; Default = $default; Description = $desc }
}

# Feature switches stored elsewhere, each with its description just before the name.
$rows = @($rows) + @(foreach ($name in 'g_activate_subscriber_perk', 'g_enable_discount_perk') {
    $i = $text.IndexOf("`0$name`0", [StringComparison]::Ordinal)
    if ($i -lt 0) { continue }
    $e = $i; while ($e -gt 0 -and $text[$e - 1] -eq "`0") { $e-- }
    $a = $e; while ($a -gt 0 -and $text[$a - 1] -match '[\x20-\x7E\t]') { $a-- }
    [pscustomobject]@{ Setting = $name; Default = ''; Description = $text.Substring($a, $e - $a).Trim() }
})
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220

'Log lines:'
# Lines elsewhere in the exe that mention the perks: take the whole string around each hit.
$elsewhere = foreach ($needle in 'with subscriber perks', 'subscriber perk') {
    $i = $text.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase)
    while ($i -ge 0) {
        $a = $i; while ($a -gt 0 -and $text[$a - 1] -match '[\x20-\x7E\t]') { $a-- }
        $b = $i; while ($b -lt $text.Length -and $text[$b] -match '[\x20-\x7E\t]') { $b++ }
        if ($a -lt $from -or $a -ge $to) { $text.Substring($a, $b - $a).Trim() }
        $i = $text.IndexOf($needle, $b, [StringComparison]::OrdinalIgnoreCase)
    }
}
@($elsewhere) + $strings | Where-Object {
    ($_ -match '^\[Subscriber\]\[' -or $_ -match 'subscriber perk' -or $_ -match 'with subscriber perks' -or $_ -match '^Example: cig_subscriber') -and
    $_ -notmatch 'Error_'
} | Select-Object -Unique | ForEach-Object { "  $_" }
