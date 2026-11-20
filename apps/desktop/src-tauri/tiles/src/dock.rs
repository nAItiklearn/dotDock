//! The dock UI's door to the core: watch the feeds a tile shows, send the commands its buttons send, and receive
//! what changes, in the shapes of [`crate::wire`]. The host forwards [`DockEvent`]s to the dock window on
//! [`EVENT_FEEDS`] and [`EVENT_MIC_LEVEL`] and maps its six commands onto the methods below.
//!
//! A provider runs only while a feed that needs it is watched. A new `watch` replaces the previous one: providers
//! that are no longer needed stop, new ones start, and the current value of every watched feed is delivered at once,
//! then each change. Calls block (they start threads and talk to Windows); make them from a worker thread.

use crate::audio;
use crate::calendar;
use crate::clock::now_ms;
use crate::emit::{lock, Emitter};
use crate::hub::TileHub;
use crate::hydration::Hydration;
use crate::microphone;
use crate::paths::DataDir;
use crate::protocol::{ContactAction, TileData, TileId};
use crate::shell;
use crate::stopwatch::Stopwatch;
use crate::wire::{
    agenda_feed, audio_feed, contacts_feed, meeting_feed, mic_feed, AudioOp, Feed, FeedName, FeedsUpdate, HydrationOp,
    Issue, StopwatchOp,
};
use crate::zone::{Local, Zone};
use std::collections::{BTreeSet, HashSet};
use std::sync::{Arc, Mutex};

/// The event that carries a [`FeedsUpdate`] to the dock window.
pub const EVENT_FEEDS: &str = "dock://tiles";
/// The event that carries the microphone's live level, 0 to 1, while it is watched.
pub const EVENT_MIC_LEVEL: &str = "dock://mic-level";

pub enum DockEvent {
    Feeds(Box<FeedsUpdate>),
    MicLevel(f32),
}

#[derive(Default)]
struct Watching {
    feeds: BTreeSet<FeedName>,
    mic_level: bool,
}

/// What providers report into: the sink to the dock window, and which feeds the window is watching.
struct Core {
    sink: Box<dyn Fn(DockEvent) + Send + Sync>,
    zone: Arc<dyn Zone>,
    watching: Mutex<Watching>,
}

impl Core {
    /// Passes on the feeds of `update` that are being watched.
    fn deliver(&self, update: FeedsUpdate) {
        let wanted = lock(&self.watching).feeds.clone();
        let update = update.only(&wanted);
        if !update.is_empty() {
            (self.sink)(DockEvent::Feeds(Box::new(update)));
        }
    }

    fn tile_data(&self, data: TileData) {
        if let TileData::MicrophoneLevel(level) = &data {
            if lock(&self.watching).mic_level {
                (self.sink)(DockEvent::MicLevel(level.peak.clamp(0.0, 1.0)));
            }
            return;
        }
        self.deliver(feeds_from(&data, now_ms(), &*self.zone));
    }
}

/// The feeds a tile's data feeds. Tiles the dock UI has no feed for (clipboard, shelf, toggles) feed none.
fn feeds_from(data: &TileData, now: i64, zone: &dyn Zone) -> FeedsUpdate {
    let mut update = FeedsUpdate::default();
    match data {
        TileData::Audio(state) => update.audio = Some(audio_feed(state)),
        TileData::Microphone(state) => update.mic = Some(mic_feed(state)),
        TileData::Contacts(state) => update.contacts = Some(contacts_feed(state)),
        TileData::Calendar(state) => {
            update.meeting = Some(meeting_feed(state, now));
            update.agenda = Some(agenda_feed(state, now, zone));
        }
        _ => {}
    }
    update
}

