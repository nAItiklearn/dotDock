<#
.SYNOPSIS
  Panic button: returns the desktop to stock Windows using the saved snapshot.
.DESCRIPTION
  Stops dotDock, removes its autostart entries, restores the startup-delay key,
  wallpaper and desktop-icon visibility. Safe to run any number of times.
  Use -DryRun to print the plan without changing anything.
#>
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

function Step([string]$What, [scriptblock]$Action) {
    if ($DryRun) { Write-Output "[dry-run] $What"; return }
    try { & $Action; Write-Output "[ok] $What" }
    catch { Write-Output "[failed] $What :: $($_.Exception.Message)" }
}

$snapshotPath = Get-SnapshotPath
$snap = $null
if (Test-Path $snapshotPath) { $snap = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json }
else { Write-Output "No snapshot at $snapshotPath. Only removing dotDock autostart and processes." }

Step "Stop $AppName processes" {
    Get-Process -Name $AppName, "$AppName-launcher" -ErrorAction SilentlyContinue | Stop-Process -Force
}

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
        } elseif ($snap.serializeKeyExisted) {
            Remove-ItemProperty -Path $SerializeKey -Name StartupDelayInMSec -ErrorAction SilentlyContinue
        } elseif (Test-Path $SerializeKey) {
            Remove-Item -Path $SerializeKey -Recurse -Force
        }
    }

    Step 'Restore wallpaper' {
        $source = $snap.wallpaper
        if (-not ($source -and (Test-Path -LiteralPath $source))) { $source = $snap.wallpaperCopy }
        Set-Wallpaper -Path $source -Style $snap.wallpaperStyle -Tile $snap.tileWallpaper
    }

    Step 'Restore desktop icon visibility' {
        if ($null -ne $snap.desktopIconsVisible) { Set-DesktopIconsVisible ([bool]$snap.desktopIconsVisible) }
    }
}

Write-Output 'Restore finished.'
