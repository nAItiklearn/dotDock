//! Calendar arithmetic on "wall time": a date and time of day written as milliseconds since 1970-01-01 00:00 as if
//! that clock were UTC. Pure integer maths (Howard Hinnant's civil-date algorithms), no time zone database.

pub const MS_PER_DAY: i64 = 86_400_000;
pub const MS_PER_MINUTE: i64 = 60_000;

/// Days since 1970-01-01 for a proleptic Gregorian date.
pub fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = i64::from(year) - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (i64::from(month) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date for a day count since 1970-01-01.
pub fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
    (year, month, day)
}

pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(year) => 29,
        _ => 28,
    }
}

/// Day of the week for a day count: 0 = Monday ... 6 = Sunday.
pub fn weekday(days: i64) -> u32 {
    // 1970-01-01 was a Thursday (3).
    (days + 3).rem_euclid(7) as u32
}

/// A date and time of day in wall-clock fields.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fields {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

pub fn wall_from_fields(f: Fields) -> i64 {
    days_from_civil(f.year, f.month, f.day) * MS_PER_DAY
        + (i64::from(f.hour) * 3600 + i64::from(f.minute) * 60 + i64::from(f.second)) * 1000
}

pub fn fields_from_wall(wall_ms: i64) -> Fields {
    let days = wall_ms.div_euclid(MS_PER_DAY);
    let secs = wall_ms.rem_euclid(MS_PER_DAY) / 1000;
    let (year, month, day) = civil_from_days(days);
    Fields { year, month, day, hour: (secs / 3600) as u32, minute: (secs % 3600 / 60) as u32, second: (secs % 60) as u32 }
}

/// The day (since 1970-01-01) of the `nth` occurrence of `weekday` in a month. Positive `nth` counts from the
/// start (1 = first), negative from the end (-1 = last). None when the month has no such day.
pub fn nth_weekday_of_month(year: i32, month: u32, weekday_wanted: u32, nth: i32) -> Option<i64> {
    let first = days_from_civil(year, month, 1);
    let last = first + i64::from(days_in_month(year, month)) - 1;
    if nth > 0 {
        let offset = (i64::from(weekday_wanted) - i64::from(weekday(first))).rem_euclid(7);
        let day = first + offset + 7 * i64::from(nth - 1);
        (day <= last).then_some(day)
    } else if nth < 0 {
        let offset = (i64::from(weekday(last)) - i64::from(weekday_wanted)).rem_euclid(7);
        let day = last - offset - 7 * i64::from(-nth - 1);
        (day >= first).then_some(day)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_round_trip_through_day_counts() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(days_from_civil(2026, 11, 20)), (2026, 11, 20));
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
        assert_eq!(days_from_civil(2000, 3, 1) - days_from_civil(2000, 2, 28), 2, "2000 is a leap year");
        assert_eq!(days_from_civil(1969, 12, 31), -1);
    }

    #[test]
    fn weekdays_match_the_calendar() {
        assert_eq!(weekday(days_from_civil(1970, 1, 1)), 3, "Thursday");
        assert_eq!(weekday(days_from_civil(2026, 11, 20)), 4, "Friday");
        assert_eq!(weekday(days_from_civil(2024, 2, 29)), 3, "Thursday");
    }

    #[test]
    fn month_lengths_follow_leap_years() {
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2100, 2), 28);
        assert_eq!(days_in_month(2000, 2), 29);
        assert_eq!(days_in_month(2026, 4), 30);
    }

    #[test]
    fn wall_time_round_trips() {
        let f = Fields { year: 2026, month: 3, day: 29, hour: 1, minute: 30, second: 5 };
        assert_eq!(fields_from_wall(wall_from_fields(f)), f);
        let before_epoch = Fields { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40 };
        assert_eq!(fields_from_wall(wall_from_fields(before_epoch)), before_epoch);
    }

    #[test]
    fn nth_and_last_weekdays_are_found() {
        // Second Sunday of March 2026 is the 8th; last Sunday of October 2026 is the 25th.
        assert_eq!(civil_from_days(nth_weekday_of_month(2026, 3, 6, 2).unwrap()), (2026, 3, 8));
        assert_eq!(civil_from_days(nth_weekday_of_month(2026, 10, 6, -1).unwrap()), (2026, 10, 25));
        assert_eq!(nth_weekday_of_month(2026, 2, 0, 5), None, "February 2026 has only four Mondays");
        assert_eq!(civil_from_days(nth_weekday_of_month(2026, 11, 4, 1).unwrap()), (2026, 11, 6));
    }
}
