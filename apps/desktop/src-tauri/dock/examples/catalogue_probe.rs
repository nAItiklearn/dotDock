//! Lists every launchable app on this machine with enumeration timings, then every entry left out and why
//! (`--removed` prints only those, as a Markdown table for docs/QA/dock-live/catalogue.md).
//! Run: `cargo run -p dotdock-dock --example catalogue_probe`

use dotdock_dock::catalogue;

fn main() {
    let cat = catalogue::enumerate();
    if std::env::args().any(|a| a == "--removed") {
        let mut removed = cat.removed.clone();
        removed.sort_by(|a, b| a.reason.cmp(&b.reason).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        removed.dedup();
        println!("| Entry | Why it is not on the dock |\n|---|---|");
        for r in &removed {
            println!("| {} | {} |", r.name.replace('|', "/"), r.reason);
        }
        eprintln!("kept={} removed={}", cat.apps.len(), removed.len());
        return;
    }
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
