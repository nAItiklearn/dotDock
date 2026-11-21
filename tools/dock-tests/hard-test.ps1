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

# Centre of the open menu's item whose text contains `text`, in physical screen px.
function MenuItemPoint([string]$Text, [string]$Menu = '.menu') {
  $x = ConvertTo-Json $Text -Compress
  Q "(() => { const e = [...document.querySelectorAll('$Menu .menu__item')].find((b) => b.textContent.includes($x)); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
}

# Centre of the first element matching `selector` whose text contains `text`.
function TextPoint([string]$Selector, [string]$Text) {
  $sel = ConvertTo-Json $Selector -Compress; $x = ConvertTo-Json $Text -Compress
  Q "(() => { const e = [...document.querySelectorAll($sel)].find((b) => b.textContent.includes($x)); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
}

# Where the thumb of the customise panel's slider labelled `label` sits for its current value.
function SliderThumb([string]$Label) {
  $l = ConvertTo-Json $Label -Compress
  Q "(() => { const e = [...document.querySelectorAll('.prefs input[type=range]')].find((i) => i.getAttribute('aria-label') === $l); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const f = (e.value - e.min) / (e.max - e.min); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.height / 2 + f * (r.width - r.height)) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
}

function Open-Prefs {
  if (-not (Exists '.prefs')) { $p = SlotPoint 'more'; Invoke-Click $p.x $p.y; [void](Wait-For { Exists '.prefs' }) }
}

# Opens a panel with `Open`, clicks Notepad beside the dock, and checks the click reached Notepad and the panel closed.
function Test-ClickThroughWith([string]$Selector, [scriptblock]$Open) {
  & $Open
  $opened = Wait-For { Exists $Selector }
  Invoke-Click 300 300
  $fg = Wait-For { (Get-Foreground).Process -eq 'Notepad' }
  $closed = Wait-For { -not (Exists $Selector) }
  @{ Ok = ($opened -and $fg -and $closed); Evidence = "opened: $opened; click reached Notepad: $fg; panel closed: $closed" }
}

