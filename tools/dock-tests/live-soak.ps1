<#
.SYNOPSIS
  Random-input soak of the real dock on the real desktop with real input: moves, hovers, clicks, double and right
  clicks, drags, wheel turns and Escape, aimed mostly at the dock and what it has open.
.DESCRIPTION
  Starts through guard.ps1. Nothing that starts an app or changes a setting is clicked: left clicks go to stacks,
  tiles, the App Library and the ⋯ button, never to an app, a menu entry or a switch; right clicks open menus that
  Escape or a click elsewhere closes. After every burst it rests the way a user would (Escape twice, a click on
  Notepad beside the dock) and fails on a console error or uncaught exception in the dock page, a panel, menu, App
  Library or arrange mode still open, a point away from the dock that belongs to the dock, a click on Notepad that does
  not reach it, a dock that stopped drawing, or a dropped frame (a frame that took more than two refreshes while the
  soak ran). Every path ends with dotDock quit, Notepad closed, the taskbar visible and auto-hide on.
#>
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$Report,
  [Parameter(Mandatory)][string]$Shots,
  [int]$Events = 600,
  [int]$Seed = 1,
  [int]$CdpPort = 9447
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'Mouse.psm1') -Force
Import-Module (Join-Path $here 'Windows.psm1') -Force
Import-Module (Join-Path $here 'Capture.psm1') -Force
Import-Module (Join-Path $here 'Cdp.psm1') -Force
Import-Module (Join-Path $here '..\lib\WinShell.psm1') -Force
Add-Type -Namespace DotDock -Name SoakKeys -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int w, int h2, uint flags);
'@
New-Item -ItemType Directory -Force -Path $Shots | Out-Null

# Events between two rests.
$BURST = 25
# Share of pointer events aimed at something the dock draws; the rest land on Notepad beside it.
$AIMED = 0.8
# How far from an item's centre an aimed event may land, in physical px either way.
$JITTER = 10
# Time of one pointer move, short so the soak covers many events but still a visible, continuous motion.
$MOVE_MS = 120
$VK_ESCAPE = 0x1B
$NOTEPAD = @{ X = 60; Y = 80; W = 640; H = 420 }
$REST = @{ X = 300; Y = 300 }

$rng = New-Object System.Random $Seed
function Pick($list) { $list[$rng.Next($list.Count)] }

function Q([string]$Expression) { Invoke-Dock $CdpPort $Expression }
function Press-Escape {
  [DotDock.SoakKeys]::keybd_event($VK_ESCAPE, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40
  [DotDock.SoakKeys]::keybd_event($VK_ESCAPE, 0, 2, [UIntPtr]::Zero)
}

# Screen-px centres of what may be used, by how: anything on the dock may be hovered, turned and right-clicked; only
# items that open a panel may be left-clicked; open stacks and the library may be scrolled.
$SPOTS = @'
(() => {
  const s = devicePixelRatio;
  const at = (sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return [Math.round((screenX + r.x + r.width / 2) * s), Math.round((screenY + r.y + r.height / 2) * s)]; }).filter(([x, y]) => r0(x, y));
  const r0 = (x, y) => x > 0 && y > 0 && x < screen.width * s && y < screen.height * s;
  return {
    hover: at('.dock__row .slot, .popover[data-open="true"] .cell, .menu .menu__item'),
    click: at('.dock__row .slot[data-key^="stack:"], .dock__row .slot[data-key^="tile:"], .dock__row .slot[data-key="library"], .dock__row .slot[data-key="more"]'),
    right: at('.dock__row .slot'),
    wheel: at('.dock__row .slot, .popover[data-open="true"], .library'),
  };
})()
'@

$STATE = @'
(() => ({
  dock: !!document.querySelector('.dock__row .slot'),
  open: document.querySelectorAll('.popover[data-open="true"], .menu, .preview, .gallery, .prefs').length,
  library: !!document.querySelector('.library'),
  editing: !!document.querySelector('.edit-banner'),
}))()
'@

