//! Real-hardware checks for the dock tiles, and the latency and idle-CPU measurements recorded in
//! `docs/dock/TILES.md`. Run one scenario at a time:
//!
//! `cargo run -p dotdock-tiles --release --example tiles_probe -- <scenario>`
//!
//! Every scenario that changes a system setting puts it back before it ends, on success and on failure.
//! Scenarios: audio, microphone, clipboard, downloads, screenshots, toggles, history, shelf, contacts, calendar,
//! voice, colour, dock, idle-each, idle.

use dotdock_tiles::protocol::*;
use dotdock_tiles::wire::{AudioOp, FeedName, FeedsUpdate, HydrationOp, StopwatchOp};
use dotdock_tiles::{DataDir, DockEvent, DockTiles, Emitter, TileHub};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{FILETIME, HANDLE};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

type Events = Receiver<(Instant, TileData)>;

fn setup() -> (TileHub, Events, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("temp dir");
    let (tx, rx) = channel();
    let hub = TileHub::new(
        DataDir::at(dir.path()),
        Emitter::new(move |d| {
            let _ = tx.send((Instant::now(), d));
        }),
    );
    (hub, rx, dir)
}

/// Waits for an event of `tile` that satisfies `ok`; returns when it arrived.
fn wait_for(
    rx: &Events,
    tile: TileId,
    timeout: Duration,
    ok: impl Fn(&TileData) -> bool,
) -> Option<(Instant, TileData)> {
    let deadline = Instant::now() + timeout;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok((at, d)) if d.tile() == tile && ok(&d) => return Some((at, d)),
            Ok(_) => {}
            Err(_) => return None,
        }
    }
    None
}

fn drain(rx: &Events) {
    while rx.try_recv().is_ok() {}
}

fn ms(d: Duration) -> String {
    format!("{:.1} ms", d.as_secs_f64() * 1000.0)
}

fn cpu_seconds() -> f64 {
    let (mut c, mut e, mut k, mut u) =
        (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    // SAFETY: writes four FILETIMEs we own.
    unsafe { GetProcessTimes(GetCurrentProcess(), &mut c, &mut e, &mut k, &mut u).expect("process times") };
    let ticks = |f: FILETIME| ((u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime)) as f64 / 1e7;
    ticks(k) + ticks(u)
}

/// Puts text on the clipboard as a password manager would: with the "keep this out of history" markers.
fn copy_as_password_manager(text: &str) {
    // SAFETY: plain clipboard calls; memory handed to SetClipboardData belongs to the clipboard afterwards.
    unsafe {
        let name = |s: &str| {
            let w: Vec<u16> = s.encode_utf16().chain([0]).collect();
            RegisterClipboardFormatW(PCWSTR(w.as_ptr()))
        };
        let put = |format: u32, bytes: &[u8]| {
            let g = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).unwrap();
            let p = GlobalLock(g);
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p as *mut u8, bytes.len());
            let _ = GlobalUnlock(g);
            SetClipboardData(format, Some(HANDLE(g.0))).unwrap();
        };
        OpenClipboard(None).unwrap();
        let _ = EmptyClipboard();
        let utf16: Vec<u8> = text.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        put(13, &utf16); // CF_UNICODETEXT
        put(name("ExcludeClipboardContentFromMonitorProcessing"), &1u32.to_le_bytes());
        put(name("CanIncludeInClipboardHistory"), &0u32.to_le_bytes());
        put(name("Clipboard Viewer Ignore"), &[0u8]);
        let _ = CloseClipboard();
    }
}

