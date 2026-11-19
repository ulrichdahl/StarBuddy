# overlay-mem.ps1 - memory footprint of the running StarBuddy client (Windows).
#
# Measures starbuddy-client.exe / StarBuddy.exe and every descendant
# msedgewebview2.exe process (found by walking parent PIDs). For each it
# prints the WebView2 role from --type= on the command line (none = browser),
# WorkingSet and PrivateMemorySize in MB, then totals. Private bytes is the
# better number to compare; working set counts shared pages in every process.
#
# Suggested protocol (run each, compare the totals before and after a change):
#   a) only the main window open
#   b) all overlays open
#   c) overlays opened, then hidden; wait 30 s before measuring
#
# Usage: .\overlay-mem.ps1 [-Watch N]
param([int]$Watch = 0)

function Get-Report {
    $all = @(Get-CimInstance Win32_Process)
    $client = $all | Where-Object { $_.Name -in @('starbuddy-client.exe', 'StarBuddy.exe') } | Select-Object -First 1
    if (-not $client) {
        Write-Host 'StarBuddy client is not running (no starbuddy-client.exe / StarBuddy.exe found).'
        return $false
    }

    $byParent = @{}
    foreach ($p in $all) {
        $key = [int]$p.ParentProcessId
        if (-not $byParent.ContainsKey($key)) { $byParent[$key] = New-Object System.Collections.ArrayList }
        [void]$byParent[$key].Add($p)
    }

    $procs = New-Object System.Collections.ArrayList
    [void]$procs.Add($client)
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue([int]$client.ProcessId)
    $seen = @{ ([int]$client.ProcessId) = $true }
    while ($queue.Count -gt 0) {
        $id = $queue.Dequeue()
        if (-not $byParent.ContainsKey($id)) { continue }
        foreach ($c in $byParent[$id]) {
            $cid = [int]$c.ProcessId
            if ($seen.ContainsKey($cid)) { continue }
            $seen[$cid] = $true
            $queue.Enqueue($cid)
            if ($c.Name -eq 'msedgewebview2.exe') { [void]$procs.Add($c) }
        }
    }

    $rows = foreach ($p in $procs) {
        $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if (-not $gp) { continue }
        $role = ''
        if ($p.Name -eq 'msedgewebview2.exe') {
            $role = 'browser'
            if ($p.CommandLine -match '--type=([\w-]+)') { $role = $Matches[1] }
        }
        [pscustomobject]@{
            PID        = [int]$p.ProcessId
            Name       = $p.Name
            Role       = $role
            WorkingMB  = [math]::Round($gp.WorkingSet64 / 1MB, 1)
            PrivateMB  = [math]::Round($gp.PrivateMemorySize64 / 1MB, 1)
        }
    }

    $rows | Format-Table -AutoSize | Out-String | Write-Host
    $ws = ($rows | Measure-Object WorkingMB -Sum).Sum
    $pm = ($rows | Measure-Object PrivateMB -Sum).Sum
    Write-Host ('TOTAL  WorkingSet {0:N1} MB   Private {1:N1} MB   ({2} processes)' -f $ws, $pm, @($rows).Count)
    return $true
}

if ($Watch -le 0) {
    if (-not (Get-Report)) { exit 1 }
} else {
    while ($true) {
        Write-Host ('== ' + (Get-Date -Format 'HH:mm:ss'))
        if (-not (Get-Report)) { exit 1 }
        Start-Sleep -Seconds $Watch
    }
}