# Collects errors and frame times in the page; `on` is set only while the soak runs, so the dock idles as usual otherwise.
$COLLECT = @'
(() => {
  if (!window.__soak) {
    const s = { on: false, errors: [], frames: 0, dropped: 0, worst: 0, last: 0 };
    addEventListener('error', (e) => s.errors.push('error: ' + e.message));
    addEventListener('unhandledrejection', (e) => s.errors.push('rejection: ' + String(e.reason)));
    const original = console.error.bind(console);
    console.error = (...a) => { s.errors.push('console: ' + a.map(String).join(' ')); original(...a); };
    const tick = (t) => {
      if (!s.on) { s.last = 0; return; }
      if (s.last) { const d = t - s.last; s.frames++; if (d > s.budget) s.dropped++; s.worst = Math.max(s.worst, d); }
      s.last = t;
      requestAnimationFrame(tick);
    };
    s.start = (refreshMs) => { s.budget = 2 * refreshMs; if (!s.on) { s.on = true; requestAnimationFrame(tick); } };
    s.stop = () => { s.on = false; };
    window.__soak = s;
  }
  return true;
})()
'@

function Stop-Everything([int]$PadId) {
  Get-Process dotdock -ErrorAction SilentlyContinue | Stop-Process -Force
  if ($PadId) { Stop-Process -Id $PadId -Force -ErrorAction SilentlyContinue }
  if (-not (Test-TaskbarVisible)) { Show-Taskbar }
  if (-not (Get-TaskbarAutoHide)) { Set-TaskbarAutoHide $true }
}

