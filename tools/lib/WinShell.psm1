# Shared helpers for the snapshot and restore scripts.
# Scope: HKCU only. Never touches HKLM or system files.

Set-StrictMode -Version Latest

$script:AppName = 'dotDock'
# App data folder; must match APP_DIR in apps/desktop/src-tauri/shell/src/lib.rs.
# Separate from %LOCALAPPDATA%\dotDock, where the per-user installer puts the program.
$script:DataDirName = 'dev.dotdock.desktop'
$script:DesktopKey = 'HKCU:\Control Panel\Desktop'
$script:AdvancedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$script:SerializeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize'
$script:RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

if (-not ('DotDock.Native' -as [type])) {
    Add-Type -Namespace DotDock -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, string pvParam, uint fWinIni);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
[DllImport("user32.dll")]
public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[StructLayout(LayoutKind.Sequential)]
public struct APPBARDATA {
    public uint cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge;
    public int left; public int top; public int right; public int bottom; public IntPtr lParam;
}
[DllImport("shell32.dll")]
public static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);
'@
}

function Get-AppDataDir {
    $dir = Join-Path $env:LOCALAPPDATA $script:DataDirName
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    return $dir
}

function Get-SnapshotPath { Join-Path (Get-AppDataDir) 'windows-original.json' }

function Get-RegValue([string]$Path, [string]$Name) {
    $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    return $item.$Name
}

# Finds the SHELLDLL_DefView that hosts desktop icons. On Windows 11 24H2+ it can
# live under Progman or under a WorkerW sibling, so both layouts are searched.
function Get-DesktopDefView {
    $progman = [DotDock.Native]::FindWindow('Progman', [NullString]::Value)
    $defView = [DotDock.Native]::FindWindowEx($progman, [IntPtr]::Zero, 'SHELLDLL_DefView', [NullString]::Value)
    if ($defView -ne [IntPtr]::Zero) { return $defView }
    $worker = [IntPtr]::Zero
    while ($true) {
        $worker = [DotDock.Native]::FindWindowEx([IntPtr]::Zero, $worker, 'WorkerW', [NullString]::Value)
        if ($worker -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
        $defView = [DotDock.Native]::FindWindowEx($worker, [IntPtr]::Zero, 'SHELLDLL_DefView', [NullString]::Value)
        if ($defView -ne [IntPtr]::Zero) { return $defView }
    }
}

function Test-DesktopIconsVisible {
    $defView = Get-DesktopDefView
    if ($defView -eq [IntPtr]::Zero) { return $null }
    $list = [DotDock.Native]::FindWindowEx($defView, [IntPtr]::Zero, 'SysListView32', [NullString]::Value)
    if ($list -eq [IntPtr]::Zero) { return $null }
    return [DotDock.Native]::IsWindowVisible($list)
}

# Explorer's own "Show desktop icons" toggle command (same as the context menu item).
function Set-DesktopIconsVisible([bool]$Visible) {
    $current = Test-DesktopIconsVisible
    if ($null -eq $current -or $current -eq $Visible) { return }
    $toggleIconsCommand = 0x7402
    $wmCommand = 0x0111
    [void][DotDock.Native]::SendMessage((Get-DesktopDefView), $wmCommand, [IntPtr]$toggleIconsCommand, [IntPtr]::Zero)
}

function Set-Wallpaper([string]$Path, [string]$Style, [string]$Tile) {
    if ($null -ne $Style) { Set-ItemProperty -Path $script:DesktopKey -Name WallpaperStyle -Value $Style }
    if ($null -ne $Tile) { Set-ItemProperty -Path $script:DesktopKey -Name TileWallpaper -Value $Tile }
    $spiSetDeskWallpaper = 0x0014
    $updateAndBroadcast = 0x01 -bor 0x02
    $value = if ($Path) { $Path } else { '' }
    [void][DotDock.Native]::SystemParametersInfo($spiSetDeskWallpaper, 0, $value, $updateAndBroadcast)
}

# ---------- Taskbar (dock phase) ----------
$script:AbmGetState = 0x4
$script:AbmSetState = 0xA
$script:AbsAutoHide = 0x1
$script:AbsAlwaysOnTop = 0x2
$script:SwShow = 5

# The primary taskbar and the one on every other monitor.
function Get-TaskbarWindows {
    $list = @()
    $primary = [DotDock.Native]::FindWindow('Shell_TrayWnd', [NullString]::Value)
    if ($primary -ne [IntPtr]::Zero) { $list += $primary }
    $next = [IntPtr]::Zero
    while ($true) {
        $next = [DotDock.Native]::FindWindowEx([IntPtr]::Zero, $next, 'Shell_SecondaryTrayWnd', [NullString]::Value)
        if ($next -eq [IntPtr]::Zero) { break }
        $list += $next
    }
    return $list
}

function Test-TaskbarVisible {
    $bars = @(Get-TaskbarWindows)
    if ($bars.Count -eq 0) { return $null }
    foreach ($bar in $bars) { if (-not [DotDock.Native]::IsWindowVisible($bar)) { return $false } }
    return $true
}

function Show-Taskbar {
    foreach ($bar in @(Get-TaskbarWindows)) { [void][DotDock.Native]::ShowWindow($bar, $script:SwShow) }
}

function New-AppBarData {
    $data = New-Object DotDock.Native+APPBARDATA
    $data.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($data)
    $data.hWnd = [DotDock.Native]::FindWindow('Shell_TrayWnd', [NullString]::Value)
    return $data
}

# True when "Automatically hide the taskbar" is on.
function Get-TaskbarAutoHide {
    $data = New-AppBarData
    $state = [DotDock.Native]::SHAppBarMessage($script:AbmGetState, [ref]$data).ToUInt32()
    return [bool]($state -band $script:AbsAutoHide)
}

function Set-TaskbarAutoHide([bool]$On) {
    $data = New-AppBarData
    $data.lParam = [IntPtr]$(if ($On) { $script:AbsAutoHide } else { $script:AbsAlwaysOnTop })
    [void][DotDock.Native]::SHAppBarMessage($script:AbmSetState, [ref]$data)
}

Export-ModuleMember -Function * -Variable AppName, DataDirName, DesktopKey, AdvancedKey, SerializeKey, RunKey
