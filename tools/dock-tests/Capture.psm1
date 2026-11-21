# Real screen captures in physical pixels (the process is made DPI aware first), for live dock checks.
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace DotDock -Name Dpi -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
'@
[void][DotDock.Dpi]::SetProcessDPIAware()

function Save-Screen([Parameter(Mandatory)][string]$Path) {
  $w = [DotDock.Dpi]::GetSystemMetrics(0); $h = [DotDock.Dpi]::GetSystemMetrics(1)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Export-ModuleMember -Function Save-Screen