fn audio(hub: &TileHub, rx: &Events) {
    let TileData::Audio(first) = hub.subscribe(TileId::Audio).unwrap() else { unreachable!() };
    println!(
        "audio: volume {:.2} muted {} devices {:?}",
        first.volume,
        first.muted,
        first.devices.iter().map(|d| (&d.name, d.is_default)).collect::<Vec<_>>()
    );
    println!("audio: apps {:?}", first.apps.iter().map(|a| (&a.name, a.active, a.volume)).collect::<Vec<_>>());
    let original = first.volume;
    let target = if original > 0.5 { original - 0.05 } else { original + 0.05 };
    for round in 0..5 {
        drain(rx);
        let want = if round % 2 == 0 { target } else { original };
        let t = Instant::now();
        let r = hub.command(TileCommand::AudioSetVolume { volume: want });
        let round_trip = t.elapsed();
        let event = wait_for(
            rx,
            TileId::Audio,
            Duration::from_secs(2),
            |d| matches!(d, TileData::Audio(a) if (a.volume - want).abs() < 0.006),
        );
        println!(
            "audio: set volume {want:.2}: command {} ({}), event after {}",
            ms(round_trip),
            r.is_ok(),
            event.map_or("NONE".to_owned(), |(at, _)| ms(at - t))
        );
    }
    // Restore the exact original, whatever the rounds left.
    let _ = hub.command(TileCommand::AudioSetVolume { volume: original });
    // Mute round trip.
    drain(rx);
    let t = Instant::now();
    hub.command(TileCommand::AudioSetMuted { muted: !first.muted });
    let e = wait_for(
        rx,
        TileId::Audio,
        Duration::from_secs(2),
        |d| matches!(d, TileData::Audio(a) if a.muted != first.muted),
    );
    println!("audio: mute toggle event after {}", e.map_or("NONE".to_owned(), |(at, _)| ms(at - t)));
    hub.command(TileCommand::AudioSetMuted { muted: first.muted });
    std::thread::sleep(Duration::from_millis(200));
    let TileData::Audio(end) = hub.state(TileId::Audio) else { unreachable!() };
    println!("audio: restored volume {:.2} muted {} (was {:.2} / {})", end.volume, end.muted, original, first.muted);
    hub.unsubscribe(TileId::Audio);
}

fn microphone(hub: &TileHub, rx: &Events) {
    let TileData::Microphone(first) = hub.subscribe(TileId::Microphone).unwrap() else { unreachable!() };
    println!("microphone: {first:?}");
    // Mute round trip.
    drain(rx);
    let t = Instant::now();
    hub.command(TileCommand::MicrophoneSetMuted { muted: !first.muted });
    let e = wait_for(
        rx,
        TileId::Microphone,
        Duration::from_secs(2),
        |d| matches!(d, TileData::Microphone(m) if m.muted != first.muted),
    );
    println!("microphone: mute toggle event after {}", e.map_or("NONE".to_owned(), |(at, _)| ms(at - t)));
    // Level, with the microphone unmuted for the test only.
    hub.command(TileCommand::MicrophoneSetMuted { muted: false });
    hub.subscribe(TileId::MicrophoneLevel).unwrap();
    println!("microphone: listening for 6 s; playing a system sound so the laptop microphone has something to hear...");
    let sound = dotdock_tiles::com::wide(r"C:\Windows\Media\Alarm01.wav");
    // SAFETY: plays a system file asynchronously; the path is NUL-terminated.
    unsafe {
        let _ = windows::Win32::Media::Audio::PlaySoundW(
            PCWSTR(sound.as_ptr()),
            None,
            windows::Win32::Media::Audio::SND_FILENAME | windows::Win32::Media::Audio::SND_ASYNC,
        );
    }
    let start = Instant::now();
    let (mut count, mut max, mut listening) = (0u32, 0.0f32, false);
    while start.elapsed() < Duration::from_secs(6) {
        if let Some((_, TileData::MicrophoneLevel(l))) =
            wait_for(rx, TileId::MicrophoneLevel, Duration::from_millis(500), |_| true)
        {
            count += 1;
            max = max.max(l.peak);
            listening |= l.listening;
            if let Some(p) = l.problem {
                println!("microphone: problem {p}");
            }
        }
    }
    println!(
        "microphone: level events {count} in 6 s ({:.1}/s), max peak {max:.3}, listening {listening}",
        f64::from(count) / 6.0
    );
    // Muting closes the stream.
    drain(rx);
    hub.command(TileCommand::MicrophoneSetMuted { muted: true });
    let closed = wait_for(
        rx,
        TileId::MicrophoneLevel,
        Duration::from_secs(2),
        |d| matches!(d, TileData::MicrophoneLevel(l) if !l.listening),
    );
    println!("microphone: stream closed after mute: {}", closed.is_some());
    hub.unsubscribe(TileId::MicrophoneLevel);
    hub.command(TileCommand::MicrophoneSetMuted { muted: first.muted });
    std::thread::sleep(Duration::from_millis(200));
    let TileData::Microphone(end) = hub.state(TileId::Microphone) else { unreachable!() };
    println!("microphone: restored muted {} (was {})", end.muted, first.muted);
    hub.unsubscribe(TileId::Microphone);
}

