<#
.SYNOPSIS
  Real mouse input for live tests, one command per line on stdin, so a driver can move the visible cursor at a
  human pace without starting PowerShell for every step.
.DESCRIPTION
  Commands (coordinates in physical screen pixels):
    move <x> <y>       put the cursor there
    left <x> <y>       move there and click the left button
    right <x> <y>      move there and click the right button
    hwheel <delta>     scroll sideways by delta (120 is one notch) where the cursor is
    rect <title>       print "rect <left> <top> <right> <bottom>" of the top-level window with that title
    activate <title>   bring the window with that title to the front (takes focus away from whatever had it)
    quit               put the cursor back where it was at start and exit
  Every command answers one line ("ok" or the result) so the driver can wait for it.
#>
$ErrorActionPreference = 'Stop'
Add-Type -Namespace DotDock -Name Input -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, System.UIntPtr extra);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
'@
[void][DotDock.Input]::SetProcessDPIAware()
# mouse_event flags (winuser.h).
$LEFTDOWN = 0x0002; $LEFTUP = 0x0004; $RIGHTDOWN = 0x0008; $RIGHTUP = 0x0010; $HWHEEL = 0x01000
$start = New-Object DotDock.Input+POINT
[void][DotDock.Input]::GetCursorPos([ref]$start)

function Click([int]$x, [int]$y, [uint32]$down, [uint32]$up) {
  [void][DotDock.Input]::SetCursorPos($x, $y)
  [DotDock.Input]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  [DotDock.Input]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}

try {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $cmd, $rest = $line.Trim() -split ' ', 2
    switch ($cmd) {
      'move' { $x, $y = $rest -split ' '; [void][DotDock.Input]::SetCursorPos([int]$x, [int]$y); 'ok' }
      'left' { $x, $y = $rest -split ' '; Click ([int]$x) ([int]$y) $LEFTDOWN $LEFTUP; 'ok' }
      'right' { $x, $y = $rest -split ' '; Click ([int]$x) ([int]$y) $RIGHTDOWN $RIGHTUP; 'ok' }
      'hwheel' { [DotDock.Input]::mouse_event($HWHEEL, 0, 0, [int]$rest, [UIntPtr]::Zero); 'ok' }
      'rect' {
        $h = [DotDock.Input]::FindWindow([NullString]::Value, $rest)
        $r = New-Object DotDock.Input+RECT
        if ($h -eq [IntPtr]::Zero -or -not [DotDock.Input]::GetWindowRect($h, [ref]$r)) { 'none' }
        else { "rect $($r.Left) $($r.Top) $($r.Right) $($r.Bottom)" }
      }
      'activate' {
        $h = [DotDock.Input]::FindWindow([NullString]::Value, $rest)
        if ($h -eq [IntPtr]::Zero) { 'none' } else { [void][DotDock.Input]::SetForegroundWindow($h); 'ok' }
      }
      'quit' { break }
      default { "unknown $cmd" }
    }
    if ($cmd -eq 'quit') { break }
  }
} finally {
  [void][DotDock.Input]::SetCursorPos($start.X, $start.Y)
}