/// The hub tile that provides a feed; the stopwatch and the water log have providers of their own.
fn tile_of(feed: FeedName) -> Option<TileId> {
    match feed {
        FeedName::Contacts => Some(TileId::Contacts),
        FeedName::Meeting | FeedName::Agenda => Some(TileId::Calendar),
        FeedName::Mic => Some(TileId::Microphone),
        FeedName::Audio => Some(TileId::Audio),
        FeedName::Stopwatch | FeedName::Hydration => None,
    }
}

fn tiles_for(feeds: &BTreeSet<FeedName>) -> HashSet<TileId> {
    feeds.iter().filter_map(|f| tile_of(*f)).collect()
}

pub struct DockTiles {
    core: Arc<Core>,
    hub: TileHub,
    stopwatch: Stopwatch,
    hydration: Hydration,
}

impl DockTiles {
    /// `sink` receives every event for the dock window; it is called from provider threads.
    pub fn new(data_dir: DataDir, sink: impl Fn(DockEvent) + Send + Sync + 'static) -> Self {
        Self::in_zone(data_dir, Arc::new(Local), sink)
    }

    fn in_zone(data_dir: DataDir, zone: Arc<dyn Zone>, sink: impl Fn(DockEvent) + Send + Sync + 'static) -> Self {
        let core =
            Arc::new(Core { sink: Box::new(sink), zone: zone.clone(), watching: Mutex::new(Watching::default()) });
        let hub_core = core.clone();
        let hub = TileHub::new(data_dir.clone(), Emitter::new(move |data| hub_core.tile_data(data)));
        let stopwatch_core = core.clone();
        let stopwatch = Stopwatch::new(data_dir.stopwatch(), move |view| {
            stopwatch_core.deliver(FeedsUpdate { stopwatch: Some(Feed::data(view)), ..FeedsUpdate::default() });
        });
        let hydration_core = core.clone();
        let hydration = Hydration::new(data_dir.hydration(), zone, move |feed| {
            hydration_core.deliver(FeedsUpdate { hydration: Some(feed), ..FeedsUpdate::default() });
        });
        Self { core, hub, stopwatch, hydration }
    }

    /// Makes `feeds` the set being watched, replacing the previous set.
    pub fn watch(&self, feeds: &[FeedName]) {
        let wanted: BTreeSet<FeedName> = feeds.iter().copied().collect();
        let (before, water_was_watched) = {
            let mut watching = lock(&self.core.watching);
            let before = std::mem::replace(&mut watching.feeds, wanted.clone());
            let water = before.contains(&FeedName::Hydration);
            (tiles_for(&before), water)
        };
        let after = tiles_for(&wanted);
        let mut failed: BTreeSet<FeedName> = BTreeSet::new();
        for tile in after.difference(&before) {
            if self.hub.subscribe(*tile).is_err() {
                failed.extend(wanted.iter().filter(|f| tile_of(**f) == Some(*tile)));
            }
        }
        for tile in before.difference(&after) {
            self.hub.unsubscribe(*tile);
        }
        match (water_was_watched, wanted.contains(&FeedName::Hydration)) {
            (false, true) => {
                if self.hydration.start().is_err() {
                    failed.insert(FeedName::Hydration);
                }
            }
            (true, false) => self.hydration.stop(),
            _ => {}
        }
        self.deliver_current(&wanted, &failed);
    }

    /// The current value of every watched feed, with the feeds of a provider that would not start saying so.
    fn deliver_current(&self, wanted: &BTreeSet<FeedName>, failed: &BTreeSet<FeedName>) {
        let now = now_ms();
        let mut update = FeedsUpdate::default();
        for tile in tiles_for(wanted) {
            update.absorb(feeds_from(&self.hub.state(tile), now, &*self.core.zone));
        }
        if wanted.contains(&FeedName::Stopwatch) {
            update.stopwatch = Some(Feed::data(self.stopwatch.view()));
        }
        if wanted.contains(&FeedName::Hydration) {
            update.hydration = Some(self.hydration.view(now));
        }
        for feed in failed {
            update.absorb(FeedsUpdate::failed(*feed, Issue::Error));
        }
        self.core.deliver(update);
    }

