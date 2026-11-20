//! A reader for iCalendar (`.ics`, RFC 5545) files: events, recurrence, time zones, meeting links.
//!
//! This is the calendar tile's second source, for people whose appointments are not in Windows' own calendar
//! store: export or subscribe to a calendar in Outlook, Google Calendar, Apple Calendar or Thunderbird and point
//! the tile at the file. Understood: one-off and all-day events; DAILY/WEEKLY/MONTHLY/YEARLY rules with INTERVAL,
//! COUNT, UNTIL, BYDAY (also "2TU", "-1FR"), BYMONTHDAY and BYMONTH; EXDATE; edited single occurrences
//! (RECURRENCE-ID); cancelled events; UTC, floating and time-zone times (zones from the file's own VTIMEZONE).
//! Not understood and skipped: RDATE, BYSETPOS, BYHOUR and other sub-day rules, VTODO and VJOURNAL.

use super::civil::{
    days_from_civil, days_in_month, fields_from_wall, nth_weekday_of_month, wall_from_fields, weekday, Fields, MS_PER_DAY,
    MS_PER_MINUTE,
};
use super::meeting;
use crate::protocol::CalendarEvent;
use std::collections::HashMap;

/// Longest run of recurrence periods examined for one event; guards against a malformed rule that never ends.
const MAX_PERIODS: u32 = 20_000;
/// Slack added around the asked-for window, in wall time, so any time zone offset still falls inside.
const ZONE_SLACK_MS: i64 = 2 * MS_PER_DAY;
/// Characters shown for an event without a title.
const UNTITLED: &str = "(No title)";

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Zone {
    Utc,
    /// No zone given: the user's own time zone.
    Floating,
    Named(String),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Stamp {
    pub wall_ms: i64,
    pub zone: Zone,
    pub date_only: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Rule {
    freq: Freq,
    interval: u32,
    count: Option<u32>,
    until: Option<i64>,
    /// (ordinal, weekday 0 = Monday); ordinal 0 means "every".
    by_day: Vec<(i32, u32)>,
    by_month_day: Vec<i32>,
    by_month: Vec<u32>,
}

#[derive(Clone, Debug)]
struct Observance {
    onset_wall: i64,
    yearly: Option<(u32, i32, u32)>,
    offset_to_min: i32,
}

#[derive(Clone, Debug, Default)]
struct ZoneRules {
    observances: Vec<Observance>,
}

#[derive(Clone, Debug)]
pub struct IcsEvent {
    uid: String,
    summary: String,
    location: Option<String>,
    description: Option<String>,
    url: Option<String>,
    start: Stamp,
    end: Option<Stamp>,
    duration_ms: Option<i64>,
    rule: Option<Rule>,
    exdates: Vec<Stamp>,
    recurrence_id: Option<Stamp>,
    cancelled: bool,
    meeting_urls: Vec<String>,
}

#[derive(Default)]
pub struct Calendar {
    events: Vec<IcsEvent>,
    zones: HashMap<String, ZoneRules>,
}

struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, name: &str) -> Option<&str> {
        self.params.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let (Some(rest), Some(last)) = (line.strip_prefix([' ', '\t']), lines.last_mut()) {
            last.push_str(rest);
        } else if !line.is_empty() {
            lines.push(line.to_owned());
        }
    }
    lines
}

/// Splits at the first `:` outside double quotes.
fn split_value(line: &str) -> Option<(&str, &str)> {
    let mut in_quotes = false;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => return Some((&line[..i], &line[i + 1..])),
            _ => {}
        }
    }
    None
}

fn split_params(head: &str) -> (String, Vec<(String, String)>) {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in head.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            ';' if !in_quotes => parts.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    parts.push(current);
    let name = parts.remove(0).to_ascii_uppercase();
    let params = parts
        .into_iter()
        .filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.to_owned())))
        .collect();
    (name, params)
}

fn parse_prop(line: &str) -> Option<Prop> {
    let (head, value) = split_value(line)?;
    let (name, params) = split_params(head);
    Some(Prop { name, params, value: value.to_owned() })
}

/// Undoes iCalendar text escaping.
fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn digits(s: &str, from: usize, len: usize) -> Option<u32> {
    s.get(from..from + len)?.parse().ok()
}

