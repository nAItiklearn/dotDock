//! Captures the composed screen (DWM thumbnails, glass and layered windows included) to a PNG, for the QA records in
//! `docs/QA/dock-live/`. With no rectangle it captures the whole primary monitor.
//! Run: `cargo run -p dotdock-dock --example screenshot -- <output.png> [left top right bottom]`

mod common;

use common::{capture, dpi_aware};
use dotdock_dock::appbar::primary_monitor;
use dotdock_dock::icons::encode_png;
use windows::Win32::Foundation::RECT;

fn main() {
    dpi_aware();
    let mut args = std::env::args().skip(1);
    let out = args.next().expect("output png path");
    let numbers: Vec<i32> = args.map(|a| a.parse().expect("rectangle edges are whole numbers")).collect();
    let area = match numbers.as_slice() {
        [left, top, right, bottom] => RECT { left: *left, top: *top, right: *right, bottom: *bottom },
        [] => primary_monitor().expect("primary monitor"),
        _ => panic!("give all four edges (left top right bottom) or none"),
    };
    let image = capture(area);
    std::fs::write(&out, encode_png(&image).expect("png")).expect("write screenshot");
    println!("wrote {out} ({}x{})", image.width, image.height);
}
