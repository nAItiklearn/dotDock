//! Lists the windows that would be on the taskbar right now and times the enumeration. Prints app and
//! executable names, not titles (titles can hold anything the user has open).
//! Run: `cargo run --release -p dotdock-dock --example windows_probe`

use dotdock_dock::com::ComGuard;
use dotdock_dock::running::enumerate::{list, ProcessCache};
use std::time::Instant;

fn main() {
    let _com = ComGuard::new();
    let own = [std::process::id()];
    let mut cache = ProcessCache::default();

    let started = Instant::now();
    let first = list(&own, &mut cache);
    let cold = started.elapsed();
    let started = Instant::now();
    let second = list(&own, &mut cache);
    let warm = started.elapsed();
    let mut samples: Vec<_> = (0..50)
        .map(|_| {
            let t = Instant::now();
            let _ = list(&own, &mut cache);
            t.elapsed()
        })
        .collect();
    samples.sort();
    println!(
        "{} windows; first call {cold:?}, second {warm:?}; 50 calls: median {:?}, max {:?}",
        first.len(),
        samples[samples.len() / 2],
        samples[samples.len() - 1]
    );
    for w in &second {
        let exe = w.exe.as_deref().and_then(|p| p.rsplit('\\').next()).unwrap_or("?");
        println!(
            "  {:<28} aumid={:<44} minimized={:<5} focused={}",
            exe,
            w.aumid.as_deref().unwrap_or("-"),
            w.minimized,
            w.focused
        );
    }
}
