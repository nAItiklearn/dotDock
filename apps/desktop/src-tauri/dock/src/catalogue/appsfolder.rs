//! The shell's AppsFolder (`shell:AppsFolder`): what the Start menu's "All apps" list is built from. It
//! lists every packaged (Store) app, which has no Start menu shortcut, and the desktop apps, each with the
//! AppUserModelID the running app uses for its windows.

use super::manifest;
use super::{is_synthetic_aumid, AppEntry};
use crate::com::{pcwstr, take_pwstr, wide};
use std::path::PathBuf;
use windows::core::{Interface, GUID};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Storage::EnhancedStorage::{
    PKEY_AppUserModel_ID, PKEY_Link_Arguments, PKEY_Link_TargetParsingPath,
};
use windows::Win32::UI::Shell::PropertiesSystem::PSGetPropertyKeyFromName;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItem2, SHGetKnownFolderItem,
    SHGetKnownFolderPath, KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY,
};

/// Canonical name of the property holding a packaged app's install folder.
const PACKAGE_INSTALL_PATH: &str = "System.AppUserModel.PackageInstallPath";
const MANIFEST_FILE: &str = "AppxManifest.xml";
/// How many items to ask the enumerator for at once.
const BATCH: usize = 32;

fn named_key(name: &str) -> Option<PROPERTYKEY> {
    let wide = wide(name);
    let mut key = PROPERTYKEY::default();
    // SAFETY: `wide` is zero-terminated and outlives the call; `key` is a valid out pointer.
    unsafe { PSGetPropertyKeyFromName(pcwstr(&wide), &mut key) }.ok().map(|()| key)
}

/// Turns a `{KNOWNFOLDER-GUID}\relative\path.exe` id (what the shell invents for a desktop app without an
/// explicit AppUserModelID) into the real path.
pub fn expand_known_folder(id: &str) -> Option<String> {
    let rest = id.strip_prefix('{')?;
    let (guid_text, relative) = rest.split_once("}\\")?;
    let guid = GUID::try_from(format!("{{{guid_text}}}").as_str()).ok()?;
    // SAFETY: known-folder lookup; the returned string is copied and freed by `take_pwstr`.
    let base = unsafe { SHGetKnownFolderPath(&guid, KF_FLAG_DEFAULT, None) }.ok()?;
    Some(PathBuf::from(take_pwstr(base)).join(relative).to_string_lossy().into_owned())
}

/// Every item of the AppsFolder as an unmerged candidate. Packaged apps carry their install folder and the
/// publisher read from the package manifest; desktop apps carry the target and arguments of their shortcut.
pub fn scan() -> Vec<AppEntry> {
    let Some(install_path_key) = named_key(PACKAGE_INSTALL_PATH) else { return Vec::new() };
    // SAFETY: shell enumeration on an STA thread; every interface is released by drop, strings by `take_pwstr`.
    unsafe {
        let Ok(folder) = SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) else {
            return Vec::new();
        };
        let Ok(items) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        loop {
            let mut batch: [Option<IShellItem>; BATCH] = std::array::from_fn(|_| None);
            let mut fetched = 0u32;
            if items.Next(&mut batch, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            for item in batch.into_iter().take(fetched as usize).flatten() {
                out.extend(read_item(&item, &install_path_key));
            }
        }
        out
    }
}

/// # Safety
/// Must run on a thread with COM initialised.
unsafe fn read_item(item: &IShellItem, install_path_key: &PROPERTYKEY) -> Option<AppEntry> {
    // SAFETY: plain property reads on a live shell item; strings are freed by `take_pwstr`.
    unsafe {
        let name = take_pwstr(item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?);
        let item2: IShellItem2 = item.cast().ok()?;
        let text = |key: &PROPERTYKEY| item2.GetString(key).ok().map(take_pwstr).filter(|s| !s.trim().is_empty());
        let shell_id = text(&PKEY_AppUserModel_ID)?;
        let mut entry = AppEntry { name, shell_id: Some(shell_id.clone()), ..AppEntry::default() };
        if let Some(dir) = text(install_path_key).map(PathBuf::from) {
            let xml = std::fs::read_to_string(dir.join(MANIFEST_FILE)).unwrap_or_default();
            entry.publisher = manifest::parse(&xml).publisher_name();
            entry.package_dir = Some(dir);
            entry.aumid = Some(shell_id);
            return Some(entry);
        }
        entry.target = text(&PKEY_Link_TargetParsingPath).or_else(|| expand_known_folder(&shell_id));
        entry.arguments = text(&PKEY_Link_Arguments);
        if !is_synthetic_aumid(&shell_id) {
            entry.aumid = Some(shell_id);
        }
        Some(entry)
    }
}
