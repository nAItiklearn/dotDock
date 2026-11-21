# Read-only check of the desktop state after a dotDock test: dotDock processes, dev servers, taskbar.
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='dotdock.exe'" |
  ForEach-Object {
    $cmd = [string]$_.CommandLine -replace '\s+', ' '
    '{0,6} {1}' -f $_.ProcessId, $cmd.Substring(0, [Math]::Min(140, $cmd.Length))
  }
$settings = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3').Settings
'taskbar auto-hide flag byte: ' + $settings[8] + ' (3 = auto-hide on, 2 = off)'
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
'@
'taskbar window visible: ' + [W.U]::IsWindowVisible([W.U]::FindWindow('Shell_TrayWnd', $null))
