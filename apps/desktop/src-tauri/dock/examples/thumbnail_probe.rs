//! Proves DWM thumbnails work: a colour-bar window is shown live inside a dark host window, twice, through the
//! same `Previews` the dock uses, and the screen is captured to a PNG. Needs a desktop session.
//! Run: `cargo run -p dotdock-dock --example thumbnail_probe -- <output.png>`

mod common;

use common::{capture, destroy, dpi_aware, pixel, probe_window, pump, Look, DARK};
use dotdock_dock::icons::encode_png;
use dotdock_dock::protocol::Rect as CssRect;
use dotdock_dock::thumbnail::{Previews, Thumbnail};
use std::time::{Duration, Instant};
use windows::core::w;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{WINDOW_EX_STYLE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP};

const HOST: RECT = RECT { left: 80, top: 80, right: 780, bottom: 380 };
const SOURCE: RECT = RECT { left: 820, top: 80, right: 1220, bottom: 380 };
/// The bars of `common::BARS` as (r, g, b).
const BAR_COLOURS: [(u8, u8, u8); 6] =
    [(255, 0, 0), (255, 165, 0), (255, 255, 0), (0, 192, 0), (0, 0, 255), (128, 0, 160)];
const SETTLE: Duration = Duration::from_millis(500);

fn count_colour(image: &dotdock_dock::icons::Rgba, colour: (u8, u8, u8)) -> usize {
    (0..image.height)
        .flat_map(|y| (0..image.width).map(move |x| (x, y)))
        .filter(|&(x, y)| pixel(image, x, y) == colour)
        .count()
}

fn main() {
    dpi_aware();
    let out = std::env::args().nth(1).expect("output png path");
    let ex = WINDOW_EX_STYLE(WS_EX_TOPMOST.0 | WS_EX_TOOLWINDOW.0);
    let host = probe_window(Look::Dark, w!("dotDock probe host"), HOST, WS_POPUP, ex);
    let source = probe_window(Look::Bars, w!("dotDock probe source"), SOURCE, WS_POPUP, ex);
    pump(SETTLE);

    let before = capture(HOST);
    // `DARK` is a COLORREF (0x00BBGGRR).
    let dark_rgb = (DARK as u8, (DARK >> 8) as u8, (DARK >> 16) as u8);
    println!(
        "before: bar pixels in the host = {}",
        BAR_COLOURS.iter().map(|c| count_colour(&before, *c)).sum::<usize>()
    );

    let started = Instant::now();
    let single = Thumbnail::register(host.0 as isize, source.0 as isize).expect("register");
    let registered = started.elapsed();
    let (sw, sh) = single.source_size().expect("source size");
    println!("source size {sw}x{sh}, register took {registered:?}");
    drop(single);

    // The path the dock takes: two previews of the same window above an anchor near the bottom of the host.
    let mut previews = Previews::default();
    let anchor = CssRect { x: 300.0, y: 280.0, w: 60.0, h: 20.0 };
    let started = Instant::now();
    previews.show(host.0 as isize, &[source.0 as isize, source.0 as isize], anchor, 1.0, HOST.right - HOST.left);
    println!("show took {:?}, previews shown: {}", started.elapsed(), previews.count());
    pump(SETTLE);
    let after = capture(HOST);
    let found: Vec<usize> = BAR_COLOURS.iter().map(|c| count_colour(&after, *c)).collect();
    println!("after: pixels per bar colour {found:?}, dark background left: {}", count_colour(&after, dark_rgb));

    std::fs::write(&out, encode_png(&after).expect("png")).expect("write screenshot");
    println!("wrote {out}");

    previews.hide();
    pump(SETTLE);
    let hidden = capture(HOST);
    let leftover: usize = BAR_COLOURS.iter().map(|c| count_colour(&hidden, *c)).sum();
    println!("after hide: bar pixels = {leftover}");

    destroy(source);
    destroy(host);
    let ok = found.iter().all(|n| *n > 500) && leftover == 0;
    println!("{}", if ok { "PASS: thumbnails drawn by DWM, removed on hide" } else { "FAIL" });
    std::process::exit(i32::from(!ok));
}
