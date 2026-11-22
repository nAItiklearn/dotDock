//! Calendar and meetings: today's events and the next one, with a Join link for online meetings.
//!
//! Two sources, in this order: an `.ics` file the user picked (they asked for it explicitly), else Windows' own
//! calendar store. Everything is read only and stays on this machine; subscribing to a calendar URL is not
//! offered because it would make the dock fetch from the network. The worker wakes when the `.ics` file changes,
//! at midnight, when an event ends (so "next" moves on), and at least every five minutes to see edits made in
//! the Windows calendar, and only while the tile is subscribed.

mod civil;
pub mod ics;
pub mod meeting;
mod store;

use crate::clock::{local_civil, local_to_unix_ms, now_ms, Civil};
use crate::com::{coalesce, ComGuard, Refresh, Worker};
use crate::emit::{lock, Emitter, Shared};
use crate::protocol::{CalendarEvent, CalendarSource, CalendarState, TileData};
use crate::settings::Settings;
use civil::{days_from_civil, fields_from_wall, Fields, MS_PER_DAY, MS_PER_HOUR};
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// Days ahead that are listed, counting today.
const DAYS_AHEAD: i64 = 7;
/// The longest the worker sleeps between looks at the Windows calendar.
const REFRESH_MAX: Duration = Duration::from_secs(5 * 60);
/// A save in a calendar app touches the file several times; wait for quiet.
const FILE_QUIET: Duration = Duration::from_millis(400);
/// Never sleep less than this, so a pile-up of events cannot spin the thread.
const MIN_SLEEP: Duration = Duration::from_secs(1);
/// `.ics` files bigger than this are not calendars.
const MAX_ICS_BYTES: u64 = 20 * 1024 * 1024;
const NO_EVENTS_HINT: &str =
    "Windows has no calendar events to show. Add an account in Windows Settings, or choose an .ics file.";

fn civil_of(f: Fields) -> Civil {
    Civil { year: f.year, month: f.month, day: f.day, hour: f.hour, minute: f.minute, second: f.second }
}

/// Unix time of a wall-clock time in the user's zone.
fn local_instant(wall_ms: i64) -> Option<i64> {
    local_to_unix_ms(civil_of(fields_from_wall(wall_ms)))
}

/// Days since 1970-01-01 of the local calendar day that contains `now`.
pub(crate) fn local_day(now: i64) -> Option<i64> {
    let c = local_civil(now)?;
    Some(days_from_civil(c.year, c.month, c.day))
}

/// Unix time of `hour`:00 local time on the day `days` after the one that contains `now`.
pub(crate) fn local_hour(now: i64, days: i64, hour: u32) -> Option<i64> {
    local_instant((local_day(now)? + days) * MS_PER_DAY + i64::from(hour) * MS_PER_HOUR)
}

/// Unix time of local midnight `days` days after today's.
fn midnight(now: i64, days: i64) -> Option<i64> {
    local_hour(now, days, 0)
}

fn read_ics(path: &Path) -> Result<ics::Calendar, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Could not open the calendar file: {e}"))?;
    if meta.len() > MAX_ICS_BYTES {
        return Err("That file is too large to be a calendar".to_owned());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read the calendar file: {e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("That file is not an iCalendar (.ics) file".to_owned());
    }
    Ok(ics::parse(&text))
}

/// Events of the listed days from the chosen source.
fn compose(settings: &Settings, cached: &mut Option<(PathBuf, SystemTime, u64, ics::Calendar)>) -> CalendarState {
    let now = now_ms();
    let (Some(from), Some(to)) = (midnight(now, 0), midnight(now, DAYS_AHEAD)) else {
        return CalendarState {
            source: CalendarSource::None,
            problem: Some("Windows would not give the local time".into()),
            ics_path: None,
            events: Vec::new(),
        };
    };
    if let Some(path) = settings.get().calendar_ics_path {
        let file = PathBuf::from(&path);
        let stamp = std::fs::metadata(&file).and_then(|m| Ok((m.modified()?, m.len()))).ok();
        let fresh =
            matches!((&cached, stamp), (Some((p, t, l, _)), Some((mt, ml))) if *p == file && *t == mt && *l == ml);
        if !fresh {
            *cached = read_ics(&file).ok().zip(stamp).map(|(cal, (t, l))| (file.clone(), t, l, cal));
        }
        return match cached {
            Some((_, _, _, cal)) => CalendarState {
                source: CalendarSource::IcsFile,
                problem: None,
                ics_path: Some(path),
                events: cal.between(from, to, &local_instant),
            },
            None => CalendarState {
                source: CalendarSource::IcsFile,
                problem: Some(read_ics(&file).err().unwrap_or_else(|| "Could not read the calendar file".to_owned())),
                ics_path: Some(path),
                events: Vec::new(),
            },
        };
    }
    *cached = None;
    match store::fetch(from, to) {
        Ok(events) => {
            let problem = (events.is_empty() && !store::has_any_events(now)).then(|| NO_EVENTS_HINT.to_owned());
            CalendarState { source: CalendarSource::Windows, problem, ics_path: None, events }
        }
        Err(e) => CalendarState { source: CalendarSource::None, problem: Some(e), ics_path: None, events: Vec::new() },
    }
}