/// `20261120`, `20261120T143000` or `20261120T143000Z`.
fn parse_stamp(value: &str, tzid: Option<&str>, date_param: bool) -> Option<Stamp> {
    let v = value.trim();
    let date_only = date_param || v.len() == 8;
    let (year, month, day) = (digits(v, 0, 4)? as i32, digits(v, 4, 2)?, digits(v, 6, 2)?);
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let (hour, minute, second) = if date_only || v.len() < 15 {
        (0, 0, 0)
    } else {
        let t = (digits(v, 9, 2)?, digits(v, 11, 2)?, digits(v, 13, 2)?);
        if t.0 > 24 || t.1 > 59 || t.2 > 60 {
            return None;
        }
        t
    };
    let zone = if v.ends_with('Z') {
        Zone::Utc
    } else if let Some(id) = tzid.filter(|id| !id.is_empty()) {
        Zone::Named(id.to_owned())
    } else {
        Zone::Floating
    };
    let wall_ms = wall_from_fields(Fields { year, month, day, hour, minute, second });
    Some(Stamp { wall_ms, zone: if date_only { Zone::Floating } else { zone }, date_only })
}

fn stamp_of(p: &Prop) -> Option<Stamp> {
    parse_stamp(&p.value, p.param("TZID"), p.param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE")))
}

/// `+0100`, `-0530`, `+010000` as minutes east of UTC.
fn parse_offset(value: &str) -> Option<i32> {
    let v = value.trim();
    let sign = match v.chars().next()? {
        '+' => 1,
        '-' => -1,
        _ => return None,
    };
    let hours = digits(v, 1, 2)? as i32;
    let minutes = digits(v, 3, 2)? as i32;
    Some(sign * (hours * 60 + minutes))
}

/// `PT1H30M`, `P1D`, `P1W`, `-PT15M` in milliseconds.
fn parse_duration(value: &str) -> Option<i64> {
    let v = value.trim();
    let (sign, v) = match v.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, v.strip_prefix('+').unwrap_or(v)),
    };
    let v = v.strip_prefix('P')?;
    let mut total = 0i64;
    let mut number = String::new();
    let mut in_time = false;
    for c in v.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => number.push(c),
            unit => {
                let n: i64 = number.parse().ok()?;
                number.clear();
                total += n * match (unit, in_time) {
                    ('W', _) => 7 * MS_PER_DAY,
                    ('D', _) => MS_PER_DAY,
                    ('H', true) => 3_600_000,
                    ('M', true) => MS_PER_MINUTE,
                    ('S', true) => 1000,
                    _ => return None,
                };
            }
        }
    }
    number.is_empty().then_some(sign * total)
}

fn weekday_code(code: &str) -> Option<u32> {
    ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].iter().position(|d| *d == code).map(|i| i as u32)
}

fn parse_rule(value: &str) -> Option<Rule> {
    let mut rule = Rule {
        freq: Freq::Daily,
        interval: 1,
        count: None,
        until: None,
        by_day: Vec::new(),
        by_month_day: Vec::new(),
        by_month: Vec::new(),
    };
    let mut have_freq = false;
    for part in value.split(';') {
        let (key, val) = part.split_once('=')?;
        match key.to_ascii_uppercase().as_str() {
            "FREQ" => {
                rule.freq = match val.to_ascii_uppercase().as_str() {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    _ => return None,
                };
                have_freq = true;
            }
            "INTERVAL" => rule.interval = val.parse::<u32>().ok().filter(|n| *n > 0)?,
            "COUNT" => rule.count = Some(val.parse().ok()?),
            "UNTIL" => rule.until = Some(parse_stamp(val, None, false)?.wall_ms + if val.len() == 8 { MS_PER_DAY - 1 } else { 0 }),
            "BYDAY" => {
                for d in val.split(',') {
                    let d = d.trim().to_ascii_uppercase();
                    let split = d.len().checked_sub(2)?;
                    let ordinal = if split == 0 { 0 } else { d[..split].parse::<i32>().ok()? };
                    rule.by_day.push((ordinal, weekday_code(&d[split..])?));
                }
            }
            "BYMONTHDAY" => rule.by_month_day = val.split(',').map(|n| n.trim().parse().ok()).collect::<Option<_>>()?,
            "BYMONTH" => rule.by_month = val.split(',').map(|n| n.trim().parse().ok()).collect::<Option<_>>()?,
            // Rules this reader does not model make the whole event non-repeating rather than wrong.
            "BYSETPOS" | "BYHOUR" | "BYMINUTE" | "BYSECOND" | "BYYEARDAY" | "BYWEEKNO" => return None,
            _ => {}
        }
    }
    have_freq.then_some(rule)
}

