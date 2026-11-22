//! Proves the app-bar spike: a registered bar makes the work area smaller, a maximised window stops at the bar,
//! and removing the bar gives the space back. Registers a real bar for a few seconds and ALWAYS removes it.
//!
//! With `--hide-taskbar` the native taskbar is hidden for the run (the owner allowed this for tests);
//! a guard shows it again and restores the auto-hide state on every path, including a panic.
//!
//! Run: `cargo run -p dotdock-dock --example appbar_probe [-- --hide-taskbar]`

mod common;

use common::{destroy, dpi_aware, probe_window, pump, Look};
use dotdock_dock::appbar::{work_area, AppBar};
use dotdock_shell::taskbar;
use std::time::Duration;
use windows::core::w;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::WindowsAndMessaging::{
    ShowWindow, SW_HIDE, SW_MAXIMIZE, WINDOW_EX_STYLE, WM_USER, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_OVERLAPPEDWINDOW,
    WS_POPUP,
};

const BAR_THICKNESS: i32 = 80;
const SETTLE: Duration = Duration::from_millis(600);
/// Where the test window is created before it is maximised; away from the bar.
const TEST_RECT: RECT = RECT { left: 300, top: 300, right: 700, bottom: 600 };

/// Puts the taskbar back the way it was found, however the run ends.
struct TaskbarGuard {
    was_visible: bool,
    was_auto_hide: bool,
}

impl TaskbarGuard {
    fn hide() -> TaskbarGuard {
        let guard =
            TaskbarGuard { was_visible: taskbar::is_visible().unwrap_or(true), was_auto_hide: taskbar::auto_hide() };
        // The release profile aborts on panic and never runs `Drop`, so the hook restores too.
        let auto_hide = guard.was_auto_hide;
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            taskbar::show_all();
            taskbar::set_auto_hide(auto_hide);
            previous(info);
        }));
        for bar in taskbar::windows() {
            // SAFETY: hides a taskbar window; `Drop` shows it again.
            unsafe {
                let _ = ShowWindow(bar, SW_HIDE);
            }
        }
        guard
    }
}

impl Drop for TaskbarGuard {
    fn drop(&mut self) {
        if self.was_visible {
            taskbar::show_all();
        }
        taskbar::set_auto_hide(self.was_auto_hide);
    }
}

fn visible_bounds(hwnd: HWND) -> RECT {
    let mut rect = RECT::default();
    // SAFETY: DWM writes one RECT.
    unsafe {
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            std::ptr::from_mut(&mut rect).cast(),
            size_of::<RECT>() as u32,
        );
    }
    rect
}

fn describe(rect: RECT) -> String {
    format!("[{}..{}] x [{}..{}]", rect.left, rect.right, rect.top, rect.bottom)
}

/// One run: register a bar along the bottom, maximise a window, report where it ended up, remove the bar.
fn run() -> bool {
    let before = work_area().expect("work area");
    let ex = WINDOW_EX_STYLE(WS_EX_TOPMOST.0 | WS_EX_TOOLWINDOW.0);
    let bar_window = probe_window(
        Look::Dark,
        w!("dotDock appbar probe"),
        RECT { left: 0, top: 0, right: 400, bottom: BAR_THICKNESS },
        WS_POPUP,
        ex,
    );
    let bar = AppBar::register(bar_window.0 as isize, BAR_THICKNESS, WM_USER + 1).expect("register app bar");
    pump(SETTLE);
    let granted = bar.rect();
    let with_bar = work_area().expect("work area");

    let test =
        probe_window(Look::Bars, w!("dotDock maximise probe"), TEST_RECT, WS_OVERLAPPEDWINDOW, WINDOW_EX_STYLE(0));
    // SAFETY: maximises our own test window.
    unsafe {
        let _ = ShowWindow(test, SW_MAXIMIZE);
    }
    pump(SETTLE);
    let maximised = visible_bounds(test);

    let respects = maximised.bottom <= granted.top;
    destroy(test);
    drop(bar);
    destroy(bar_window);
    pump(SETTLE);
    let after = work_area().expect("work area");

    println!(
        "bottom: work area before {} | with bar {} | after removing {}",
        describe(before),
        describe(with_bar),
        describe(after)
    );
    println!(
        "bottom: bar granted {} | maximised window {} | stops at the bar: {respects}",
        describe(granted),
        describe(maximised)
    );
    let shrank = (with_bar.bottom - with_bar.top) < (before.bottom - before.top)
        || (with_bar.right - with_bar.left) < (before.right - before.left);
    let restored = after.left == before.left
        && after.top == before.top
        && after.right == before.right
        && after.bottom == before.bottom;
    println!("bottom: work area shrank: {shrank}, restored: {restored}");
    shrank && respects && restored
}

fn main() {
    dpi_aware();
    let hide = std::env::args().any(|a| a == "--hide-taskbar");
    let visible_at_start = taskbar::is_visible();
    let auto_hide_at_start = taskbar::auto_hide();
    println!("taskbar at start: visible {visible_at_start:?}, auto-hide {auto_hide_at_start}");

    let mut ok = true;
    {
        let _taskbar = hide.then(TaskbarGuard::hide);
        if hide {
            println!("native taskbar hidden for the bottom run: visible now {:?}", taskbar::is_visible());
        }
        ok &= run();
    }
    let visible_at_end = taskbar::is_visible();
    let auto_hide_at_end = taskbar::auto_hide();
    println!("taskbar at end: visible {visible_at_end:?}, auto-hide {auto_hide_at_end}");
    ok &= visible_at_end == visible_at_start && auto_hide_at_end == auto_hide_at_start;
    println!(
        "{}",
        if ok {
            "PASS: bar reserved the space, the maximised window respected it, everything restored"
        } else {
            "FAIL"
        }
    );
    std::process::exit(i32::from(!ok));
}
