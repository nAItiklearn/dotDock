<#
.SYNOPSIS
  Hard-kill test of the taskbar restore guarantees (dock milestone D0, docs/DOCK_SPEC.md section 3).
.DESCRIPTION
  Runs against the REAL taskbar. A probe process (the shell crate's `dock_guard_probe` example)
  stands in for the dock: it hides the taskbar through dock_guard, with its sentinel watching.
  Each scenario then ends the probe in one way and asserts that, within the timeout, the taskbar
  is visible, "automatically hide the taskbar" is what it was before the hide, and the marker
  file is gone. Scenarios run with the real dotdock-sentinel.exe next to the probe ("bin") and
  with the program hosting the sentinel itself ("self": the portable exe, a dev run).

  Before the hide, auto-hide equals the snapshot's value (the default) or, with
  -StartAutoHide opposite, the other value: that proves the restore puts back what the user had,
  not a fixed value, and exercises the auto-hide path even where the snapshot value is already on.

  The taskbar is shown and auto-hide put back to the snapshot value after every run and at the
  end, also when a run fails or the script is interrupted. Prints a markdown table.
  Exits 1 when any run failed.

  Build first (from apps/desktop/src-tauri), or pass -Build:
    cargo build -p dotdock-sentinel
    cargo build -p dotdock-shell --examples
.PARAMETER Runs
  How many times each scenario is repeated.
.PARAMETER BinDir
  Cargo output folder holding dotdock-sentinel.exe and examples\dock_guard_probe.exe.
.PARAMETER TimeoutSeconds
  How long a restore may take before the run counts as failed.
.PARAMETER StartAutoHide
  "snapshot" (default) or "opposite": the auto-hide value to set before each hide.
.PARAMETER Build
  Build the sentinel and the probe first.
.PARAMETER Toolchain
  Rust toolchain for -Build, for example stable-x86_64-pc-windows-gnu (local builds use GNU, D-005).
#>
param(
    [int]$Runs = 3,
    [string]$BinDir = (Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\target\debug'),
    [int]$TimeoutSeconds = 10,
    [ValidateSet('snapshot', 'opposite')][string]$StartAutoHide = 'snapshot',
    [switch]$Build,
    [string]$Toolchain
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

$timeoutMs = $TimeoutSeconds * 1000
# The core re-checks its sentinel this often; a respawn is expected within a few of these.
$respawnMs = 5000
$srcTauri = Join-Path $PSScriptRoot '..\apps\desktop\src-tauri'

if ($Build) {
    # Modern MinGW-w64 ahead of the old C:\MinGW one, as tools/env-gnu.sh does for bash.
    $winlibs = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'BrechtSanders.WinLibs*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($winlibs) { $env:PATH = (Join-Path $winlibs.FullName 'mingw64\bin') + ';' + $env:PATH }
    $plus = @(if ($Toolchain) { "+$Toolchain" })
    Push-Location $srcTauri
    try {
        & cargo @plus build -p dotdock-sentinel
        if ($LASTEXITCODE -ne 0) { throw 'cargo build of the sentinel failed' }
        & cargo @plus build -p dotdock-shell --examples
        if ($LASTEXITCODE -ne 0) { throw 'cargo build of the probe failed' }
    } finally { Pop-Location }
}

$sentinelExe = Join-Path $BinDir 'dotdock-sentinel.exe'
$probeExe = Join-Path $BinDir 'examples\dock_guard_probe.exe'
foreach ($file in @($sentinelExe, $probeExe)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing $file. Build first or pass -Build." }
}

$snapshot = Get-Content -LiteralPath (Get-SnapshotPath) -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not ($snapshot.PSObject.Properties.Name -contains 'taskbarAutoHide') -or $null -eq $snapshot.taskbarAutoHide) {
    throw 'The snapshot has no taskbarAutoHide. Run tools/snapshot-windows.ps1 first.'
}
$original = [bool]$snapshot.taskbarAutoHide
# What auto-hide is just before each hide, and so what each restore must give back.
$expected = if ($StartAutoHide -eq 'opposite') { -not $original } else { $original }
if ((Get-TaskbarAutoHide) -ne $original) { throw "Auto-hide is not the snapshot value ($original). Fix that before testing." }
if (Test-Path -LiteralPath (Get-TaskbarMarkerPath)) { throw 'A taskbar marker already exists. Run tools/restore-windows.ps1 first.' }

# Each variant gets its own folder: "bin" has the sentinel exe beside the probe, "self" does not.
$stage = Join-Path ([IO.Path]::GetTempPath()) ('dotdock-d0-' + [guid]::NewGuid().ToString('N'))
$variants = @{ bin = Join-Path $stage 'bin'; self = Join-Path $stage 'self' }
foreach ($dir in $variants.Values) { New-Item -ItemType Directory -Path $dir | Out-Null }
foreach ($dir in $variants.Values) { Copy-Item -LiteralPath $probeExe -Destination $dir }
Copy-Item -LiteralPath $sentinelExe -Destination $variants['bin']

function Get-StagedProcesses {
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($stage, [StringComparison]::OrdinalIgnoreCase) }
}

# The watcher of one probe: "<exe> [--sentinel] watch <pid>".
function Get-Watcher([int]$ProbePid) {
    # The comma keeps a single match an array, so .Count and [0] work for zero, one or two.
    , @(Get-StagedProcesses | Where-Object { $_.CommandLine -match "\bwatch $ProbePid\s*$" })
}

function Reset-State {
    foreach ($process in @(Get-StagedProcesses)) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath (Get-TaskbarMarkerPath) -Force -ErrorAction SilentlyContinue
    Show-Taskbar
    Set-TaskbarAutoHide $expected
}

function Wait-Until([scriptblock]$Condition, [int]$LimitMs) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $LimitMs) {
        if (& $Condition) { return $watch.ElapsedMilliseconds }
        Start-Sleep -Milliseconds 5
    }
    return $null
}

