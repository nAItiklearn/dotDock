<#
.SYNOPSIS
  Captures the primary screen on request, from one long-lived process, for live tests that must catch a state
  while it is on screen.
.DESCRIPTION
  Starting PowerShell can take seconds on a busy machine, which is longer than some island states stay on
  screen (a finished turn collapses after a few seconds). This process starts once and then reads one request
  per line on standard input: "<out.png>" or "<out.png>|x,y,width,height" (physical pixels). It captures at once,
  saves the PNG and answers "ok <out.png>" on standard output. It ends when standard input closes.
.PARAMETER Front
  Title of a window to bring to the front before each capture (the test backdrop), so a window that came
  forward meanwhile does not end up in the picture. The always-on-top island stays above it.
#>
param([string]$Front)
$ErrorActionPreference = 'Stop'
# Time for the window manager to finish raising the backdrop before the screen is read.
$RaiseMs = 150
$shell = New-Object -ComObject WScript.Shell
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace DotDock -Name ShotDpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][DotDock.ShotDpi]::SetProcessDPIAware()
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $out, $crop = $line.Split('|')
  $bounds = $screen
  if ($crop) {
    $x, $y, $w, $h = $crop.Split(',') | ForEach-Object { [int]$_ }
    $bounds = New-Object System.Drawing.Rectangle ($screen.X + $x), ($screen.Y + $y), $w, $h
  }
  if ($Front -and $shell.AppActivate($Front)) { Start-Sleep -Milliseconds $RaiseMs }
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Out.WriteLine("ok $out")
  } catch {
    [Console]::Out.WriteLine("failed $out $($_.Exception.Message)")
  } finally {
    $g.Dispose(); $bmp.Dispose()
  }
}
