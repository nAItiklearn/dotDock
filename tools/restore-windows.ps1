<#
.SYNOPSIS
  Panic button: returns the desktop to stock Windows using the saved snapshot.
.DESCRIPTION
  Stops dotDock, shows the Windows taskbar, removes its autostart entries, restores the
  startup-delay value, wallpaper, taskbar auto-hide and desktop-icon visibility. Safe to run any number of times. Exits 1 if any step failed.
  Use -DryRun to print the plan without changing anything.
  The installed app does the same with `dotdock.exe --restore-windows`.
#>
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

$script:Failures = 0
function Step([string]$What, [scriptblock]$Action) {
    if ($DryRun) { Write-Output "[dry-run] $What"; return }
    try { & $Action; Write-Output "[ok] $What" }
    catch { $script:Failures++; Write-Output "[failed] $What :: $($_.Exception.Message)" }
}

$snapshotPath = Get-SnapshotPath
$snap = $null
if (Test-Path $snapshotPath) {
    # Explicit UTF-8: Windows PowerShell 5.1 would read the BOM-less Rust-written file as ANSI
    # and garble non-ASCII paths.
    $snap = Get-Content -LiteralPath $snapshotPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    Write-Output "No snapshot at $snapshotPath. Only removing dotDock autostart and processes."
}

# The dock's own record first: with it gone, a watching sentinel finds nothing to do while this
# script restores the taskbar and the two cannot disagree about auto-hide.
$script:markerAutoHide = $null
Step 'Take over the dock marker' { $script:markerAutoHide = Clear-TaskbarMarker }

Step "Stop $AppName processes" {
    Get-Process -Name "$AppName-sentinel" -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process -Name $AppName -ErrorAction SilentlyContinue | Stop-Process -Force
}

# Always, with or without a snapshot: a hidden taskbar is the one state a user cannot fix by hand.
Step 'Show the Windows taskbar' { Show-Taskbar }

Step 'Remove autostart Run entry' {
    Remove-ItemProperty -Path $RunKey -Name $AppName -ErrorAction SilentlyContinue
}

Step 'Remove logon scheduled task' {
    $task = Get-ScheduledTask -TaskName $AppName -ErrorAction SilentlyContinue
    if ($task) { Unregister-ScheduledTask -TaskName $AppName -Confirm:$false }
}

if ($snap) {
    Step 'Restore StartupDelayInMSec' {
        if ($null -ne $snap.startupDelayInMSec) {
            New-Item -Path $SerializeKey -Force | Out-Null
            Set-ItemProperty -Path $SerializeKey -Name StartupDelayInMSec -Value $snap.startupDelayInMSec -Type DWord
        } else {
            # Only our value: other software may have added values to this key since the snapshot.
            Remove-ItemProperty -Path $SerializeKey -Name StartupDelayInMSec -ErrorAction SilentlyContinue
        }
    }

    Step 'Restore wallpaper' {
        # Prefer the private copy: the original path may be a file Windows has since overwritten
        # (Spotlight and slideshow write to TranscodedWallpaper). Never a relative or missing path (D-042).
        $source = Select-RestoreWallpaper $snap
        if (-not $source) { throw "no usable wallpaper in the snapshot (copy '$($snap.wallpaperCopy)', original '$($snap.wallpaper)'); left as it is" }
        Set-Wallpaper -Path $source -Style $snap.wallpaperStyle -Tile $snap.tileWallpaper
    }

    Step 'Check the wallpaper Windows has on record' {
        $now = Get-RegistryWallpaper
        if (-not $now.Exists) { throw "the registry WallPaper '$($now.Path)' is not a file that exists" }
        Write-Output "Wallpaper on record exists: $($now.Path)"
    }

    if ($snap.PSObject.Properties.Name -contains 'taskbarAutoHide' -and $null -ne $snap.taskbarAutoHide) {
        Step 'Restore taskbar auto-hide' { Set-TaskbarAutoHide ([bool]$snap.taskbarAutoHide) }
    }

    Step 'Restore desktop icon visibility' {
        if ($null -ne $snap.desktopIconsVisible) { Set-DesktopIconsVisible ([bool]$snap.desktopIconsVisible) }
    }
}

# The icons are the user's again, so dotDock must stop claiming them: a record left behind would have
# the next start hide them once more (B4, desktop_icons.rs).
Step 'Drop the desktop-icon claim' {
    $claim = Join-Path (Split-Path -Parent $snapshotPath) 'desktop-icons.json'
    if (Test-Path -LiteralPath $claim) { Remove-Item -LiteralPath $claim -Force }
}

# No snapshot value to go by: the value from before the dock hid the taskbar is the next best.
$snapHasAutoHide = $snap -and $snap.PSObject.Properties.Name -contains 'taskbarAutoHide' -and $null -ne $snap.taskbarAutoHide
if (-not $snapHasAutoHide -and $null -ne $script:markerAutoHide) {
    Step 'Restore taskbar auto-hide from the dock marker' { Set-TaskbarAutoHide $script:markerAutoHide }
}

if ($script:Failures -gt 0) {
    Write-Output "Restore finished with $script:Failures failed step(s)."
    exit 1
}
Write-Output 'Restore finished.'
