<#
  Lists the subscriber perks baked into a Star Citizen build: the cig_subscriber.* settings
  with their default values and descriptions, the perk feature switches, the subscriber
  tiers, and the log lines the perks can write.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\Find-SubscriberPerks.ps1            # PTU
    powershell -ExecutionPolicy Bypass -File .\Find-SubscriberPerks.ps1 -Channel LIVE
    powershell -ExecutionPolicy Bypass -File .\Find-SubscriberPerks.ps1 -Root 'D:\Games\StarCitizen'
#>
param(
    [string]$Root = 'C:\Program Files\Roberts Space Industries\StarCitizen',
    [string]$Channel = 'PTU'
)

# Feature switches, found by exact name. A later build may add more.
$switches = 'g_activate_subscriber_perk', 'g_enable_discount_perk'

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

function Test-Printable([char]$c) { ($c -ge ' ' -and $c -le '~') -or $c -eq "`t" }

# Every offset where $needle occurs.
function Find-All([string]$needle, [switch]$IgnoreCase) {
    $mode = if ($IgnoreCase) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    $i = $text.IndexOf($needle, $mode)
    while ($i -ge 0) { $i; $i = $text.IndexOf($needle, $i + $needle.Length, $mode) }
}

# The whole readable string around an offset, with where it starts and ends.
function Get-StringAt([int]$i) {
    $a = $i; while ($a -gt 0 -and (Test-Printable $text[$a - 1])) { $a-- }
    $b = $i; while ($b -lt $text.Length -and (Test-Printable $text[$b])) { $b++ }
    [pscustomobject]@{ Start = $a; End = $b; Value = $text.Substring($a, $b - $a).Trim() }
}

# The string stored right after / right before another, across the zero padding between them.
function Get-Next($s) {
    $i = $s.End; $stop = [Math]::Min($text.Length, $i + 16)
    while ($i -lt $stop -and $text[$i] -eq [char]0) { $i++ }
    if ($i -lt $text.Length -and $i -gt $s.End -and (Test-Printable $text[$i])) { Get-StringAt $i }
}
function Get-Previous($s) {
    $i = $s.Start; $stop = [Math]::Max(0, $i - 16)
    while ($i -gt $stop -and $text[$i - 1] -eq [char]0) { $i-- }
    if ($i -gt 0 -and $i -lt $s.Start -and (Test-Printable $text[$i - 1])) { Get-StringAt ($i - 1) }
}

$isDefault = '^[\d.]+(\s*,\s*[\d.]+)+$'
$notDescription = '^\[|^cig_|^g_|::'

# Settings: each name is stored next to its default value (if any) and its description,
# which mostly follows the name and sometimes comes just before it.
$settings = [ordered]@{}
foreach ($i in Find-All 'cig_subscriber.') {
    $s = Get-StringAt $i
    if ($s.Value -notmatch '^cig_subscriber\.[\w.]+$' -or $settings.Contains($s.Value)) { continue }
    $default = ''
    $next = Get-Next $s
    if ($next -and $next.Value -match $isDefault) { $default = $next.Value; $next = Get-Next $next }
    $previous = Get-Previous $s
    $desc = if ($next -and $next.Value -notmatch $notDescription -and $next.Value -notmatch $isDefault) { $next.Value }
            elseif ($previous -and $previous.Value -notmatch $notDescription -and $previous.Value -notmatch $isDefault) { $previous.Value }
            else { '' }
    $settings[$s.Value] = [pscustomobject]@{ Setting = $s.Value; Default = $default; Description = $desc }
}
# Switches: the description comes just before the name.
foreach ($name in $switches) {
    foreach ($i in Find-All "`0$name`0") {
        $s = Get-StringAt ($i + 1)
        $previous = Get-Previous $s
        $settings[$name] = [pscustomobject]@{ Setting = $name; Default = ''; Description = if ($previous) { $previous.Value } else { '' } }
        break
    }
}

# Subscriber tiers, as badges.
$tiers = @(Find-All 'RSI_BADGE_SUBSCRIBER' | ForEach-Object { (Get-StringAt $_).Value } |
    Where-Object { $_ -match '^RSI_BADGE_SUBSCRIBER\w*$' } | Select-Object -Unique)

# Log lines about the perks and the party's subscriber tier.
$descriptions = @($settings.Values | ForEach-Object { $_.Description })
$lines = @(foreach ($needle in '[Subscriber][', 'subscriber perk', 'party subscriber tier', 'Example: cig_subscriber') {
    Find-All $needle -IgnoreCase | ForEach-Object { (Get-StringAt $_).Value }
}) | Where-Object { $_ -notmatch 'Error_|::|^g_|^cig_' -and $descriptions -notcontains $_ } | Select-Object -Unique

if ($settings.Count -eq 0 -and $lines.Count -eq 0) { 'No subscriber perks in this build.'; exit 0 }

'Settings:'
$settings.Values | Format-Table -AutoSize -Wrap | Out-String -Width 220

'Tiers (badges):'
if ($tiers) { $tiers | ForEach-Object { "  $_" } } else { '  (none)' }
''

'Log lines:'
if ($lines) { $lines | ForEach-Object { "  $_" } } else { '  (none)' }