fn clipboard(hub: &TileHub, rx: &Events) {
    hub.subscribe(TileId::Clipboard).unwrap();
    let marker = format!("probe-{}", std::process::id());
    let t = Instant::now();
    hub.command(TileCommand::ColourCopy { hex: "#112233".into() });
    let got = wait_for(
        rx,
        TileId::Clipboard,
        Duration::from_secs(3),
        |d| matches!(d, TileData::Clipboard(c) if c.entries.iter().any(|e| e.preview == "#112233")),
    );
    println!("clipboard: ordinary copy recorded after {}", got.map_or("NEVER".to_owned(), |(at, _)| ms(at - t)));
    drain(rx);
    copy_as_password_manager(&format!("secret-{marker}"));
    let leaked = wait_for(
        rx,
        TileId::Clipboard,
        Duration::from_secs(2),
        |d| matches!(d, TileData::Clipboard(c) if c.entries.iter().any(|e| e.preview.contains(&marker))),
    );
    let TileData::Clipboard(state) = hub.state(TileId::Clipboard) else { unreachable!() };
    println!(
        "clipboard: password-manager copy stored: {} (entries: {:?})",
        leaked.is_some() || state.entries.iter().any(|e| e.preview.contains(&marker)),
        state.entries.iter().map(|e| e.preview.clone()).collect::<Vec<_>>()
    );
    // Paste-back of the ordinary entry.
    if let Some(entry) = state.entries.iter().find(|e| e.preview == "#112233") {
        println!("clipboard: paste-back {:?}", hub.command(TileCommand::ClipboardPaste { id: entry.id }));
    }
    hub.unsubscribe(TileId::Clipboard);
}

fn folder_scenario(hub: &TileHub, rx: &Events, tile: TileId, create_in: std::path::PathBuf, name: &str) {
    let (TileData::Downloads(s) | TileData::Screenshots(s)) = hub.subscribe(tile).unwrap() else { unreachable!() };
    println!("{tile:?}: folder {} items {} first {:?}", s.folder, s.items.len(), s.items.first().map(|i| &i.name));
    let file = create_in.join(name);
    drain(rx);
    let t = Instant::now();
    std::fs::write(&file, b"probe").unwrap();
    let e = wait_for(
        rx,
        tile,
        Duration::from_secs(3),
        |d| matches!(d, TileData::Downloads(s) | TileData::Screenshots(s) if s.items.iter().any(|i| i.name == name)),
    );
    println!("{tile:?}: new file reported after {}", e.map_or("NEVER".to_owned(), |(at, _)| ms(at - t)));
    let path = file.to_string_lossy().into_owned();
    let t = Instant::now();
    let r = hub.command(TileCommand::FileThumbnail { path, size: 64 });
    println!("{tile:?}: thumbnail/icon {} in {}", r.is_ok(), ms(t.elapsed()));
    drain(rx);
    let t = Instant::now();
    std::fs::remove_file(&file).unwrap();
    let e = wait_for(
        rx,
        tile,
        Duration::from_secs(3),
        |d| matches!(d, TileData::Downloads(s) | TileData::Screenshots(s) if !s.items.iter().any(|i| i.name == name)),
    );
    println!("{tile:?}: removal reported after {}", e.map_or("NEVER".to_owned(), |(at, _)| ms(at - t)));
    hub.unsubscribe(tile);
}

fn screenshots(hub: &TileHub, rx: &Events) {
    hub.subscribe(TileId::Screenshots).unwrap();
    drain(rx);
    let mut made = Vec::new();
    for (label, cmd) in [
        ("screen", TileCommand::ScreenshotsCapture { mode: CaptureMode::Screen, hwnd: None, rect: None }),
        (
            "region",
            TileCommand::ScreenshotsCapture {
                mode: CaptureMode::Region,
                hwnd: None,
                rect: Some(PixelRect { x: 100, y: 100, w: 640, h: 360 }),
            },
        ),
    ] {
        let t = Instant::now();
        let r = hub.command(cmd);
        let took = t.elapsed();
        if let CommandResult::Ok { value: Some(v), .. } = &r {
            let path = v["path"].as_str().unwrap().to_owned();
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let seen = wait_for(
                rx,
                TileId::Screenshots,
                Duration::from_secs(3),
                |d| matches!(d, TileData::Screenshots(s) if s.items.iter().any(|i| i.path == path)),
            );
            println!(
                "screenshots: {label} {took:?} -> {path} ({size} bytes), listed after {}",
                seen.map_or("NEVER".to_owned(), |(at, _)| ms(at - t))
            );
            made.push(path);
        } else {
            println!("screenshots: {label} failed: {r:?}");
        }
    }
    // Remove what the probe made, so the user's Screenshots folder is as it was.
    for p in made {
        let _ = std::fs::remove_file(p);
    }
    hub.unsubscribe(TileId::Screenshots);
}

