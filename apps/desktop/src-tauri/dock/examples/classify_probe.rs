//! Files every app on this machine and prints the result, one app per line, then the counts.
//! Run: `cargo run -p dotdock-dock --example classify_probe`
//! With `--fixture` it prints tab-separated rows (name, publisher, folder, AUMID, exe, category) in the
//! shape of `src/classify/golden.tsv`, for reviewing by hand before they are committed.

use dotdock_dock::catalogue;
use dotdock_dock::classify::{classify, Subject};
use std::collections::BTreeMap;

fn main() {
    let fixture = std::env::args().any(|a| a == "--fixture");
    let cat = catalogue::enumerate();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut rows = Vec::new();
    for app in &cat.apps {
        let c = classify(&Subject::from_entry(app), None);
        *counts.entry(c.category.to_string()).or_default() += 1;
        if fixture {
            let field = |v: Option<&str>| v.unwrap_or_default().to_owned();
            // Only protocol URLs go into the fixture; a path would name the user's folders.
            let url = app.target.as_deref().filter(|t| t.contains("://")).unwrap_or_default();
            rows.push(format!(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                app.name,
                field(app.publisher.as_deref()),
                field(app.folder.as_deref()),
                field(app.aumid.as_deref()),
                app.exe_name().unwrap_or_default(),
                url,
                if app.packaged() { "packaged" } else { "" },
                c.category
            ));
        } else {
            rows.push(format!("{:<14}{:<9}{}", c.category.to_string(), format!("{:?}", c.filed_by), app.name));
        }
    }
    rows.sort();
    for row in &rows {
        println!("{row}");
    }
    eprintln!("\n{} apps: {counts:?}", cat.apps.len());
}
