//! Lists every launchable app on this machine with enumeration timings.
//! Run: `cargo run -p dotdock-dock --example catalogue_probe`

use dotdock_dock::catalogue;

fn main() {
    let cat = catalogue::enumerate();
    let t = cat.timings;
    eprintln!(
        "apps={} start_menu={:?} apps_folder={:?} merge={:?} publishers={:?} total={:?}",
        cat.apps.len(),
        t.start_menu,
        t.apps_folder,
        t.merge,
        t.publishers,
        t.total
    );
    for a in &cat.apps {
        println!(
            "{}\t{}\t{}\t{}\t{}",
            a.name,
            a.id,
            a.publisher.as_deref().unwrap_or("-"),
            a.folder.as_deref().unwrap_or("-"),
            if a.packaged() { "pkg" } else { "desktop" }
        );
    }
}
