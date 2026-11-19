<#
.SYNOPSIS
  Read-only diagnostic: prints the desktop window hierarchy (Progman / WorkerW / DefView).
  Used to pick and debug the desktop host strategy on a given Windows build.
#>
$ErrorActionPreference = 'Stop'
if (-not ('DotDock.Probe' -as [type])) {
    Add-Type -Namespace DotDock -Name Probe -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
[DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
'@
}
$GW_HWNDNEXT = 2
$GW_CHILD = 5

function Get-ClassName([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 256
    $n = [DotDock.Probe]::GetClassName($h, $sb, 256)
    if ($n -eq 0) { return "<err $([Runtime.InteropServices.Marshal]::GetLastWin32Error())>" }
    return $sb.ToString()
}
function Get-Owner([IntPtr]$h) {
    $procId = [uint32]0
    [void][DotDock.Probe]::GetWindowThreadProcessId($h, [ref]$procId)
    return (Get-Process -Id $procId -ErrorAction SilentlyContinue).Name
}
function Show-Tree([IntPtr]$h, [int]$depth) {
    $c = [DotDock.Probe]::GetWindow($h, $GW_CHILD)
    while ($c -ne [IntPtr]::Zero) {
        Write-Output (('  ' * $depth) + (Get-ClassName $c) + " [$(Get-Owner $c)] visible=$([DotDock.Probe]::IsWindowVisible($c))")
        if ($depth -lt 3) { Show-Tree $c ($depth + 1) }
        $c = [DotDock.Probe]::GetWindow($c, $GW_HWNDNEXT)
    }
}

$shell = [DotDock.Probe]::GetShellWindow()
Write-Output "Shell window: $shell $(Get-ClassName $shell) [$(Get-Owner $shell)]"
$h = [DotDock.Probe]::GetWindow([DotDock.Probe]::GetDesktopWindow(), $GW_CHILD)
while ($h -ne [IntPtr]::Zero) {
    $cls = Get-ClassName $h
    if ($cls -match 'Progman|WorkerW') {
        Write-Output "$cls [$(Get-Owner $h)] visible=$([DotDock.Probe]::IsWindowVisible($h))"
        Show-Tree $h 1
    }
    $h = [DotDock.Probe]::GetWindow($h, $GW_HWNDNEXT)
}
