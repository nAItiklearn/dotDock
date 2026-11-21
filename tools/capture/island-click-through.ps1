<#
.SYNOPSIS
  Proves on the real desktop that the island's window lets clicks through everywhere outside the visible notch.
.DESCRIPTION
  Finds the running "Agent Island" window of dotdock.exe and puts the real cursor on points of that window that
  lie outside the plate (corners, the bottom edge, the sides), then on the plate itself. At each point it asks
  Windows which window a click there would reach (WindowFromPoint skips click-through windows). Outside the
  plate the answer must never be the island; on the plate it must be the island (it accepts clicks there).
  The cursor is put back where it was. Exit code 0 when every check passes, 1 otherwise.
.PARAMETER PlateDepth
  How far down from the window's top the plate reaches in this run, in physical pixels; points below it and
  beside the plate's width are the ones that must click through.
.PARAMETER PlateWidth
  Width of the visible plate in physical pixels, centred in the window.
.PARAMETER Standby
  The island shows only its small standby pill, which takes no clicks: then the centre must click through too.
#>
param([int]$PlateDepth = 60, [int]$PlateWidth = 160, [switch]$Standby)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace DotDock -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern int GetWindowLong(System.IntPtr h, int i);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
'@
[void][DotDock.Win]::SetProcessDPIAware()
$island = [DotDock.Win]::FindWindow([NullString]::Value, 'Agent Island')
if ($island -eq [IntPtr]::Zero) { Write-Output 'FAIL: no Agent Island window'; exit 1 }
$r = New-Object DotDock.Win+RECT
[void][DotDock.Win]::GetWindowRect($island, [ref]$r)
$cx = [int](($r.Left + $r.Right) / 2)
$saved = New-Object DotDock.Win+POINT
[void][DotDock.Win]::GetCursorPos([ref]$saved)
$inset = 6
$half = [int]($PlateWidth / 2) + $inset
# Every point lies inside the island's window rectangle but outside the plate.
$through = @(
  @(($r.Left + $inset), ($r.Top + $inset), 'top-left corner'),
  @(($r.Right - $inset), ($r.Top + $inset), 'top-right corner'),
  @(($cx - $half - 20), ($r.Top + $inset), 'left of the plate'),
  @(($cx + $half + 20), ($r.Top + $inset), 'right of the plate'),
  @(($r.Left + $inset), ($r.Bottom - $inset), 'bottom-left corner'),
  @(($cx), ($r.Bottom - $inset), 'below the plate, centre'),
  @(($r.Right - $inset), ($r.Bottom - $inset), 'bottom-right corner'),
  @(($cx), ($r.Top + $PlateDepth + 24), 'just under the plate'),
  @(($r.Left + $inset), ([int](($r.Top + $r.Bottom) / 2)), 'left edge, middle'),
  @(($r.Right - $inset), ([int](($r.Top + $r.Bottom) / 2)), 'right edge, middle')
)
$hit = {
  param($x, $y)
  [void][DotDock.Win]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 220
  $p = New-Object DotDock.Win+POINT; $p.X = $x; $p.Y = $y
  [DotDock.Win]::GetAncestor([DotDock.Win]::WindowFromPoint($p), 2)
}
$failed = 0
Write-Output ("island window {0},{1} {2}x{3}" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
try {
  foreach ($pt in $through) {
    $root = & $hit $pt[0] $pt[1]
    $ok = $root -ne $island
    if (-not $ok) { $failed++ }
    Write-Output ('{0} click passes through at {1},{2} ({3})' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $pt[0], $pt[1], $pt[2])
  }
  $root = & $hit $cx ($r.Top + [int]($PlateDepth / 2))
  $ok = if ($Standby) { $root -ne $island } else { $root -eq $island }
  if (-not $ok) { $failed++ }
  $what = if ($Standby) { 'the standby pill lets the click through' } else { 'the plate itself takes the click' }
  Write-Output ('{0} {1} at {2},{3}' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $what, $cx, ($r.Top + [int]($PlateDepth / 2)))
} finally {
  [void][DotDock.Win]::SetCursorPos($saved.X, $saved.Y)
}
if ($failed) { Write-Output "$failed check(s) failed"; exit 1 }
Write-Output 'all click-through checks passed'
