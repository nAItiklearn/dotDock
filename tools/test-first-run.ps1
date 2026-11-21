<#
.SYNOPSIS
  End-to-end check that a new install starts with the Wind Meadow wallpaper, without touching the
  owner's dotDock data.
.DESCRIPTION
  Runs the real dotdock.exe with LOCALAPPDATA pointed at a fresh folder under
  %LOCALAPPDATA%\dockDock\first-run-e2e, so the app sees a machine it has never run on. Checks that:
    1. the first start applies meadow-dots (dark) and boot.log says so;
    2. Windows is then showing meadow-dots-dark.jpg;
    3. a second start leaves the wallpaper alone;
    4. `--restore-windows` from that fresh profile puts back the wallpaper that was showing before.
  The wallpaper on screen before the run is copied first and put back at the end whatever happens.
  Exits 1 if any check failed.
  -Exe   the dotdock.exe to run (default: the local GNU debug build of this worktree)
#>
param(
    [string]$Exe = (Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\target-gnu\debug\dotdock.exe'),
    [int]$TimeoutSec = 60
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\WinShell.psm1') -Force

$Exe = (Resolve-Path -LiteralPath $Exe).Path
# dotDock is single-instance: with another copy running, the fresh one only hands over to it and exits.
$running = @(Get-Process -Name 'dotdock' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    Write-Output "dotdock.exe is already running (pid $($running.Id -join ', ')); stop it first."
    exit 2
}
# Only the files are isolated: --restore-windows also removes the real logon task and Run value. With
# either present, this machine starts dotDock at sign-in, and the run would turn that off.
$hasTask = [bool](Get-ScheduledTask -TaskName $AppName -ErrorAction SilentlyContinue)
$hasRun = $null -ne (Get-ItemProperty -Path $RunKey -Name $AppName -ErrorAction SilentlyContinue)
if ($hasTask -or $hasRun) {
    Write-Output 'dotDock starts at sign-in on this machine (logon task or Run value); this test would remove that. Not run.'
    exit 2
}
$autoHideBefore = Get-TaskbarAutoHide
# A start picture that is not the meadow, so seeing the meadow afterwards proves the first start set it.
$startPicture = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\assets\wallpapers\soft-mono-light.jpg')).Path
$realLocal = $env:LOCALAPPDATA
$root = Join-Path $realLocal ('dockDock\first-run-e2e\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$profileDir = Join-Path $root 'LocalAppData'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$appDir = Join-Path $profileDir 'dev.dotdock.desktop'
$bootLog = Join-Path $appDir 'boot.log'

$script:Failures = 0
function Check([string]$What, [bool]$Ok, [string]$Detail = '') {
    if ($Ok) { Write-Output "[pass] $What" } else { $script:Failures++; Write-Output "[FAIL] $What $Detail" }
}

function Get-ShownWallpaper {
    (Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name WallPaper).WallPaper
}

function Start-Fresh([string[]]$Arguments = @()) {
    $info = New-Object System.Diagnostics.ProcessStartInfo $Exe
    $info.UseShellExecute = $false
    $info.EnvironmentVariables['LOCALAPPDATA'] = $profileDir
    $info.Arguments = ($Arguments -join " ")
    [System.Diagnostics.Process]::Start($info)
}

function Wait-BootLine([string]$Pattern) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path -LiteralPath $bootLog) -and (Select-String -LiteralPath $bootLog -Pattern $Pattern -Quiet)) { return $true }
        Start-Sleep -Milliseconds 250
    }
    $false
}

function Stop-Fresh($Process) {
    if ($Process -and -not $Process.HasExited) { $Process.Kill(); $Process.WaitForExit(10000) | Out-Null }
}