fn toggles(hub: &TileHub, rx: &Events, wifi_too: bool) {
    let TileData::Toggles(first) = hub.subscribe(TileId::Toggles).unwrap() else { unreachable!() };
    println!("toggles: {}", serde_json::to_string(&first).unwrap());
    let cycle = |label: &str,
                 original: Option<bool>,
                 set: &dyn Fn(bool) -> CommandResult,
                 read: &dyn Fn(&TogglesState) -> Option<bool>| {
        let Some(orig) = original else { return println!("toggles: {label} state unknown, not touched") };
        // Always put it back, even if the checks below panic.
        struct Restore<'a>(&'a dyn Fn(bool) -> CommandResult, bool);
        impl Drop for Restore<'_> {
            fn drop(&mut self) {
                (self.0)(self.1);
            }
        }
        let _restore = Restore(set, orig);
        for want in [!orig, orig] {
            drain(rx);
            let t = Instant::now();
            let r = set(want);
            let rt = t.elapsed();
            let e = wait_for(
                rx,
                TileId::Toggles,
                Duration::from_secs(8),
                |d| matches!(d, TileData::Toggles(s) if read(s) == Some(want)),
            );
            println!(
                "toggles: {label} -> {want}: command {} ({}), event after {}",
                ms(rt),
                r.is_ok(),
                e.map_or("NONE".to_owned(), |(at, _)| ms(at - t))
            );
            std::thread::sleep(Duration::from_millis(500));
        }
    };
    cycle("bluetooth", first.bluetooth.on, &|on| hub.command(TileCommand::TogglesSetBluetooth { on }), &|s| {
        s.bluetooth.on
    });
    if wifi_too {
        cycle("wifi", first.wifi.on, &|on| hub.command(TileCommand::TogglesSetWifi { on }), &|s| s.wifi.on);
    }
    if first.brightness.available {
        let original = first.brightness.level;
        let want = if original > 0.5 { original - 0.2 } else { original + 0.2 };
        drain(rx);
        let t = Instant::now();
        let r = hub.command(TileCommand::TogglesSetBrightness { level: want });
        let rt = t.elapsed();
        let e = wait_for(
            rx,
            TileId::Toggles,
            Duration::from_secs(3),
            |d| matches!(d, TileData::Toggles(s) if (s.brightness.level - want).abs() < 0.02),
        );
        println!(
            "toggles: brightness {original:.2} -> {want:.2}: command {} ({}), event after {}",
            ms(rt),
            r.is_ok(),
            e.map_or("NONE".to_owned(), |(at, _)| ms(at - t))
        );
        // A slider drag: ten steps one after another, on the warm connection.
        let steps: Vec<String> = (0..10)
            .map(|k| {
                let t = Instant::now();
                hub.command(TileCommand::TogglesSetBrightness { level: (original + 0.02 * k as f32).min(1.0) });
                ms(t.elapsed())
            })
            .collect();
        println!("toggles: brightness drag, command times: {}", steps.join(", "));
        std::thread::sleep(Duration::from_millis(800));
        hub.command(TileCommand::TogglesSetBrightness { level: original });
        std::thread::sleep(Duration::from_millis(800));
        let TileData::Toggles(end) = hub.state(TileId::Toggles) else { unreachable!() };
        println!("toggles: brightness restored to {:.2} (was {original:.2})", end.brightness.level);
    }
    hub.unsubscribe(TileId::Toggles);
}

fn history(hub: &TileHub, rx: &Events) {
    hub.subscribe(TileId::SystemHistory).unwrap();
    println!("history: 4 s idle, then 4 s with every core busy");
    let sample = |secs: u64| {
        let end = Instant::now() + Duration::from_secs(secs);
        let mut last = None;
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            if let Ok((_, TileData::SystemHistory(h))) = rx.recv_timeout(left) {
                last = Some(h);
            }
        }
        last
    };
    let idle = sample(4).expect("idle samples");
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let busy: Vec<_> = (0..std::thread::available_parallelism().map_or(4, |n| n.get()))
        .map(|_| {
            let s = stop.clone();
            std::thread::spawn(move || {
                let mut x = 1u64;
                while !s.load(std::sync::atomic::Ordering::Relaxed) {
                    x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    std::hint::black_box(x);
                }
            })
        })
        .collect();
    let loaded = sample(4).expect("loaded samples");
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    for b in busy {
        let _ = b.join();
    }
    let fmt = |v: &[f32]| v.iter().map(|x| format!("{:.0}", x * 100.0)).collect::<Vec<_>>().join(" ");
    println!("history: cpu % over time: {}", fmt(&loaded.cpu));
    println!("history: idle part {} | memory {} | disk {}", fmt(&idle.cpu), fmt(&loaded.memory), fmt(&loaded.disk));
    println!(
        "history: net down B/s last {:.0}, up {:.0}",
        loaded.net_down.last().unwrap_or(&0.0),
        loaded.net_up.last().unwrap_or(&0.0)
    );
    hub.unsubscribe(TileId::SystemHistory);
}

