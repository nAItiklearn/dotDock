//! Extracts the icon of every app on this machine into a scratch cache, times each extraction and a second
//! (cached) pass, and writes contact sheets so the result can be looked at.
//! Run: `cargo run --release -p dotdock-dock --example icons_probe -- <output folder>`

use dotdock_dock::catalogue::{self, AppEntry};
use dotdock_dock::icons::{decode_png, encode_png, IconKey, IconRequest, IconSource, IconWorker, Rgba};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const CELL: u32 = 128;
const COLUMNS: u32 = 8;
const ROWS: u32 = 5;
const DARK: [u8; 4] = [24, 24, 28, 255];
const LIGHT: [u8; 4] = [236, 236, 240, 255];

fn sources_for(app: &AppEntry) -> Vec<IconSource> {
    IconSource::candidates(app)
}

/// Box-downsamples `image` into a `CELL` square (never scales up) and composites it over `background`.
fn paint(sheet: &mut Rgba, image: &Rgba, col: u32, row: u32, background: [u8; 4]) {
    let (x0, y0) = (col * CELL, row * CELL);
    for y in 0..CELL {
        for x in 0..CELL {
            let i = ((y0 + y) * sheet.width + x0 + x) as usize * 4;
            sheet.pixels[i..i + 4].copy_from_slice(&background);
        }
    }
    let scale = (CELL as f32 / image.width.max(image.height) as f32).min(1.0);
    let (w, h) = ((image.width as f32 * scale) as u32, (image.height as f32 * scale) as u32);
    let (ox, oy) = ((CELL - w) / 2, (CELL - h) / 2);
    for y in 0..h {
        for x in 0..w {
            let (sx0, sy0) = ((x as f32 / scale) as u32, (y as f32 / scale) as u32);
            let (sx1, sy1) = (((x + 1) as f32 / scale).ceil() as u32, ((y + 1) as f32 / scale).ceil() as u32);
            let mut acc = [0f32; 4];
            let mut n = 0f32;
            for sy in sy0..sy1.min(image.height) {
                for sx in sx0..sx1.min(image.width) {
                    let p = &image.pixels[(sy * image.width + sx) as usize * 4..][..4];
                    let a = f32::from(p[3]) / 255.0;
                    for c in 0..3 {
                        acc[c] += f32::from(p[c]) * a;
                    }
                    acc[3] += a;
                    n += 1.0;
                }
            }
            if n == 0.0 {
                continue;
            }
            let a = acc[3] / n;
            let i = ((y0 + oy + y) * sheet.width + x0 + ox + x) as usize * 4;
            for c in 0..3 {
                let fg = acc[c] / n;
                let bg = f32::from(background[c]);
                sheet.pixels[i + c] = (fg + bg * (1.0 - a)).round().min(255.0) as u8;
            }
        }
    }
}

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("output folder argument"));
    std::fs::create_dir_all(&out).unwrap();
    let cache = out.join("cache");
    let _ = std::fs::remove_dir_all(&cache);

    let apps = catalogue::enumerate().apps;
    let worker = IconWorker::start(cache.clone()).unwrap();

    let mut cold = Vec::new();
    let mut sizes = Vec::new();
    let mut images: Vec<(String, Option<Rgba>)> = Vec::new();
    for app in &apps {
        let sources = sources_for(app);
        let key = IconKey::new(&app.id, &sources);
        let t = Instant::now();
        worker.request(IconRequest { key: key.clone(), sources });
        let path = worker.wait_for(&key, Duration::from_secs(10));
        cold.push(t.elapsed());
        let image = path.and_then(|p| std::fs::read(p).ok()).and_then(|b| decode_png(&b).ok());
        sizes.push(image.as_ref().map_or(0, Rgba::short_edge));
        if let Some(b) = image.as_ref().and_then(Rgba::visible_bounds) {
            if b.2 - b.0 < 160 {
                println!("small content {}: {:?}", app.name, b);
            }
        }
        images.push((app.name.clone(), image));
    }

    // Second pass: everything is on disk, so nothing is extracted.
    let extracted_before = worker.extracted();
    let t = Instant::now();
    for app in &apps {
        let sources = sources_for(app);
        worker.request(IconRequest { key: IconKey::new(&app.id, &sources), sources });
    }
    let warm = t.elapsed();
    let extracted_warm = worker.extracted() - extracted_before;

    cold.sort();
    let total: Duration = cold.iter().sum();
    let at = |q: f32| cold[((cold.len() - 1) as f32 * q) as usize];
    println!(
        "apps={} extracted={} failed={} cold: total={:?} mean={:?} p50={:?} p95={:?} max={:?}",
        apps.len(),
        extracted_before,
        sizes.iter().filter(|s| **s == 0).count(),
        total,
        total / cold.len() as u32,
        at(0.5),
        at(0.95),
        at(1.0)
    );
    println!("warm pass over {} apps: {:?}, extracted again: {}", apps.len(), warm, extracted_warm);
    let (shell, encode) = worker.time_spent();
    println!("of the cold total: shell {shell:?}, encode and write {encode:?}");

    // The way the service asks: every app queued at once, the worker threads share the queue.
    let bulk_dir = out.join("cache-bulk");
    let _ = std::fs::remove_dir_all(&bulk_dir);
    let bulk = IconWorker::start(bulk_dir).unwrap();
    let started = Instant::now();
    for app in &apps {
        let sources = sources_for(app);
        bulk.request(IconRequest { key: IconKey::new(&app.id, &sources), sources });
    }
    while bulk.pending() > 0 {
        std::thread::sleep(Duration::from_millis(20));
    }
    println!("bulk cold start: {} icons queued at once, all on disk after {:?}", bulk.extracted(), started.elapsed());
    let mut histogram = std::collections::BTreeMap::new();
    for s in &sizes {
        *histogram.entry(*s).or_insert(0) += 1;
    }
    println!("short edge of the cached icons (0 = failed): {histogram:?}");

    let per_sheet = (COLUMNS * ROWS) as usize;
    for (n, chunk) in images.chunks(per_sheet).enumerate() {
        let mut sheet = Rgba {
            width: COLUMNS * CELL,
            height: ROWS * CELL,
            pixels: vec![0; (COLUMNS * CELL * ROWS * CELL * 4) as usize],
        };
        for (i, (_, image)) in chunk.iter().enumerate() {
            let (col, row) = (i as u32 % COLUMNS, i as u32 / COLUMNS);
            let background = if (col + row) % 2 == 0 { DARK } else { LIGHT };
            if let Some(image) = image {
                paint(&mut sheet, image, col, row, background);
            }
        }
        let file: &Path = &out.join(format!("sheet-{n}.png"));
        std::fs::write(file, encode_png(&sheet).unwrap()).unwrap();
        let names: Vec<String> = chunk.iter().enumerate().map(|(i, (name, _))| format!("{}:{name}", i)).collect();
        println!("sheet-{n}.png  {}", names.join(" | "));
    }
}
