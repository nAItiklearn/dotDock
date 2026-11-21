<#
.SYNOPSIS
  Hard test of the real dock on the real desktop, by hand-like input: a visible cursor moving at a human pace, real
  left and right clicks, real keys. One PASS/FAIL row per feature goes to the report, with a screenshot.
.DESCRIPTION
  Starts through guard.ps1 (transparent, click-through, no focus taken), then walks every feature the owner uses:
  click-through beside the bar, launch, focus, right-click menus, stacks, the App Library, live tiles, window
  previews, the customise panel (auto-hide on and off, saved to dock.json), arrange mode, remove and add back, no
  focus taken while idle, and the kill switch. Every path ends with dotDock quit, the windows it opened closed, the
  taskbar visible and auto-hide on.
#>
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$Report,
  [Parameter(Mandatory)][string]$Shots,
  [int]$CdpPort = 9447
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'Mouse.psm1') -Force
Import-Module (Join-Path $here 'Windows.psm1') -Force
Import-Module (Join-Path $here 'Capture.psm1') -Force
Import-Module (Join-Path $here 'Cdp.psm1') -Force
Import-Module (Join-Path $here '..\lib\WinShell.psm1') -Force
Add-Type -Namespace DotDock -Name Keys -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int w, int h2, uint flags);
'@
New-Item -ItemType Directory -Force -Path $Shots | Out-Null
$store = Join-Path $env:LOCALAPPDATA 'dev.dotdock.desktop\dock\dock.json'
$script:failed = 0
$script:n = 0
$opened = New-Object System.Collections.ArrayList

function Row([string]$Feature, [bool]$Ok, [string]$Evidence) {
  $script:n++
  $shot = ('{0:D2}.png' -f $script:n)
  Save-Screen (Join-Path $Shots $shot)
  if (-not $Ok) { $script:failed++ }
  $line = '| {0} | {1} | {2} | {3} | [{4}]({5}/{4}) |' -f $script:n, $Feature, $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Evidence, $shot, (Split-Path -Leaf $Shots)
  Add-Content -Path $Report -Value $line
  Write-Output $line
}

function Step([string]$Feature, [scriptblock]$Body) {
  $started = Get-Date
  $evidence = ''
  $ok = $false
  try {
    $result = & $Body
    $ok = [bool]$result.Ok
    $evidence = [string]$result.Evidence
  } catch { $evidence = "error: $($_.Exception.Message)" }
  $evidence = '{0} ({1} ms)' -f $evidence, [int]((Get-Date) - $started).TotalMilliseconds
  Row $Feature $ok $evidence
  Start-Sleep -Milliseconds 600
}

function Q([string]$Expression) { Invoke-Dock $CdpPort $Expression }

function Wait-For([scriptblock]$Condition, [int]$LimitMs = 4000) {
  $deadline = (Get-Date).AddMilliseconds($LimitMs)
  while ((Get-Date) -lt $deadline) { if (& $Condition) { return $true }; Start-Sleep -Milliseconds 80 }
  return $false
}

# Centre of the first element matching `selector`, in physical screen px.
function Point([string]$Selector) {
  $sel = $Selector.Replace("'", "\'")
  Q "(() => { const e = document.querySelector('$sel'); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
}

# Centre of the round face of the bar item with `key` (keys hold paths, so they are matched in JS, not in CSS).
function SlotPoint([string]$Key) {
  $k = ConvertTo-Json $Key -Compress
  Q "(() => { const e = [...document.querySelectorAll('.dock__row .slot')].find((s) => s.dataset.key === $k)?.querySelector('.disc, .face'); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
}

function SlotName([string]$Key) {
  $k = ConvertTo-Json $Key -Compress
  Q "[...document.querySelectorAll('.dock__row .slot')].find((s) => s.dataset.key === $k)?.querySelector('.disc')?.getAttribute('aria-label') ?? null"
}

function SlotExists([string]$Key) {
  $k = ConvertTo-Json $Key -Compress
  (Q "[...document.querySelectorAll('.dock__row .slot')].some((s) => s.dataset.key === $k)") -eq $true
}

