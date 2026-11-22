<#
.SYNOPSIS
  Captures a part of the primary screen again and again, as a numbered frame sequence, for live tests.
.DESCRIPTION
  One process does all the captures, so a frame costs a few milliseconds instead of a PowerShell start: fast
  enough to record how an animation moves (the island expanding, the beetle walking in, a burst of sparks).
  Frames are PNGs named <Prefix>-0001.png, -0002.png... in -Dir.
.PARAMETER Crop
  "x,y,width,height" in physical pixels.
.PARAMETER Every
  Milliseconds between two frames.
.PARAMETER Seconds
  How long to record.
#>
param(
  [Parameter(Mandatory)][string]$Dir,
  [Parameter(Mandatory)][string]$Prefix,
  [Parameter(Mandatory)][string]$Crop,
  [int]$Every = 250,
  [int]$Seconds = 30
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace DotDock -Name SeqDpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][DotDock.SeqDpi]::SetProcessDPIAware()
New-Item -ItemType Directory -Force $Dir | Out-Null
$x, $y, $w, $h = $Crop.Split(',') | ForEach-Object { [int]$_ }
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$origin = New-Object System.Drawing.Point ($screen.X + $x), ($screen.Y + $y)
$size = New-Object System.Drawing.Size $w, $h
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$frame = 0
try {
  while ($clock.ElapsedMilliseconds -lt $Seconds * 1000) {
    $due = $frame * $Every
    $wait = $due - $clock.ElapsedMilliseconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
    $frame++
    $g.CopyFromScreen($origin, [System.Drawing.Point]::Empty, $size)
    $bmp.Save((Join-Path $Dir ('{0}-{1:D4}.png' -f $Prefix, $frame)), [System.Drawing.Imaging.ImageFormat]::Png)
  }
} finally {
  $g.Dispose(); $bmp.Dispose()
}
Write-Output "$frame frames -> $Dir"