fn shelf_and_contacts(hub: &TileHub) {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("a.txt");
    std::fs::write(&f, b"x").unwrap();
    let path = f.to_string_lossy().into_owned();
    println!("shelf add: {:?}", hub.command(TileCommand::ShelfAdd { paths: vec![path] }));
    println!("shelf: {}", serde_json::to_string(&hub.state(TileId::Shelf)).unwrap());
    hub.command(TileCommand::ShelfClear);
    let contact = Contact {
        id: String::new(),
        name: "Probe".into(),
        handles: vec![
            Handle { channel: Channel::Phone, value: "+1 555 010 0199".into() },
            Handle { channel: Channel::Teams, value: "probe@example.com".into() },
        ],
    };
    println!("contact save: {:?}", hub.command(TileCommand::ContactsSave { contact }));
    println!("contacts: {}", serde_json::to_string(&hub.state(TileId::Contacts)).unwrap());
    if let TileData::Contacts(c) = hub.state(TileId::Contacts) {
        for x in c.contacts {
            hub.command(TileCommand::ContactsRemove { id: x.id });
        }
    }
}

fn calendar(hub: &TileHub, rx: &Events) {
    let TileData::Calendar(first) = hub.subscribe(TileId::Calendar).unwrap() else { unreachable!() };
    println!("calendar: source {:?} problem {:?} events {}", first.source, first.problem, first.events.len());
    let dir = tempfile::tempdir().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let stamp = |t: i64| {
        let days = t.div_euclid(86_400);
        let secs = t.rem_euclid(86_400);
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + i64::from(m <= 2);
        format!("{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z", secs / 3600, secs % 3600 / 60, secs % 60)
    };
    let ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:p1\r\nSUMMARY:Design review\r\nDTSTART:{}\r\nDTEND:{}\r\nDESCRIPTION:Join https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:p2\r\nSUMMARY:Lunch\r\nDTSTART:{}\r\nDTEND:{}\r\nLOCATION:Canteen\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        stamp(now + 900),
        stamp(now + 2700),
        stamp(now + 7200),
        stamp(now + 9000)
    );
    let file = dir.path().join("probe.ics");
    std::fs::write(&file, ics).unwrap();
    drain(rx);
    let t = Instant::now();
    let r = hub.command(TileCommand::CalendarSetIcsFile { path: Some(file.to_string_lossy().into_owned()) });
    let e = wait_for(
        rx,
        TileId::Calendar,
        Duration::from_secs(3),
        |d| matches!(d, TileData::Calendar(c) if c.source == CalendarSource::IcsFile && !c.events.is_empty()),
    );
    println!(
        "calendar: chose .ics ({}), events after {}",
        r.is_ok(),
        e.as_ref().map_or("NEVER".to_owned(), |(at, _)| ms(*at - t))
    );
    if let Some((_, TileData::Calendar(c))) = e {
        for ev in c.events {
            println!(
                "calendar:  {} in {} min, join {:?}",
                ev.title,
                (ev.start_ms - now * 1000) / 60_000,
                ev.join.map(|j| j.service)
            );
        }
    }
    // Edit the file: the tile follows.
    drain(rx);
    let t = Instant::now();
    std::fs::write(&file, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n").unwrap();
    let e = wait_for(
        rx,
        TileId::Calendar,
        Duration::from_secs(3),
        |d| matches!(d, TileData::Calendar(c) if c.events.is_empty()),
    );
    println!("calendar: file edited, tile updated after {}", e.map_or("NEVER".to_owned(), |(at, _)| ms(at - t)));
    hub.command(TileCommand::CalendarSetIcsFile { path: None });
    hub.unsubscribe(TileId::Calendar);
}

