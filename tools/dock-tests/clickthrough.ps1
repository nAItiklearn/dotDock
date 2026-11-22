<#
.SYNOPSIS
  Real-desktop test: with the dock running, clicks outside the dock reach the windows below, with and without a
  dock popover open, and the kill switch (Ctrl+Alt+Shift+D) quits dotDock and puts the taskbar back.
.DESCRIPTION
  Uses the real mouse and keyboard at a human pace. Writes one PASS/FAIL line per step to the log and stops dotDock
  on any failure, so a broken dock never stays on screen. Needs dotDock started with
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<CdpPort>, only to read what the dock shows.
#>
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$Log,
  [int]$CdpPort = 9333
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'Mouse.psm1') -Force
Import-Module (Join-Path $here 'Windows.psm1') -Force
Import-Module (Join-Path $here '..\lib\WinShell.psm1') -Force
Add-Type -Namespace DotDock -Name Keys -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int w, int h2, uint flags);
'@
$cdp = Join-Path $here 'cdp-eval.mjs'
$failed = 0

function Step([string]$Caption, [scriptblock]$Check) {
  $started = Get-Date
  $ok = $false
  try { $ok = [bool](& $Check) } catch { $ok = $false; $Caption += " ($($_.Exception.Message))" }
  $ms = [int]((Get-Date) - $started).TotalMilliseconds
  $line = '| {0} | {1} | {2} ms |' -f $Caption, $(if ($ok) { 'PASS' } else { 'FAIL' }), $ms
  Add-Content -Path $Log -Value $line
  Write-Output $line
  if (-not $ok) { $script:failed++ }
  Start-Sleep -Milliseconds 700
}

function Dock([string]$Expression) { (& node $cdp $CdpPort 'dock.html' $Expression) -join '' | ConvertFrom-Json }

function Wait-For([scriptblock]$Condition, [int]$LimitMs = 3000) {
  $deadline = (Get-Date).AddMilliseconds($LimitMs)
  while ((Get-Date) -lt $deadline) { if (& $Condition) { return $true }; Start-Sleep -Milliseconds 50 }
  return $false
}

function Stop-DotDock { Get-Process dotdock -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 2 }

Add-Content -Path $Log -Value "`n## Click-through and kill switch, $(Get-Date -Format s)`n`n| Step | Result | Time |`n|---|---|---|"

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe)
Step 'dotDock starts and the dock shows its bar' { Wait-For { try { (Dock 'document.querySelector(".dock") !== null') -eq $true } catch { $false } } 20000 }

# A real app window next to the dock, so there is something to click through to.
$notepad = Start-Process notepad -PassThru
[void](Wait-For { (Get-Process -Id $notepad.Id -ErrorAction SilentlyContinue).MainWindowHandle -ne 0 } 8000)
Start-Sleep -Milliseconds 800
$pad = Get-Process notepad | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
[void][DotDock.Keys]::SetWindowPos($pad.MainWindowHandle, [IntPtr]::Zero, 80, 560, 520, 380, 0x0040)
$bar = Dock '(() => { const r = document.querySelector(".dock").getBoundingClientRect(); const s = devicePixelRatio; return { x: r.x * s, y: r.y * s, w: r.width * s, h: r.height * s }; })()'
$barMidY = [int]($bar.y + $bar.h / 2)
$besideBar = @{ X = 300; Y = 900 }

Step 'Clicked the Notepad window left of the dock: Notepad gets the click' {
  Invoke-Click 300 700
  Wait-For { (Get-Foreground).Process -eq 'Notepad' }
}
Step 'Clicked the desktop beside the dock (no popover open): it reaches the desktop, not the dock' {
  Invoke-Click ([int]($bar.x - 60)) $barMidY
  Wait-For { (Get-WindowAt ([int]($bar.x - 60)) $barMidY).Process -ne 'dotdock' -and (Get-Foreground).Process -ne 'dotdock' }
}
Step 'Right-clicked the first app on the dock: its menu opens' {
  Invoke-Click ([int]($bar.x + $bar.h * 1.6)) $barMidY -Right
  Wait-For { (Dock 'document.querySelector(".menu") !== null') -eq $true }
}
Step 'With the menu open, clicked Notepad: Notepad gets the click and the menu closes' {
  Invoke-Click $besideBar.X 700
  (Wait-For { (Get-Foreground).Process -eq 'Notepad' }) -and (Wait-For { (Dock 'document.querySelector(".menu") === null') -eq $true })
}
Step 'With the menu open again, the screen outside the dock and the menu is not the dock window' {
  Invoke-Click ([int]($bar.x + $bar.h * 1.6)) $barMidY -Right
  [void](Wait-For { (Dock 'document.querySelector(".menu") !== null') -eq $true })
  Move-Mouse 1700 300
  Start-Sleep -Milliseconds 300
  $at = Get-WindowAt 1700 300
  Invoke-Click 300 700
  $at.Process -ne 'dotdock'
}
Step 'Clicked Chrome in the dock: Chrome comes to the front' {
  $chrome = Dock '(() => { const cells = [...document.querySelectorAll(".dock__row .cell")]; const c = cells.find((e) => /chrome/i.test(e.getAttribute("aria-label") ?? "")); if (!c) return null; const r = c.getBoundingClientRect(); const s = devicePixelRatio; return { x: (r.x + r.width / 2) * s, y: (r.y + r.height / 2) * s }; })()'
  if ($null -eq $chrome) { throw 'no Chrome on the dock' }
  Invoke-Click ([int]$chrome.x) ([int]$chrome.y)
  Wait-For { (Get-Foreground).Process -eq 'chrome' }
}

Stop-Process -Id $pad.Id -ErrorAction SilentlyContinue
Step 'Pressed Ctrl+Alt+Shift+D: dotDock quits, the taskbar is visible and auto-hide is on' {
  $VK_CONTROL = 0x11; $VK_MENU = 0x12; $VK_SHIFT = 0x10; $VK_D = 0x44; $UP = 2
  foreach ($k in $VK_CONTROL, $VK_MENU, $VK_SHIFT, $VK_D) { [DotDock.Keys]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 80
  foreach ($k in $VK_D, $VK_SHIFT, $VK_MENU, $VK_CONTROL) { [DotDock.Keys]::keybd_event($k, 0, $UP, [UIntPtr]::Zero) }
  (Wait-For { -not (Get-Process dotdock -ErrorAction SilentlyContinue) } 8000) -and (Test-TaskbarVisible) -and (Get-TaskbarAutoHide)
}

if (Get-Process dotdock -ErrorAction SilentlyContinue) { Stop-DotDock }
if (-not (Test-TaskbarVisible)) { Show-Taskbar }
if (-not (Get-TaskbarAutoHide)) { Set-TaskbarAutoHide $true }
Add-Content -Path $Log -Value "`n$failed failed."
exit $failed