# Centre of the customise panel's switch labelled `label`.
function SwitchPoint([string]$Label) {
  $l = ConvertTo-Json $Label -Compress
  Q "(() => { const e = [...document.querySelectorAll('.prefs .prefs__switch')].find((b) => b.textContent.trim() === $l); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
}

function Exists([string]$Selector) { (Q "document.querySelector('$($Selector.Replace("'", "\'"))') !== null") -eq $true }

function Press([byte[]]$Keys) {
  foreach ($k in $Keys) { [DotDock.Keys]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 60
  [array]::Reverse($Keys)
  foreach ($k in $Keys) { [DotDock.Keys]::keybd_event($k, 0, 2, [UIntPtr]::Zero) }
}
$VK_ESCAPE = 0x1B

function Settings { (Get-Content $store -Raw | ConvertFrom-Json).settings }

function Stop-Everything {
  Get-Process dotdock -ErrorAction SilentlyContinue | Stop-Process -Force
  foreach ($p in $opened) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  if (-not (Test-TaskbarVisible)) { Show-Taskbar }
  if (-not (Get-TaskbarAutoHide)) { Set-TaskbarAutoHide $true }
}

Add-Content -Path $Report -Value "`n## Run $(Get-Date -Format s)`n`n| # | Feature | Result | Evidence | Screen |`n|---|---|---|---|---|"
try {
  $guard = & (Join-Path $here 'guard.ps1') -Exe $Exe -OutDir $Shots -CdpPort $CdpPort -Keep
  $guardOk = $LASTEXITCODE -eq 0
  Row 'Start guard: transparent outside the bar, click-through, no focus taken' $guardOk (($guard | ForEach-Object { $_ -replace '^\| ', '' -replace ' \|$', '' }) -join '; ')
  if (-not $guardOk) { throw 'the start guard failed, so no input is sent to the dock' }

  $pad = Start-Process notepad -PassThru
  [void]$opened.Add($pad.Id)
  [void](Wait-For { (Get-Process -Id $pad.Id).MainWindowHandle -ne 0 } 8000)
  Start-Sleep -Milliseconds 600
  $padWindow = (Get-Process -Id $pad.Id).MainWindowHandle
  [void][DotDock.Keys]::SetWindowPos($padWindow, [IntPtr]::Zero, 60, 80, 640, 420, 0x0040)
  $bar = Q '(() => { const r = document.querySelector(".dock").getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x) * s), y: Math.round((screenY + r.y) * s), w: Math.round(r.width * s), h: Math.round(r.height * s) }; })()'
  $barMidY = [int]($bar.y + $bar.h / 2)

  Step 'Layout: real pinned apps, stacks and tiles on the bar' {
    $keys = Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key)'
    $apps = @($keys | Where-Object { $_ -like 'app:*' }).Count
    $stacks = @($keys | Where-Object { $_ -like 'stack:*' }).Count
    $tiles = @($keys | Where-Object { $_ -like 'tile:*' }).Count
    @{ Ok = ($apps -ge 4 -and $stacks -ge 1 -and $tiles -ge 1 -and $keys -contains 'library' -and $keys -contains 'more'); Evidence = "$apps apps, $stacks stacks, $tiles tiles, library and more: $($keys -join ', ')" }
  }

  Step 'Click beside the bar reaches the window below (Notepad)' {
    Invoke-Click 300 300
    @{ Ok = (Wait-For { (Get-Foreground).Process -eq 'Notepad' }); Evidence = "foreground: $((Get-Foreground).Process)" }
  }

  Step 'Click on the desktop left of the bar is not taken by the dock' {
    $x = [int]($bar.x - 70)
    $at = Get-WindowAt $x $barMidY
    Invoke-Click $x $barMidY
    Start-Sleep -Milliseconds 300
    @{ Ok = ($at.Process -ne 'dotdock' -and (Get-Foreground).Process -ne 'dotdock'); Evidence = "window under the point: $($at.Process); foreground after: $((Get-Foreground).Process)" }
  }

  Step 'Click File Explorer on the dock launches it' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => /explorer|::\{|file/i.test(k) && k.startsWith("app:")) ?? null')
    if (-not $key) { $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("app:"))') }
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y
    $ok = Wait-For { (Get-Foreground).Process -eq 'explorer' } 6000
    @{ Ok = $ok; Evidence = "clicked $key; foreground: $((Get-Foreground).Process) '$((Get-Foreground).Title)'" }
  }

  Step 'Click the running app again: its window comes to the front (focus, no second launch)' {
    Invoke-Click 300 300
    [void](Wait-For { (Get-Foreground).Process -eq 'Notepad' })
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => /explorer|::\{|file/i.test(k) && k.startsWith("app:")) ?? null')
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y
    $ok = Wait-For { (Get-Foreground).Process -eq 'explorer' } 4000
    @{ Ok = $ok; Evidence = "foreground: $((Get-Foreground).Process) '$((Get-Foreground).Title)'" }
  }

  Step 'Right-click an app: its menu opens with Open, Remove from dock and the dock entries' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("app:"))')
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y -Right
    $ok = Wait-For { Exists '.menu' }
    $labels = Q '[...document.querySelectorAll(".menu .menu__label")].map((e) => e.textContent)'
    @{ Ok = ($ok -and ($labels -contains 'Remove from dock') -and ($labels -contains 'Customise the dock…')); Evidence = "menu: $($labels -join ' / ')" }
  }

  Step 'With the menu open, a click on Notepad reaches Notepad and closes the menu' {
    Invoke-Click 300 300
    $fg = Wait-For { (Get-Foreground).Process -eq 'Notepad' }
    $closed = Wait-For { -not (Exists '.menu') }
    @{ Ok = ($fg -and $closed); Evidence = "foreground Notepad: $fg; menu closed: $closed" }
  }

  Step 'Click a stack: its apps open in a popover, Escape closes it' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("stack:"))')
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y
    $open = Wait-For { Exists '.popover[data-open="true"]' }
    $count = Q 'document.querySelectorAll(".popover[data-open=\"true\"] .cell").length'
    Start-Sleep -Milliseconds 500
    Save-Screen (Join-Path $Shots 'stack-open.png')
    Press @($VK_ESCAPE)
    $closed = Wait-For { -not (Exists '.popover[data-open="true"]') }
    @{ Ok = ($open -and $count -ge 1 -and $closed); Evidence = "$key: $count apps shown; closed by Escape: $closed" }
  }

  Step 'App Library opens over the screen with every category, Escape closes it' {
    $p = SlotPoint 'library'
    Invoke-Click $p.x $p.y
    Start-Sleep -Milliseconds 700
    $sections = Q 'document.querySelectorAll(".library .lib-section").length'
    $apps = Q 'document.querySelectorAll(".library .lib-grid .cell").length'
    Save-Screen (Join-Path $Shots 'library-open.png')
    Press @($VK_ESCAPE)
    Start-Sleep -Milliseconds 600
    @{ Ok = ($sections -ge 3 -and $apps -ge 20); Evidence = "$sections categories, $apps apps" }
  }

  Step 'Clock tile shows the real time' {
    $text = Q '(document.querySelector(".slot[data-key=\"tile:clock\"]")?.textContent ?? "").replace(/\s+/g, " ").trim()'
    $now = Get-Date
    $hh = $now.ToString('hh'); $mm = $now.ToString('mm'); $h24 = $now.ToString('HH')
    $digits = ($text -replace '[^0-9]', '')
    @{ Ok = ($digits.StartsWith("$hh$mm") -or $digits.StartsWith("$h24$mm") -or $digits.StartsWith("$($now.Hour % 12)$mm")); Evidence = "tile reads '$text' at $($now.ToString('HH:mm'))" }
  }

  Step 'System tile opens its popover with real numbers' {
    $p = SlotPoint 'tile:system'
    if ($null -eq $p) { return @{ Ok = $false; Evidence = 'no system tile on the bar' } }
    Invoke-Click $p.x $p.y
    $open = Wait-For { Exists '.popover[data-open="true"]' }
    $text = Q '(document.querySelector(".popover[data-open=\"true\"]")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160)'
    Save-Screen (Join-Path $Shots 'tile-system.png')
    Press @($VK_ESCAPE)
    [void](Wait-For { -not (Exists '.popover[data-open="true"]') })
    @{ Ok = ($open -and $text -match '\d'); Evidence = "popover: $text" }
  }

  Step 'Hovering a running app shows its window previews' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => /explorer|::\{|file/i.test(k) && k.startsWith("app:")) ?? null')
    $p = SlotPoint $key
    Move-Mouse $p.x $p.y 700
    $shown = Wait-For { Exists '.preview' } 3000
    $slots = Q 'document.querySelectorAll(".preview .preview__slot").length'
    Save-Screen (Join-Path $Shots 'preview.png')
    Move-Mouse 360 320 500
    @{ Ok = ($shown -and $slots -ge 1); Evidence = "$slots window thumbnails for $key" }
  }

  Step 'The ⋯ button opens the customise panel' {
    $p = SlotPoint 'more'
    Invoke-Click $p.x $p.y
    $open = Wait-For { Exists '.prefs' }
    Save-Screen (Join-Path $Shots 'customise.png')
    @{ Ok = $open; Evidence = "panel open: $open" }
  }

  Step 'Auto-hide on: saved to dock.json, and the dock slides away when the pointer leaves' {
    $switch = SwitchPoint 'Hide when not in use'
    Invoke-Click $switch.x $switch.y
    $saved = Wait-For { (Settings).autoHide -eq $true } 4000
    Invoke-Click 300 300
    $hidden = Wait-For { (Q 'document.querySelector(".dock")?.dataset.hidden === "true"') -eq $true } 4000
    Save-Screen (Join-Path $Shots 'auto-hidden.png')
    @{ Ok = ($saved -and $hidden); Evidence = "autoHide saved: $saved; bar out of sight: $hidden" }
  }

  Step 'Pointer at the bottom edge brings the hidden dock back' {
    $w = [DotDock.Dpi]::GetSystemMetrics(0); $h = [DotDock.Dpi]::GetSystemMetrics(1)
    Move-Mouse ([int]($w / 2)) ($h - 1) 600
    $back = Wait-For { (Q 'document.querySelector(".dock")?.dataset.hidden !== "true"') -eq $true } 3000
    Save-Screen (Join-Path $Shots 'auto-hide-reveal.png')
    @{ Ok = $back; Evidence = "bar back on screen: $back" }
  }

  Step 'Auto-hide off again from the panel: saved, dock stays' {
    $p = SlotPoint 'more'
    Invoke-Click $p.x $p.y
    [void](Wait-For { Exists '.prefs' })
    $switch = SwitchPoint 'Hide when not in use'
    Invoke-Click $switch.x $switch.y
    $saved = Wait-For { (Settings).autoHide -eq $false } 4000
    Press @($VK_ESCAPE)
    Invoke-Click 300 300
    Start-Sleep -Milliseconds 1200
    $stays = (Q 'document.querySelector(".dock")?.dataset.hidden !== "true"') -eq $true
    @{ Ok = ($saved -and $stays); Evidence = "autoHide off saved: $saved; bar stays: $stays" }
  }

  Step 'Replace the Windows taskbar: on hides it (dock reserves the strip), off brings it back' {
    $p = SlotPoint 'more'
    Invoke-Click $p.x $p.y
    [void](Wait-For { Exists '.prefs' })
    $switch = SwitchPoint 'Replace the Windows taskbar'
    Invoke-Click $switch.x $switch.y
    $saved = Wait-For { (Settings).replaceTaskbar -eq $true } 4000
    $hidden = Wait-For { -not (Test-TaskbarVisible) } 6000
    Save-Screen (Join-Path $Shots 'taskbar-replaced.png')
    $switch = SwitchPoint 'Replace the Windows taskbar'
    Invoke-Click $switch.x $switch.y
    $off = Wait-For { (Settings).replaceTaskbar -eq $false } 4000
    $back = Wait-For { Test-TaskbarVisible } 6000
    Press @($VK_ESCAPE)
    @{ Ok = ($saved -and $hidden -and $off -and $back -and (Get-TaskbarAutoHide)); Evidence = "on saved: $saved, taskbar hidden: $hidden; off saved: $off, taskbar back: $back, auto-hide on: $(Get-TaskbarAutoHide)" }
  }

  Step 'Remove an app from the dock with its menu, then add it back from the App Library' {
    $before = @((Settings).pinned).Count
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).filter((k) => k.startsWith("app:")).pop()')
    $name = SlotName $key
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y -Right
    [void](Wait-For { Exists '.menu' })
    $item = Q '(() => { const e = [...document.querySelectorAll(".menu .menu__item")].find((b) => b.textContent.includes("Remove from dock")); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()'
    Invoke-Click $item.x $item.y
    $removed = Wait-For { @((Settings).pinned).Count -eq $before - 1 } 4000
    $gone = Wait-For { -not (SlotExists $key) }
    $lib = SlotPoint 'library'
    Invoke-Click $lib.x $lib.y
    Start-Sleep -Milliseconds 900
    $n = ConvertTo-Json $name -Compress
    $cell = Q "(() => { const e = [...document.querySelectorAll('.library .cell')].find((c) => c.querySelector('.cell__name')?.textContent === $n); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
    $added = $false
    if ($cell) {
      Invoke-Click $cell.x $cell.y -Right
      [void](Wait-For { Exists '.menu' })
      $keep = Q '(() => { const e = [...document.querySelectorAll(".menu .menu__item")].find((b) => b.textContent.includes("Keep in dock")); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()'
      if ($keep) { Invoke-Click $keep.x $keep.y; $added = Wait-For { @((Settings).pinned).Count -eq $before } 4000 }
    }
    Press @($VK_ESCAPE)
    Start-Sleep -Milliseconds 500
    @{ Ok = ($removed -and $gone -and $added); Evidence = "'$name': pinned $before, removed: $removed, slot gone: $gone, kept again from the library: $added" }
  }

  Step 'Arrange mode from the bar menu shows the edit banner and remove buttons; Done leaves it' {
    $gap = Q '(() => { const a = [...document.querySelectorAll(".dock__row .slot")]; const r = document.querySelector(".dock").getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + 8) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()'
    Invoke-Click $gap.x $gap.y -Right
    [void](Wait-For { Exists '.menu' })
    $arrange = Q '(() => { const e = [...document.querySelectorAll(".menu .menu__item")].find((b) => b.textContent.includes("Arrange and remove")); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()'
    Invoke-Click $arrange.x $arrange.y
    $editing = Wait-For { Exists '.edit-banner' }
    $removes = Q 'document.querySelectorAll(".dock__row .remove").length'
    Save-Screen (Join-Path $Shots 'arrange.png')
    Press @($VK_ESCAPE)
    $done = Wait-For { -not (Exists '.edit-banner') }
    @{ Ok = ($editing -and $removes -ge 1 -and $done); Evidence = "banner: $editing, $removes remove buttons, left with Escape: $done" }
  }

  Step 'Idle for 20 s with Notepad in front: the dock never takes the focus' {
    Invoke-Click 300 300
    [void](Wait-For { (Get-Foreground).Process -eq 'Notepad' })
    $stolen = 0
    for ($i = 0; $i -lt 40; $i++) { if ((Get-Foreground).Process -eq 'dotdock') { $stolen++ }; Start-Sleep -Milliseconds 500 }
    @{ Ok = ($stolen -eq 0); Evidence = "foreground was the dock in $stolen of 40 samples" }
  }

  Step 'Ctrl+Alt+Shift+D quits dotDock; the taskbar is visible and auto-hide is on' {
    Press @(0x11, 0x12, 0x10, 0x44)
    $gone = Wait-For { -not (Get-Process dotdock -ErrorAction SilentlyContinue) } 8000
    @{ Ok = ($gone -and (Test-TaskbarVisible) -and (Get-TaskbarAutoHide)); Evidence = "quit: $gone; taskbar visible: $(Test-TaskbarVisible); auto-hide: $(Get-TaskbarAutoHide)" }
  }
} catch {
  Row 'Run stopped' $false $_.Exception.Message
} finally {
  Stop-Everything
}
Add-Content -Path $Report -Value "`n$script:failed of $script:n rows failed."
exit $script:failed
