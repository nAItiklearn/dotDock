<#
.SYNOPSIS
  Cuts a rectangle out of PNG captures, for images that show one element (a notch state for the website) with
  an even margin of real desktop around it.
.PARAMETER InDir
  Folder of the captures.
.PARAMETER Filter
  Which files in it, for example notch-*.png.
.PARAMETER OutDir
  Where the cut images go; the names are kept.
.PARAMETER Crop
  "x,y,width,height" in the captures' pixels.
#>
param([Parameter(Mandatory)][string]$InDir, [string]$Filter = '*.png', [Parameter(Mandatory)][string]$OutDir, [Parameter(Mandatory)][string]$Crop)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$x, $y, $w, $h = $Crop.Split(',') | ForEach-Object { [int]$_ }
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($file in Get-ChildItem -Path $InDir -Filter $Filter) {
  $src = [System.Drawing.Image]::FromFile($file.FullName)
  try {
    $bmp = $src.Clone((New-Object System.Drawing.Rectangle $x, $y, $w, $h), $src.PixelFormat)
    $out = Join-Path $OutDir $file.Name
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output $out
  } finally { $src.Dispose() }
}
