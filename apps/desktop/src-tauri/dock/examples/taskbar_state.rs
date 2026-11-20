//! Prints what the live QA checks before and after every step: whether the Windows taskbar is visible, its auto-hide
//! setting, the primary monitor and the work area (which shrinks by exactly the strip a registered app bar holds),
//! and whether the dock's taskbar marker is on disk. Read-only.
//! Run: `cargo run -p dotdock-dock --example taskbar_state`

mod common;

use common::dpi_aware;
use dotdock_dock::appbar::{primary_monitor, work_area};
use dotdock_shell::taskbar;

fn main() {
    dpi_aware();
    let monitor = primary_monitor().expect("primary monitor");
    let work = work_area().expect("work area");
    let marker = dotdock_shell::app_data_dir().map(|d| d.join("taskbar-hidden.json").exists()).unwrap_or(false);
    println!("taskbar visible: {:?}", taskbar::is_visible());
    println!("taskbar auto-hide: {}", taskbar::auto_hide());
    println!("marker present: {marker}");
    println!("monitor: {}x{} at {},{}", monitor.right - monitor.left, monitor.bottom - monitor.top, monitor.left, monitor.top);
    println!(
        "work area: {}x{} at {},{} (reserved: top {}, bottom {}, left {}, right {})",
        work.right - work.left,
        work.bottom - work.top,
        work.left,
        work.top,
        work.top - monitor.top,
        monitor.bottom - work.bottom,
        work.left - monitor.left,
        monitor.right - work.right
    );
}