function Exists([string]$Selector) { (Q "document.querySelector('$($Selector.Replace("'", "\'"))') !== null") -eq $true }

function Press([byte[]]$Keys) {
  foreach ($k in $Keys) { [DotDock.Keys]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 60
  [array]::Reverse($Keys)
  foreach ($k in $Keys) { [DotDock.Keys]::keybd_event($k, 0, 2, [UIntPtr]::Zero) }
}
$VK_ESCAPE = 0x1B; $VK_LEFT = 0x25; $VK_RIGHT = 0x27

function Settings { (Get-Content $store -Raw | ConvertFrom-Json).settings }

$desktopKey = 'HKCU:\Control Panel\Desktop'
$wallBefore = Get-ItemProperty $desktopKey | Select-Object WallPaper, WallpaperStyle, TileWallpaper
$meadow = (Resolve-Path (Join-Path $here '..\..\assets\wallpapers\meadow-dots-dark.jpg')).Path
# Windows' "Fill" wallpaper style.
$FILL = '10'
$storeBackup = "$store.before-hard-test"

function Stop-Everything {
  Get-Process dotdock -ErrorAction SilentlyContinue | Stop-Process -Force
  if (Test-Path $storeBackup) { Move-Item -Force $storeBackup $store }
  Set-Wallpaper $wallBefore.WallPaper $wallBefore.WallpaperStyle $wallBefore.TileWallpaper
  foreach ($p in $opened) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  if (-not (Test-TaskbarVisible)) { Show-Taskbar }
  if (-not (Get-TaskbarAutoHide)) { Set-TaskbarAutoHide $true }
}

Add-Content -Path $Report -Value "`n## Run $(Get-Date -Format s)`n`n| # | Feature | Result | Evidence | Screen |`n|---|---|---|---|---|"
try {
  # The original desktop is recorded once (never overwritten); the run is on Wind Meadow, and everything is put back.
  & (Join-Path $here '..\snapshot-windows.ps1') | Out-Null
  if (Test-Path $store) { Copy-Item -Force $store $storeBackup }
  Set-Wallpaper $meadow $FILL '0'
  Start-Sleep -Milliseconds 800
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

  Step 'Glass look chosen in the customise panel; the frosted plate draws over Wind Meadow' {
    Open-Prefs
    $chip = TextPoint '.prefs__chips button' 'Glass'
    Invoke-Click $chip.x $chip.y
    $chosen = Wait-For { (Q '[...document.querySelectorAll(".prefs__chips button")].find((b) => b.textContent.trim() === "Glass")?.getAttribute("aria-checked")') -eq 'true' }
    Press @($VK_ESCAPE)
    [void](Wait-For { -not (Exists '.prefs') })
    Move-Mouse 360 320 400
    Start-Sleep -Milliseconds 700
    $drawn = Q 'document.querySelector("[data-dock-theme]")?.dataset.dockTheme ?? null'
    $wall = (Get-ItemProperty $desktopKey).WallPaper
    Save-Screen (Join-Path $Shots 'glass-on-meadow.png')
    @{ Ok = ($chosen -and $drawn -eq 'glass' -and $wall -eq $meadow); Evidence = "Glass chosen: $chosen; drawn as: $drawn; wallpaper: $(Split-Path -Leaf $wall)" }
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

  Step 'Running apps carry a dot under their icon; the app in front is marked focused' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => /explorer|::\{|file/i.test(k) && k.startsWith("app:")) ?? null')
    $k = ConvertTo-Json $key -Compress
    $dots = Q "[...document.querySelectorAll('.dock__row .slot')].find((s) => s.dataset.key === $k)?.querySelectorAll('.dots > *').length ?? 0"
    $focused = Q "[...document.querySelectorAll('.dock__row .slot')].find((s) => s.dataset.key === $k)?.querySelector('.dots')?.dataset.focused === 'true'"
    $idle = Q '[...document.querySelectorAll(".dock__row .slot")].filter((s) => s.dataset.key.startsWith("app:") && !s.querySelector(".dots > *")).length'
    @{ Ok = ($dots -ge 1 -and $focused -eq $true -and $idle -ge 1); Evidence = "${key}: $dots dot(s), focused: $focused; apps with no window and no dot: $idle" }
  }

  Step 'Hovering an item magnifies it and shows its name above it' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("app:"))')
    $k = ConvertTo-Json $key -Compress
    $width = "(() => { const f = [...document.querySelectorAll('.dock__row .slot')].find((s) => s.dataset.key === $k)?.querySelector('.disc, .face'); return f ? f.getBoundingClientRect().width : 0; })()"
    $rest = Q $width
    $p = SlotPoint $key
    Move-Mouse $p.x ($p.y + 4) 700
    Start-Sleep -Milliseconds 500
    $hover = Q $width
    $label = Q '(() => { const l = document.querySelector(".dock__label"); return l && l.dataset.visible === "true" ? l.textContent.trim() : ""; })()'
    $name = SlotName $key
    Save-Screen (Join-Path $Shots 'hover-magnify.png')
    Move-Mouse 360 320 500
    @{ Ok = ($hover -gt $rest * 1.1 -and $label -ne '' -and $label.StartsWith($name)); Evidence = ('{0}: face {1:N0} px at rest, {2:N0} px hovered; label "{3}"' -f $key, $rest, $hover, $label) }
  }

  Step 'Clicking the app in front minimises it; clicking again brings it back' {
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => /explorer|::\{|file/i.test(k) && k.startsWith("app:")) ?? null')
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y
    [void](Wait-For { (Get-Foreground).Process -eq 'explorer' } 4000)
    $window = (Get-Foreground).Handle
    Start-Sleep -Milliseconds 400
    Invoke-Click $p.x $p.y
    $minimised = Wait-For { (Get-WindowFacts $window).Minimized } 4000
    Invoke-Click $p.x $p.y
    $back = Wait-For { (-not (Get-WindowFacts $window).Minimized) -and (Get-Foreground).Handle -eq $window } 4000
    @{ Ok = ($minimised -and $back); Evidence = "minimised by a click: $minimised; back in front after the next: $back" }
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
    @{ Ok = ($open -and $count -ge 1 -and $closed); Evidence = "${key}: $count apps shown; closed by Escape: $closed" }
  }

  Step 'With a stack open, a click on Notepad reaches Notepad and closes the stack' {
    Test-ClickThroughWith '.popover[data-open="true"]' {
      $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("stack:"))')
      $p = SlotPoint $key; Invoke-Click $p.x $p.y
    }
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

  Step 'With a tile popover open, a click on Notepad reaches Notepad and closes it' {
    Test-ClickThroughWith '.popover[data-open="true"]' { $p = SlotPoint 'tile:clock'; Invoke-Click $p.x $p.y }
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

  Step 'Icon size: one step up from the panel is saved and drawn, one step down restores it' {
    Open-Prefs
    $thumb = SliderThumb 'Icon size'
    Invoke-Click $thumb.x $thumb.y
    Start-Sleep -Milliseconds 300
    $start = (Settings).iconSize
    $width = Q 'document.querySelector(".dock").getBoundingClientRect().width'
    Press @($VK_RIGHT)
    $up = Wait-For { (Settings).iconSize -gt $start } 3000
    $bigger = (Settings).iconSize
    Start-Sleep -Milliseconds 400
    $wider = Q 'document.querySelector(".dock").getBoundingClientRect().width'
    Save-Screen (Join-Path $Shots 'icon-size-up.png')
    Press @($VK_LEFT)
    $down = Wait-For { (Settings).iconSize -eq $start } 3000
    @{ Ok = ($up -and $wider -gt $width -and $down); Evidence = ('size {0} px; Right: {1} px (saved: {2}), bar {3:N0} to {4:N0} px wide; Left: back to {5} px (saved: {6})' -f $start, $bigger, $up, $width, $wider, (Settings).iconSize, $down) }
  }

  Step 'Magnification: one step up and back from the panel, saved each time' {
    Open-Prefs
    $thumb = SliderThumb 'Magnification'
    Invoke-Click $thumb.x $thumb.y
    Start-Sleep -Milliseconds 300
    $start = [double](Settings).magnification
    Press @($VK_RIGHT)
    $up = Wait-For { [double](Settings).magnification -gt $start } 3000
    $more = (Settings).magnification
    Press @($VK_LEFT)
    $down = Wait-For { [Math]::Abs([double](Settings).magnification - $start) -lt 0.001 } 3000
    @{ Ok = ($up -and $down); Evidence = "magnification $start; Right: $more (saved: $up); Left: back to $((Settings).magnification) (saved: $down)" }
  }

  Step 'Keep windows clear of the dock: flipped and back from the panel, saved each time' {
    Open-Prefs
    $start = [bool](Settings).reserveSpace
    $switch = SwitchPoint 'Keep windows clear of the dock'
    Invoke-Click $switch.x $switch.y
    $flipped = Wait-For { [bool](Settings).reserveSpace -ne $start } 3000
    $switch = SwitchPoint 'Keep windows clear of the dock'
    Invoke-Click $switch.x $switch.y
    $back = Wait-For { [bool](Settings).reserveSpace -eq $start } 3000
    @{ Ok = ($flipped -and $back); Evidence = "reserveSpace $start; flipped and saved: $flipped; back: $back" }
  }

  Step 'Every look in the panel draws the dock in it; Glass is chosen again at the end' {
    Open-Prefs
    $drawnAs = @()
    foreach ($look in @('Glass lite', 'Obsidian', 'Paper', 'Aurum', 'Minimal', 'Glass')) {
      $chip = Q "(() => { const e = [...document.querySelectorAll('.prefs__chips button')].find((b) => b.textContent.trim() === '$look'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s) }; })()"
      Invoke-Click $chip.x $chip.y
      Start-Sleep -Milliseconds 700
      $drawnAs += "$look=$(Q 'document.querySelector("[data-dock-theme]")?.dataset.dockTheme ?? ""')"
      Save-Screen (Join-Path $Shots ('look-{0}.png' -f ($look.ToLower() -replace ' ', '-')))
    }
    Press @($VK_ESCAPE)
    $expected = @('Glass lite=glass-lite', 'Obsidian=obsidian', 'Paper=paper', 'Aurum=aurum', 'Minimal=minimal', 'Glass=glass')
    @{ Ok = ((Compare-Object $drawnAs $expected).Count -eq 0); Evidence = $drawnAs -join ', ' }
  }

  Step 'The widget gallery from the panel adds the weather tile, which shows the real weather' {
    Open-Prefs
    $add = TextPoint '.prefs__actions button' 'Add a widget'
    Invoke-Click $add.x $add.y
    $open = Wait-For { Exists '.gallery' }
    $card = Q '(() => { const c = [...document.querySelectorAll(".gallery .gcard")].find((g) => g.querySelector(".gcard__name")?.textContent.trim() === "Weather"); const e = c?.querySelector(".gcard__action"); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s), on: c.dataset.on === "true" }; })()'
    $wasOn = [bool]$card.on
    if (-not $wasOn) { Invoke-Click $card.x $card.y }
    $added = Wait-For { SlotExists 'tile:weather' } 4000
    Save-Screen (Join-Path $Shots 'gallery.png')
    Press @($VK_ESCAPE)
    [void](Wait-For { -not (Exists '.gallery') })
    $read = 'document.querySelector(".slot[data-key=\"tile:weather\"] [aria-label]")?.getAttribute("aria-label") ?? ""'
    $shows = Wait-For { (Q $read) -match '\d' } 15000
    $label = Q $read
    Save-Screen (Join-Path $Shots 'weather-tile.png')
    @{ Ok = ($open -and $added -and $shows); Evidence = "gallery: $open; weather on the dock: $added (already there: $wasOn); tile reads '$label'" }
  }

  Step 'With the gallery open, a click on Notepad reaches Notepad and closes it' {
    Test-ClickThroughWith '.gallery' {
      Open-Prefs
      $add = TextPoint '.prefs__actions button' 'Add a widget'
      Invoke-Click $add.x $add.y
    }
  }

  Step 'With the customise panel open, a click on Notepad reaches Notepad and closes it' {
    Test-ClickThroughWith '.prefs' { $p = SlotPoint 'more'; Invoke-Click $p.x $p.y }
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

  Step 'Move an app to another stack from its menu; that stack shows it; moved back after' {
    $stackKey = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("stack:"))')
    $stackName = SlotName $stackKey
    $key = (Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).find((k) => k.startsWith("app:"))')
    $name = SlotName $key
    $p = SlotPoint $key
    Invoke-Click $p.x $p.y -Right
    [void](Wait-For { Exists '.menu' })
    $move = MenuItemPoint 'Move to stack'
    Move-Mouse $move.x $move.y 500
    $sub = Wait-For { Exists '.menu--sub' }
    $home = Q '[...document.querySelectorAll(".menu--sub .menu__item")].find((b) => b.getAttribute("aria-checked") === "true")?.textContent.trim() ?? null'
    $sn = ConvertTo-Json "$stackName" -Compress
    $item = Q "(() => { const e = [...document.querySelectorAll('.menu--sub .menu__item')].find((b) => b.getAttribute('aria-checked') !== 'true' && $sn.startsWith(b.textContent.trim())); if (!e) return null; const r = e.getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round((screenX + r.x + r.width / 2) * s), y: Math.round((screenY + r.y + r.height / 2) * s), label: e.textContent.trim() }; })()"
    if ($null -eq $item) { Press @($VK_ESCAPE); return @{ Ok = $false; Evidence = "'$name' is already in '$stackName', or that stack is not in the menu" } }
    Move-Mouse $item.x $move.y 300
    Invoke-Click $item.x $item.y
    Start-Sleep -Milliseconds 800
    $sp = SlotPoint $stackKey
    Invoke-Click $sp.x $sp.y
    [void](Wait-For { Exists '.popover[data-open="true"]' })
    $n = ConvertTo-Json $name -Compress
    $inStack = Wait-For { (Q "[...document.querySelectorAll('.popover[data-open] .cell__name')].some((c) => c.textContent === $n)") -eq $true } 3000
    Save-Screen (Join-Path $Shots 'category-moved.png')
    Press @($VK_ESCAPE)
    [void](Wait-For { -not (Exists '.popover[data-open="true"]') })
    Invoke-Click $p.x $p.y -Right
    [void](Wait-For { Exists '.menu' })
    $move = MenuItemPoint 'Move to stack'
    Move-Mouse $move.x $move.y 500
    [void](Wait-For { Exists '.menu--sub' })
    $back = MenuItemPoint $home '.menu--sub'
    Move-Mouse $back.x $move.y 300
    Invoke-Click $back.x $back.y
    Start-Sleep -Milliseconds 600
    @{ Ok = ($sub -and $inStack); Evidence = "'$name' moved from '$home' to '$($item.label)': shown in that stack: $inStack; moved back to '$home'" }
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

  Step 'Drag to reorder in arrange mode: the new order is saved, and dragging back restores it' {
    $order = { @((Settings).pinned | ForEach-Object { if ($_.kind -eq 'app') { "app:$($_.id)" } else { "stack:$($_.category)" } }) -join '|' }
    $before = & $order
    Open-Prefs
    $arr = TextPoint '.prefs__actions button' 'Arrange and remove'
    Invoke-Click $arr.x $arr.y
    $editing = Wait-For { Exists '.edit-banner' }
    $keys = @(Q '[...document.querySelectorAll(".dock__row .slot")].map((s) => s.dataset.key).filter((k) => k.startsWith("app:"))')
    $a = SlotPoint $keys[0]; $b = SlotPoint $keys[1]
    Invoke-Drag $a.x $a.y ($b.x + 12) $b.y
    $moved = Wait-For { (& $order) -ne $before } 4000
    Save-Screen (Join-Path $Shots 'reorder.png')
    $a = SlotPoint $keys[0]; $b = SlotPoint $keys[1]
    Invoke-Drag $a.x $a.y ($b.x - 12) $b.y
    $restored = Wait-For { (& $order) -eq $before } 4000
    Press @($VK_ESCAPE)
    [void](Wait-For { -not (Exists '.edit-banner') })
    @{ Ok = ($editing -and $moved -and $restored); Evidence = "arrange mode: $editing; $($keys[0]) dragged past $($keys[1]), saved: $moved; dragged back, order restored: $restored" }
  }

  Step 'Idle for 20 s with Notepad in front: the dock never takes the focus' {
    Invoke-Click 300 300
    [void](Wait-For { (Get-Foreground).Process -eq 'Notepad' })
    $stolen = 0
    for ($i = 0; $i -lt 40; $i++) { if ((Get-Foreground).Process -eq 'dotdock') { $stolen++ }; Start-Sleep -Milliseconds 500 }
    @{ Ok = ($stolen -eq 0); Evidence = "foreground was the dock in $stolen of 40 samples" }
  }

  Step 'Reset the dock asks once more, then puts items, tiles, size and look back to how it started' {
    Open-Prefs
    $reset = TextPoint '.prefs__reset' 'Reset'
    Invoke-Click $reset.x $reset.y
    $asks = Wait-For { (Q 'document.querySelector(".prefs__reset")?.dataset.confirm === "true"') -eq $true }
    $reset = TextPoint '.prefs__reset' 'Press again'
    Invoke-Click $reset.x $reset.y
    $done = Wait-For { Exists '.prefs [role="status"]' } 4000
    $s = Settings
    Save-Screen (Join-Path $Shots 'reset.png')
    Press @($VK_ESCAPE)
    @{ Ok = ($asks -and $done -and @($s.pinned).Count -ge 1); Evidence = "asked to confirm: $asks; done: $done; now $(@($s.pinned).Count) items, $(@($s.tiles).Count) tiles, icon $($s.iconSize) px (the user's dock.json is put back after the run)" }
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
