<#
.SYNOPSIS
  Soak of the real dock: runs it for -Minutes and samples, once a minute, whether it is alive, its CPU use and its
  memory (dotdock.exe plus its WebView2 processes). Writes one CSV row per sample and a summary to the report.
.DESCRIPTION
  Starts through guard.ps1, so a dock that covers the screen never stays up. CPU is the share of one core over the
  minute, the number Task Manager would show divided by the core count times the core count; idle means nothing is
  hovered. Every path ends with dotDock quit, the taskbar visible and auto-hide on.
#>
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$Report,
  [Parameter(Mandatory)][string]$Csv,
  [int]$Minutes = 120,
  [int]$SampleSeconds = 60,
  [int]$CdpPort = 9447
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here '..\lib\WinShell.psm1') -Force

function Tree {
  $root = Get-Process dotdock -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $root) { return @() }
  $children = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match 'webview-exe-name=dotdock\.exe' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  @($root) + @($children | Where-Object { $_ })
}

$outDir = Split-Path -Parent $Csv
$guard = & (Join-Path $here 'guard.ps1') -Exe $Exe -OutDir $outDir -CdpPort $CdpPort -Keep
if ($LASTEXITCODE -ne 0) { Add-Content $Report "Soak not started: the start guard failed.`n$($guard -join "`n")"; exit 1 }
$pid0 = (Get-Process dotdock | Select-Object -First 1).Id
Set-Content -Path $Csv -Value 'minute,alive,dock_cpu_pct,all_cpu_pct,dock_private_mb,all_private_mb,handles'
$crashes = 0
try {
  Start-Sleep -Seconds 30
  $last = Tree; $lastHost = ($last | Where-Object { $_.Id -eq $pid0 }).TotalProcessorTime.TotalSeconds
  $lastAll = ($last | Measure-Object -Property { $_.TotalProcessorTime.TotalSeconds } -Sum).Sum
  $lastAt = Get-Date
  for ($m = 1; $m -le [int]($Minutes * 60 / $SampleSeconds); $m++) {
    Start-Sleep -Seconds $SampleSeconds
    $now = Get-Date; $wall = ($now - $lastAt).TotalSeconds; $lastAt = $now
    $tree = Tree
    $hostProc = $tree | Where-Object { $_.Id -eq $pid0 }
    if (-not $hostProc) { $crashes++; Add-Content $Csv "$m,0,,,,,"; break }
    $h = $hostProc.TotalProcessorTime.TotalSeconds
    $all = ($tree | Measure-Object -Property { $_.TotalProcessorTime.TotalSeconds } -Sum).Sum
    $line = '{0},1,{1:N3},{2:N3},{3:N1},{4:N1},{5}' -f $m, (100 * ($h - $lastHost) / $wall), (100 * ($all - $lastAll) / $wall),
      ($hostProc.PrivateMemorySize64 / 1MB), (($tree | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB), $hostProc.HandleCount
    Add-Content $Csv $line
    $lastHost = $h; $lastAll = $all
  }
} finally {
  Get-Process dotdock -ErrorAction SilentlyContinue | Stop-Process -Force
  if (-not (Test-TaskbarVisible)) { Show-Taskbar }
  if (-not (Get-TaskbarAutoHide)) { Set-TaskbarAutoHide $true }
}
$rows = Import-Csv $Csv | Where-Object { $_.alive -eq '1' }
$first = $rows | Select-Object -First 5; $lastRows = $rows | Select-Object -Last 5
$avg = { param($set, $col) ($set | Measure-Object -Property $col -Average).Average }
$summary = @"

## Soak $(Get-Date -Format s), $($rows.Count) samples of $SampleSeconds s

| Measure | Value |
|---|---|
| Crashes | $crashes |
| dotdock.exe CPU, mean | $('{0:N3}' -f (& $avg $rows 'dock_cpu_pct')) % of one core |
| dotdock.exe + WebView2 CPU, mean | $('{0:N3}' -f (& $avg $rows 'all_cpu_pct')) % of one core |
| dotdock.exe private memory, first 5 / last 5 min | $('{0:N1}' -f (& $avg $first 'dock_private_mb')) / $('{0:N1}' -f (& $avg $lastRows 'dock_private_mb')) MB |
| All dock processes private memory, first 5 / last 5 min | $('{0:N1}' -f (& $avg $first 'all_private_mb')) / $('{0:N1}' -f (& $avg $lastRows 'all_private_mb')) MB |
| Handles, first / last | $($first[0].handles) / $($lastRows[-1].handles) |
"@
Add-Content $Report $summary
Write-Output $summary
exit $crashes
