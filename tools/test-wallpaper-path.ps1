<#
.SYNOPSIS
  Checks the wallpaper path guard of the restore script (docs/DECISIONS.md D-042) without changing anything.
.DESCRIPTION
  Test-UsableWallpaperPath and Select-RestoreWallpaper must refuse a relative, drive-less, mangled or missing path
  and pick the snapshot's private copy, then its original. Reads and writes only a temporary folder; never sets the
  wallpaper. Exits 1 when a check fails.
#>
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

$script:Failed = 0
function Check([string]$What, [bool]$Ok) {
    if ($Ok) { Write-Output "[ok] $What" } else { $script:Failed++; Write-Output "[failed] $What" }
}

$dir = Join-Path ([IO.Path]::GetTempPath()) ("dotdock-wallpaper-path-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
try {
    $copy = Join-Path $dir 'original-wallpaper.jpeg'
    $original = Join-Path $dir 'coast.jpg'
    Set-Content -LiteralPath $copy -Value 'jpeg'
    Set-Content -LiteralPath $original -Value 'jpeg'
    $mangled = ':LOCALAPPDATA\dev.dotdock.desktop\original-wallpaper.jpeg'

    Check 'an absolute path to a file is usable' (Test-UsableWallpaperPath $copy)
    Check 'the mangled path that blacked out the desktop is refused' (-not (Test-UsableWallpaperPath $mangled))
    Check 'a relative path is refused' (-not (Test-UsableWallpaperPath 'dev.dotdock.desktop\original-wallpaper.jpeg'))
    Check 'a path without a drive is refused' (-not (Test-UsableWallpaperPath '\dev.dotdock.desktop\original-wallpaper.jpeg'))
    Check 'a missing file is refused' (-not (Test-UsableWallpaperPath (Join-Path $dir 'gone.jpg')))
    Check 'a folder is refused' (-not (Test-UsableWallpaperPath $dir))
    Check 'an empty path is refused' (-not (Test-UsableWallpaperPath ''))

    Check 'the private copy comes first' ((Select-RestoreWallpaper ([pscustomobject]@{ wallpaperCopy = $copy; wallpaper = $original })) -eq $copy)
    Check 'a mangled copy falls back to the original' ((Select-RestoreWallpaper ([pscustomobject]@{ wallpaperCopy = $mangled; wallpaper = $original })) -eq $original)
    Check 'nothing usable gives nothing to set' ($null -eq (Select-RestoreWallpaper ([pscustomobject]@{ wallpaperCopy = $mangled; wallpaper = $null })))

    $refused = $false
    try { Set-Wallpaper -Path $mangled -Style '10' -Tile '0' } catch { $refused = $true }
    Check 'Set-Wallpaper refuses the mangled path before touching anything' $refused
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force
}

if ($script:Failed -gt 0) { Write-Output "$script:Failed check(s) failed."; exit 1 }
Write-Output 'Wallpaper path checks passed.'
