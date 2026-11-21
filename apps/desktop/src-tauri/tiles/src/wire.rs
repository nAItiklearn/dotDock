//! What the dock UI reads and sends, in the shapes of the dock's `tiles/ui-types.ts`: nine feeds, each
//! `{ data, issue }`, and seven commands. Everything serialises as camelCase and times are Unix milliseconds.
//!
//! The functions here only map the providers' states onto those shapes, so they are pure and tested. A feed that
//! has no data says why with an [`Issue`]; the core produces three of the UI's five reasons. `unsupported` is the
//! UI's own word for a core that predates a feed, and `offline` belongs to network feeds, which the core has none of.

use crate::calendar::next_event;
use crate::contacts;
use crate::protocol::{
    AudioState, CalendarEvent, CalendarSource, CalendarState, Channel, Contact, ContactAction, ContactsState,
    DeviceKind, MeetingService, MicrophoneState, SystemHistory, Toggle, TogglesState,
};
use crate::zone::Zone;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// The order the three ways of reaching someone are listed in.
const ACTIONS: [ContactAction; 3] = [ContactAction::Call, ContactAction::Video, ContactAction::Message];

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Issue {
    NoDevice,
    Error,
    NeedsSetup,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Feed<T> {
    pub data: Option<T>,
    pub issue: Option<Issue>,
}

impl<T> Feed<T> {
    pub fn data(value: T) -> Self {
        Self { data: Some(value), issue: None }
    }

    pub fn issue(issue: Issue) -> Self {
        Self { data: None, issue: Some(issue) }
    }

    /// The meeting feed's "nothing coming up": no data and no issue is a state, not a failure.
    pub fn empty() -> Self {
        Self { data: None, issue: None }
    }
}

/// The feeds the UI can ask for.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum FeedName {
    Contacts,
    Meeting,
    Stopwatch,
    Mic,
    Hydration,
    Agenda,
    Audio,
    Network,
    Toggles,
}

