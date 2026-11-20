//! Reads the Start menu and the AppsFolder and merges them into the catalogue.

use super::{appsfolder, merge, startmenu, versioninfo, AppEntry};
use crate::com::ComGuard;
use std::path::Path;
use std::time::{Duration, Instant};

/// How long each stage took, so a regression in enumeration speed is visible.
#[derive(Clone, Copy, Debug, Default)]
pub struct Timings {
    pub start_menu: Duration,
    pub apps_folder: Duration,
    pub merge: Duration,
    pub publishers: Duration,
    pub total: Duration,
}

#[derive(Clone, Debug)]
pub struct Catalogue {
    pub apps: Vec<AppEntry>,
    pub timings: Timings,
}

/// AppsFolder items are kept when something real stands behind them: a package, a protocol URL, a shell
/// namespace object (`::{GUID}`, Control Panel and File Explorer), or an existing program. Folders and
/// shortcuts to files that were uninstalled are not apps.
fn launchable(entry: &AppEntry) -> bool {
    if entry.package_dir.is_some() {
        return true;
    }
    match entry.target.as_deref() {
        None => true,
        Some(t) if t.contains("://") || t.starts_with("::") => true,
        Some(t) => {
            let path = Path::new(t);
            path.exists() && !path.is_dir()
        }
    }
}

/// Fills in the publisher of desktop apps from the version resource of their executable, on a few threads
/// because each lookup is a file open.
fn fill_publishers(apps: &mut [AppEntry]) {
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8);
    let chunk = apps.len().div_ceil(workers).max(1);
    std::thread::scope(|scope| {
        for part in apps.chunks_mut(chunk) {
            scope.spawn(move || {
                for app in part.iter_mut().filter(|a| a.publisher.is_none()) {
                    if let Some(target) = app.target.as_deref().filter(|t| t.to_ascii_lowercase().ends_with(".exe")) {
                        app.publisher = versioninfo::company_name(target);
                    }
                }
            });
        }
    });
}

/// Enumerates every launchable app. Initialises COM on the calling thread for the duration.
pub fn enumerate() -> Catalogue {
    let started = Instant::now();

    // The AppsFolder enumeration is the slow part (the shell builds the whole list on the first call), so it
    // runs beside the Start menu scan instead of after it.
    let (mut candidates, start_menu, shell_items, apps_folder) = std::thread::scope(|scope| {
        let shell = scope.spawn(|| {
            let _com = ComGuard::new();
            let t = Instant::now();
            let items = appsfolder::scan();
            (items, t.elapsed())
        });
        let t = Instant::now();
        let start = startmenu::scan();
        let start_menu = t.elapsed();
        let (items, apps_folder) = shell.join().unwrap_or_default();
        (start, start_menu, items, apps_folder)
    });
    candidates.extend(shell_items.into_iter().filter(launchable));

    let t = Instant::now();
    let mut apps = merge(candidates);
    let merge = t.elapsed();

    let t = Instant::now();
    fill_publishers(&mut apps);
    let publishers = t.elapsed();

    Catalogue { apps, timings: Timings { start_menu, apps_folder, merge, publishers, total: started.elapsed() } }
}