$problems = New-Object System.Collections.ArrayList
$counts = @{}
$padId = 0
$summary = $null
try {
  $guard = & (Join-Path $here 'guard.ps1') -Exe $Exe -OutDir $Shots -CdpPort $CdpPort -Keep
  if ($LASTEXITCODE -ne 0) { throw "the start guard failed: $($guard -join '; ')" }
  $pad = Start-Process notepad -PassThru
  $padId = $pad.Id
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Process -Id $padId).MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Start-Sleep -Milliseconds 600
  [void][DotDock.SoakKeys]::SetWindowPos((Get-Process -Id $padId).MainWindowHandle, [IntPtr]::Zero, $NOTEPAD.X, $NOTEPAD.Y, $NOTEPAD.W, $NOTEPAD.H, 0x0040)
  [void](Q $COLLECT)
  $refreshMs = 1000 / [double](Get-CimInstance Win32_VideoController | Where-Object CurrentRefreshRate | Select-Object -First 1).CurrentRefreshRate
  [void](Q "window.__soak.start($refreshMs)")
  $w = [DotDock.Dpi]::GetSystemMetrics(0); $h = [DotDock.Dpi]::GetSystemMetrics(1)
  $away = @(@{ X = [int]($w / 2); Y = [int]($h / 3) }, @{ X = 20; Y = 20 }, @{ X = $w - 20; Y = [int]($h / 2) })
  $started = Get-Date
  $done = 0
  while ($done -lt $Events) {
    $spots = Q $SPOTS
    for ($i = 0; $i -lt $BURST -and $done -lt $Events; $i++, $done++) {
      $action = Pick @('move', 'move', 'move', 'click', 'click', 'right', 'double', 'drag', 'wheel', 'escape')
      $counts[$action] = 1 + [int]$counts[$action]
      $list = switch ($action) { 'click' { $spots.click } 'double' { $spots.click } 'right' { $spots.right } 'wheel' { $spots.wheel } default { $spots.hover } }
      if (@($list).Count -gt 0 -and $rng.NextDouble() -lt $AIMED) {
        $c = Pick @($list); $x = $c[0] + $rng.Next(-$JITTER, $JITTER + 1); $y = $c[1] + $rng.Next(-$JITTER, $JITTER + 1)
      } else {
        # Notepad beside the dock: a click there must always reach it.
        $x = $NOTEPAD.X + 40 + $rng.Next($NOTEPAD.W - 80); $y = $NOTEPAD.Y + 80 + $rng.Next($NOTEPAD.H - 120)
        if ($action -in @('double', 'right', 'drag')) { $action = 'move' }
      }
      switch ($action) {
        'move' { Move-Mouse $x $y $MOVE_MS }
        'click' { Move-Mouse $x $y $MOVE_MS; Invoke-Click $x $y }
        'double' { Invoke-Click $x $y; Start-Sleep -Milliseconds 90; Invoke-Click $x $y }
        'right' { Invoke-Click $x $y -Right }
        'drag' { $to = Pick @($spots.hover); Invoke-Drag $x $y $to[0] ($to[1] - 30) 300 }
        'wheel' { Move-Mouse $x $y $MOVE_MS; Invoke-Wheel (Pick @(-3, -1, 1, 3)) }
        'escape' { Press-Escape }
      }
    }
    # Rest the way a user would, then check nothing is left behind and the desktop takes clicks.
    Press-Escape; Start-Sleep -Milliseconds 120; Press-Escape
    Invoke-Click $REST.X $REST.Y
    Move-Mouse $REST.X $REST.Y 100
    Start-Sleep -Milliseconds 450
    $state = Q $STATE
    if ($null -eq $state) { [void]$problems.Add("after $done events: the dock page did not answer"); break }
    if (-not $state.dock) { [void]$problems.Add("after ${done}: the dock stopped drawing") }
    if ($state.open -gt 0) { [void]$problems.Add("after ${done}: $($state.open) panel(s) still open"); Save-Screen (Join-Path $Shots "soak-stuck-$done.png") }
    if ($state.library) { [void]$problems.Add("after ${done}: the App Library stayed open") }
    if ($state.editing) { [void]$problems.Add("after ${done}: arrange mode survived Escape and a click on Notepad") }
    if ((Get-Foreground).Process -ne 'Notepad') { [void]$problems.Add("after ${done}: a click on Notepad left $((Get-Foreground).Process) in front") }
    foreach ($p in $away) { if ((Get-WindowAt $p.X $p.Y).Process -eq 'dotdock') { [void]$problems.Add("after ${done}: the dock takes clicks at $($p.X), $($p.Y)") } }
    if (-not (Get-Process dotdock -ErrorAction SilentlyContinue)) { [void]$problems.Add("after ${done}: dotdock.exe is gone"); break }
    if ($problems.Count -gt 20) { break }
  }
  $seconds = ((Get-Date) - $started).TotalSeconds
  [void](Q 'window.__soak.stop()')
  Start-Sleep -Milliseconds 100
  $page = Q '(() => ({ errors: window.__soak.errors.slice(0, 20), errorCount: window.__soak.errors.length, frames: window.__soak.frames, dropped: window.__soak.dropped, worst: Math.round(window.__soak.worst) }))()'
  foreach ($e in @($page.errors)) { [void]$problems.Add("page: $e") }
  if ($page.dropped -gt 0) { [void]$problems.Add("$($page.dropped) dropped frame(s), worst $($page.worst) ms") }
  Save-Screen (Join-Path $Shots 'soak-end.png')
  $summary = [pscustomobject]@{ Events = $done; Seconds = [int]$seconds; Counts = (($counts.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name) $($_.Value)" }) -join ', '); Frames = $page.frames; Dropped = $page.dropped; WorstMs = $page.worst; Errors = $page.errorCount; Problems = $problems.Count }
} catch {
  [void]$problems.Add("run stopped: $($_.Exception.Message)")
} finally {
  Stop-Everything $padId
}
$lines = @("`n## Live random soak $(Get-Date -Format s), seed $Seed`n", '| Measure | Value |', '|---|---|')
if ($summary) {
  $lines += "| Events | $($summary.Events) in $($summary.Seconds) s ($($summary.Counts)) |"
  $lines += "| Frames while the soak ran | $($summary.Frames), dropped $($summary.Dropped), worst $($summary.WorstMs) ms (refresh $([math]::Round($refreshMs, 1)) ms) |"
  $lines += "| Page errors | $($summary.Errors) |"
}
$lines += "| Problems | $($problems.Count) |"
$lines += "| Ended clean | dotdock running: $([bool](Get-Process dotdock -ErrorAction SilentlyContinue)); taskbar visible: $(Test-TaskbarVisible); auto-hide: $(Get-TaskbarAutoHide) |"
foreach ($p in $problems) { $lines += "- $p" }
Add-Content -Path $Report -Value ($lines -join "`n")
$lines
exit $problems.Count
