<#
.SYNOPSIS
  Measures the idle CPU use of one app process and all of its child processes (WebView2), for the "idle CPU
  under 0.2 % per process" check.
.DESCRIPTION
  Samples the total processor time of every process in the tree at the start and the end of the window. CPU % is
  of the whole machine (all logical processors), as Task Manager shows it. Prints one JSON line per process and
  a total.
.PARAMETER Id
  Process id of the app.
.PARAMETER Seconds
  Length of the measuring window.
#>
param(
  [Parameter(Mandatory)][int]$Id,
  [int]$Seconds = 60
)
$ErrorActionPreference = 'Stop'

function Get-Tree([int]$Root) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $ids = [System.Collections.Generic.List[int]]::new()
  $ids.Add($Root)
  for ($i = 0; $i -lt $ids.Count; $i++) {
    $all | Where-Object { $_.ParentProcessId -eq $ids[$i] } | ForEach-Object { $ids.Add([int]$_.ProcessId) }
  }
  return $ids
}

function Get-Sample([int[]]$Ids) {
  $out = @{}
  foreach ($p in Get-Process -Id $Ids -ErrorAction SilentlyContinue) {
    $out[$p.Id] = [pscustomobject]@{ Name = $p.ProcessName; Cpu = $p.TotalProcessorTime.TotalMilliseconds }
  }
  return $out
}

$ids = Get-Tree $Id
$cores = [Environment]::ProcessorCount
$a = Get-Sample $ids
$clock = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$b = Get-Sample $ids
$wall = $clock.Elapsed.TotalMilliseconds
$totalCpu = 0.0
foreach ($pid_ in $b.Keys) {
  if (-not $a.ContainsKey($pid_)) { continue }
  $cpu = $b[$pid_].Cpu - $a[$pid_].Cpu
  $totalCpu += $cpu
  [pscustomobject]@{ id = $pid_; name = $b[$pid_].Name; cpuPercent = [Math]::Round(100 * $cpu / ($wall * $cores), 3) } | ConvertTo-Json -Compress
}
[pscustomobject]@{ total = $true; processes = $b.Count; seconds = [Math]::Round($wall / 1000, 1); cores = $cores; cpuPercent = [Math]::Round(100 * $totalCpu / ($wall * $cores), 3) } | ConvertTo-Json -Compress
