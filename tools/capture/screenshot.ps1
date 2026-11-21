<#
.SYNOPSIS
  Captures the primary screen (physical pixels) to a PNG, for visual QA of the real desktop.
.PARAMETER Crop
  Optional "x,y,width,height" in physical pixels: only that part of the screen is saved, for close-ups.
#>
param([Parameter(Mandatory)][string]$Out, [string]$Crop)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace DotDock -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][DotDock.Dpi]::SetProcessDPIAware()
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($Crop) {
  $x, $y, $w, $h = $Crop.Split(',') | ForEach-Object { [int]$_ }
  $bounds = New-Object System.Drawing.Rectangle ($bounds.X + $x), ($bounds.Y + $y), $w, $h
}
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "$($bounds.Width)x$($bounds.Height) -> $Out"