/// Wall times of a recurrence, in order, from `start_wall` until `limit_wall`.
fn expand(start_wall: i64, rule: &Rule, limit_wall: i64) -> Vec<i64> {
    let start_day = start_wall.div_euclid(MS_PER_DAY);
    let time_of_day = start_wall.rem_euclid(MS_PER_DAY);
    let start = fields_from_wall(start_wall);
    let mut out: Vec<i64> = Vec::new();
    let push = |day: i64, out: &mut Vec<i64>| {
        let wall = day * MS_PER_DAY + time_of_day;
        if wall >= start_wall && rule.until.is_none_or(|u| wall <= u) {
            out.push(wall);
        }
    };
    'periods: for k in 0..MAX_PERIODS {
        let step = i64::from(k) * i64::from(rule.interval);
        let mut days: Vec<i64> = Vec::new();
        match rule.freq {
            Freq::Daily => {
                let day = start_day + step;
                if rule.by_day.is_empty() || rule.by_day.iter().any(|(_, w)| *w == weekday(day)) {
                    days.push(day);
                }
            }
            Freq::Weekly => {
                let week_start = start_day - i64::from(weekday(start_day)) + step * 7;
                let wanted: Vec<u32> =
                    if rule.by_day.is_empty() { vec![weekday(start_day)] } else { rule.by_day.iter().map(|(_, w)| *w).collect() };
                days.extend(wanted.into_iter().map(|w| week_start + i64::from(w)));
            }
            Freq::Monthly | Freq::Yearly => {
                let (year, months): (i32, Vec<u32>) = if rule.freq == Freq::Monthly {
                    let index = i64::from(start.month - 1) + step;
                    ((i64::from(start.year) + index.div_euclid(12)) as i32, vec![index.rem_euclid(12) as u32 + 1])
                } else {
                    let months = if rule.by_month.is_empty() { vec![start.month] } else { rule.by_month.clone() };
                    ((i64::from(start.year) + step) as i32, months)
                };
                for month in months {
                    if rule.freq == Freq::Monthly && !rule.by_month.is_empty() && !rule.by_month.contains(&month) {
                        continue;
                    }
                    if !rule.by_day.is_empty() {
                        for (ordinal, wd) in &rule.by_day {
                            if *ordinal == 0 {
                                let first = days_from_civil(year, month, 1);
                                days.extend((0..i64::from(days_in_month(year, month))).map(|d| first + d).filter(|d| weekday(*d) == *wd));
                            } else if let Some(d) = nth_weekday_of_month(year, month, *wd, *ordinal) {
                                days.push(d);
                            }
                        }
                    } else if !rule.by_month_day.is_empty() {
                        let length = days_in_month(year, month) as i32;
                        for md in &rule.by_month_day {
                            let day = if *md < 0 { length + md + 1 } else { *md };
                            if (1..=length).contains(&day) {
                                days.push(days_from_civil(year, month, day as u32));
                            }
                        }
                    } else if start.day <= days_in_month(year, month) {
                        days.push(days_from_civil(year, month, start.day));
                    }
                }
            }
        }
        days.sort_unstable();
        days.dedup();
        for day in days {
            if day * MS_PER_DAY + time_of_day > limit_wall {
                // Periods are in order, so once a day lies past the limit everything after it does too.
                break 'periods;
            }
            push(day, &mut out);
            if rule.count.is_some_and(|c| out.len() as u32 >= c) {
                break 'periods;
            }
        }
        if start_day + step * if rule.freq == Freq::Daily { 1 } else { 28 } > limit_wall.div_euclid(MS_PER_DAY) + 366 {
            break;
        }
    }
    out
}

