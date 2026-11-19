<#
.SYNOPSIS
  Records the original Windows desktop state once, before dotDock changes anything.
.DESCRIPTION
  Writes %LOCALAPPDATA%\dotDock\windows-original.json. Never overwrites an existing
  snapshot unless -Force is given, so the user's true original is always preserved.
#>
param([switch]$Force)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

$path = Get-SnapshotPath
if ((Test-Path $path) -and -not $Force) {
    Write-Output "Snapshot already exists, keeping it: $path"
    exit 0
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
}

$tmp = "$path.tmp"
$snapshot | ConvertTo-Json | Set-Content -LiteralPath $tmp -Encoding UTF8
Move-Item -LiteralPath $tmp -Destination $path -Force
Write-Output "Snapshot written: $path"
