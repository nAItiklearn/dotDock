//! Launches an app through the service, measures the click-to-window latency, then closes it again.
//! Run: `cargo run --release -p dotdock-dock --example launch_probe -- <scratch folder> [app name]`
//! The app defaults to Calculator. The scratch folder holds the probe's own store and icon cache.

use dotdock_dock::protocol::{DockApp, DockEvent};
use dotdock_dock::service::{DockService, ServiceConfig};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(30);
const RUNS: usize = 3;
/// Pause between runs so the closed app is really gone before it is started again.
const SETTLE: Duration = Duration::from_secs(2);

fn wait_for<T>(events: &Receiver<DockEvent>, mut pick: impl FnMut(&DockEvent) -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + WAIT;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match events.recv_timeout(left) {
            Ok(event) => {
                if let Some(found) = pick(&event) {
                    return Some(found);
                }
            }
            Err(_) => return None,
        }
    }
    None
}

fn main() {
    let scratch = PathBuf::from(std::env::args().nth(1).expect("scratch folder"));
    let wanted = std::env::args().nth(2).unwrap_or_else(|| "Calculator".to_owned());
    let (service, events) =
        DockService::start(ServiceConfig { data_dir: scratch.join("data"), icon_dir: scratch.join("icons") })
            .expect("start");

    let app: DockApp = wait_for(&events, |e| match e {
        DockEvent::Apps(apps) => apps.iter().find(|a| a.name == wanted).cloned(),
        _ => None,
    })
    .unwrap_or_else(|| panic!("{wanted} is not in the catalogue"));
    println!("found {} (category {}, filed by {:?})", app.name, app.category, app.filed_by);

    // The first launch of a process pays for the shell loading its handlers; the later ones are what a click costs.
    for run in 1..=RUNS {
        let clicked = Instant::now();
        let result = service.launch(&app.id);
        let call = clicked.elapsed();
        let window = wait_for(&events, |e| match e {
            DockEvent::Windows(list) => list.iter().find(|w| w.app_id.as_deref() == Some(app.id.as_str())).cloned(),
            _ => None,
        });
        let Some(window) = window else {
            println!("run {run}: no window of {} appeared within {WAIT:?}", app.name);
            std::process::exit(1);
        };
        println!(
            "run {run}: launch {result:?} returned after {call:?}; window pushed {:?} after the click",
            clicked.elapsed()
        );

        let closed = Instant::now();
        let _ = service.close_window(&window.hwnd);
        let gone = wait_for(&events, |e| match e {
            DockEvent::Windows(list) => (!list.iter().any(|w| w.hwnd == window.hwnd)).then_some(()),
            _ => None,
        });
        println!("run {run}: removal pushed {:?} after the close request ({})", closed.elapsed(), gone.is_some());
        std::thread::sleep(SETTLE);
    }
}