    pub fn unwatch(&self) {
        self.watch(&[]);
    }

    /// Starts reading the microphone's level. Windows shows its microphone indicator while this is on.
    pub fn mic_watch(&self) -> Result<(), String> {
        {
            let mut watching = lock(&self.core.watching);
            if watching.mic_level {
                return Ok(());
            }
            watching.mic_level = true;
        }
        self.hub.subscribe(TileId::MicrophoneLevel).map(|_| ()).inspect_err(|_| {
            lock(&self.core.watching).mic_level = false;
        })
    }

    pub fn mic_unwatch(&self) {
        let was_watching = std::mem::replace(&mut lock(&self.core.watching).mic_level, false);
        if was_watching {
            self.hub.unsubscribe(TileId::MicrophoneLevel);
        }
    }

    /// Stops every provider. Call when the dock quits.
    pub fn shutdown(&self) {
        *lock(&self.core.watching) = Watching::default();
        self.hub.shutdown();
        self.hydration.stop();
    }

    // ------------------------------------------------------------ commands

    /// Calls, video-calls or messages a saved contact, over the first of their ways that can.
    pub fn contact(&self, id: &str, action: ContactAction) -> Result<(), String> {
        shell::open_uri(&self.hub.contact_link(id, action)?)
    }

    /// Opens a meeting link, and only a link that is itself a recognised meeting link.
    pub fn join_meeting(&self, url: &str) -> Result<(), String> {
        calendar::join(url)
    }

    pub fn stopwatch(&self, op: StopwatchOp) -> Result<(), String> {
        self.stopwatch.command(op, now_ms())
    }

    /// Mutes the microphone, or unmutes it, for the whole system.
    pub fn toggle_mic(&self) -> Result<(), String> {
        let state = microphone::read_once();
        if !state.available {
            return Err("No microphone is connected".to_owned());
        }
        microphone::set_muted(!state.muted)
    }

    pub fn hydration(&self, op: HydrationOp) -> Result<(), String> {
        self.hydration.command(op, now_ms())
    }