impl ZoneRules {
    /// Minutes east of UTC at a wall-clock moment of this zone.
    fn offset_at(&self, wall: i64) -> Option<i32> {
        let year = fields_from_wall(wall).year;
        let mut best: Option<(i64, i32)> = None;
        for o in &self.observances {
            let onsets: Vec<i64> = match o.yearly {
                None => vec![o.onset_wall],
                Some((month, ordinal, wd)) => {
                    let tod = o.onset_wall.rem_euclid(MS_PER_DAY);
                    [year - 1, year]
                        .into_iter()
                        .filter_map(|y| nth_weekday_of_month(y, month, wd, ordinal).map(|d| d * MS_PER_DAY + tod))
                        .collect()
                }
            };
            for onset in onsets.into_iter().filter(|onset| *onset <= wall) {
                if best.is_none_or(|(b, _)| onset > b) {
                    best = Some((onset, o.offset_to_min));
                }
            }
        }
        best.map(|(_, off)| off).or_else(|| self.observances.first().map(|o| o.offset_to_min))
    }
}

fn parse_observance(props: &[Prop]) -> Option<Observance> {
    let get = |name: &str| props.iter().find(|p| p.name == name);
    let onset_wall = parse_stamp(&get("DTSTART")?.value, None, false)?.wall_ms;
    let offset_to_min = parse_offset(&get("TZOFFSETTO")?.value)?;
    let yearly = get("RRULE").and_then(|p| parse_rule(&p.value)).and_then(|r| {
        let (ordinal, wd) = *r.by_day.first()?;
        (r.freq == Freq::Yearly && ordinal != 0).then_some((*r.by_month.first()?, ordinal, wd))
    });
    Some(Observance { onset_wall, yearly, offset_to_min })
}

fn build_event(props: &[Prop]) -> Option<IcsEvent> {
    let get = |name: &str| props.iter().find(|p| p.name == name);
    let text = |name: &str| get(name).map(|p| unescape(&p.value)).filter(|s| !s.trim().is_empty());
    let start = stamp_of(get("DTSTART")?)?;
    let mut meeting_urls: Vec<String> = ["X-MICROSOFT-SKYPETEAMSMEETINGURL", "X-GOOGLE-CONFERENCE", "CONFERENCE"]
        .iter()
        .filter_map(|n| get(n).map(|p| p.value.clone()))
        .collect();
    meeting_urls.extend(props.iter().filter(|p| p.name == "ATTACH").map(|p| p.value.clone()));
    Some(IcsEvent {
        uid: get("UID").map(|p| p.value.clone()).unwrap_or_default(),
        summary: text("SUMMARY").unwrap_or_else(|| UNTITLED.to_owned()),
        location: text("LOCATION"),
        description: text("DESCRIPTION"),
        url: get("URL").map(|p| p.value.clone()),
        end: get("DTEND").and_then(stamp_of),
        duration_ms: get("DURATION").and_then(|p| parse_duration(&p.value)),
        rule: get("RRULE").and_then(|p| parse_rule(&p.value)),
        exdates: props
            .iter()
            .filter(|p| p.name == "EXDATE")
            .flat_map(|p| p.value.split(',').filter_map(|v| parse_stamp(v, p.param("TZID"), p.param("VALUE").is_some_and(|x| x == "DATE"))))
            .collect(),
        recurrence_id: get("RECURRENCE-ID").and_then(stamp_of),
        cancelled: get("STATUS").is_some_and(|p| p.value.eq_ignore_ascii_case("CANCELLED")),
        start,
        meeting_urls,
    })
}