fn voice(hub: &TileHub, rx: &Events) {
    let mic_before = dotdock_tiles::microphone::read_once().muted;
    hub.command(TileCommand::MicrophoneSetMuted { muted: false });
    let TileData::VoiceMemo(first) = hub.subscribe(TileId::VoiceMemo).unwrap() else { unreachable!() };
    println!("voice: folder {} memos {}", first.folder, first.memos.len());
    drain(rx);
    let t = Instant::now();
    let r = hub.command(TileCommand::VoiceMemoRecord);
    println!("voice: record started ({}) in {}", r.is_ok(), ms(t.elapsed()));
    let start = Instant::now();
    let (mut max, mut events) = (0.0f32, 0u32);
    while start.elapsed() < Duration::from_secs(4) {
        if let Some((_, TileData::VoiceMemo(s))) = wait_for(rx, TileId::VoiceMemo, Duration::from_millis(300), |_| true)
        {
            if let Some(rec) = s.recording {
                max = max.max(rec.peak);
                events += 1;
            }
        }
    }
    println!("voice: level events {events} in 4 s, max peak {max:.3}");
    hub.command(TileCommand::VoiceMemoStop);
    let TileData::VoiceMemo(after) = hub.state(TileId::VoiceMemo) else { unreachable!() };
    let new: Vec<_> = after.memos.iter().filter(|m| !first.memos.iter().any(|o| o.path == m.path)).collect();
    println!("voice: new memos {:?}", new.iter().map(|m| (&m.name, m.duration_ms, m.size_bytes)).collect::<Vec<_>>());
    if let Some(m) = new.first() {
        println!("voice: play {:?}", hub.command(TileCommand::VoiceMemoPlay { path: m.path.clone() }));
        std::thread::sleep(Duration::from_millis(800));
        println!("voice: stop playback {:?}", hub.command(TileCommand::VoiceMemoStopPlayback));
        println!("voice: delete {:?}", hub.command(TileCommand::VoiceMemoDelete { path: m.path.clone() }));
    }
    hub.unsubscribe(TileId::VoiceMemo);
    hub.command(TileCommand::MicrophoneSetMuted { muted: mic_before });
    println!("voice: microphone mute restored to {}", dotdock_tiles::microphone::read_once().muted);
}

fn colour(hub: &TileHub, rx: &Events) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};
    // SAFETY: only changes this thread's DPI mode, so cursor coordinates below are physical pixels like the picker's.
    unsafe {
        windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(
            windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        )
    };
    hub.subscribe(TileId::ColourPicker).unwrap();
    let mut original = Default::default();
    // SAFETY: cursor position is read and restored below.
    unsafe { GetCursorPos(&mut original).unwrap() };
    drain(rx);
    println!("colour: start {:?}", hub.command(TileCommand::ColourPickStart));
    // Aim at a spot, and compare what the picker reports with an independent screenshot of the same pixel.
    // SAFETY: moves the cursor and sends one click; both are undone/consumed by the picker's hook.
    unsafe { SetCursorPos(300, 300).unwrap() };
    let t = Instant::now();
    let seen = wait_for(
        rx,
        TileId::ColourPicker,
        Duration::from_secs(2),
        |d| matches!(d, TileData::ColourPicker(c) if c.current.as_ref().is_some_and(|s| s.x == 300 && s.y == 300)),
    );
    let Some((at, TileData::ColourPicker(c))) = seen else { return println!("colour: no sample at the cursor") };
    let picked = c.current.clone().unwrap();
    println!("colour: sample at (300, 300) = {} after {} (loupe {} cells)", picked.hex, ms(at - t), c.loupe.len());
    let shot = dotdock_tiles::screenshots::capture(
        std::env::temp_dir().as_path(),
        CaptureMode::Region,
        None,
        Some(PixelRect { x: 300, y: 300, w: 1, h: 1 }),
    )
    .unwrap();
    let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&shot).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut buf).unwrap();
    let independent = format!("#{:02X}{:02X}{:02X}", buf[0], buf[1], buf[2]);
    let _ = std::fs::remove_file(shot);
    println!("colour: independent screenshot pixel = {independent} -> match {}", independent == picked.hex);
    drain(rx);
    let click = |flags| INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dwFlags: flags, ..Default::default() } },
    };
    // SAFETY: one synthetic click, swallowed by the picker's hook.
    unsafe {
        SendInput(&[click(MOUSEEVENTF_LEFTDOWN), click(MOUSEEVENTF_LEFTUP)], std::mem::size_of::<INPUT>() as i32)
    };
    let done = wait_for(
        rx,
        TileId::ColourPicker,
        Duration::from_secs(2),
        |d| matches!(d, TileData::ColourPicker(c) if !c.picking),
    );
    if let Some((_, TileData::ColourPicker(c))) = done {
        println!("colour: click picked, history {:?}", c.history);
    } else {
        println!("colour: the click did not finish the pick");
        hub.command(TileCommand::ColourPickCancel);
    }
    // SAFETY: restores the cursor.
    unsafe { SetCursorPos(original.x, original.y).unwrap() };
    hub.unsubscribe(TileId::ColourPicker);
}

