//! The windows that belong on a taskbar, mapped to catalogue apps, with a push when the list changes.
//!
//! - `enumerate`: which top-level windows qualify and what the shell knows about each.
//! - `sensors`: one thread with a hidden window that hears shell hooks, window events, session and display
//!   power changes, and turns them into debounced signals. Nothing polls.
//! - `worker`: recomputes the list when told to and emits it only when it changed.
//! - `control`: bring a window forward, minimise it, close it.

pub mod control;
pub mod enumerate;
pub mod sensors;
pub mod worker;

use crate::catalogue::AppEntry;
use crate::util::normalise_path;
use std::collections::HashMap;

/// A window with everything the dock needs to place it, before it is turned into the wire type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawWindow {
    pub hwnd: isize,
    pub title: String,
    pub pid: u32,
    /// The AppUserModelID the window announces, when it announces one.
    pub aumid: Option<String>,
    /// Full path of the program that owns the window.
    pub exe: Option<String>,
    pub minimized: bool,
    pub focused: bool,
}

struct ExeEntry {
    id: String,
    /// The shortcut passes no arguments, so a window of this program is most likely this app.
    plain: bool,
}

/// Finds the catalogue app a window belongs to: by AppUserModelID first (exact), then by the program that
/// owns the window.
#[derive(Default)]
pub struct AppIndex {
    by_aumid: HashMap<String, String>,
    by_exe: HashMap<String, Vec<ExeEntry>>,
    /// Package folders (lower case, trailing separator) of Store apps, with the app id.
    by_package: Vec<(String, String)>,
}

impl AppIndex {
    pub fn new(apps: &[AppEntry]) -> AppIndex {
        let mut index = AppIndex::default();
        for app in apps {
            if let Some(aumid) = &app.aumid {
                index.by_aumid.entry(aumid.to_lowercase()).or_insert_with(|| app.id.clone());
            }
            if let Some(dir) = &app.package_dir {
                // With a trailing separator so `app` never matches `app2`.
                let prefix = format!("{}\\", normalise_path(&dir.to_string_lossy()));
                index.by_package.push((prefix, app.id.clone()));
            }
            if let Some(target) = app.target.as_deref().filter(|t| t.to_ascii_lowercase().ends_with(".exe")) {
                let plain = app.arguments.as_deref().is_none_or(|a| a.trim().is_empty());
                index.by_exe.entry(normalise_path(target)).or_default().push(ExeEntry { id: app.id.clone(), plain });
            }
        }
        index
    }

    pub fn resolve(&self, aumid: Option<&str>, exe: Option<&str>) -> Option<&str> {
        if let Some(id) = aumid.and_then(|a| self.by_aumid.get(&a.to_lowercase())) {
            return Some(id);
        }
        let path = normalise_path(exe?);
        if let Some(candidates) = self.by_exe.get(&path) {
            return candidates.iter().find(|c| c.plain).or_else(|| candidates.first()).map(|c| c.id.as_str());
        }
        // A packaged app's window comes from a program inside its package folder.
        if let Some((_, id)) = self.by_package.iter().find(|(dir, _)| path.starts_with(dir.as_str())) {
            return Some(id);
        }
        // The folder is versioned and the catalogue may not know it (the app updated itself, or the scan has not
        // read it yet), so the package family in the path is matched against the AppUserModelID too.
        let family = package_family(&path)?;
        let stem = path.rsplit('\\').next()?.trim_end_matches(".exe");
        let mut found = self
            .by_aumid
            .iter()
            .filter(|(aumid, _)| aumid.strip_prefix(family.as_str()).is_some_and(|rest| rest.starts_with('!')));
        let first = found.next();
        let suffix = format!("!{stem}");
        let named = first.into_iter().chain(found).find(|(aumid, _)| aumid.ends_with(&suffix));
        named.or(first).map(|(_, id)| id.as_str())
    }
}

/// `<name>_<publisher id>` from a lower-case program path under `\windowsapps\<name>_<version>_<arch>__<publisher id>\`.
fn package_family(path: &str) -> Option<String> {
    let (_, rest) = path.split_once("\\windowsapps\\")?;
    let folder = rest.split('\\').next()?;
    let (name, _) = folder.split_once('_')?;
    let (_, publisher) = folder.rsplit_once("__")?;
    (!name.is_empty() && !publisher.is_empty()).then(|| format!("{name}_{publisher}"))
}

impl AppIndex {
    #[cfg(test)]
    fn len(&self) -> usize {
        self.by_aumid.len()
    }
}

