<#
.SYNOPSIS
  Records the original Windows desktop state once, before dotDock changes anything.
.DESCRIPTION
  Writes %LOCALAPPDATA%\dev.dotdock.desktop\windows-original.json. Never overwrites an existing
  snapshot unless -Force is given, so the user's true original is always preserved.
#>
param([switch]$Force)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

$path = Get-SnapshotPath

# Taskbar fields came with the dock phase. A snapshot from before then lacks them; nothing in the app
# touched the taskbar before the dock, so its state now is still the original and can be added.
function Add-TaskbarFields($snap) {
    $added = $false
    if (-not ($snap.PSObject.Properties.Name -contains 'taskbarAutoHide')) {
        $snap | Add-Member -NotePropertyName taskbarAutoHide -NotePropertyValue (Get-TaskbarAutoHide); $added = $true
    }
    if (-not ($snap.PSObject.Properties.Name -contains 'taskbarVisible')) {
        $snap | Add-Member -NotePropertyName taskbarVisible -NotePropertyValue (Test-TaskbarVisible); $added = $true
    }
    return $added
}

if ((Test-Path $path) -and -not $Force) {
    $existing = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Add-TaskbarFields $existing) {
        $tmp = "$path.tmp"
        $existing | ConvertTo-Json | Set-Content -LiteralPath $tmp -Encoding UTF8
        Move-Item -LiteralPath $tmp -Destination $path -Force
        Write-Output "Snapshot kept; added the original taskbar state: $path"
    } else {
        Write-Output "Snapshot already exists, keeping it: $path"
    }
    exit 0
}
if (Test-Path $path) {
    # -Force never destroys the true original: keep it as a timestamped backup.
    $backup = "$path.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
    Copy-Item -LiteralPath $path -Destination $backup
    Write-Output "Previous snapshot kept as $backup"
}

$wallpaperCopy = $null
$wallpaper = Get-RegValue $DesktopKey 'WallPaper'
if ($wallpaper -and (Test-Path -LiteralPath $wallpaper)) {
    # Keep a private copy so restore still works if the user later deletes the original file.
    $ext = [IO.Path]::GetExtension($wallpaper)
    $wallpaperCopy = Join-Path (Get-AppDataDir) "original-wallpaper$ext"
    Copy-Item -LiteralPath $wallpaper -Destination $wallpaperCopy -Force
}

$snapshot = [ordered]@{
    schema              = 1
    takenAt             = (Get-Date).ToString('o')
    wallpaper           = $wallpaper
    wallpaperCopy       = $wallpaperCopy
    wallpaperStyle      = Get-RegValue $DesktopKey 'WallpaperStyle'
    tileWallpaper       = Get-RegValue $DesktopKey 'TileWallpaper'
    hideIconsRegistry   = Get-RegValue $AdvancedKey 'HideIcons'
    desktopIconsVisible = Test-DesktopIconsVisible
    serializeKeyExisted = Test-Path $SerializeKey
    startupDelayInMSec  = Get-RegValue $SerializeKey 'StartupDelayInMSec'
    runEntryExisted     = $null -ne (Get-RegValue $RunKey $AppName)
    taskbarAutoHide     = Get-TaskbarAutoHide
    taskbarVisible      = Test-TaskbarVisible
}

$tmp = "$path.tmp"
$snapshot | ConvertTo-Json | Set-Content -LiteralPath $tmp -Encoding UTF8
Move-Item -LiteralPath $tmp -Destination $path -Force
Write-Output "Snapshot written: $path"