// ---------------------------------------------------------------- views

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct ContactChannel {
    pub action: ContactAction,
    /// The app that handles it, as the user knows it.
    pub app: &'static str,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct ContactView {
    pub id: String,
    pub name: String,
    pub channels: Vec<ContactChannel>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct ContactsView {
    pub contacts: Vec<ContactView>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MeetingView {
    pub id: String,
    pub title: String,
    pub starts_at: i64,
    pub ends_at: i64,
    /// "Teams", "Zoom", "Meet": the service of the link, when the event has one.
    pub service: Option<&'static str>,
    pub join_url: Option<String>,
    pub location: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StopwatchView {
    pub running: bool,
    /// When the current run began; present only while running.
    pub started_at: Option<i64>,
    /// Time collected before the current run.
    pub banked_ms: i64,
    /// Elapsed time at each lap press, in order.
    pub laps: Vec<i64>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct MicView {
    pub muted: bool,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HydrationView {
    pub goal_ml: u32,
    pub logged_ml: u32,
    /// What one tap on "log a glass" adds.
    pub glass_ml: u32,
    /// When the next reminder fires; absent when reminders are off.
    pub next_reminder_at: Option<i64>,
    pub interval_minutes: u32,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgendaEvent {
    pub id: String,
    pub title: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub all_day: bool,
    pub location: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct AgendaView {
    /// Midnight at the start of the day shown, local time.
    pub day: i64,
    pub events: Vec<AgendaEvent>,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AudioKind {
    Speakers,
    Headphones,
    Other,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct AudioDeviceView {
    pub id: String,
    pub name: String,
    pub kind: AudioKind,
    pub current: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct AudioView {
    pub devices: Vec<AudioDeviceView>,
    /// 0 to 1.
    pub volume: f32,
    pub muted: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetworkView {
    pub down_bytes_per_sec: f64,
    pub up_bytes_per_sec: f64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Switches {
    pub wifi: Option<bool>,
    pub bluetooth: Option<bool>,
    pub night_light: Option<bool>,
    pub do_not_disturb: Option<bool>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct TogglesView {
    pub switches: Switches,
    /// 0 to 1, or null for a display whose brightness cannot be set.
    pub brightness: Option<f32>,
}

/// Splits the feed names a window asked for into the ones this core serves and the ones it does not know (a dock
/// UI newer than its core). Unknown names must not make the whole watch fail.
pub fn known_feeds(names: &[String]) -> (Vec<FeedName>, Vec<String>) {
    let mut known = Vec::new();
    let mut unknown = Vec::new();
    for name in names {
        match serde_json::from_value::<FeedName>(serde_json::Value::String(name.clone())) {
            Ok(feed) => known.push(feed),
            Err(_) => unknown.push(name.clone()),
        }
    }
    (known, unknown)
}

/// The feed event that tells the UI these feeds are not served, in its own word (`unsupported`).
pub fn unsupported_feeds(names: &[String]) -> serde_json::Value {
    names
        .iter()
        .map(|name| (name.clone(), serde_json::json!({ "data": null, "issue": "unsupported" })))
        .collect::<serde_json::Map<_, _>>()
        .into()
}

/// One delivery on the feed event: only the feeds that changed, as the UI's `Partial<TileFeeds>`.
#[derive(Serialize, Default, Clone, PartialEq, Debug)]
pub struct FeedsUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contacts: Option<Feed<ContactsView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meeting: Option<Feed<MeetingView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopwatch: Option<Feed<StopwatchView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mic: Option<Feed<MicView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hydration: Option<Feed<HydrationView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agenda: Option<Feed<AgendaView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<Feed<AudioView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<Feed<NetworkView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggles: Option<Feed<TogglesView>>,
}

impl FeedsUpdate {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// An update in which the feed `name` has no data and says why.
    pub fn failed(name: FeedName, issue: Issue) -> Self {
        let mut update = Self::default();
        match name {
            FeedName::Contacts => update.contacts = Some(Feed::issue(issue)),
            FeedName::Meeting => update.meeting = Some(Feed::issue(issue)),
            FeedName::Stopwatch => update.stopwatch = Some(Feed::issue(issue)),
            FeedName::Mic => update.mic = Some(Feed::issue(issue)),
            FeedName::Hydration => update.hydration = Some(Feed::issue(issue)),
            FeedName::Agenda => update.agenda = Some(Feed::issue(issue)),
            FeedName::Audio => update.audio = Some(Feed::issue(issue)),
            FeedName::Network => update.network = Some(Feed::issue(issue)),
            FeedName::Toggles => update.toggles = Some(Feed::issue(issue)),
        }
        update
    }

    /// The feeds of `self` that `wanted` asks for; the rest are dropped.
    pub fn only(self, wanted: &BTreeSet<FeedName>) -> Self {
        let keep = |name: FeedName| wanted.contains(&name);
        Self {
            contacts: self.contacts.filter(|_| keep(FeedName::Contacts)),
            meeting: self.meeting.filter(|_| keep(FeedName::Meeting)),
            stopwatch: self.stopwatch.filter(|_| keep(FeedName::Stopwatch)),
            mic: self.mic.filter(|_| keep(FeedName::Mic)),
            hydration: self.hydration.filter(|_| keep(FeedName::Hydration)),
            agenda: self.agenda.filter(|_| keep(FeedName::Agenda)),
            audio: self.audio.filter(|_| keep(FeedName::Audio)),
            network: self.network.filter(|_| keep(FeedName::Network)),
            toggles: self.toggles.filter(|_| keep(FeedName::Toggles)),
        }
    }

    /// Takes the feeds `other` holds over this update's, so a later reading of a feed wins.
    pub fn absorb(&mut self, other: FeedsUpdate) {
        self.contacts = other.contacts.or(self.contacts.take());
        self.meeting = other.meeting.or(self.meeting.take());
        self.stopwatch = other.stopwatch.or(self.stopwatch.take());
        self.mic = other.mic.or(self.mic.take());
        self.hydration = other.hydration.or(self.hydration.take());
        self.agenda = other.agenda.or(self.agenda.take());
        self.audio = other.audio.or(self.audio.take());
        self.network = other.network.or(self.network.take());
        self.toggles = other.toggles.or(self.toggles.take());
    }
}

// ---------------------------------------------------------------- commands

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum StopwatchOp {
    Start,
    Pause,
    Lap,
    Reset,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HydrationOp {
    Log { ml: u32 },
    Snooze { minutes: u32 },
}

/// The switches of the quick-toggles tile.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum ToggleName {
    Wifi,
    Bluetooth,
    NightLight,
    DoNotDisturb,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TogglesOp {
    Switch { name: ToggleName, on: bool },
    Brightness { value: f32 },
}

#[derive(Deserialize, Clone, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum AudioOp {
    Output { device_id: String },
    Volume { value: f32 },
    Mute { muted: bool },
}

// ---------------------------------------------------------------- mapping

/// The app a contact channel opens, as the user knows it.
pub fn app_name(channel: Channel) -> &'static str {
    match channel {
        Channel::Phone => "Phone Link",
        Channel::Teams => "Teams",
        Channel::Zoom => "Zoom",
        Channel::Whatsapp => "WhatsApp",
        Channel::Discord => "Discord",
        Channel::Email => "Mail",
    }
}

fn contact_view(contact: &Contact) -> ContactView {
    let channels = ACTIONS
        .into_iter()
        .filter_map(|action| {
            let handle = contact.handles.iter().find(|h| contacts::supports(h.channel, action))?;
            Some(ContactChannel { action, app: app_name(handle.channel) })
        })
        .collect();
    ContactView { id: contact.id.clone(), name: contact.name.clone(), channels }
}

pub fn contacts_feed(state: &ContactsState) -> Feed<ContactsView> {
    Feed::data(ContactsView { contacts: state.contacts.iter().map(contact_view).collect() })
}

pub fn audio_feed(state: &AudioState) -> Feed<AudioView> {
    if !state.available {
        return Feed::issue(Issue::NoDevice);
    }
    let devices = state
        .devices
        .iter()
        .map(|d| AudioDeviceView {
            id: d.id.clone(),
            name: d.name.clone(),
            kind: match d.kind {
                DeviceKind::Speakers => AudioKind::Speakers,
                DeviceKind::Headphones | DeviceKind::Headset => AudioKind::Headphones,
                _ => AudioKind::Other,
            },
            current: d.is_default,
        })
        .collect();
    Feed::data(AudioView { devices, volume: state.volume, muted: state.muted })
}

/// Throughput over the last sample of the system history; before the first sample, zero.
pub fn network_feed(history: &SystemHistory) -> Feed<NetworkView> {
    Feed::data(NetworkView {
        down_bytes_per_sec: history.net_down.last().copied().unwrap_or(0.0),
        up_bytes_per_sec: history.net_up.last().copied().unwrap_or(0.0),
    })
}

/// A switch the machine has and can read is its state; one it lacks, or cannot read, is null.
fn switch(toggle: &Toggle) -> Option<bool> {
    toggle.on.filter(|_| toggle.available)
}

pub fn toggles_feed(state: &TogglesState) -> Feed<TogglesView> {
    Feed::data(TogglesView {
        switches: Switches {
            wifi: switch(&state.wifi),
            bluetooth: switch(&state.bluetooth),
            night_light: switch(&state.night_light),
            do_not_disturb: switch(&state.do_not_disturb),
        },
        brightness: state.brightness.available.then_some(state.brightness.level.clamp(0.0, 1.0)),
    })
}

pub fn mic_feed(state: &MicrophoneState) -> Feed<MicView> {
    if state.available {
        Feed::data(MicView { muted: state.muted })
    } else {
        Feed::issue(Issue::NoDevice)
    }
}

/// Why a calendar with nothing to show has nothing: no account to read, or something that failed. Only the Windows
/// source reports a problem for an empty store without it having failed.
fn calendar_issue(state: &CalendarState) -> Option<Issue> {
    state.problem.as_ref()?;
    Some(if state.source == CalendarSource::Windows { Issue::NeedsSetup } else { Issue::Error })
}

fn service_name(service: MeetingService) -> &'static str {
    match service {
        MeetingService::Teams => "Teams",
        MeetingService::Zoom => "Zoom",
        MeetingService::Meet => "Meet",
        MeetingService::Webex => "Webex",
        MeetingService::Other => "Meeting",
    }
}

fn meeting_view(event: &CalendarEvent) -> MeetingView {
    MeetingView {
        id: event.id.clone(),
        title: event.title.clone(),
        starts_at: event.start_ms,
        ends_at: event.end_ms,
        service: event.join.as_ref().map(|j| service_name(j.service)),
        join_url: event.join.as_ref().map(|j| j.url.clone()),
        location: event.location.clone(),
    }
}

/// The next meeting: the first timed event that has not ended. All-day entries (birthdays, holidays) are not meetings.
pub fn meeting_feed(state: &CalendarState, now: i64) -> Feed<MeetingView> {
    if state.events.is_empty() {
        return calendar_issue(state).map_or_else(Feed::empty, Feed::issue);
    }
    let timed: Vec<CalendarEvent> = state.events.iter().filter(|e| !e.all_day).cloned().collect();
    next_event(&timed, now).map_or_else(Feed::empty, |e| Feed::data(meeting_view(e)))
}

/// Whether an event touches the span `[from, to)`; an event with no length counts at its start.
fn within(event: &CalendarEvent, from: i64, to: i64) -> bool {
    if event.end_ms > event.start_ms {
        event.end_ms > from && event.start_ms < to
    } else {
        event.start_ms >= from && event.start_ms < to
    }
}

/// Today's events, from local midnight to the next local midnight.
pub fn agenda_feed(state: &CalendarState, now: i64, zone: &dyn Zone) -> Feed<AgendaView> {
    let (Some(day), Some(next_day)) = (zone.at(now, 0, 0), zone.at(now, 1, 0)) else {
        return Feed::issue(Issue::Error);
    };
    if state.events.is_empty() {
        if let Some(issue) = calendar_issue(state) {
            return Feed::issue(issue);
        }
    }
    let events = state
        .events
        .iter()
        .filter(|e| within(e, day, next_day))
        .map(|e| AgendaEvent {
            id: e.id.clone(),
            title: e.title.clone(),
            starts_at: e.start_ms,
            ends_at: e.end_ms,
            all_day: e.all_day,
            location: e.location.clone(),
        })
        .collect();
    Feed::data(AgendaView { day, events })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AudioDevice, Handle, MeetingLink};
    use serde_json::json;

    const HOUR: i64 = 3_600_000;
    const DAY: i64 = 24 * HOUR;

    /// UTC as the local zone, which puts the day boundaries on whole multiples of a day.
    struct Utc;

    impl Zone for Utc {
        fn day(&self, now: i64) -> Option<i64> {
            Some(now.div_euclid(DAY))
        }

        fn at(&self, now: i64, days: i64, hour: u32) -> Option<i64> {
            Some((now.div_euclid(DAY) + days) * DAY + i64::from(hour) * HOUR)
        }
    }

    fn event(id: &str, start: i64, end: i64) -> CalendarEvent {
        CalendarEvent {
            id: id.into(),
            title: id.into(),
            start_ms: start,
            end_ms: end,
            all_day: false,
            location: None,
            calendar: None,
            join: None,
        }
    }

    fn calendar(source: CalendarSource, problem: Option<&str>, events: Vec<CalendarEvent>) -> CalendarState {
        CalendarState { source, problem: problem.map(str::to_owned), ics_path: None, events }
    }

    fn contact(handles: &[(Channel, &str)]) -> Contact {
        Contact {
            id: "c".into(),
            name: "C".into(),
            handles: handles
                .iter()
                .map(|(channel, value)| Handle { channel: *channel, value: (*value).into() })
                .collect(),
        }
    }

    #[test]
    fn a_feed_is_data_or_an_issue_and_the_empty_meeting_is_neither() {
        assert_eq!(
            serde_json::to_value(Feed::data(MicView { muted: true })).unwrap(),
            json!({ "data": { "muted": true }, "issue": null })
        );
        assert_eq!(
            serde_json::to_value(Feed::<MicView>::issue(Issue::NoDevice)).unwrap(),
            json!({ "data": null, "issue": "no-device" })
        );
        assert_eq!(
            serde_json::to_value(Feed::<MicView>::issue(Issue::NeedsSetup)).unwrap(),
            json!({ "data": null, "issue": "needs-setup" })
        );
        assert_eq!(serde_json::to_value(Feed::<MeetingView>::empty()).unwrap(), json!({ "data": null, "issue": null }));
    }

    #[test]
    fn each_contact_lists_one_way_per_action_in_the_fixed_order_through_the_app_that_can() {
        let channels = |handles: &[(Channel, &str)]| -> Vec<(ContactAction, &'static str)> {
            contact_view(&contact(handles)).channels.iter().map(|c| (c.action, c.app)).collect()
        };
        use ContactAction::*;
        assert_eq!(channels(&[(Channel::Phone, "+15551234567")]), [(Call, "Phone Link"), (Message, "Phone Link")]);
        assert_eq!(channels(&[(Channel::Zoom, "123456789")]), [(Call, "Zoom"), (Video, "Zoom")]);
        assert_eq!(channels(&[(Channel::Discord, "123456789012345678")]), [(Message, "Discord")]);
        assert_eq!(channels(&[(Channel::Whatsapp, "+15551234567")]), [(Call, "WhatsApp"), (Message, "WhatsApp")]);
        assert_eq!(channels(&[(Channel::Email, "a@b.co")]), [(Message, "Mail")]);
        // The first way that can do each thing wins, whatever order the ways were entered in.
        assert_eq!(
            channels(&[(Channel::Email, "a@b.co"), (Channel::Phone, "+15551234567"), (Channel::Teams, "a@b.co")]),
            [(Call, "Phone Link"), (Video, "Teams"), (Message, "Mail")]
        );
    }

    #[test]
    fn the_contacts_feed_has_the_shape_the_ui_reads() {
        let state = ContactsState { contacts: vec![contact(&[(Channel::Teams, "a@b.co")])] };
        assert_eq!(
            serde_json::to_value(contacts_feed(&state)).unwrap(),
            json!({
                "data": { "contacts": [{ "id": "c", "name": "C", "channels": [
                    { "action": "call", "app": "Teams" },
                    { "action": "video", "app": "Teams" },
                    { "action": "message", "app": "Teams" }
                ]}]},
                "issue": null
            })
        );
        assert_eq!(contacts_feed(&ContactsState { contacts: vec![] }).data, Some(ContactsView { contacts: vec![] }));
    }

    #[test]
    fn the_audio_feed_names_device_kinds_and_says_when_there_is_no_device() {
        let device = |id: &str, kind, is_default| AudioDevice { id: id.into(), name: id.into(), kind, is_default };
        let state = AudioState {
            available: true,
            volume: 0.25,
            muted: true,
            devices: vec![
                device("a", DeviceKind::Speakers, true),
                device("b", DeviceKind::Headset, false),
                device("c", DeviceKind::Headphones, false),
                device("d", DeviceKind::Hdmi, false),
            ],
            apps: vec![],
        };
        let view = audio_feed(&state).data.unwrap();
        let kinds: Vec<_> = view.devices.iter().map(|d| (d.kind, d.current)).collect();
        assert_eq!(
            kinds,
            [
                (AudioKind::Speakers, true),
                (AudioKind::Headphones, false),
                (AudioKind::Headphones, false),
                (AudioKind::Other, false)
            ]
        );
        assert_eq!((view.volume, view.muted), (0.25, true));
        assert_eq!(
            serde_json::to_value(audio_feed(&AudioState { available: false, ..state })).unwrap(),
            json!({ "data": null, "issue": "no-device" })
        );
    }

    #[test]
    fn the_microphone_feed_is_its_mute_state() {
        let mic = |available, muted| MicrophoneState { available, device_name: None, muted, volume: 0.0 };
        assert_eq!(mic_feed(&mic(true, true)), Feed::data(MicView { muted: true }));
        assert_eq!(mic_feed(&mic(false, false)), Feed::issue(Issue::NoDevice));
    }

    #[test]
    fn the_next_meeting_is_the_first_timed_event_that_has_not_ended() {
        let now = 100 * DAY;
        let mut birthday = event("birthday", now - HOUR, now + 10 * HOUR);
        birthday.all_day = true;
        let mut call = event("call", now + HOUR, now + 2 * HOUR);
        call.location = Some("Room 4".into());
        call.join =
            Some(MeetingLink { service: MeetingService::Meet, url: "https://meet.google.com/abc-defg-hij".into() });
        let state =
            calendar(CalendarSource::IcsFile, None, vec![event("done", now - 2 * HOUR, now - HOUR), birthday, call]);
        let meeting = meeting_feed(&state, now).data.unwrap();
        assert_eq!((meeting.id.as_str(), meeting.starts_at, meeting.ends_at), ("call", now + HOUR, now + 2 * HOUR));
        assert_eq!(
            (meeting.service, meeting.join_url.as_deref()),
            (Some("Meet"), Some("https://meet.google.com/abc-defg-hij"))
        );
        assert_eq!(meeting.location.as_deref(), Some("Room 4"));
        assert_eq!(
            serde_json::to_value(meeting_feed(&state, now)).unwrap()["data"],
            json!({
                "id": "call", "title": "call", "startsAt": now + HOUR, "endsAt": now + 2 * HOUR,
                "service": "Meet", "joinUrl": "https://meet.google.com/abc-defg-hij", "location": "Room 4"
            })
        );
    }

    #[test]
    fn a_meeting_without_a_link_has_no_join_url_and_a_free_day_is_no_meeting() {
        let now = 100 * DAY;
        let plain = calendar(CalendarSource::IcsFile, None, vec![event("lunch", now + HOUR, now + 2 * HOUR)]);
        let meeting = meeting_feed(&plain, now).data.unwrap();
        assert_eq!((meeting.service, meeting.join_url), (None, None));
        assert_eq!(meeting_feed(&plain, now + 3 * HOUR), Feed::empty(), "everything has ended");
        assert_eq!(meeting_feed(&calendar(CalendarSource::Windows, None, vec![]), now), Feed::empty());
    }

    #[test]
    fn an_empty_calendar_says_whether_it_needs_an_account_or_failed() {
        let now = 100 * DAY;
        let hint = Some("Windows has no calendar events to show.");
        assert_eq!(meeting_feed(&calendar(CalendarSource::Windows, hint, vec![]), now), Feed::issue(Issue::NeedsSetup));
        assert_eq!(
            meeting_feed(&calendar(CalendarSource::None, Some("Windows would not open its calendar"), vec![]), now),
            Feed::issue(Issue::Error)
        );
        assert_eq!(
            meeting_feed(&calendar(CalendarSource::IcsFile, Some("not a calendar"), vec![]), now),
            Feed::issue(Issue::Error)
        );
        assert_eq!(
            agenda_feed(&calendar(CalendarSource::Windows, hint, vec![]), now, &Utc),
            Feed::issue(Issue::NeedsSetup)
        );
        assert_eq!(
            agenda_feed(&calendar(CalendarSource::IcsFile, Some("x"), vec![]), now, &Utc),
            Feed::issue(Issue::Error)
        );
    }

    #[test]
    fn the_agenda_is_todays_events_from_midnight_to_midnight() {
        let today = 100 * DAY;
        let mut holiday = event("holiday", today, today + DAY);
        holiday.all_day = true;
        let state = calendar(
            CalendarSource::IcsFile,
            None,
            vec![
                event("yesterday", today - 3 * HOUR, today - HOUR),
                event("overnight", today - HOUR, today + HOUR),
                holiday,
                event("standup", today + 9 * HOUR, today + 10 * HOUR),
                event("reminder", today + 12 * HOUR, today + 12 * HOUR),
                event("late", today + 23 * HOUR, today + 25 * HOUR),
                event("tomorrow", today + DAY, today + DAY + HOUR),
                event("zero tomorrow", today + DAY, today + DAY),
            ],
        );
        let agenda = agenda_feed(&state, today + 8 * HOUR, &Utc).data.unwrap();
        let ids: Vec<_> = agenda.events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["overnight", "holiday", "standup", "reminder", "late"]);
        assert_eq!(agenda.day, today, "the day starts at local midnight");
        assert!(agenda.events[1].all_day);
        assert_eq!(
            agenda_feed(&calendar(CalendarSource::IcsFile, None, vec![]), today, &Utc).data.unwrap().events,
            vec![]
        );
    }

    #[test]
    fn an_agenda_needs_the_local_time() {
        struct Broken;
        impl Zone for Broken {
            fn day(&self, _: i64) -> Option<i64> {
                None
            }
            fn at(&self, _: i64, _: i64, _: u32) -> Option<i64> {
                None
            }
        }
        assert_eq!(
            agenda_feed(&calendar(CalendarSource::IcsFile, None, vec![]), 0, &Broken),
            Feed::issue(Issue::Error)
        );
    }

    #[test]
    fn an_update_carries_only_what_changed_and_the_latest_reading_wins() {
        let wanted: BTreeSet<FeedName> = [FeedName::Mic, FeedName::Audio].into();
        let both = FeedsUpdate {
            mic: Some(Feed::data(MicView { muted: true })),
            contacts: Some(contacts_feed(&ContactsState { contacts: vec![] })),
            ..FeedsUpdate::default()
        };
        let kept = both.clone().only(&wanted);
        assert!(kept.mic.is_some() && kept.contacts.is_none());
        assert!(FeedsUpdate::default().is_empty() && !kept.is_empty());
        assert_eq!(
            serde_json::to_value(&kept).unwrap(),
            json!({ "mic": { "data": { "muted": true }, "issue": null } })
        );
        let mut merged = both;
        merged.absorb(FeedsUpdate { mic: Some(Feed::data(MicView { muted: false })), ..FeedsUpdate::default() });
        assert_eq!(merged.mic, Some(Feed::data(MicView { muted: false })));
        assert!(merged.contacts.is_some(), "what the later update does not mention stays");
        assert_eq!(
            serde_json::to_value(FeedsUpdate::failed(FeedName::Hydration, Issue::Error)).unwrap(),
            json!({ "hydration": { "data": null, "issue": "error" } })
        );
    }

    #[test]
    fn the_ui_commands_parse_as_the_ui_sends_them() {
        assert_eq!(serde_json::from_value::<FeedName>(json!("agenda")).unwrap(), FeedName::Agenda);
        assert_eq!(
            serde_json::from_value::<Vec<FeedName>>(json!(["mic", "audio"])).unwrap(),
            [FeedName::Mic, FeedName::Audio]
        );
        assert_eq!(serde_json::from_value::<ContactAction>(json!("video")).unwrap(), ContactAction::Video);
        for (text, op) in [
            ("start", StopwatchOp::Start),
            ("pause", StopwatchOp::Pause),
            ("lap", StopwatchOp::Lap),
            ("reset", StopwatchOp::Reset),
        ] {
            assert_eq!(serde_json::from_value::<StopwatchOp>(json!(text)).unwrap(), op);
        }
        assert_eq!(
            serde_json::from_value::<HydrationOp>(json!({ "type": "log", "ml": 250 })).unwrap(),
            HydrationOp::Log { ml: 250 }
        );
        assert_eq!(
            serde_json::from_value::<HydrationOp>(json!({ "type": "snooze", "minutes": 15 })).unwrap(),
            HydrationOp::Snooze { minutes: 15 }
        );
        assert_eq!(
            serde_json::from_value::<AudioOp>(json!({ "type": "output", "deviceId": "x" })).unwrap(),
            AudioOp::Output { device_id: "x".into() }
        );
        assert_eq!(
            serde_json::from_value::<AudioOp>(json!({ "type": "volume", "value": 0.5 })).unwrap(),
            AudioOp::Volume { value: 0.5 }
        );
        assert_eq!(
            serde_json::from_value::<AudioOp>(json!({ "type": "mute", "muted": true })).unwrap(),
            AudioOp::Mute { muted: true }
        );
        assert!(serde_json::from_value::<AudioOp>(json!({ "type": "eject" })).is_err());
    }

    fn history(down: &[f64], up: &[f64]) -> SystemHistory {
        SystemHistory {
            interval_secs: 1,
            cpu: vec![],
            memory: vec![],
            disk: vec![],
            net_down: down.to_vec(),
            net_up: up.to_vec(),
            capacity: 60,
            memory_used_bytes: 0,
            memory_total_bytes: 0,
        }
    }

    #[test]
    fn the_network_feed_is_the_newest_sample_and_zero_before_the_first() {
        assert_eq!(
            serde_json::to_value(network_feed(&history(&[10.0, 2048.0], &[5.0, 512.0]))).unwrap(),
            json!({ "data": { "downBytesPerSec": 2048.0, "upBytesPerSec": 512.0 }, "issue": null })
        );
        let empty = network_feed(&history(&[], &[])).data.expect("data");
        assert_eq!((empty.down_bytes_per_sec, empty.up_bytes_per_sec), (0.0, 0.0));
    }

    fn toggle(available: bool, on: Option<bool>) -> Toggle {
        Toggle { available, on, problem: None }
    }

    #[test]
    fn a_missing_or_unreadable_switch_is_null_and_brightness_is_clamped() {
        let state = TogglesState {
            wifi: toggle(true, Some(true)),
            bluetooth: toggle(false, Some(false)),
            brightness: crate::protocol::Brightness { available: true, level: 1.4 },
            night_light: toggle(true, None),
            do_not_disturb: toggle(true, Some(false)),
        };
        assert_eq!(
            serde_json::to_value(toggles_feed(&state)).unwrap(),
            json!({
                "data": {
                    "switches": { "wifi": true, "bluetooth": null, "nightLight": null, "doNotDisturb": false },
                    "brightness": 1.0
                },
                "issue": null
            })
        );
        let dark = TogglesState { brightness: crate::protocol::Brightness { available: false, level: 0.5 }, ..state };
        assert_eq!(toggles_feed(&dark).data.expect("data").brightness, None);
    }

    #[test]
    fn toggles_ops_and_the_new_feed_names_read_as_the_ui_sends_them() {
        assert_eq!(
            serde_json::from_value::<TogglesOp>(json!({ "type": "switch", "name": "nightLight", "on": true })).unwrap(),
            TogglesOp::Switch { name: ToggleName::NightLight, on: true }
        );
        assert_eq!(
            serde_json::from_value::<TogglesOp>(json!({ "type": "brightness", "value": 0.25 })).unwrap(),
            TogglesOp::Brightness { value: 0.25 }
        );
        assert!(
            serde_json::from_value::<TogglesOp>(json!({ "type": "switch", "name": "airplane", "on": true })).is_err()
        );
        assert_eq!(
            serde_json::from_value::<Vec<FeedName>>(json!(["network", "toggles"])).unwrap(),
            vec![FeedName::Network, FeedName::Toggles]
        );
    }

    #[test]
    fn an_unknown_feed_is_reported_unsupported_and_the_rest_are_still_served() {
        let asked = vec!["audio".to_owned(), "rates".to_owned(), "toggles".to_owned()];
        let (known, unknown) = known_feeds(&asked);
        assert_eq!(known, vec![FeedName::Audio, FeedName::Toggles]);
        assert_eq!(unknown, vec!["rates".to_owned()]);
        assert_eq!(unsupported_feeds(&unknown), json!({ "rates": { "data": null, "issue": "unsupported" } }));
    }

    #[test]
    fn the_new_feeds_fail_filter_and_absorb_like_the_others() {
        let failed = FeedsUpdate::failed(FeedName::Toggles, Issue::Error);
        assert_eq!(serde_json::to_value(&failed).unwrap(), json!({ "toggles": { "data": null, "issue": "error" } }));
        let mut update = FeedsUpdate::failed(FeedName::Network, Issue::Error);
        update.absorb(failed);
        let only: BTreeSet<FeedName> = [FeedName::Network].into();
        let kept = update.only(&only);
        assert!(kept.network.is_some() && kept.toggles.is_none());
    }
}
