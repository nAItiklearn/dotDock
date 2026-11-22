<#
.SYNOPSIS
  Real mouse input for the live dock run (docs/QA/dock-live/). Moves at a human pace so the owner can follow, and
  so the dock's cursor poller sees every step. Coordinates are physical screen pixels.
#>
$ErrorActionPreference = 'Stop'
Add-Type -Namespace DotDock -Name Input -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
public struct POINT { public int X; public int Y; }
'@
[void][DotDock.Input]::SetProcessDPIAware()

$LEFT_DOWN = 0x0002; $LEFT_UP = 0x0004; $RIGHT_DOWN = 0x0008; $RIGHT_UP = 0x0010
# One step every frame of a 60 Hz screen, so the motion reads as continuous.
$STEP_MS = 16

function Get-Cursor { $p = New-Object DotDock.Input+POINT; [void][DotDock.Input]::GetCursorPos([ref]$p); $p }

function Move-Mouse([int]$X, [int]$Y, [int]$DurationMs = 600) {
  $from = Get-Cursor
  $steps = [Math]::Max(1, [int]($DurationMs / $STEP_MS))
  for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    $e = $t * $t * (3 - 2 * $t)
    [void][DotDock.Input]::SetCursorPos([int]($from.X + ($X - $from.X) * $e), [int]($from.Y + ($Y - $from.Y) * $e))
    Start-Sleep -Milliseconds $STEP_MS
  }
}

function Invoke-Click([int]$X, [int]$Y, [switch]$Right) {
  Move-Mouse $X $Y
  Start-Sleep -Milliseconds 150
  if ($Right) { $down = $RIGHT_DOWN; $up = $RIGHT_UP } else { $down = $LEFT_DOWN; $up = $LEFT_UP }
  [DotDock.Input]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [DotDock.Input]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}

# Press at (X, Y), move to (ToX, ToY) at a human pace and release: a real drag, as a hand would make it.
function Invoke-Drag([int]$X, [int]$Y, [int]$ToX, [int]$ToY, [int]$DurationMs = 900) {
  Move-Mouse $X $Y
  Start-Sleep -Milliseconds 150
  [DotDock.Input]::mouse_event($LEFT_DOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 200
  Move-Mouse $ToX $ToY $DurationMs
  Start-Sleep -Milliseconds 200
  [DotDock.Input]::mouse_event($LEFT_UP, 0, 0, 0, [UIntPtr]::Zero)
}

# Turns the wheel by `Notches` (positive away from the user) at the cursor.
function Invoke-Wheel([int]$Notches) {
  $WHEEL = 0x0800; $NOTCH = 120
  [DotDock.Input]::mouse_event($WHEEL, 0, 0, $Notches * $NOTCH, [UIntPtr]::Zero)
}

Export-ModuleMember -Function Move-Mouse, Invoke-Click, Invoke-Drag, Invoke-Wheel, Get-Cursor