/// Shell windows and desktop surfaces that are visible and top level but are not apps.
pub const NOT_APP_CLASSES: [&str; 6] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Windows.UI.Core.CoreWindow",
    "XamlExplorerHostIslandWindow",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, aumid: Option<&str>, target: Option<&str>, args: Option<&str>) -> AppEntry {
        AppEntry {
            id: id.into(),
            aumid: aumid.map(str::to_owned),
            target: target.map(str::to_owned),
            arguments: args.map(str::to_owned),
            ..AppEntry::default()
        }
    }

    #[test]
    fn a_store_app_is_found_by_its_package_family_when_the_folder_is_unknown() {
        let index = AppIndex::new(&[
            app("spotify", Some("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), None, None),
            app("other", Some("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Helper"), None, None),
        ]);
        assert_eq!(index.len(), 2);
        let exe = r"C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_1.311.0.0_x64__zpdnekdrzrea0\Spotify.exe";
        assert_eq!(index.resolve(None, Some(exe)), Some("spotify"));
        assert_eq!(index.resolve(None, Some(r"C:\Program Files\WindowsApps\Other_1.0_x64__abc\x.exe")), None);
        assert_eq!(index.resolve(None, Some(r"C:\Apps\Spotify.exe")), None);
    }

    #[test]
    fn aumid_wins_over_the_executable() {
        let index = AppIndex::new(&[
            app("browser", Some("Chrome"), Some("C:\\Chrome\\chrome.exe"), None),
            app("pwa", Some("Chrome._crx_x"), Some("C:\\Chrome\\chrome_proxy.exe"), Some("--app-id=x")),
        ]);
        assert_eq!(index.resolve(Some("chrome._crx_x"), Some("C:\\Chrome\\chrome.exe")), Some("pwa"));
        assert_eq!(index.resolve(Some("CHROME"), None), Some("browser"));
    }

    #[test]
    fn windows_fall_back_to_their_program_path() {
        let index = AppIndex::new(&[app("7zip", None, Some("C:\\Program Files\\7-Zip\\7zFM.exe"), None)]);
        assert_eq!(index.resolve(None, Some("c:/program files/7-zip/7zfm.exe")), Some("7zip"));
        assert_eq!(index.resolve(None, Some("C:\\other\\7zfm.exe")), None);
        assert_eq!(index.resolve(None, None), None);
    }

    #[test]
    fn an_unknown_aumid_still_finds_the_program() {
        let index = AppIndex::new(&[app("x", None, Some("C:\\x\\x.exe"), None)]);
        assert_eq!(index.resolve(Some("some.runtime.id"), Some("C:\\x\\x.exe")), Some("x"));
    }

    #[test]
    fn a_plain_shortcut_beats_one_with_arguments_for_the_same_program() {
        let index = AppIndex::new(&[
            app("diff", None, Some("C:\\Vim\\gvim.exe"), Some("-d")),
            app("plain", None, Some("C:\\Vim\\gvim.exe"), None),
        ]);
        assert_eq!(index.resolve(None, Some("C:\\Vim\\gvim.exe")), Some("plain"));
        let only_args = AppIndex::new(&[app("diff", None, Some("C:\\Vim\\gvim.exe"), Some("-d"))]);
        assert_eq!(only_args.resolve(None, Some("C:\\Vim\\gvim.exe")), Some("diff"));
    }

    #[test]
    fn packaged_apps_match_by_their_aumid() {
        let index = AppIndex::new(&[app("calc", Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), None, None)]);
        assert_eq!(
            index.resolve(
                Some("microsoft.windowscalculator_8wekyb3d8bbwe!app"),
                Some("C:\\Windows\\System32\\ApplicationFrameHost.exe")
            ),
            Some("calc")
        );
    }

    #[test]
    fn a_packaged_apps_window_is_found_by_its_package_folder() {
        let mut slack = app("slack", Some("Slack.Pkg_x!Slack"), None, None);
        slack.package_dir = Some("C:\\Program Files\\WindowsApps\\Slack.Pkg_1.0_x64__x".into());
        let index = AppIndex::new(&[slack]);
        let exe = "C:\\Program Files\\WindowsApps\\Slack.Pkg_1.0_x64__x\\app\\Slack.exe";
        assert_eq!(index.resolve(None, Some(exe)), Some("slack"));
        // A sibling folder that merely starts with the same letters is another package.
        assert_eq!(index.resolve(None, Some("C:\\Program Files\\WindowsApps\\Slack.Pkg_1.0_x64__x2\\Slack.exe")), None);
    }

    #[test]
    fn non_executable_targets_are_not_indexed_by_path() {
        let index = AppIndex::new(&[app("bat", None, Some("C:\\x\\run.bat"), None)]);
        assert_eq!(index.resolve(None, Some("C:\\x\\run.bat")), None);
    }
}
