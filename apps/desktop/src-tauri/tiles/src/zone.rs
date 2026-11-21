//! The user's local calendar day and hours, behind a trait so logic that depends on "today" can be tested with a
//! fixed zone instead of the machine's.

use crate::calendar;

pub trait Zone: Send + Sync {
    /// Days since 1970-01-01 of the local calendar day that contains `now` (Unix ms).
    fn day(&self, now: i64) -> Option<i64>;

    /// Unix time of `hour`:00 local time on the day `days` after the one that contains `now`.
    fn at(&self, now: i64, days: i64, hour: u32) -> Option<i64>;
}

/// The time zone Windows is set to, with its daylight saving rules.
pub struct Local;

impl Zone for Local {
    fn day(&self, now: i64) -> Option<i64> {
        calendar::local_day(now)
    }

    fn at(&self, now: i64, days: i64, hour: u32) -> Option<i64> {
        calendar::local_hour(now, days, hour)
    }
}
