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

Export-ModuleMember -Function * -Variable AppName, DataDirName, DesktopKey, AdvancedKey, SerializeKey, RunKey
