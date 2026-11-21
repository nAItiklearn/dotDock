# Live QA helpers for the home screen: real cursor, real clicks, screenshots, and what window is under a point.
# Usage: powershell -File desk.ps1 <command> [args]
#   shot <file.png>               full primary-screen screenshot
#   at <x> <y>                    top-level window under a physical-pixel point (class, process)
#   move <x> <y>                  move the real cursor
#   click <x> <y> [right]         move and click (left by default)
#   drag <x1> <y1> <x2> <y2> <ms> press, move in 60 Hz steps over <ms>, release
#   hold <x> <y> <ms>             press and hold still, then release
#   find <name>                   UI Automation: bounding box of the element named <name> (physical px)
#   style                         the overlay's click-through / no-activate bits and focus
#   wait <ms> | minimize-all | restore-all
#   run <scenario.txt>            run one step per line in a single process
param([string]$cmd, [Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Desk {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
[Desk]::SetProcessDPIAware() | Out-Null
function Down($right) { if ($right) { [Desk]::mouse_event(0x08,0,0,0,[UIntPtr]::Zero) } else { [Desk]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero) } }
function Up($right) { if ($right) { [Desk]::mouse_event(0x10,0,0,0,[UIntPtr]::Zero) } else { [Desk]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero) } }
function Invoke-Desk([string]$cmd, [string[]]$rest) {
switch ($cmd) {
  'shot' {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($rest[0], [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
    "saved $($rest[0]) $($b.Width)x$($b.Height)"
  }
  'at' {
    $p = New-Object Desk+POINT; $p.X = [int]$rest[0]; $p.Y = [int]$rest[1]
    $h = [Desk]::GetAncestor([Desk]::WindowFromPoint($p), 2)
    $c = New-Object System.Text.StringBuilder 256; [Desk]::GetClassName($h, $c, 256) | Out-Null
    $t = New-Object System.Text.StringBuilder 256; [Desk]::GetWindowText($h, $t, 256) | Out-Null
    $procId = 0; [Desk]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    "$($c.ToString())|$($t.ToString())|$name"
  }
  'move' { [Desk]::SetCursorPos([int]$rest[0], [int]$rest[1]) | Out-Null }
  'click' {
    [Desk]::SetCursorPos([int]$rest[0], [int]$rest[1]) | Out-Null; Start-Sleep -Milliseconds 120
    $r = $rest.Count -gt 2 -and $rest[2] -eq 'right'; Down $r; Start-Sleep -Milliseconds 70; Up $r
  }
  'drag' {
    $x1=[double]$rest[0]; $y1=[double]$rest[1]; $x2=[double]$rest[2]; $y2=[double]$rest[3]; $ms=[int]$rest[4]
    [Desk]::SetCursorPos([int]$x1, [int]$y1) | Out-Null; Start-Sleep -Milliseconds 120; Down $false
    $steps = [Math]::Max(2, [int]($ms / 16))
    for ($i = 1; $i -le $steps; $i++) {
      $t = $i / $steps; $e = 1 - [Math]::Pow(1 - $t, 3)
      [Desk]::SetCursorPos([int]($x1 + ($x2 - $x1) * $e), [int]($y1 + ($y2 - $y1) * $e)) | Out-Null
      Start-Sleep -Milliseconds 16
    }
    Start-Sleep -Milliseconds 120; Up $false
  }
  'hold' {
    [Desk]::SetCursorPos([int]$rest[0], [int]$rest[1]) | Out-Null; Start-Sleep -Milliseconds 120
    Down $false; Start-Sleep -Milliseconds ([int]$rest[2]); Up $false
  }
  'find' {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), $rest[0]
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($null -eq $el) { "none" } else { $r = $el.Current.BoundingRectangle; "$([int]$r.X) $([int]$r.Y) $([int]$r.Width) $([int]$r.Height)" }
  }
  'style' {
    # The overlay's click-through (WS_EX_TRANSPARENT) and no-activate bits, and whether it has focus.
    $h = [Desk]::FindWindow("Tauri Window", "Desktop")
    if ($h -eq [IntPtr]::Zero) { "no overlay" } else {
      $ex = [Desk]::GetWindowLongPtr($h, -20).ToInt64()
      "transparent=$([int](($ex -band 0x20) -ne 0)) noactivate=$([int](($ex -band 0x08000000) -ne 0)) foreground=$([int]([Desk]::GetForegroundWindow() -eq $h))"
    }
  }
  'wait' { Start-Sleep -Milliseconds ([int]$rest[0]) }
  'minimize-all' { (New-Object -ComObject Shell.Application).MinimizeAll() }
  'restore-all' { (New-Object -ComObject Shell.Application).UndoMinimizeALL() }
}
}
if ($cmd -eq 'run') {
  # One process for a whole scenario: no PowerShell start-up between steps, so the run keeps a human pace.
  foreach ($line in Get-Content $rest[0]) {
    $t = $line.Trim(); if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $parts = $t -split '\s+'
    $out = Invoke-Desk $parts[0] ([string[]]($parts | Select-Object -Skip 1))
    if ($out) { "$t => $out" }
  }
} else { Invoke-Desk $cmd $rest }
