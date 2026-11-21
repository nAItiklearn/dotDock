<#
.SYNOPSIS
  Shows a wallpaper full screen behind always-on-top windows (the island, the dock), for live tests and captures.
.DESCRIPTION
  Live tests run while other windows (terminals, editors) cover the desktop. This opens one borderless window
  that fills the primary screen with the given image, brought to the front once but not topmost, so the island
  and the dock stay above it and the screen reads as a clean desktop. Nothing on the system is changed: close the
  window (or stop the process, or let -Seconds run out) and the screen is exactly as before.
.PARAMETER Image
  The picture to show, for example assets\wallpapers\meadow-dots-dark.jpg (Wind Meadow).
.PARAMETER Seconds
  Closes itself after this long, so a forgotten backdrop never outlives a 20 minute screen lock.
#>
param([Parameter(Mandatory)][string]$Image, [int]$Seconds = 1200)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace DotDock -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][DotDock.Dpi]::SetProcessDPIAware()

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Bounds = $screen
$form.ShowInTaskbar = $false
$form.TopMost = $false
$form.Text = 'dotDock test backdrop'
$picture = New-Object System.Windows.Forms.PictureBox
$picture.Dock = 'Fill'
$picture.SizeMode = 'Zoom'
$picture.Image = [System.Drawing.Image]::FromFile((Resolve-Path $Image))
$form.Controls.Add($picture)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $Seconds * 1000
$timer.add_Tick({ $form.Close() })
$timer.Start()
$form.add_Shown({ $form.Activate() })
[void]$form.ShowDialog()
$picture.Image.Dispose()
