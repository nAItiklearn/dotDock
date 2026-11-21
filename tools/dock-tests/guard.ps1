<#
.SYNOPSIS
  Start guard for every live dock run: the dock must be invisible and click-through everywhere except the bar.
.DESCRIPTION
  Captures the real screen, starts dotDock (its console hidden, so nothing takes the focus), waits for the dock
  window, captures again and compares the two captures outside the bar. Fails when more than a sliver of the
  screen outside the bar changed (an opaque or white sheet), when the window under points away from the bar is the
  dock, or when the dock took the foreground. On any failure dotDock is quit at once. With -Keep a passing dock is
  left running for the test that follows; without it the dock is quit.
#>
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$OutDir,
  [int]$CdpPort = 9447,
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here 'Capture.psm1') -Force
Import-Module (Join-Path $here 'Windows.psm1') -Force
Import-Module (Join-Path $here 'Cdp.psm1') -Force
Add-Type -ReferencedAssemblies System.Drawing -Namespace DotDock -Name Diff -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
/// Fraction of pixels outside `keep` (x, y, w, h) whose colour moved by more than `tolerance` (sum of channels).
public static double Outside(string a, string b, int kx, int ky, int kw, int kh, int tolerance) {
  using (var A = new System.Drawing.Bitmap(a)) using (var B = new System.Drawing.Bitmap(b)) {
    var r = new System.Drawing.Rectangle(0, 0, A.Width, A.Height);
    var da = A.LockBits(r, System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    var db = B.LockBits(r, System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    var pa = new byte[da.Stride * A.Height]; var pb = new byte[db.Stride * B.Height];
    System.Runtime.InteropServices.Marshal.Copy(da.Scan0, pa, 0, pa.Length);
    System.Runtime.InteropServices.Marshal.Copy(db.Scan0, pb, 0, pb.Length);
    A.UnlockBits(da); B.UnlockBits(db);
    long changed = 0, total = 0;
    for (int y = 0; y < A.Height; y++) for (int x = 0; x < A.Width; x++) {
      if (x >= kx && x < kx + kw && y >= ky && y < ky + kh) continue;
      total++;
      int i = y * da.Stride + x * 4;
      int d = System.Math.Abs(pa[i] - pb[i]) + System.Math.Abs(pa[i + 1] - pb[i + 1]) + System.Math.Abs(pa[i + 2] - pb[i + 2]);
      if (d > tolerance) changed++;
    }
    return total == 0 ? 0 : (double)changed / total;
  }
}
'@

# Outside the bar, at most this share of the screen may change while the dock appears (a clock, a cursor blink).
$MAX_CHANGED = 0.01
# Colour distance below which two captures count as the same pixel (JPEG-free PNG captures, so noise is small).
$TOLERANCE = 30
# Room kept around the bar for its shadow, in physical px.
$SHADOW = 40

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$before = Join-Path $OutDir 'guard-before.png'
$after = Join-Path $OutDir 'guard-after.png'
$results = @()
function Check([string]$Caption, [bool]$Ok, [string]$Detail = '') {
  $script:results += [pscustomobject]@{ Step = $Caption; Ok = $Ok; Detail = $Detail }
}

try {
  Save-Screen $before
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
  Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe) -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(40)
  $shown = $false
  while ((Get-Date) -lt $deadline -and -not $shown) {
    Start-Sleep -Milliseconds 250
    $shown = (Invoke-Dock $CdpPort 'document.querySelector(".dock") !== null') -eq $true
  }
  Check 'The dock draws its bar' $shown
  Start-Sleep -Milliseconds 1500

  if ($shown) {
    Save-Screen $after
    $bar = Invoke-Dock $CdpPort '(() => { const r = document.querySelector(".dock").getBoundingClientRect(); const s = devicePixelRatio; return { x: Math.round(r.x * s + screenX * s), y: Math.round(r.y * s + screenY * s), w: Math.round(r.width * s), h: Math.round(r.height * s) }; })()'
    $kx = $bar.x - $SHADOW; $ky = $bar.y - $SHADOW; $kw = $bar.w + 2 * $SHADOW; $kh = $bar.h + 2 * $SHADOW
    $changed = [DotDock.Diff]::Outside($before, $after, $kx, $ky, $kw, $kh, $TOLERANCE)
    Check 'Nothing outside the bar changed on screen (no opaque or white sheet)' ($changed -le $MAX_CHANGED) ('{0:P2} of the screen outside the bar changed' -f $changed)
    $w = [DotDock.Dpi]::GetSystemMetrics(0); $h = [DotDock.Dpi]::GetSystemMetrics(1)
    $points = @(@{ X = [int]($w / 2); Y = [int]($h / 3) }, @{ X = 20; Y = 20 }, @{ X = $w - 20; Y = [int]($h / 2) }, @{ X = [int]($bar.x - 80); Y = [int]($bar.y + $bar.h / 2) })
    $dockHits = @($points | Where-Object { (Get-WindowAt $_.X $_.Y).Process -eq 'dotdock' })
    Check 'Points away from the bar belong to the windows below, not the dock' ($dockHits.Count -eq 0) ("$($dockHits.Count) of $($points.Count) points hit the dock")
    $fg = Get-Foreground
    Check 'The dock did not take the foreground' ($fg.Process -ne 'dotdock') ("foreground: $($fg.Process) '$($fg.Title)'")
  }
} finally {
  # A failed, empty or unkept run never leaves the dock up, whatever threw.
  if (-not $Keep -or @($results | Where-Object { -not $_.Ok }).Count -gt 0 -or $results.Count -eq 0) { Get-Process dotdock -ErrorAction SilentlyContinue | Stop-Process -Force }
}
$failed = @($results | Where-Object { -not $_.Ok }).Count
$results | ForEach-Object { '| {0} | {1} | {2} |' -f $_.Step, $(if ($_.Ok) { 'PASS' } else { 'FAIL' }), $_.Detail }
exit $failed