/// Reads the events and time zones of an `.ics` file. Malformed events are skipped, not fatal.
pub fn parse(text: &str) -> Calendar {
    let mut cal = Calendar::default();
    let mut stack: Vec<String> = Vec::new();
    let mut event_props: Vec<Prop> = Vec::new();
    let mut zone_id: Option<String> = None;
    let mut zone = ZoneRules::default();
    let mut obs_props: Vec<Prop> = Vec::new();
    for line in unfold(text) {
        let Some(prop) = parse_prop(&line) else { continue };
        match prop.name.as_str() {
            "BEGIN" => {
                let name = prop.value.to_ascii_uppercase();
                if name == "VEVENT" {
                    event_props.clear();
                } else if name == "VTIMEZONE" {
                    zone = ZoneRules::default();
                    zone_id = None;
                } else if name == "STANDARD" || name == "DAYLIGHT" {
                    obs_props.clear();
                }
                stack.push(name);
            }
            "END" => {
                let name = prop.value.to_ascii_uppercase();
                match name.as_str() {
                    "VEVENT" => cal.events.extend(build_event(&event_props)),
                    "VTIMEZONE" => {
                        if let Some(id) = zone_id.take() {
                            cal.zones.insert(id, std::mem::take(&mut zone));
                        }
                    }
                    "STANDARD" | "DAYLIGHT" => zone.observances.extend(parse_observance(&obs_props)),
                    _ => {}
                }
                if stack.last().is_some_and(|top| *top == name) {
                    stack.pop();
                }
            }
            _ => match stack.last().map(String::as_str) {
                Some("VEVENT") => event_props.push(prop),
                Some("VTIMEZONE") if prop.name == "TZID" => zone_id = Some(prop.value),
                Some("STANDARD" | "DAYLIGHT") => obs_props.push(prop),
                _ => {}
            },
        }
    }
    cal
}

impl Calendar {
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    fn instant(&self, stamp: &Stamp, wall: i64, local: &dyn Fn(i64) -> Option<i64>) -> Option<i64> {
        match &stamp.zone {
            Zone::Utc => Some(wall),
            Zone::Floating => local(wall),
            Zone::Named(id) => match self.zones.get(id).and_then(|z| z.offset_at(wall)) {
                Some(minutes) => Some(wall - i64::from(minutes) * MS_PER_MINUTE),
                None => local(wall),
            },
        }
    }

