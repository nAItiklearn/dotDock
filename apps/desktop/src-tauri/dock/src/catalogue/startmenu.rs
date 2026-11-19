//! Start menu shortcuts: both `Programs` folders, resolved through `IShellLinkW`.

use super::AppEntry;
use crate::com::{cast, from_wide, store_string, ComGuard};
use crate::util::expand_env;
use std::path::{Path, PathBuf};
use windows::core::Interface;
use windows::Win32::Foundation::MAX_PATH;
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    FOLDERID_CommonStartMenu, FOLDERID_StartMenu, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT,
};

/// Folder under each Start menu root that holds the program shortcuts.
const PROGRAMS: &str = "Programs";
/// Shortcuts in here launch at sign-in; they are not something the user opens from a dock.
const STARTUP_FOLDER: &str = "Startup";
const SHORTCUT_EXTENSION: &str = "lnk";
/// Upper bound on resolver threads; past this the disk, not the CPU, is the limit.
const MAX_WORKERS: usize = 8;
/// Characters of a shortcut's arguments that are read (the shell's own limit is `INFOTIPSIZE`, 1024).
const MAX_ARGUMENTS: usize = 2048;

/// The two `Programs` folders: all users first, then the current user.
pub fn roots() -> Vec<PathBuf> {
    [&FOLDERID_CommonStartMenu, &FOLDERID_StartMenu]
        .into_iter()
        .filter_map(|id| {
            // SAFETY: known-folder lookup; the returned string is copied and freed by `take_pwstr`.
            let path = unsafe { SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) }.ok()?;
            Some(PathBuf::from(crate::com::take_pwstr(path)).join(PROGRAMS))
        })
        .filter(|p| p.is_dir())
        .collect()
}

/// Every `.lnk` under `root`, with its folder relative to `root`.
fn shortcuts(root: &Path) -> Vec<(PathBuf, Option<String>)> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if !entry.file_name().eq_ignore_ascii_case(STARTUP_FOLDER) {
                    pending.push(path);
                }
            } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case(SHORTCUT_EXTENSION)) {
                let folder = path
                    .parent()
                    .and_then(|p| p.strip_prefix(root).ok())
                    .and_then(|rel| rel.components().next())
                    .map(|c| c.as_os_str().to_string_lossy().into_owned());
                found.push((path, folder));
            }
        }
    }
    found
}

struct LinkInfo {
    target: Option<String>,
    arguments: Option<String>,
    aumid: Option<String>,
    icon_file: Option<PathBuf>,
}

/// Reads one shortcut. A fresh `IShellLinkW` per file: a reused object keeps the property store of the
/// previous file, which hands the next shortcut a stale AppUserModelID.
fn read_link(lnk: &Path) -> Option<LinkInfo> {
    let wide = crate::com::wide(&lnk.to_string_lossy());
    // SAFETY: the buffers outlive each call, the PCWSTR points into `wide` which lives to the end of this
    // function, and the link is only read (no `Resolve`, which can search the disk for moved targets).
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(crate::com::pcwstr(&wide), STGM_READ).ok()?;
        let mut path = [0u16; MAX_PATH as usize];
        let mut data = WIN32_FIND_DATAW::default();
        let target = link.GetPath(&mut path, &mut data, 0).ok().map(|()| from_wide(&path));
        let mut args = [0u16; MAX_ARGUMENTS];
        let arguments = link.GetArguments(&mut args).ok().map(|()| from_wide(&args));
        let aumid = cast::<_, IPropertyStore>(&link).and_then(|s| store_string(&s, &PKEY_AppUserModel_ID));
        let mut icon = [0u16; MAX_PATH as usize];
        let mut index = 0i32;
        let icon_file = link
            .GetIconLocation(&mut icon, &mut index)
            .ok()
            .map(|()| expand_env(&from_wide(&icon)))
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty() && p.is_file());
        Some(LinkInfo {
            target: target.filter(|t| !t.trim().is_empty()),
            arguments: arguments.filter(|a| !a.trim().is_empty()),
            aumid,
            icon_file,
        })
    }
}

/// Reads one shortcut into a candidate. Shortcuts whose target no longer exists are dropped unless they carry
/// an AppUserModelID (those launch through the shell, not the path); so are shortcuts to folders.
fn candidate(lnk: PathBuf, folder: Option<String>) -> Option<AppEntry> {
    let info = read_link(&lnk)?;
    match &info.target {
        Some(target) => {
            let path = Path::new(target);
            if path.is_dir() || (!path.exists() && info.aumid.is_none()) {
                return None;
            }
        }
        None if info.aumid.is_none() => return None,
        None => {}
    }
    let name = lnk.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    Some(AppEntry {
        name,
        aumid: info.aumid,
        icon_file: info.icon_file,
        target: info.target,
        arguments: info.arguments,
        shortcut: Some(lnk),
        folder,
        ..AppEntry::default()
    })
}

/// Every shortcut in both Start menu folders as an unmerged candidate, all-users folder first. Resolving a
/// shortcut is a file open, so the work is spread over a few threads, each with its own COM apartment.
pub fn scan() -> Vec<AppEntry> {
    let files: Vec<(PathBuf, Option<String>)> = roots().iter().flat_map(|root| shortcuts(root)).collect();
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(MAX_WORKERS);
    let chunk = files.len().div_ceil(workers).max(1);
    std::thread::scope(|scope| {
        let handles: Vec<_> = files
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    let _com = ComGuard::new();
                    part.iter().filter_map(|(lnk, folder)| candidate(lnk.clone(), folder.clone())).collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}
