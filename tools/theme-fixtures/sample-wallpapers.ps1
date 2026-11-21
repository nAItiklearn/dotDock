<#
.SYNOPSIS
  Shrinks real wallpapers to the pixel grid "Theme from your wallpaper" reads, for the palette tests.
.DESCRIPTION
  Each picture is scaled, high-quality bicubic, so its longest side is 64 px (SAMPLE_EDGE in
  apps/desktop/src/lib/theme/imageSample.ts), the same grid the webview hands the palette. Written as
  `<name>.rgb`: two little-endian uint16 (width, height), then width*height RGB bytes.
  -Source  folder of .jpg/.jpeg/.png pictures (default: the app's own wallpapers, assets/wallpapers)
  -Out     output folder (default: the committed fixtures, apps/desktop/src/lib/theme/fixtures/wallpapers)
  Pictures that are not ours (Windows' own, the owner's references) go to fixtures-local, which is never committed.
#>
param(
    [string]$Source = (Join-Path $PSScriptRoot '..\..\assets\wallpapers'),
    [string]$Out = (Join-Path $PSScriptRoot '..\..\apps\desktop\src\lib\theme\fixtures\wallpapers'),
    [string]$Prefix = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$edge = 64
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$files = Get-ChildItem -LiteralPath $Source -File | Where-Object { $_.Extension -match '^\.(jpe?g|png)$' }
foreach ($file in $files) {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    try {
        $scale = [Math]::Min(1.0, $edge / [Math]::Max($image.Width, $image.Height))
        $w = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
        $h = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
        $bitmap = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $g = [System.Drawing.Graphics]::FromImage($bitmap)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($image, 0, 0, $w, $h)
        $g.Dispose()
        $bytes = New-Object byte[] (4 + $w * $h * 3)
        [BitConverter]::GetBytes([uint16]$w).CopyTo($bytes, 0)
        [BitConverter]::GetBytes([uint16]$h).CopyTo($bytes, 2)
        $at = 4
        for ($y = 0; $y -lt $h; $y++) {
            for ($x = 0; $x -lt $w; $x++) {
                $c = $bitmap.GetPixel($x, $y)
                $bytes[$at] = $c.R; $bytes[$at + 1] = $c.G; $bytes[$at + 2] = $c.B
                $at += 3
            }
        }
        $bitmap.Dispose()
        $name = $Prefix + [IO.Path]::GetFileNameWithoutExtension($file.Name) + '.rgb'
        [IO.File]::WriteAllBytes((Join-Path $Out $name), $bytes)
        Write-Output "$name ${w}x$h"
    } finally {
        $image.Dispose()
    }
}
