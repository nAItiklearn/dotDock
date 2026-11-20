//! Windows' own calendar store (`Windows.ApplicationModel.Appointments`): the accounts the user added in Windows
//! Settings (Outlook.com, Google, Exchange, iCloud) as seen by the Calendar and Mail apps. Read only.
//!
//! Opening the store works for a desktop app without package identity (verified on Windows 11 build 26300).

use super::meeting;
use crate::protocol::CalendarEvent;
use windows::ApplicationModel::Appointments::{
    Appointment, AppointmentManager, AppointmentStore, AppointmentStoreAccessType, FindAppointmentsOptions,
};
use windows::Foundation::{DateTime, TimeSpan};

/// Milliseconds from the WinRT epoch (1601-01-01) to the Unix epoch.
const EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;
/// WinRT counts 100 ns ticks.
const TICKS_PER_MS: i64 = 10_000;
/// Events returned per query; a week of a very busy calendar fits.
const MAX_EVENTS: u32 = 200;
/// How far a "does this calendar have anything at all" probe looks each way.
const PROBE_DAYS: i64 = 365;
const DAY_MS: i64 = 86_400_000;
/// Only this much of an event's description is searched for a meeting link.
const DETAILS_CHARS: usize = 20_000;

fn to_datetime(unix_ms: i64) -> DateTime {
    DateTime { UniversalTime: (unix_ms + EPOCH_OFFSET_MS) * TICKS_PER_MS }
}

fn from_datetime(t: DateTime) -> i64 {
    t.UniversalTime / TICKS_PER_MS - EPOCH_OFFSET_MS
}

fn open() -> Result<AppointmentStore, String> {
    crate::com::ensure();
    AppointmentManager::RequestStoreAsync(AppointmentStoreAccessType::AllCalendarsReadOnly)
        .and_then(|op| op.join())
        .map_err(|e| format!("Windows would not open its calendar: {e}"))
}

fn query(store: &AppointmentStore, from_ms: i64, to_ms: i64) -> Result<Vec<Appointment>, String> {
    let options = FindAppointmentsOptions::new().map_err(|e| e.to_string())?;
    options.SetMaxCount(MAX_EVENTS).map_err(|e| e.to_string())?;
    let span = TimeSpan { Duration: (to_ms - from_ms) * TICKS_PER_MS };
    store
        .FindAppointmentsAsyncWithOptions(to_datetime(from_ms), span, &options)
        .and_then(|op| op.join())
        .map(|list| list.into_iter().collect())
        .map_err(|e| format!("Windows would not list the calendar: {e}"))
}

fn convert(a: &Appointment) -> CalendarEvent {
    let start_ms = a.StartTime().map(from_datetime).unwrap_or(0);
    let length_ms = a.Duration().map(|d| d.Duration / TICKS_PER_MS).unwrap_or(0);
    let subject = a.Subject().map(|s| s.to_string()).unwrap_or_default();
    let location = a.Location().map(|s| s.to_string()).ok().filter(|s| !s.trim().is_empty());
    let details: String = a.Details().map(|s| s.to_string()).unwrap_or_default().chars().take(DETAILS_CHARS).collect();
    let online = a.OnlineMeetingLink().map(|s| s.to_string()).unwrap_or_default();
    let uri = a.Uri().and_then(|u| u.AbsoluteUri()).map(|s| s.to_string()).unwrap_or_default();
    let join = meeting::find_join_link([online.as_str(), location.as_deref().unwrap_or(""), uri.as_str(), details.as_str()]);
    let id = a.LocalId().map(|s| s.to_string()).unwrap_or_default();
    CalendarEvent {
        id: format!("{id}@{start_ms}"),
        title: if subject.trim().is_empty() { "(No title)".to_owned() } else { subject },
        start_ms,
        end_ms: start_ms + length_ms.max(0),
        all_day: a.AllDay().unwrap_or(false),
        location,
        calendar: None,
        join,
    }
}

/// Events overlapping `[from_ms, to_ms)`, soonest first.
pub fn fetch(from_ms: i64, to_ms: i64) -> Result<Vec<CalendarEvent>, String> {
    let store = open()?;
    let mut events: Vec<CalendarEvent> = query(&store, from_ms, to_ms)?.iter().map(convert).collect();
    events.sort_by(|a, b| a.start_ms.cmp(&b.start_ms).then(a.end_ms.cmp(&b.end_ms)));
    Ok(events)
}

/// True if the store has any event within a year either side of `around_ms`: tells "no accounts" from "free week".
pub fn has_any_events(around_ms: i64) -> bool {
    open()
        .and_then(|store| query(&store, around_ms - PROBE_DAYS * DAY_MS, around_ms + PROBE_DAYS * DAY_MS))
        .map(|list| !list.is_empty())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_conversion_round_trips() {
        assert_eq!(from_datetime(to_datetime(0)), 0);
        let now = crate::clock::now_ms();
        assert_eq!(from_datetime(to_datetime(now)), now);
    }

    #[test]
    fn the_windows_calendar_can_be_read_without_package_identity() {
        let now = crate::clock::now_ms();
        let events = fetch(now, now + 7 * DAY_MS).expect("the store opens");
        assert!(events.windows(2).all(|w| w[0].start_ms <= w[1].start_ms), "soonest first");
    }
}