    pub fn audio(&self, op: AudioOp) -> Result<(), String> {
        match op {
            AudioOp::Output { device_id } => audio::set_default_device(&device_id),
            AudioOp::Volume { value } if value.is_finite() => audio::set_volume(value),
            AudioOp::Volume { .. } => Err("That is not a volume".to_owned()),
            AudioOp::Mute { muted } => audio::set_muted(muted),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        AudioDevice, AudioState, CalendarEvent, CalendarSource, CalendarState, Channel, Contact, DeviceKind, Handle,
        MeetingLink, MeetingService, MicrophoneLevel, MicrophoneState, TileCommand,
    };
    use crate::wire::{ContactsView, StopwatchView};
    use std::sync::mpsc::{channel, Receiver};
    use std::time::Duration;

    /// Local time is the machine's, which suits a test that only needs "today" to be today.
    fn dock() -> (DockTiles, Receiver<DockEvent>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = channel();
        let dock = DockTiles::new(DataDir::at(dir.path()), move |e| drop(tx.send(e)));
        (dock, rx, dir)
    }

    fn feeds(event: DockEvent) -> FeedsUpdate {
        match event {
            DockEvent::Feeds(update) => *update,
            DockEvent::MicLevel(_) => panic!("a feed update was expected"),
        }
    }

    fn event(rx: &Receiver<DockEvent>) -> DockEvent {
        rx.recv_timeout(Duration::from_secs(5)).expect("an event")
    }

    #[test]
    fn watching_delivers_the_current_values_at_once_and_then_each_change() {
        let (dock, rx, _dir) = dock();
        dock.watch(&[FeedName::Stopwatch, FeedName::Hydration]);
        let first = feeds(event(&rx));
        assert!(first.stopwatch.is_some() && first.hydration.is_some(), "both feeds arrive in one delivery");
        assert_eq!(first.contacts, None);
        dock.stopwatch(StopwatchOp::Start).unwrap();
        let change = feeds(event(&rx));
        assert_eq!(change.stopwatch.and_then(|f| f.data).map(|v| v.running), Some(true));
        assert_eq!(change.hydration, None, "only what changed");
        dock.hydration(HydrationOp::Log { ml: 250 }).unwrap();
        let logged = feeds(event(&rx)).hydration.and_then(|f| f.data).map(|v| v.logged_ml);
        assert_eq!(logged, Some(250));
    }

    #[test]
    fn a_new_watch_replaces_the_old_one_and_unwatched_feeds_stay_quiet() {
        let (dock, rx, _dir) = dock();
        dock.watch(&[FeedName::Stopwatch]);
        let _ = event(&rx);
        dock.watch(&[FeedName::Hydration]);
        let replaced = feeds(event(&rx));
        assert!(replaced.hydration.is_some() && replaced.stopwatch.is_none());
        dock.stopwatch(StopwatchOp::Start).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "nobody watches the stopwatch now");
        dock.unwatch();
        dock.hydration(HydrationOp::Log { ml: 250 }).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "nothing is watched");
    }

    #[test]
    fn providers_run_only_for_watched_feeds_and_the_calendar_serves_two_feeds() {
        let (dock, rx, _dir) = dock();
        assert!(dock.hub.active().is_empty());
        dock.watch(&[FeedName::Meeting, FeedName::Agenda]);
        assert_eq!(dock.hub.active(), [TileId::Calendar], "one provider behind both feeds");
        let both = feeds(event(&rx));
        assert!(both.meeting.is_some() && both.agenda.is_some());
        dock.watch(&[FeedName::Agenda]);
        assert_eq!(dock.hub.active(), [TileId::Calendar], "still needed by the agenda");
        dock.unwatch();
        assert!(dock.hub.active().is_empty(), "nothing watched, nothing running");
    }

    #[test]
    fn a_saved_contact_reaches_the_contacts_feed_with_its_ways_in_order() {
        let (dock, rx, _dir) = dock();
        dock.watch(&[FeedName::Contacts]);
        let empty = feeds(event(&rx)).contacts.and_then(|f| f.data);
        assert_eq!(empty, Some(ContactsView { contacts: vec![] }));
        let contact = Contact {
            id: "ada".into(),
            name: "Ada Lovelace".into(),
            handles: vec![
                Handle { channel: Channel::Email, value: "ada@example.com".into() },
                Handle { channel: Channel::Teams, value: "ada@example.com".into() },
                Handle { channel: Channel::Phone, value: "+15551234567".into() },
            ],
        };
        assert!(dock.hub.command(TileCommand::ContactsSave { contact }).is_ok());
        let view = feeds(event(&rx)).contacts.and_then(|f| f.data).expect("contacts");
        assert_eq!(
            serde_json::to_value(view).unwrap(),
            serde_json::json!({ "contacts": [{
                "id": "ada",
                "name": "Ada Lovelace",
                "channels": [
                    { "action": "call", "app": "Teams" },
                    { "action": "video", "app": "Teams" },
                    { "action": "message", "app": "Mail" }
                ]
            }]})
        );
        assert_eq!(
            dock.hub.contact_link("ada", ContactAction::Call).unwrap(),
            "msteams://teams.microsoft.com/l/call/0/0?users=ada%40example.com",
            "the first way that can make the call"
        );
        assert!(dock.contact("nobody", ContactAction::Call).is_err());
    }

    #[test]
    fn calendar_data_feeds_the_meeting_and_the_agenda_and_other_tiles_feed_nothing() {
        let now = now_ms();
        let event = |id: &str, from: i64, to: i64| CalendarEvent {
            id: id.into(),
            title: id.into(),
            start_ms: from,
            end_ms: to,
            all_day: false,
            location: None,
            calendar: None,
            join: Some(MeetingLink { service: MeetingService::Zoom, url: "https://zoom.us/j/123456789".into() }),
        };
        let state = CalendarState {
            source: CalendarSource::IcsFile,
            problem: None,
            ics_path: None,
            events: vec![
                event("over", now - 7_200_000, now - 3_600_000),
                event("next", now + 600_000, now + 1_200_000),
            ],
        };
        let update = feeds_from(&TileData::Calendar(state), now, &Local);
        let meeting = update.meeting.and_then(|f| f.data).expect("a meeting");
        assert_eq!((meeting.id.as_str(), meeting.service), ("next", Some("Zoom")), "the first that has not ended");
        assert_eq!(meeting.join_url.as_deref(), Some("https://zoom.us/j/123456789"));
        assert!(update.agenda.is_some());
        let none = feeds_from(
            &TileData::MicrophoneLevel(MicrophoneLevel { peak: 1.0, listening: true, problem: None }),
            now,
            &Local,
        );
        assert!(none.is_empty());
    }

    #[test]
    fn audio_and_the_microphone_say_when_there_is_no_device() {
        let now = now_ms();
        let audio = AudioState { available: false, volume: 0.0, muted: false, devices: vec![], apps: vec![] };
        assert_eq!(feeds_from(&TileData::Audio(audio), now, &Local).audio, Some(Feed::issue(Issue::NoDevice)));
        let mic = MicrophoneState { available: false, device_name: None, muted: false, volume: 0.0 };
        assert_eq!(feeds_from(&TileData::Microphone(mic), now, &Local).mic, Some(Feed::issue(Issue::NoDevice)));
        let speakers = AudioState {
            available: true,
            volume: 0.4,
            muted: false,
            devices: vec![AudioDevice {
                id: "a".into(),
                name: "Speakers".into(),
                kind: DeviceKind::Speakers,
                is_default: true,
            }],
            apps: vec![],
        };
        let view = feeds_from(&TileData::Audio(speakers), now, &Local).audio.and_then(|f| f.data).unwrap();
        assert_eq!((view.devices.len(), view.devices[0].current, view.volume), (1, true, 0.4));
    }

    #[test]
    fn the_microphone_level_is_passed_on_only_while_it_is_watched() {
        let (dock, rx, _dir) = dock();
        let level = |peak| TileData::MicrophoneLevel(MicrophoneLevel { peak, listening: true, problem: None });
        dock.core.tile_data(level(0.5));
        assert!(rx.try_recv().is_err(), "nobody watches the level");
        lock(&dock.core.watching).mic_level = true;
        dock.core.tile_data(level(1.7));
        assert!(matches!(rx.try_recv(), Ok(DockEvent::MicLevel(p)) if p == 1.0), "clamped to 0..1");
        lock(&dock.core.watching).mic_level = false;
        dock.mic_unwatch();
        assert!(dock.hub.active().is_empty());
    }

    #[test]
    fn commands_that_cannot_work_say_why_without_touching_the_system() {
        let (dock, _rx, _dir) = dock();
        assert!(dock.join_meeting("https://example.com/").is_err());
        assert!(dock.audio(AudioOp::Volume { value: f32::NAN }).is_err());
        assert!(dock.audio(AudioOp::Output { device_id: "no-such-device".into() }).is_err());
        assert!(dock.hydration(HydrationOp::Log { ml: 0 }).is_err());
        assert!(dock.stopwatch(StopwatchOp::Pause).is_ok(), "pausing a stopped stopwatch is not an error");
    }

    #[test]
    fn the_stopwatch_feed_is_the_ui_shape() {
        let (dock, rx, _dir) = dock();
        dock.watch(&[FeedName::Stopwatch]);
        assert_eq!(
            feeds(event(&rx)).stopwatch,
            Some(Feed::data(StopwatchView { running: false, started_at: None, banked_ms: 0, laps: vec![] }))
        );
    }
}
