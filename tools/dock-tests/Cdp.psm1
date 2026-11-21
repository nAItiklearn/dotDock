<#
.SYNOPSIS
  Reads what the running dock shows, over WebView2 remote debugging (cdp.mjs). The expression goes through a file:
  Windows PowerShell strips the double quotes out of arguments it passes to a native program, which broke every
  selector like ".dock" when it was passed inline.
#>
$cdp = Join-Path $PSScriptRoot 'cdp.mjs'

function Invoke-Dock([int]$Port, [string]$Expression, [string]$Page = 'dock.html') {
  $file = [System.IO.Path]::GetTempFileName()
  # node writes to stderr while the dock's debug port is not up yet; that is "no answer", not a failure.
  $ErrorActionPreference = 'Continue'
  try {
    Set-Content -Path $file -Value $Expression -Encoding UTF8
    $out = (& node $cdp $Port $Page "@$file" 2>$null) -join ''
    if ($LASTEXITCODE -ne 0 -or $out -eq '') { return $null }
    $out | ConvertFrom-Json
  } catch { return $null } finally { Remove-Item $file -ErrorAction SilentlyContinue }
}

Export-ModuleMember -Function Invoke-Dock