fn idle(hub: &TileHub, secs: u64) {
    let measure = |label: &str, tiles: &[TileId]| {
        for t in tiles {
            hub.subscribe(*t).unwrap();
        }
        std::thread::sleep(Duration::from_secs(10)); // let start-up settle
        let (c0, t0) = (cpu_seconds(), Instant::now());
        std::thread::sleep(Duration::from_secs(secs));
        let used = cpu_seconds() - c0;
        let wall = t0.elapsed().as_secs_f64();
        println!("idle: {label}: {used:.3} s of CPU in {wall:.0} s = {:.3} % of one core", used / wall * 100.0);
        for t in tiles.iter().rev() {
            hub.unsubscribe(*t);
        }
    };
    measure("nothing subscribed", &[]);
    measure(
        "event-driven tiles (audio, microphone, calendar, clipboard, screenshots, downloads, toggles)",
        &[
            TileId::Audio,
            TileId::Microphone,
            TileId::Calendar,
            TileId::Clipboard,
            TileId::Screenshots,
            TileId::Downloads,
            TileId::Toggles,
        ],
    );
    measure("system history (samples every second)", &[TileId::SystemHistory]);
    measure(
        "microphone level (30 Hz while visible, microphone muted so the stream is closed)",
        &[TileId::MicrophoneLevel],
    );
    println!("idle: tiles still active after unsubscribing everything: {:?}", hub.active());
}

/// The dock UI's door end to end: every feed watched at once, then the stopwatch and the water log driven through the
/// commands the UI sends. Everything is saved in the scenario's temporary data folder, never in the user's.
fn dock(dir: &std::path::Path) {
    let (tx, rx) = channel();
    let dock = DockTiles::new(DataDir::at(dir), move |e| {
        let _ = tx.send((Instant::now(), e));
    });
    let all = [
        FeedName::Contacts,
        FeedName::Meeting,
        FeedName::Stopwatch,
        FeedName::Mic,
        FeedName::Hydration,
        FeedName::Agenda,
        FeedName::Audio,
    ];
    let t = Instant::now();
    dock.watch(&all);
    println!("dock: watch of all seven feeds returned after {}", ms(t.elapsed()));
    let show = |update: &FeedsUpdate| {
        let json = serde_json::to_value(update).unwrap();
        for (name, feed) in json.as_object().unwrap() {
            let text = feed.to_string();
            let cut: String = text.chars().take(220).collect();
            println!("dock:   {name}: {cut}{}", if text.chars().count() > 220 { " ..." } else { "" });
        }
    };
    // Providers report as they start, then the current value of every feed arrives; read until it goes quiet.
    let mut deliveries = 0;
    let mut latest = FeedsUpdate::default();
    let mut last_at = t;
    while let Ok((at, event)) = rx.recv_timeout(Duration::from_millis(600)) {
        let DockEvent::Feeds(update) = event else { panic!("a feed update was expected") };
        deliveries += 1;
        last_at = at;
        latest.absorb(*update);
    }
    println!(
        "dock: {deliveries} deliveries, the last {} after the call began; what each feed holds now:",
        ms(last_at - t)
    );
    show(&latest);

    let timed = |label: &str, run: &dyn Fn() -> Result<(), String>| {
        while rx.try_recv().is_ok() {}
        let t = Instant::now();
        let result = run();
        let took = t.elapsed();
        let event = rx.recv_timeout(Duration::from_secs(2)).ok().map(|(at, e)| (at - t, e));
        println!(
            "dock: {label}: command {} ({}), event after {}",
            ms(took),
            result.map_or_else(|e| e, |()| "ok".to_owned()),
            event.as_ref().map_or("NONE".to_owned(), |(after, _)| ms(*after))
        );
        if let Some((_, DockEvent::Feeds(update))) = &event {
            show(update);
        }
    };
    timed("stopwatch start", &|| dock.stopwatch(StopwatchOp::Start));
    std::thread::sleep(Duration::from_millis(1500));
    timed("stopwatch lap", &|| dock.stopwatch(StopwatchOp::Lap));
    timed("stopwatch pause", &|| dock.stopwatch(StopwatchOp::Pause));
    timed("stopwatch reset", &|| dock.stopwatch(StopwatchOp::Reset));
    timed("water: log a glass", &|| dock.hydration(HydrationOp::Log { ml: 250 }));
    timed("water: snooze 15 minutes", &|| dock.hydration(HydrationOp::Snooze { minutes: 15 }));
    timed("audio: a volume that is not a number", &|| dock.audio(AudioOp::Volume { value: f32::NAN }));
    timed("join: a link that is not a meeting", &|| dock.join_meeting("https://example.com/"));
    dock.unwatch();
    dock.shutdown();
}