# The owner's wallpaper, kept aside before anything changes.
$before = Get-ShownWallpaper
$desktop = Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop'
$style = $desktop.WallpaperStyle
$tile = $desktop.TileWallpaper
# Kept outside the fresh profile, which is deleted at the end: the original may be a file Windows
# rewrites (TranscodedWallpaper), so the copy is what is put back.
$keepDir = Join-Path $realLocal 'dockDock\first-run-e2e-keep'
New-Item -ItemType Directory -Force -Path $keepDir | Out-Null
$keep = Join-Path $keepDir ('before' + [IO.Path]::GetExtension($before))
if ($before -and (Test-Path -LiteralPath $before)) { Copy-Item -LiteralPath $before -Destination $keep -Force }
$picture = Join-Path $root 'picture.jpg'
Copy-Item -LiteralPath $startPicture -Destination $picture
Write-Output "Wallpaper before the run: $before"
Set-Wallpaper -Path $picture -Style $style -Tile $tile

$process = $null
try {
    $process = Start-Fresh
    $applied = Wait-BootLine 'first start wallpaper: Applied\("meadow-dots"\)'
    Check 'first start applies meadow-dots' $applied ((Get-Content -LiteralPath $bootLog -ErrorAction SilentlyContinue) -join ' | ')
    $shown = Get-ShownWallpaper
    Check 'Windows shows meadow-dots-dark.jpg' ($shown -like '*\meadow-dots-dark.jpg') $shown
    Check 'the original wallpaper was snapshotted first' (Test-Path -LiteralPath (Join-Path $appDir 'windows-original.json'))
    Check 'the first-run marker is written' (Test-Path -LiteralPath (Join-Path $appDir 'first-run.json'))
    Stop-Fresh $process

    # A second start: the marker exists, so nothing is applied again.
    Set-Wallpaper -Path $picture -Style $style -Tile $tile
    $setups = @(Select-String -LiteralPath $bootLog -Pattern ' setup').Count
    $process = Start-Fresh
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline -and @(Select-String -LiteralPath $bootLog -Pattern ' setup').Count -le $setups) {
        Start-Sleep -Milliseconds 250
    }
    # The first start applies within a second of setup; this waits well past that.
    Start-Sleep -Seconds 5
    $lines = @(Select-String -LiteralPath $bootLog -Pattern 'first start wallpaper').Count
    Check 'a second start does not apply it again' ($lines -eq 1) "lines=$lines"
    Check 'the wallpaper stays as the user left it' ((Get-ShownWallpaper) -eq $picture) (Get-ShownWallpaper)
    Stop-Fresh $process

    # Restore from the fresh profile: its snapshot holds the wallpaper that was showing before the first start.
    $restore = Start-Fresh @('--restore-windows')
    $restore.WaitForExit(30000) | Out-Null
    Check '--restore-windows succeeds' ($restore.ExitCode -eq 0) "exit=$($restore.ExitCode)"
    $restored = Get-ShownWallpaper
    # The fresh profile's snapshot was taken over the start picture, so that is what restore brings back
    # (from its private copy, original-wallpaper.jpg, or the picture itself).
    Check 'restore brings back the wallpaper from before the first start' ((Split-Path $restored -Leaf) -in @('original-wallpaper.jpg', 'picture.jpg')) $restored
} finally {
    Stop-Fresh $process
    # A killed app had no chance to give the taskbar back.
    Show-Taskbar
    Set-TaskbarAutoHide $autoHideBefore
    if (Test-Path -LiteralPath $keep) {
        $original = $before -and (Test-Path -LiteralPath $before) -and
            ((Get-FileHash -LiteralPath $before).Hash -eq (Get-FileHash -LiteralPath $keep).Hash)
        Set-Wallpaper -Path $(if ($original) { $before } else { $keep }) -Style $style -Tile $tile
    }
    Write-Output "Wallpaper after the run: $(Get-ShownWallpaper)"
    # WebView2 may hold its profile for a moment after the process exits.
    for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath $root); $i++) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $root) { Start-Sleep -Seconds 1 }
    }
}
if ($script:Failures -gt 0) { Write-Output "$script:Failures check(s) failed"; exit 1 }
Write-Output 'All first-run checks passed'