    /// Events overlapping `[from_ms, to_ms)` (Unix time), soonest first. `local` turns a wall-clock time in the
    /// user's own time zone into a Unix time.
    pub fn between(&self, from_ms: i64, to_ms: i64, local: &dyn Fn(i64) -> Option<i64>) -> Vec<CalendarEvent> {
        let overridden = |e: &IcsEvent, wall: i64| {
            self.events.iter().any(|o| o.uid == e.uid && o.recurrence_id.as_ref().is_some_and(|r| r.wall_ms == wall))
        };
        let mut out = Vec::new();
        for e in self.events.iter().filter(|e| !e.cancelled) {
            let length = match (&e.end, e.duration_ms) {
                (Some(end), _) => end.wall_ms - e.start.wall_ms,
                (None, Some(d)) => d,
                (None, None) if e.start.date_only => MS_PER_DAY,
                (None, None) => 0,
            };
            let walls = match (&e.rule, &e.recurrence_id) {
                (Some(rule), None) => expand(e.start.wall_ms, rule, to_ms + ZONE_SLACK_MS),
                _ => vec![e.start.wall_ms],
            };
            for wall in walls {
                let excluded = e.exdates.iter().any(|x| {
                    if x.date_only {
                        x.wall_ms.div_euclid(MS_PER_DAY) == wall.div_euclid(MS_PER_DAY)
                    } else {
                        x.wall_ms == wall
                    }
                });
                if excluded || (e.recurrence_id.is_none() && e.rule.is_some() && overridden(e, wall)) {
                    continue;
                }
                let Some(start) = self.instant(&e.start, wall, local) else { continue };
                let end = start + length.max(0);
                let overlaps = if end > start { end > from_ms && start < to_ms } else { start >= from_ms && start < to_ms };
                if !overlaps {
                    continue;
                }
                let texts = e.meeting_urls.iter().map(String::as_str).chain(e.location.as_deref()).chain(e.url.as_deref()).chain(e.description.as_deref());
                out.push(CalendarEvent {
                    id: format!("{}@{start}", e.uid),
                    title: e.summary.clone(),
                    start_ms: start,
                    end_ms: end,
                    all_day: e.start.date_only,
                    location: e.location.clone(),
                    calendar: None,
                    join: meeting::find_join_link(texts),
                });
            }
        }
        out.sort_by(|a, b| a.start_ms.cmp(&b.start_ms).then(a.end_ms.cmp(&b.end_ms)).then_with(|| a.title.cmp(&b.title)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MeetingService;

    /// The user's zone for tests: UTC+1, no daylight saving.
    fn plus_one(wall: i64) -> Option<i64> {
        Some(wall - 3_600_000)
    }

    fn at(y: i32, m: u32, d: u32, h: u32, mi: u32) -> i64 {
        wall_from_fields(Fields { year: y, month: m, day: d, hour: h, minute: mi, second: 0 })
    }

    fn day_window(cal: &Calendar, y: i32, m: u32, d: u32) -> Vec<CalendarEvent> {
        let from = at(y, m, d, 0, 0) - 3_600_000;
        cal.between(from, from + MS_PER_DAY, &plus_one)
    }

    fn wrap(body: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n")
    }

    #[test]
    fn a_utc_event_keeps_its_instant() {
        let cal = parse(&wrap("BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Standup\r\nDTSTART:20261120T090000Z\r\nDTEND:20261120T093000Z\r\nEND:VEVENT\r\n"));
        let events = day_window(&cal, 2026, 11, 20);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].title, "Standup");
        assert_eq!(events[0].start_ms, at(2026, 11, 20, 9, 0));
        assert_eq!(events[0].end_ms - events[0].start_ms, 1_800_000);
    }

    #[test]
    fn floating_times_are_the_users_local_time() {
        let cal = parse(&wrap("BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Lunch\r\nDTSTART:20261120T120000\r\nDURATION:PT1H\r\nEND:VEVENT\r\n"));
        let e = &day_window(&cal, 2026, 11, 20)[0];
        assert_eq!(e.start_ms, at(2026, 11, 20, 11, 0), "12:00 at UTC+1 is 11:00 UTC");
        assert_eq!(e.end_ms - e.start_ms, 3_600_000);
    }

    #[test]
    fn all_day_events_span_the_day_and_end_exclusive() {
        let cal = parse(&wrap("BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nEND:VEVENT\r\n"));
        assert_eq!(day_window(&cal, 2026, 11, 20).len(), 1);
        assert!(day_window(&cal, 2026, 11, 20)[0].all_day);
        assert!(day_window(&cal, 2026, 11, 21).is_empty(), "the end date is exclusive");
        assert!(day_window(&cal, 2026, 11, 19).is_empty());
    }

    #[test]
    fn folded_lines_and_escapes_are_read() {
        let cal = parse(&wrap(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Plan\\, review\\; part\r\n  two\r\nLOCATION:Room 4\\nFloor 2\r\nDTSTART:20261120T090000Z\r\nEND:VEVENT\r\n",
        ));
        let e = &day_window(&cal, 2026, 11, 20)[0];
        assert_eq!(e.title, "Plan, review; part two");
        assert_eq!(e.location.as_deref(), Some("Room 4\nFloor 2"));
    }

    #[test]
    fn weekly_rules_with_days_interval_and_count() {
        let cal = parse(&wrap(
            "BEGIN:VEVENT\r\nUID:w\r\nSUMMARY:Gym\r\nDTSTART:20261102T180000Z\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5\r\nEND:VEVENT\r\n",
        ));
        let from = at(2026, 11, 1, 0, 0);
        let all = cal.between(from, from + 60 * MS_PER_DAY, &plus_one);
        let days: Vec<_> = all.iter().map(|e| super::super::civil::civil_from_days(e.start_ms.div_euclid(MS_PER_DAY))).collect();
        // Mon 2 Nov, Wed 4 Nov, then two weeks on: Mon 16, Wed 18, Mon 30 Nov (COUNT=5).
        assert_eq!(days, [(2026, 11, 2), (2026, 11, 4), (2026, 11, 16), (2026, 11, 18), (2026, 11, 30)]);
    }

    #[test]
    fn monthly_nth_weekday_and_yearly_rules() {
        let cal = parse(&wrap(
            "BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:Board\r\nDTSTART:20260310T100000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=2TU\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:y\r\nSUMMARY:Birthday\r\nDTSTART;VALUE=DATE:20200229\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\n",
        ));
        let board = cal.between(at(2026, 11, 1, 0, 0), at(2026, 12, 1, 0, 0), &plus_one);
        let board: Vec<_> = board.iter().filter(|e| e.title == "Board").collect();
        assert_eq!(board.len(), 1);
        assert_eq!(super::super::civil::civil_from_days(board[0].start_ms.div_euclid(MS_PER_DAY)), (2026, 11, 10), "second Tuesday of November 2026");
        // A 29 February birthday only occurs in leap years.
        assert!(cal.between(at(2026, 2, 28, 0, 0), at(2026, 3, 2, 0, 0), &plus_one).iter().all(|e| e.title != "Birthday"));
        assert_eq!(cal.between(at(2028, 2, 28, 0, 0), at(2028, 3, 2, 0, 0), &plus_one).iter().filter(|e| e.title == "Birthday").count(), 1);
    }

    #[test]
    fn until_exdate_and_edited_occurrences() {
        let cal = parse(&wrap(
            "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Daily\r\nDTSTART:20261116T080000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261120T080000Z\r\nEXDATE:20261118T080000Z\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Daily (moved)\r\nRECURRENCE-ID:20261119T080000Z\r\nDTSTART:20261119T150000Z\r\nEND:VEVENT\r\n",
        ));
        let from = at(2026, 11, 15, 0, 0);
        let titles: Vec<_> = cal.between(from, from + 10 * MS_PER_DAY, &plus_one).iter().map(|e| (e.title.clone(), fields_from_wall(e.start_ms).day, fields_from_wall(e.start_ms).hour)).collect();
        assert_eq!(
            titles,
            [("Daily".to_owned(), 16, 8), ("Daily".to_owned(), 17, 8), ("Daily (moved)".to_owned(), 19, 15), ("Daily".to_owned(), 20, 8)]
        );
    }

    #[test]
    fn cancelled_events_are_hidden() {
        let cal = parse(&wrap("BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Gone\r\nSTATUS:CANCELLED\r\nDTSTART:20261120T090000Z\r\nEND:VEVENT\r\n"));
        assert!(day_window(&cal, 2026, 11, 20).is_empty());
    }

    #[test]
    fn named_zones_use_the_files_own_daylight_saving_rules() {
        let zone = "BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\n\
            BEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\n\
            BEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\n";
        let ev = |date: &str| format!("BEGIN:VEVENT\r\nUID:{date}\r\nSUMMARY:Call\r\nDTSTART;TZID=Europe/Berlin:{date}T090000\r\nEND:VEVENT\r\n");
        let cal = parse(&wrap(&format!("{zone}{}{}", ev("20260715"), ev("20261120"))));
        let from = at(2026, 1, 1, 0, 0);
        let events = cal.between(from, from + 365 * MS_PER_DAY, &plus_one);
        assert_eq!(events.len(), 2);
        assert_eq!(fields_from_wall(events[0].start_ms).hour, 7, "09:00 in summer (UTC+2) is 07:00 UTC");
        assert_eq!(fields_from_wall(events[1].start_ms).hour, 8, "09:00 in winter (UTC+1) is 08:00 UTC");
    }

    #[test]
    fn meeting_links_come_from_any_field() {
        let cal = parse(&wrap(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Sync\r\nDTSTART:20261120T090000Z\r\nDESCRIPTION:Join: https://us02web.zoom.us/j/81234567890?pwd=x\\nThanks\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Review\r\nDTSTART:20261120T100000Z\r\nX-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Coffee\r\nDTSTART:20261120T110000Z\r\nLOCATION:Cafe\r\nEND:VEVENT\r\n",
        ));
        let e = day_window(&cal, 2026, 11, 20);
        assert_eq!(e[0].join.as_ref().map(|j| j.service), Some(MeetingService::Zoom));
        assert_eq!(e[1].join.as_ref().map(|j| j.service), Some(MeetingService::Meet));
        assert_eq!(e[2].join, None);
    }

    #[test]
    fn garbage_is_survivable() {
        assert!(parse("").is_empty());
        assert!(parse("not a calendar at all").is_empty());
        let cal = parse(&wrap("BEGIN:VEVENT\r\nSUMMARY:No start\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20269999T000000Z\r\nEND:VEVENT\r\n"));
        assert!(cal.is_empty());
    }

    #[test]
    fn durations_parse() {
        assert_eq!(parse_duration("PT1H30M"), Some(5_400_000));
        assert_eq!(parse_duration("P1DT2H"), Some(MS_PER_DAY + 7_200_000));
        assert_eq!(parse_duration("P1W"), Some(7 * MS_PER_DAY));
        assert_eq!(parse_duration("-PT15M"), Some(-900_000));
        assert_eq!(parse_duration("1H"), None);
    }
}
