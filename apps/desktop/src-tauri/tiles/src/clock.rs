//! Wall-clock helpers: Unix time, and the local calendar date and time (with the user's time zone and daylight
//! saving rules, as Windows applies them).

use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
use windows::Win32::System::Time::{
    FileTimeToSystemTime, SystemTimeToFileTime, SystemTimeToTzSpecificLocalTime, TzSpecificLocalTimeToSystemTime,
};

/// Unix time in milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX)).unwrap_or(0)
}

/// Milliseconds between 1601-01-01 (the FILETIME epoch) and 1970-01-01.
const FILETIME_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;
/// FILETIME counts 100 ns ticks.
const TICKS_PER_MS: i64 = 10_000;

/// A calendar date and time of day.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Civil {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

fn filetime_from_unix_ms(ms: i64) -> FILETIME {
    let ticks = (ms + FILETIME_EPOCH_OFFSET_MS) * TICKS_PER_MS;
    FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 }
}

fn unix_ms_from_filetime(ft: &FILETIME) -> i64 {
    let ticks = (i64::from(ft.dwHighDateTime) << 32) | i64::from(ft.dwLowDateTime);
    ticks / TICKS_PER_MS - FILETIME_EPOCH_OFFSET_MS
}

fn civil_of(st: &SYSTEMTIME) -> Civil {
    Civil {
        year: i32::from(st.wYear),
        month: u32::from(st.wMonth),
        day: u32::from(st.wDay),
        hour: u32::from(st.wHour),
        minute: u32::from(st.wMinute),
        second: u32::from(st.wSecond),
    }
}

/// The local date and time for a Unix time in the user's time zone.
pub fn local_civil(unix_ms: i64) -> Option<Civil> {
    let ft = filetime_from_unix_ms(unix_ms);
    let mut utc = SYSTEMTIME::default();
    let mut local = SYSTEMTIME::default();
    // SAFETY: both calls only read/write the structs passed in.
    unsafe {
        FileTimeToSystemTime(&ft, &mut utc).ok()?;
        SystemTimeToTzSpecificLocalTime(None, &utc, &mut local).ok()?;
    }
    Some(civil_of(&local))
}

/// The Unix time of a local wall-clock moment in the user's time zone. A moment skipped by the clock change
/// resolves forward; an ambiguous one resolves to the first occurrence, as Windows does.
pub fn local_to_unix_ms(c: Civil) -> Option<i64> {
    let local = SYSTEMTIME {
        wYear: u16::try_from(c.year).ok()?,
        wMonth: c.month as u16,
        wDayOfWeek: 0,
        wDay: c.day as u16,
        wHour: c.hour as u16,
        wMinute: c.minute as u16,
        wSecond: c.second as u16,
        wMilliseconds: 0,
    };
    let mut utc = SYSTEMTIME::default();
    let mut ft = FILETIME::default();
    // SAFETY: both calls only read/write the structs passed in.
    unsafe {
        TzSpecificLocalTimeToSystemTime(None, &local, &mut utc).ok()?;
        SystemTimeToFileTime(&utc, &mut ft).ok()?;
    }
    Some(unix_ms_from_filetime(&ft))
}

/// `2026-11-20 143105`: sortable and valid in a file name.
pub fn file_stamp(unix_ms: i64) -> String {
    match local_civil(unix_ms) {
        Some(c) => format!("{:04}-{:02}-{:02} {:02}{:02}{:02}", c.year, c.month, c.day, c.hour, c.minute, c.second),
        None => unix_ms.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_time_round_trips() {
        let now = now_ms();
        let civil = local_civil(now).unwrap();
        let back = local_to_unix_ms(civil).unwrap();
        // The round trip drops the milliseconds, and may differ by an hour only inside a clock-change overlap.
        assert!((now - back).abs() < 3_600_000 + 1_000, "{now} vs {back}");
    }

    #[test]
    fn the_unix_epoch_is_1970_in_utc_terms() {
        let ft = filetime_from_unix_ms(0);
        assert_eq!(unix_ms_from_filetime(&ft), 0);
        let mut st = SYSTEMTIME::default();
        // SAFETY: writes only into `st`.
        unsafe { FileTimeToSystemTime(&ft, &mut st).unwrap() };
        assert_eq!((st.wYear, st.wMonth, st.wDay), (1970, 1, 1));
    }

    #[test]
    fn file_stamps_are_sortable() {
        let s = file_stamp(now_ms());
        assert_eq!(s.len(), "2026-11-20 143105".len());
        assert!(!s.contains(':'));
    }
}