function Test-Restored {
    ((Test-TaskbarVisible) -eq $true) -and ((Get-TaskbarAutoHide) -eq $expected) -and -not (Test-Path -LiteralPath (Get-TaskbarMarkerPath))
}

function Start-Probe([string]$Variant, [string]$Mode) {
    $out = Join-Path $stage "$Variant-$Mode-$([guid]::NewGuid().ToString('N')).out"
    $err = "$out.err"
    $process = Start-Process -FilePath (Join-Path $variants[$Variant] 'dock_guard_probe.exe') -ArgumentList $Mode `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    # Without this, ExitCode can read as empty after the process has ended.
    $null = $process.Handle
    [pscustomobject]@{ Process = $process; Out = $out; Err = $err }
}

function Wait-Hidden($Probe) {
    $ready = Wait-Until { (Test-Path -LiteralPath $Probe.Out) -and ((Get-Content -LiteralPath $Probe.Out -Raw) -match 'hidden pid=') } $timeoutMs
    if ($null -eq $ready) {
        $why = if (Test-Path -LiteralPath $Probe.Err) { Get-Content -LiteralPath $Probe.Err -Raw } else { '' }
        throw "the probe never reported hiding the taskbar. $why"
    }
    # The marker is on disk, the taskbar is really hidden and a sentinel is watching.
    if (-not (Test-Path -LiteralPath (Get-TaskbarMarkerPath))) { throw 'no marker while hidden' }
    if ((Test-TaskbarVisible) -ne $false) { throw 'the taskbar is not hidden after hide_for_dock' }
    if ((Get-TaskbarAutoHide) -ne $true) { throw 'auto-hide is not on while hidden' }
    if ((Get-Watcher $Probe.Process.Id).Count -ne 1) { throw 'expected exactly one sentinel watching the probe' }
}

# After a restore the sentinel of that probe must be gone too: it ends when its core has ended.
function Wait-WatcherGone($Probe) {
    $gone = Wait-Until { (Get-Watcher $Probe.Process.Id).Count -eq 0 } $timeoutMs
    if ($null -eq $gone) { throw 'the sentinel is still running after the probe ended' }
}

function Wait-Restored {
    $ms = Wait-Until { Test-Restored } $timeoutMs
    if ($null -eq $ms) {
        throw ("not restored within $TimeoutSeconds s: visible=$(Test-TaskbarVisible) autoHide=$(Get-TaskbarAutoHide) " +
            "(want $expected) marker=$(Test-Path -LiteralPath (Get-TaskbarMarkerPath))")
    }
    return $ms
}

# The probe ends by itself after holding the taskbar hidden for a moment.
function Wait-Exited($Probe) {
    if (-not $Probe.Process.WaitForExit($timeoutMs)) { throw 'the probe did not end by itself' }
}

# Each scenario returns the milliseconds from its trigger (the kill, or the probe ending) to a verified restore.
$scenarios = @(
    @{ Name = 'hard kill (Stop-Process -Force)'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide'; Wait-Hidden $p
        Stop-Process -Id $p.Process.Id -Force
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } },
    @{ Name = 'tree kill (taskkill /F /T)'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide'; Wait-Hidden $p
        & taskkill.exe /F /T /PID $p.Process.Id | Out-Null
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } },
    @{ Name = 'exit without restoring'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide-and-exit'; Wait-Hidden $p
        Wait-Exited $p
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } },
    @{ Name = 'panic with the taskbar hidden'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide-and-panic'; Wait-Hidden $p
        Wait-Exited $p
        if ($p.Process.ExitCode -eq 0) { throw 'the probe did not panic' }
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } },
    @{ Name = 'clean quit restores by itself'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide-and-quit'; Wait-Hidden $p
        Wait-Exited $p
        if ($p.Process.ExitCode -ne 0) { throw 'the probe did not quit cleanly' }
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } },
    @{ Name = 'sentinel killed, respawned, then core killed'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide'; Wait-Hidden $p
        $first = (Get-Watcher $p.Process.Id)[0].ProcessId
        Stop-Process -Id $first -Force
        $back = Wait-Until { $w = Get-Watcher $p.Process.Id; $w.Count -eq 1 -and $w[0].ProcessId -ne $first } $respawnMs
        if ($null -eq $back) { throw "no new sentinel within $respawnMs ms of killing the first" }
        Stop-Process -Id $p.Process.Id -Force
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } },
    @{ Name = 'sentinel and core both killed, next start recovers'; Variants = 'bin', 'self'; Run = {
        param($v)
        $p = Start-Probe $v 'hide'; Wait-Hidden $p
        # Sentinel first, then the core, well inside the respawn period: nobody is left to restore.
        Stop-Process -Id (Get-Watcher $p.Process.Id)[0].ProcessId -Force
        Stop-Process -Id $p.Process.Id -Force
        Start-Sleep -Milliseconds 1500
        if ((Test-TaskbarVisible) -ne $false -or -not (Test-Path -LiteralPath (Get-TaskbarMarkerPath))) {
            throw 'the dirty state was not reproduced (taskbar already back)'
        }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $r = Start-Probe $v 'recover'
        if (-not $r.Process.WaitForExit($timeoutMs)) { throw 'recover did not finish' }
        $ms = $watch.ElapsedMilliseconds
        if ((Get-Content -LiteralPath $r.Out -Raw) -notmatch 'recovery Restored') { throw "unexpected recover output: $(Get-Content -LiteralPath $r.Out -Raw)" }
        if (-not (Test-Restored)) { throw 'recover did not restore the taskbar' }
        $ms } },
    @{ Name = 'a second start leaves a live owner alone'; Variants = 'bin'; Run = {
        param($v)
        $p = Start-Probe $v 'hide'; Wait-Hidden $p
        $r = Start-Probe $v 'recover'
        if (-not $r.Process.WaitForExit($timeoutMs)) { throw 'recover did not finish' }
        if ((Get-Content -LiteralPath $r.Out -Raw) -notmatch 'recovery OwnerRunning') { throw "unexpected recover output: $(Get-Content -LiteralPath $r.Out -Raw)" }
        if ((Test-TaskbarVisible) -ne $false -or -not (Test-Path -LiteralPath (Get-TaskbarMarkerPath))) { throw 'recover touched a live dock' }
        Stop-Process -Id $p.Process.Id -Force
        $ms = Wait-Restored; Wait-WatcherGone $p; $ms } }
)

$results = @()
try {
    Reset-State
    foreach ($scenario in $scenarios) {
        foreach ($variant in $scenario.Variants) {
            for ($run = 1; $run -le $Runs; $run++) {
                $result = [pscustomobject]@{ Scenario = $scenario.Name; Variant = $variant; Run = $run; Pass = $false; Ms = $null; Detail = '' }
                try {
                    $result.Ms = & $scenario.Run $variant
                    $result.Pass = $true
                } catch {
                    $result.Detail = $_.Exception.Message
                } finally {
                    Reset-State
                }
                $results += $result
                $mark = if ($result.Pass) { 'pass' } else { 'FAIL' }
                Write-Output ("[{0}] {1} / {2} / run {3}: {4} {5}" -f $mark, $scenario.Name, $variant, $run, $result.Ms, $result.Detail)
            }
        }
    }
} finally {
    Reset-State
    # Whatever value the runs used, the machine ends with the snapshot's.
    Set-TaskbarAutoHide $original
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# Explorer applies the last auto-hide change a moment after it is requested.
$finalOk = $null -ne (Wait-Until { ((Test-TaskbarVisible) -eq $true) -and ((Get-TaskbarAutoHide) -eq $original) } $timeoutMs)
Write-Output ''
Write-Output '| Exit path | Variant | Runs | Passed | Restored after (ms): min / median / max |'
Write-Output '|---|---|---|---|---|'
foreach ($group in $results | Group-Object Scenario, Variant) {
    $times = @($group.Group | Where-Object { $_.Pass } | ForEach-Object { [int]$_.Ms } | Sort-Object)
    $span = if ($times.Count) { '{0} / {1} / {2}' -f $times[0], $times[[int][math]::Floor(($times.Count - 1) / 2)], $times[-1] } else { 'n/a' }
    Write-Output ('| {0} | {1} | {2} | {3} | {4} |' -f $group.Group[0].Scenario, $group.Group[0].Variant, $group.Count, @($group.Group | Where-Object { $_.Pass }).Count, $span)
}
$failed = @($results | Where-Object { -not $_.Pass }).Count
Write-Output ''
Write-Output ("Taskbar visible and auto-hide = {0} at the end: {1}" -f $original, $finalOk)
Write-Output ("{0} of {1} runs passed." -f ($results.Count - $failed), $results.Count)
if ($failed -gt 0 -or -not $finalOk) { exit 1 }
