<#
.SYNOPSIS
  Window facts for the live dock run's PASS/FAIL checks: the foreground window, the window under a point, and the
  visible top-level windows of a process.
#>
$ErrorActionPreference = 'Stop'
Add-Type -Namespace DotDock -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
public struct POINT { public int X; public int Y; }
'@

function Get-WindowFacts([IntPtr]$Handle) {
  $title = New-Object System.Text.StringBuilder 256
  [void][DotDock.Win]::GetWindowText($Handle, $title, 256)
  $procId = [uint32]0
  [void][DotDock.Win]::GetWindowThreadProcessId($Handle, [ref]$procId)
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  [pscustomobject]@{ Handle = $Handle; Title = "$title"; Process = $name; Minimized = [DotDock.Win]::IsIconic($Handle) }
}

function Get-Foreground { Get-WindowFacts ([DotDock.Win]::GetForegroundWindow()) }

function Get-WindowAt([int]$X, [int]$Y) {
  $p = New-Object DotDock.Win+POINT; $p.X = $X; $p.Y = $Y
  # GA_ROOT: the top-level window, not the child control under the point.
  Get-WindowFacts ([DotDock.Win]::GetAncestor([DotDock.Win]::WindowFromPoint($p), 2))
}

function Set-Minimized([IntPtr]$Handle) { [void][DotDock.Win]::ShowWindow($Handle, 6) }

Export-ModuleMember -Function Get-Foreground, Get-WindowAt, Get-WindowFacts, Set-Minimized