/// How long the worker may sleep: until midnight, the end of the running or next event, or the refresh limit.
fn sleep_for(state: &CalendarState, now: i64) -> Duration {
    let next_boundary = midnight(now, 1)
        .into_iter()
        .chain(state.events.iter().flat_map(|e| [e.start_ms, e.end_ms]))
        .filter(|t| *t > now)
        .min();
    let until = next_boundary.map(|t| Duration::from_millis((t - now) as u64 + 500)).unwrap_or(REFRESH_MAX);
    until.min(REFRESH_MAX).max(MIN_SLEEP)
}

pub struct Calendar {
    emitter: Emitter,
    settings: Settings,
    state: Shared<Option<CalendarState>>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl Calendar {
    pub fn new(emitter: Emitter, settings: Settings) -> Self {
        Self { emitter, settings, state: crate::emit::shared(None), worker: Mutex::new(None) }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.worker);
        if slot.is_some() {
            return Ok(());
        }
        let (settings, state, emitter) = (self.settings.clone(), self.state.clone(), self.emitter.clone());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let worker = Worker::spawn("tiles-calendar", move |rx, tx| {
            let _com = ComGuard::new();
            let mut cached = None;
            let mut watched: Option<(PathBuf, notify::RecommendedWatcher)> = None;
            let mut ready = Some(ready_tx);
            loop {
                // Follow the chosen file: watch its folder, and stop watching when the choice changes.
                let wanted = settings.get().calendar_ics_path.map(PathBuf::from);
                if watched.as_ref().map(|(p, _)| p) != wanted.as_ref() {
                    watched = wanted.and_then(|file| {
                        let poke = tx.clone();
                        let target = file.clone();
                        let mut w = notify::recommended_watcher(move |ev: notify::Result<notify::Event>| {
                            if ev.is_ok_and(|ev| ev.paths.iter().any(|p| p == &target)) {
                                let _ = poke.send(Some(Refresh));
                            }
                        })
                        .ok()?;
                        w.watch(file.parent()?, RecursiveMode::NonRecursive).ok()?;
                        Some((file, w))
                    });
                }
                let next = compose(&settings, &mut cached);
                let wait = sleep_for(&next, now_ms());
                if lock(&state).as_ref() != Some(&next) {
                    *lock(&state) = Some(next.clone());
                    emitter.emit(TileData::Calendar(next));
                }
                if let Some(tx) = ready.take() {
                    let _ = tx.send(());
                }
                match rx.recv_timeout(wait) {
                    Ok(Some(_)) => {
                        if !coalesce(&rx, FILE_QUIET) {
                            break;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
            }
        })
        .map_err(|e| format!("could not start the calendar worker: {e}"))?;
        *slot = Some(worker);
        drop(slot);
        let _ = ready_rx.recv_timeout(Duration::from_secs(15));
        Ok(())
    }

    pub fn stop(&self) {
        let worker = lock(&self.worker).take();
        drop(worker);
        *lock(&self.state) = None;
    }

    pub fn state(&self) -> CalendarState {
        lock(&self.state).clone().unwrap_or_else(|| {
            let _com = ComGuard::new();
            compose(&self.settings, &mut None)
        })
    }

    /// Chooses (or with None, forgets) the `.ics` file. The file must exist and look like a calendar.
    pub fn set_ics_file(&self, path: Option<String>) -> Result<(), String> {
        if let Some(p) = &path {
            let file = Path::new(p);
            if !file.extension().is_some_and(|e| e.eq_ignore_ascii_case("ics")) {
                return Err("Choose a file that ends in .ics".to_owned());
            }
            read_ics(file)?;
        }
        self.settings.update(|v| v.calendar_ics_path = path.clone())?;
        let sender = lock(&self.worker).as_ref().map(Worker::sender);
        match sender {
            Some(tx) => {
                let _ = tx.send(Some(Refresh));
            }
            None => self.emitter.emit(TileData::Calendar(self.state())),
        }
        Ok(())
    }
}

/// Opens an online meeting link: only a link that is itself a recognised meeting link, never an arbitrary URL.
pub fn join(url: &str) -> Result<(), String> {
    match meeting::find_join_link([url]) {
        Some(link) if link.url == url.trim() => crate::shell::open_uri(&link.url),
        _ => Err("That is not a meeting link".to_owned()),
    }
}

/// The first event that has not ended yet, for callers that want "what's next" without the UI.
pub fn next_event(events: &[CalendarEvent], now: i64) -> Option<&CalendarEvent> {
    events.iter().find(|e| e.end_ms > now || (e.end_ms == e.start_ms && e.start_ms >= now))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MeetingService;
    use civil::wall_from_fields;

    fn ev(start: i64, end: i64) -> CalendarEvent {
        CalendarEvent {
            id: start.to_string(),
            title: "x".into(),
            start_ms: start,
            end_ms: end,
            all_day: false,
            location: None,
            calendar: None,
            join: None,
        }
    }

    #[test]
    fn the_next_event_skips_those_that_ended() {
        let events = [ev(0, 100), ev(150, 300), ev(400, 500)];
        assert_eq!(next_event(&events, 120).map(|e| e.start_ms), Some(150));
        assert_eq!(next_event(&events, 200).map(|e| e.start_ms), Some(150), "a running event is still current");
        assert_eq!(next_event(&events, 600), None);
    }

    #[test]
    fn the_worker_sleeps_until_the_next_boundary_but_never_longer_than_the_limit() {
        let now = now_ms();
        let soon = CalendarState {
            source: CalendarSource::IcsFile,
            problem: None,
            ics_path: None,
            events: vec![ev(now + 30_000, now + 90_000)],
        };
        let d = sleep_for(&soon, now);
        assert!(d >= Duration::from_secs(29) && d <= Duration::from_secs(32), "{d:?}");
        let empty = CalendarState { events: vec![], ..soon };
        assert!(sleep_for(&empty, now) <= REFRESH_MAX);
        assert!(sleep_for(&empty, now) >= MIN_SLEEP);
    }

    #[test]
    fn only_real_meeting_links_can_be_joined() {
        assert!(join("https://example.com/").is_err());
        assert!(join("file:///C:/Windows/System32/calc.exe").is_err());
        assert!(join("https://evil.example/?next=https://zoom.us/j/123456789").is_err());
        // The recogniser accepts these; opening them is not exercised here.
        assert_eq!(
            meeting::find_join_link(["https://zoom.us/j/123456789"]).map(|l| l.service),
            Some(MeetingService::Zoom)
        );
    }

    #[test]
    fn an_ics_file_is_chosen_read_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings::load(dir.path().join("s.json"));
        let (tx, rx) = std::sync::mpsc::channel();
        let cal = Calendar::new(Emitter::new(move |d| drop(tx.send(d))), settings);
        assert!(cal.set_ics_file(Some("C:/nowhere/x.ics".into())).is_err());
        let notes = dir.path().join("notes.txt");
        std::fs::write(&notes, "hello").unwrap();
        assert!(cal.set_ics_file(Some(notes.to_string_lossy().into_owned())).is_err());
        let fake = dir.path().join("fake.ics");
        std::fs::write(&fake, "hello").unwrap();
        assert!(cal.set_ics_file(Some(fake.to_string_lossy().into_owned())).is_err(), "not a calendar");

        // An event today at 23:00 UTC+0 stays today or tomorrow in any zone; use a long one that covers now.
        let today = fields_from_wall(now_ms());
        let stamp = |f: Fields, plus_days: i64| {
            let w = wall_from_fields(f) + plus_days * MS_PER_DAY;
            let g = fields_from_wall(w);
            format!("{:04}{:02}{:02}T{:02}{:02}{:02}Z", g.year, g.month, g.day, g.hour, g.minute, g.second)
        };
        let ics_text = format!(
            "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:t\r\nSUMMARY:All week\r\nDTSTART:{}\r\nDTEND:{}\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            stamp(today, -1),
            stamp(today, 3)
        );
        let good = dir.path().join("good.ics");
        std::fs::write(&good, ics_text).unwrap();
        cal.set_ics_file(Some(good.to_string_lossy().into_owned())).unwrap();
        let state = cal.state();
        assert_eq!(state.source, CalendarSource::IcsFile);
        assert_eq!(state.events.len(), 1);
        assert_eq!(state.events[0].join.as_ref().map(|j| j.service), Some(MeetingService::Meet));
        assert!(matches!(rx.try_iter().last(), Some(TileData::Calendar(_))));
        cal.set_ics_file(None).unwrap();
        if !store::tests::no_calendar_service() {
            assert_eq!(cal.state().source, CalendarSource::Windows);
        }
    }
}
