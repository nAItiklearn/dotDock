//! Stands in for the dock in `tools/test-taskbar-restore.ps1`: hides the real taskbar through
//! `dock_guard`, then ends in the way the test script asks for, so every exit path of the
//! restore guarantees can be exercised against a real process.
//!
//! Usage: `dock_guard_probe <hide | hide-and-quit | hide-and-exit | hide-and-panic | recover>`

use dotdock_shell::{crash_guard, dock_guard, sentinel};
use std::process::ExitCode;
use std::time::Duration;

/// How long the modes that end by themselves keep the taskbar hidden first.
const HIDDEN_FOR: Duration = Duration::from_secs(3);
const USAGE: &str = "usage: dock_guard_probe <hide | hide-and-quit | hide-and-exit | hide-and-panic | recover>";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // The core runs the sentinel from its own exe when `dotdock-sentinel.exe` is missing; so does this.
    if args.first().map(String::as_str) == Some(sentinel::HOST_ARG) {
        return ExitCode::from(u8::try_from(sentinel::run(&args)).unwrap_or(u8::MAX));
    }
    crash_guard::install_panic_hook();
    match args.first().map(String::as_str) {
        Some("recover") => {
            println!("recovery {:?}", dock_guard::recover_if_dirty());
            ExitCode::SUCCESS
        }
        Some(mode @ ("hide" | "hide-and-quit" | "hide-and-exit" | "hide-and-panic")) => hide_then(mode),
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn hide_then(mode: &str) -> ExitCode {
    if let Err(err) = dock_guard::hide_for_dock() {
        eprintln!("hide failed: {err}");
        return ExitCode::FAILURE;
    }
    println!("hidden pid={}", std::process::id());
    if mode == "hide" {
        // Runs until the script kills it: the dock being killed.
        loop {
            std::thread::park();
        }
    }
    // Long enough for the script to see the taskbar hidden before this process ends.
    std::thread::sleep(HIDDEN_FOR);
    match mode {
        "hide-and-quit" => {
            dock_guard::restore_after_dock();
            println!("restored");
            ExitCode::SUCCESS
        }
        // A clean exit that skipped the restore, as `std::process::exit` somewhere would.
        "hide-and-exit" => ExitCode::SUCCESS,
        _ => panic!("probe panic with the taskbar hidden"),
    }
}