fn main() {
    let scenario = std::env::args().nth(1).unwrap_or_default();
    let (hub, rx, dir) = setup();
    match scenario.as_str() {
        "audio" => audio(&hub, &rx),
        "microphone" => microphone(&hub, &rx),
        "clipboard" => clipboard(&hub, &rx),
        "downloads-watch" => {
            // Prints the newest three downloads on every change for N seconds: download something meanwhile.
            hub.subscribe(TileId::Downloads).unwrap();
            let end = Instant::now()
                + Duration::from_secs(std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(15));
            println!("downloads-watch: ready");
            let started = Instant::now();
            // A real download by another process (curl), three seconds in, removed again afterwards.
            let target = dotdock_tiles::paths::downloads().unwrap().join("dotdock-probe-real-download.html");
            let helper = std::thread::spawn({
                let target = target.clone();
                move || {
                    std::thread::sleep(Duration::from_secs(3));
                    let status = std::process::Command::new("curl")
                        .args(["-s", "-o"])
                        .arg(&target)
                        .arg("https://example.com/")
                        .status();
                    println!("downloads-watch: curl finished at +3 s: {status:?}");
                }
            });
            while let Some(left) = end.checked_duration_since(Instant::now()) {
                if let Ok((at, TileData::Downloads(d))) = rx.recv_timeout(left) {
                    let top: Vec<_> = d
                        .items
                        .iter()
                        .take(3)
                        .map(|i| format!("{} ({} B{})", i.name, i.size_bytes, if i.partial { ", partial" } else { "" }))
                        .collect();
                    println!("downloads-watch: +{} {:?}", ms(at - started), top);
                }
            }
            let _ = helper.join();
            let _ = std::fs::remove_file(&target);
        }
        "clipboard-watch" => {
            // Prints every clipboard change for N seconds: copy something in any app meanwhile.
            hub.subscribe(TileId::Clipboard).unwrap();
            let end = Instant::now()
                + Duration::from_secs(std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(15));
            println!("clipboard-watch: ready");
            while let Some(left) = end.checked_duration_since(Instant::now()) {
                if let Ok((_, TileData::Clipboard(c))) = rx.recv_timeout(left) {
                    println!(
                        "clipboard-watch: {:?}",
                        c.entries.iter().map(|e| (e.preview.as_str(), e.source.as_deref())).collect::<Vec<_>>()
                    );
                }
            }
        }
        "downloads" => folder_scenario(
            &hub,
            &rx,
            TileId::Downloads,
            dotdock_tiles::paths::downloads().unwrap(),
            "dotdock-probe-download.zip",
        ),
        "screenshots" => screenshots(&hub, &rx),
        "native-screenshots" => folder_scenario(
            &hub,
            &rx,
            TileId::Screenshots,
            dotdock_tiles::paths::screenshots().unwrap(),
            "dotdock-probe-shot.png",
        ),
        "toggles" => toggles(&hub, &rx, std::env::args().nth(2).as_deref() == Some("--wifi")),
        "history" => history(&hub, &rx),
        "shelf" | "contacts" => shelf_and_contacts(&hub),
        "calendar" => calendar(&hub, &rx),
        "voice" => voice(&hub, &rx),
        "colour" => colour(&hub, &rx),
        "dock" => dock(dir.path()),
        "idle-each" => {
            // One tile at a time, to see which one costs what.
            let secs = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(20);
            for tile in [
                TileId::Audio,
                TileId::Microphone,
                TileId::Calendar,
                TileId::Clipboard,
                TileId::Screenshots,
                TileId::Downloads,
                TileId::Toggles,
            ] {
                hub.subscribe(tile).unwrap();
                std::thread::sleep(Duration::from_secs(3));
                let (c0, t0) = (cpu_seconds(), Instant::now());
                let mut events = 0;
                while let Some(left) = Duration::from_secs(secs).checked_sub(t0.elapsed()) {
                    if rx.recv_timeout(left).is_ok() {
                        events += 1;
                    }
                }
                let used = cpu_seconds() - c0;
                println!(
                    "idle-each: {tile:?}: {used:.3} s CPU in {secs} s = {:.3} %, {events} events",
                    used / t0.elapsed().as_secs_f64() * 100.0
                );
                hub.unsubscribe(tile);
            }
        }
        "idle" => idle(&hub, std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(60)),
        other => eprintln!("unknown scenario {other:?}"),
    }
    hub.shutdown();
    drop(dir);
}
