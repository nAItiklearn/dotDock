//! Proves the glass plate: colour bars sit behind a topmost "dock" window; the plate, directly behind that window,
//! draws acrylic only inside two rounded shapes. The screen is captured to a PNG and three things are checked: the
//! bars stay sharp outside the shapes, they are blurred (no pure bar colour left) inside, and an empty shape list
//! takes the glass away again. Needs a desktop session.
//! Run: `cargo run -p dotdock-dock --example glass_probe -- <output.png>`

mod common;

use common::{capture, destroy, dpi_aware, pixel, probe_window, pump, Look};
use dotdock_dock::glass::{Glass, Shape};
use dotdock_dock::icons::{encode_png, Rgba};
use dotdock_dock::placement::PxRect;
use std::time::Duration;
use windows::core::w;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{WINDOW_EX_STYLE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP};

const BARS: RECT = RECT { left: 100, top: 100, right: 1000, bottom: 500 };
/// The stand-in dock window: topmost, small, off to one side, so the plate sits just under it.
const DOCK: RECT = RECT { left: 1100, top: 100, right: 1200, bottom: 200 };
const SETTLE: Duration = Duration::from_millis(700);
const SCALE: f64 = 1.0;

/// Pixels where a colour channel sits at an extreme, which only unblurred bars have.
fn pure_pixels(image: &Rgba, area: (u32, u32, u32, u32)) -> usize {
    let (x0, y0, x1, y1) = area;
    (y0..y1)
        .flat_map(|y| (x0..x1).map(move |x| (x, y)))
        .filter(|&(x, y)| {
            let (r, g, b) = pixel(image, x, y);
            [(255, 0, 0), (255, 165, 0), (255, 255, 0), (0, 192, 0), (0, 0, 255), (128, 0, 160)].contains(&(r, g, b))
        })
        .count()
}

fn main() {
    dpi_aware();
    let out = std::env::args().nth(1).expect("output png path");
    let ex = WINDOW_EX_STYLE(WS_EX_TOPMOST.0 | WS_EX_TOOLWINDOW.0);
    let bars = probe_window(Look::Bars, w!("dotDock glass probe bars"), BARS, WS_POPUP, ex);
    let dock = probe_window(Look::Dark, w!("dotDock glass probe dock"), DOCK, WS_POPUP, ex);
    let mut glass = Glass::new().expect("glass plate");
    println!("material: {:?}", glass.material());
    let sheet = PxRect { left: BARS.left, top: BARS.top, right: BARS.right, bottom: BARS.bottom };
    glass.follow(sheet, dock.0 as isize);
    // A pill and a popover, in CSS px relative to the sheet.
    let shapes = [
        Shape { x: 100.0, y: 300.0, w: 500.0, h: 70.0, radius: 35.0 },
        Shape { x: 650.0, y: 80.0, w: 200.0, h: 180.0, radius: 24.0 },
    ];
    glass.show(&shapes, SCALE, true).expect("show glass");
    pump(SETTLE);

    let shot = capture(BARS);
    std::fs::write(&out, encode_png(&shot).expect("png")).expect("write screenshot");
    println!("wrote {out}");
    let (w, h) = (shot.width, shot.height);
    let inside_pill = pure_pixels(&shot, (140, 320, 560, 350));
    let inside_popover = pure_pixels(&shot, (680, 110, 820, 230));
    let outside = pure_pixels(&shot, (0, 0, w, 60)) + pure_pixels(&shot, (0, 380, w, h));
    println!("pure bar pixels: inside pill {inside_pill}, inside popover {inside_popover}, outside {outside}");

    glass.show(&[], SCALE, true).expect("hide glass");
    pump(SETTLE);
    let bare = capture(BARS);
    let after = pure_pixels(&bare, (140, 320, 560, 350));
    println!("pure bar pixels in the pill's place after hiding the glass: {after}");

    destroy(dock);
    destroy(bars);
    let blurred = inside_pill == 0 && inside_popover == 0;
    let sharp_outside = outside > 1000;
    let removed = after > 1000;
    println!("blurred inside: {blurred}, sharp outside: {sharp_outside}, removed on hide: {removed}");
    println!("{}", if blurred && sharp_outside && removed { "PASS: acrylic inside the shapes only" } else { "FAIL" });
    std::process::exit(i32::from(!(blurred && sharp_outside && removed)));
}
